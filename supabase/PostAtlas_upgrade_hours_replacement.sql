-- =====================================================================================================
-- PostAtlas upgrade: turnaround in HOURS, and the replacement-order fix.
--
-- Run ONCE on an existing database AFTER PostAtlas_upgrade_reviews_deadlines.sql. Idempotent and additive (the old
-- `turnaround_days_*` columns are kept, unused, so nothing is lost). New installs already contain this file as section 17 of
-- PostAtlas_fresh_supabase_schema.sql.
--
-- WHAT IT CHANGES
--   1. Publishers state turnaround in HOURS (publisher_websites.turnaround_hours_min / _max, 1-2880). Existing listings are
--      converted (days x 24). The order deadline is `accepted_at + turnaround_hours`, where turnaround_hours is snapshotted from
--      the listing's hours_max when the order is placed (default 168 hours when a listing states none).
--   2. Replacement fix: the ORIGINAL publisher can now deliver the replacement. New legal pairs
--      REPLACEMENT_REQUESTED -> PUBLISHED (publisher) and REPLACEMENT_REQUESTED -> PUBLISHER_REJECTED (customer, only after the
--      replacement deadline, via request_expiry_remedy). A replacement request starts a fresh delivery clock.
-- =====================================================================================================

-- ---- 1. listing turnaround in hours -------------------------------------------------------------------------------------
alter table public.publisher_websites add column if not exists turnaround_hours_min int;
alter table public.publisher_websites add column if not exists turnaround_hours_max int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'publisher_websites_turnaround_hours_min_check') then
    alter table public.publisher_websites add constraint publisher_websites_turnaround_hours_min_check check (turnaround_hours_min is null or turnaround_hours_min between 1 and 2880);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'publisher_websites_turnaround_hours_max_check') then
    alter table public.publisher_websites add constraint publisher_websites_turnaround_hours_max_check check (turnaround_hours_max is null or turnaround_hours_max between 1 and 2880);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'publisher_websites_turnaround_hours_order_check') then
    alter table public.publisher_websites add constraint publisher_websites_turnaround_hours_order_check check (turnaround_hours_min is null or turnaround_hours_max is null or turnaround_hours_min <= turnaround_hours_max);
  end if;
end $$;
-- Convert what publishers entered in days (only where hours are not set yet, so re-running never overwrites a new value).
update public.publisher_websites set turnaround_hours_min = turnaround_days_min * 24 where turnaround_hours_min is null and turnaround_days_min is not null;
update public.publisher_websites set turnaround_hours_max = turnaround_days_max * 24 where turnaround_hours_max is null and turnaround_days_max is not null;
-- The public marketplace may read the new columns exactly like the old ones.
grant select (turnaround_hours_min, turnaround_hours_max) on public.publisher_websites to anon, authenticated;

-- A listing that states no turnaround gets 168 hours (7 days); mirrored by DEFAULT_TURNAROUND_HOURS in src/lib/order-deadline.ts.
create or replace function public.order_turnaround_hours(p_hours int) returns int
language sql immutable set search_path = '' as $$ select coalesce(p_hours, 168) $$;

-- ---- 2. legal (from -> to) pairs (mirror src/lib/order-state.ts; a test fails if they differ) -----------------------------
insert into public.order_status_transitions (from_status, to_status) values
  ('REPLACEMENT_REQUESTED', 'PUBLISHED'),
  ('REPLACEMENT_REQUESTED', 'PUBLISHER_REJECTED')
on conflict do nothing;

-- ---- 3. the delivery clock also covers a requested replacement ----------------------------------------------------------
drop index if exists public.orders_due_idx;
create index orders_due_idx on public.orders (due_at) where status in ('ACCEPTED', 'IN_PROGRESS', 'REPLACEMENT_REQUESTED');

-- Same as before, plus: entering REPLACEMENT_REQUESTED starts a fresh window for the original publisher.
create or replace function public.transition_order(
  p_order uuid, p_from text, p_to text, p_actor uuid, p_actor_role text, p_note text default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int; v_restart boolean;
begin
  if p_actor_role is null or p_actor_role not in ('customer', 'publisher', 'admin', 'system') then
    raise exception 'invalid actor role';
  end if;
  v_restart := p_to in ('ACCEPTED', 'REPLACEMENT_REQUESTED') or (p_to = 'IN_PROGRESS' and p_from in ('REPLACEMENT_REQUESTED', 'DISPUTED'));
  perform set_config('postatlas.transition', '1', true);   -- transaction-local flags read by orders_guard()
  perform set_config('postatlas.deadline', '1', true);
  update public.orders o set
         status             = p_to,
         accepted_at        = case when p_to = 'ACCEPTED' then now() else o.accepted_at end,
         due_at             = case when v_restart then now() + make_interval(hours => coalesce(o.turnaround_hours, public.order_turnaround_hours(null))) else o.due_at end,
         expiry_notified_at = case when v_restart or p_to = 'PENDING_PUBLISHER' then null else o.expiry_notified_at end,
         expiry_choice      = case when p_to in ('ACCEPTED', 'PENDING_PUBLISHER') then null else o.expiry_choice end,
         expiry_choice_at   = case when p_to in ('ACCEPTED', 'PENDING_PUBLISHER') then null else o.expiry_choice_at end
   where o.id = p_order and o.status = p_from;
  get diagnostics n = row_count;
  perform set_config('postatlas.transition', '', true);
  perform set_config('postatlas.deadline', '', true);
  if n = 0 then
    return false;
  end if;
  insert into public.order_events (order_id, actor_id, actor_role, from_status, to_status, note)
  values (p_order, p_actor, p_actor_role, p_from, p_to, left(p_note, 2000));
  return true;
end $$;

-- Order creation and reassignment now read the listing's HOURS.
create or replace function public.create_order_priced(
  p_org uuid, p_user uuid, p_listing uuid, p_customer_site uuid, p_opportunity uuid, p_type text, p_target text, p_anchor text,
  p_currency text, p_method uuid, p_fx_rate numeric, p_fx_source text, p_fx_at timestamptz, p_expected_due numeric
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare lst record; price numeric; comm numeric; due numeric; v_order uuid;
begin
  if p_type not in ('guest_post', 'link_insertion') then raise exception 'invalid placement type'; end if;
  if p_currency not in ('USD', 'PKR') then raise exception 'unsupported currency'; end if;
  if not exists (select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = p_user) then
    raise exception 'not a member of that workspace';
  end if;
  select w.id, w.status, w.price_guest_post, w.price_link_insertion, w.turnaround_hours_max into lst from public.publisher_websites w where w.id = p_listing;
  if not found or lst.status <> 'approved' then raise exception 'this publisher is not available for orders'; end if;
  price := case p_type when 'guest_post' then lst.price_guest_post else lst.price_link_insertion end;
  if price is null or price <= 0 then raise exception 'this publisher has not set a price for that placement type'; end if;
  if not exists (select 1 from public.payment_methods m where m.id = p_method and m.enabled and p_currency = any (m.currencies)) then
    raise exception 'that payment method is not available in %', p_currency;
  end if;
  if p_currency = 'PKR' and (p_fx_rate is null or p_fx_source is null or p_fx_at is null) then raise exception 'PKR checkout needs a recorded exchange rate'; end if;
  if p_currency = 'PKR' and p_fx_at < now() - interval '48 hours' then raise exception 'the exchange rate is too old for checkout'; end if;
  comm := round(price * public.commission_bps() / 10000.0, 2);
  due := case p_currency when 'USD' then price else round(price * p_fx_rate, 0) end;
  if p_expected_due is distinct from due then raise exception 'checkout amount mismatch'; end if;

  insert into public.orders (organization_id, website_id, customer_website_id, opportunity_id, order_type, target_url, anchor_text, customer_price, created_by, turnaround_hours)
  values (p_org, p_listing, p_customer_site, p_opportunity, p_type, p_target, p_anchor, price, p_user, public.order_turnaround_hours(lst.turnaround_hours_max))
  returning id into v_order;
  insert into public.order_pricing (order_id, listing_id, list_price_usd, customer_base_usd, commission_bps, commission_usd, publisher_net_usd,
                                    checkout_currency, fx_rate, fx_source, fx_rate_at, amount_due, payment_method_id)
  values (v_order, p_listing, price, price, public.commission_bps(), comm, price - comm,
          p_currency, case when p_currency = 'PKR' then p_fx_rate end, case when p_currency = 'PKR' then p_fx_source end,
          case when p_currency = 'PKR' then p_fx_at end, due, p_method);
  insert into public.order_events (order_id, actor_id, actor_role, event_type, to_status, note)
  values (v_order, p_user, 'customer', 'created', 'PAYMENT_PENDING', 'Order created');
  return v_order;
end $$;

create or replace function public.reassign_order(p_order uuid, p_case uuid, p_new_listing uuid, p_admin uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare o record; c record; lst record; snap record; price numeric; v_ent numeric; from_status text;
begin
  perform public.assert_admin(p_admin);
  select id, status, order_type, website_id into o from public.orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;
  select * into c from public.recovery_cases where id = p_case and order_id = p_order for update;
  if not found or c.status not in ('OPEN', 'ESCALATED') then raise exception 'the recovery case is not open'; end if;
  from_status := o.status;
  if c.kind in ('publisher_rejection', 'publisher_timeout') and from_status <> 'PUBLISHER_REJECTED' then raise exception 'the order is not in the rejected state'; end if;
  if c.kind = 'link_restoration' and from_status not in ('ISSUE_DETECTED', 'REPLACEMENT_REQUESTED') then raise exception 'the order has no confirmed link issue'; end if;
  select w.id, w.status, w.publisher_id, w.price_guest_post, w.price_link_insertion, w.turnaround_hours_max into lst from public.publisher_websites w where w.id = p_new_listing;
  if not found or lst.status <> 'approved' then raise exception 'the replacement listing is not approved'; end if;
  if lst.publisher_id = c.original_publisher_id then raise exception 'choose a different publisher'; end if;
  price := case o.order_type when 'guest_post' then lst.price_guest_post else lst.price_link_insertion end;
  if price is null or price <= 0 then raise exception 'the replacement listing has no price for this placement type'; end if;
  select * into snap from public.order_pricing where order_id = p_order;
  if not found then raise exception 'order has no pricing snapshot'; end if;
  if price > snap.list_price_usd then
    raise exception 'the replacement listing (% USD) costs more than the original order budget (% USD)', price, snap.list_price_usd;
  end if;
  v_ent := price - round(price * snap.commission_bps / 10000.0, 2);

  if from_status = 'ISSUE_DETECTED' then
    if not public.transition_order(p_order, 'ISSUE_DETECTED', 'REPLACEMENT_REQUESTED', p_admin, 'admin', 'Replacement arranged by admin') then raise exception 'order state changed'; end if;
    from_status := 'REPLACEMENT_REQUESTED';
  end if;
  perform set_config('postatlas.reassign', '1', true);
  update public.orders set website_id = p_new_listing, turnaround_hours = public.order_turnaround_hours(lst.turnaround_hours_max) where id = p_order;
  perform set_config('postatlas.reassign', '', true);
  if not public.transition_order(p_order, from_status, 'PENDING_PUBLISHER', p_admin, 'admin', left('Reassigned to another publisher. ' || coalesce(p_note, ''), 1500)) then raise exception 'order state changed'; end if;
  update public.published_placements set health = 'PENDING', next_check_at = null, consecutive_failures = 0, verified_at = null, verified_by = null, updated_at = now() where order_id = p_order;
  update public.recovery_cases set status = 'REASSIGNED', replacement_listing_id = p_new_listing, replacement_list_price_usd = price, replacement_entitlement_usd = v_ent, updated_at = now() where id = p_case;
  perform public.cancel_unpaid_payouts(p_order, p_admin, case c.kind when 'publisher_rejection' then 'Original publisher declined the order'
                                                                      when 'publisher_timeout' then 'Original publisher missed the delivery deadline; order reassigned'
                                                                      else 'Original publisher did not keep the link; order reassigned' end);
end $$;

-- Replacement orders that are already open when this upgrade runs get a fresh window starting now.
do $$
begin
  perform set_config('postatlas.deadline', '1', true);
  update public.orders o
     set due_at = now() + make_interval(hours => coalesce(o.turnaround_hours, public.order_turnaround_hours(null)))
   where o.status = 'REPLACEMENT_REQUESTED' and o.due_at is null;
  perform set_config('postatlas.deadline', '', true);
end $$;

-- ---- 4. the customer's choice also applies to an overdue replacement ---------------------------------------------------
create or replace function public.request_expiry_remedy(p_order uuid, p_actor uuid, p_choice text, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o record; v_case uuid; v_reason text;
begin
  if p_choice not in ('refund', 'alternative') then raise exception 'invalid choice'; end if;
  select id, status, organization_id, due_at into o from public.orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;
  if not exists (select 1 from public.organization_members m where m.organization_id = o.organization_id and m.user_id = p_actor and m.role in ('owner', 'seo_manager')) then
    raise exception 'your role in this workspace does not allow that action';
  end if;
  if o.status not in ('ACCEPTED', 'IN_PROGRESS', 'REPLACEMENT_REQUESTED') or o.due_at is null or o.due_at > now() then
    raise exception 'this order is not past its delivery deadline';
  end if;
  if not exists (select 1 from public.payments pa where pa.order_id = p_order and pa.status = 'PAID') then
    raise exception 'there is no confirmed payment on this order';
  end if;

  v_reason := 'Publisher missed the delivery deadline (' || to_char(o.due_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC). Customer chose: '
              || case p_choice when 'refund' then 'a refund' else 'an alternative placement' end
              || case when coalesce(btrim(p_note), '') <> '' then '. Note: ' || left(btrim(p_note), 400) else '' end;
  if not public.transition_order(p_order, o.status, 'PUBLISHER_REJECTED', p_actor, 'customer', left(v_reason, 1900)) then
    raise exception 'order state changed';
  end if;
  perform set_config('postatlas.deadline', '1', true);
  update public.orders set expiry_choice = p_choice, expiry_choice_at = now() where id = p_order;
  perform set_config('postatlas.deadline', '', true);
  v_case := public.open_recovery_case(p_order, 'publisher_timeout', v_reason, p_actor, 48);
  perform public.cancel_unpaid_payouts(p_order, p_actor, 'Publisher missed the delivery deadline');
  if p_choice = 'refund' then
    perform public.request_refund(p_order, null, left(v_reason, 900), p_actor, 'customer', 'timeout:' || p_order::text);
  end if;
  return v_case;
end $$;

-- ---- 5. clean-up and privileges --------------------------------------------------------------------------------------------
-- The day-based helper is superseded (nothing calls it any more).
drop function if exists public.turnaround_hours_for(int);
do $$
declare f text;
begin
  foreach f in array array[
    'order_turnaround_hours(int)', 'transition_order(uuid,text,text,uuid,text,text)',
    'create_order_priced(uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,numeric,text,timestamptz,numeric)',
    'reassign_order(uuid,uuid,uuid,uuid,text)', 'request_expiry_remedy(uuid,uuid,text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
