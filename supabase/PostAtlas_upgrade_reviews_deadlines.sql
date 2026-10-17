-- =====================================================================================================
-- PostAtlas upgrade: site reviews, order completion deadlines, expired-order remedies.
--
-- Run ONCE on an existing database, after PostAtlas_upgrade_payout_hardening.sql. It is idempotent and additive
-- (nothing is dropped or deleted), so running it twice is harmless. New installs already contain this file as
-- section 16 of PostAtlas_fresh_supabase_schema.sql and must NOT need it.
--
-- WHAT IT ADDS
--   1. Order deadline: `turnaround_hours` is snapshotted from the listing when the order is placed; the clock
--      (`accepted_at`, `due_at`) starts when the publisher accepts, inside transition_order(), never from the browser.
--   2. Expired-order remedy: request_expiry_remedy() lets the paying customer, once `due_at` has passed, ask for a
--      REFUND or an ALTERNATIVE placement. It reuses the existing recovery case + refund workflow (new recovery kind
--      'publisher_timeout'); nothing is refunded automatically and no money moves here.
--   3. Site reviews: one 1-5 star review (+ optional text) per COMPLETED order, shown on the listing, not on publisher profiles.
-- =====================================================================================================

-- ---- 1. deadline columns on orders ----------------------------------------------------------------------------------
alter table public.orders add column if not exists turnaround_hours   int;          -- delivery window agreed when the order was placed
alter table public.orders add column if not exists accepted_at        timestamptz;  -- when the publisher accepted
alter table public.orders add column if not exists due_at             timestamptz;  -- accepted_at + turnaround_hours (reset when a replacement restarts the work)
alter table public.orders add column if not exists expiry_notified_at timestamptz;  -- the "deadline missed" notification was sent
alter table public.orders add column if not exists expiry_choice      text;         -- what the customer chose after the deadline passed
alter table public.orders add column if not exists expiry_choice_at   timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_turnaround_hours_check') then
    alter table public.orders add constraint orders_turnaround_hours_check check (turnaround_hours is null or turnaround_hours between 1 and 2880);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_expiry_choice_check') then
    alter table public.orders add constraint orders_expiry_choice_check check (expiry_choice is null or expiry_choice in ('refund', 'alternative'));
  end if;
end $$;
create index if not exists orders_due_idx on public.orders (due_at) where status in ('ACCEPTED', 'IN_PROGRESS');

-- A listing states its slowest turnaround in DAYS; the order stores HOURS. A listing with no stated turnaround gets 7 days
-- (mirrored by DEFAULT_TURNAROUND_DAYS in src/lib/order-deadline.ts; a test fails if they differ).
create or replace function public.turnaround_hours_for(p_days_max int) returns int
language sql immutable set search_path = '' as $$ select coalesce(p_days_max, 7) * 24 $$;

-- ---- 2. orders guard: the deadline fields are managed by the database workflow only ------------------------------
create or replace function public.orders_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'PAYMENT_PENDING';
    new.disputed_from := null;
    new.created_at := now();
    new.updated_at := now();
    new.accepted_at := null; new.due_at := null; new.expiry_notified_at := null; new.expiry_choice := null; new.expiry_choice_at := null;
    if not exists (select 1 from public.publisher_websites w where w.id = new.website_id and w.status = 'approved') then
      raise exception 'orders can only be placed on approved publisher listings';
    end if;
    if new.customer_website_id is not null and not exists (
         select 1 from public.websites cw where cw.id = new.customer_website_id and cw.organization_id = new.organization_id) then
      raise exception 'the target website does not belong to this organization';
    end if;
    if new.opportunity_id is not null and not exists (
         select 1 from public.opportunities op where op.id = new.opportunity_id and op.organization_id = new.organization_id) then
      raise exception 'the opportunity does not belong to this organization';
    end if;
    return new;
  end if;

  if pg_trigger_depth() > 1 and coalesce(current_setting('postatlas.reassign', true), '') <> '1' then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.order_type is distinct from old.order_type
     or new.target_url is distinct from old.target_url
     or new.customer_price is distinct from old.customer_price
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'order price, owner, type and target cannot be changed';
  end if;
  if new.website_id is distinct from old.website_id and coalesce(current_setting('postatlas.reassign', true), '') <> '1' then
    raise exception 'the publisher listing can only be changed by reassign_order()';
  end if;
  if new.turnaround_hours is distinct from old.turnaround_hours
     and coalesce(current_setting('postatlas.reassign', true), '') <> '1'
     and coalesce(current_setting('postatlas.deadline', true), '') <> '1' then
    raise exception 'the order turnaround can only be set when the order is placed or reassigned';
  end if;
  if (new.accepted_at is distinct from old.accepted_at or new.due_at is distinct from old.due_at
      or new.expiry_choice is distinct from old.expiry_choice or new.expiry_choice_at is distinct from old.expiry_choice_at)
     and coalesce(current_setting('postatlas.deadline', true), '') <> '1' then
    raise exception 'order deadline fields can only be changed by the database workflow';
  end if;
  if new.status is distinct from old.status then
    if coalesce(current_setting('postatlas.transition', true), '') <> '1' then
      raise exception 'order status can only change through transition_order()';
    end if;
    if not exists (select 1 from public.order_status_transitions t where t.from_status = old.status and t.to_status = new.status) then
      raise exception 'illegal order transition % -> %', old.status, new.status;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

-- ---- 3. legal (from -> to) pairs: the customer may close out an order whose deadline has passed -------------------
-- Mirrors src/lib/order-state.ts (a test fails if they differ). Both pairs are reachable only through request_expiry_remedy().
insert into public.order_status_transitions (from_status, to_status) values
  ('ACCEPTED', 'PUBLISHER_REJECTED'),
  ('IN_PROGRESS', 'PUBLISHER_REJECTED')
on conflict do nothing;

-- ---- 4. transition_order: starts / restarts the delivery clock ---------------------------------------------------
-- Same contract as before (compare-and-set + history row). New: entering ACCEPTED starts the clock; restarting work after a
-- replacement request or a resolved dispute (-> IN_PROGRESS) gives a fresh window; handing the order to a new publisher
-- (-> PENDING_PUBLISHER) clears the previous publisher's missed-deadline marks.
create or replace function public.transition_order(
  p_order uuid, p_from text, p_to text, p_actor uuid, p_actor_role text, p_note text default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int; v_restart boolean;
begin
  if p_actor_role is null or p_actor_role not in ('customer', 'publisher', 'admin', 'system') then
    raise exception 'invalid actor role';
  end if;
  v_restart := p_to = 'ACCEPTED' or (p_to = 'IN_PROGRESS' and p_from in ('REPLACEMENT_REQUESTED', 'DISPUTED'));
  perform set_config('postatlas.transition', '1', true);   -- transaction-local flags read by orders_guard()
  perform set_config('postatlas.deadline', '1', true);
  update public.orders o set
         status             = p_to,
         accepted_at        = case when p_to = 'ACCEPTED' then now() else o.accepted_at end,
         due_at             = case when v_restart then now() + make_interval(hours => coalesce(o.turnaround_hours, public.turnaround_hours_for(null))) else o.due_at end,
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

-- ---- 5. order creation snapshots the turnaround ----------------------------------------------------------------------
-- Identical to the finance version except that `turnaround_hours` is derived from the listing HERE, never taken from the caller.
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
  select w.id, w.status, w.price_guest_post, w.price_link_insertion, w.turnaround_days_max into lst from public.publisher_websites w where w.id = p_listing;
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
  values (p_org, p_listing, p_customer_site, p_opportunity, p_type, p_target, p_anchor, price, p_user, public.turnaround_hours_for(lst.turnaround_days_max))
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

-- ---- 6. backfill (one atomic block; the flag lets the guard accept the deadline columns) ---------------------------
do $$
begin
  perform set_config('postatlas.deadline', '1', true);
  update public.orders o
     set turnaround_hours = public.turnaround_hours_for(w.turnaround_days_max)
    from public.publisher_websites w
   where w.id = o.website_id and o.turnaround_hours is null;
  -- Orders that are already accepted when this upgrade runs start their clock NOW instead of being instantly "late".
  update public.orders o
     set accepted_at = coalesce((select max(e.created_at) from public.order_events e where e.order_id = o.id and e.to_status = 'ACCEPTED'), o.updated_at),
         due_at = now() + make_interval(hours => o.turnaround_hours)
   where o.status in ('ACCEPTED', 'IN_PROGRESS') and o.due_at is null and o.turnaround_hours is not null;
  perform set_config('postatlas.deadline', '', true);
end $$;

-- ---- 7. recovery cases: a new kind for "the publisher missed the deadline" -----------------------------------------
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.recovery_cases'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%publisher_rejection%'
  loop
    execute format('alter table public.recovery_cases drop constraint %I', c.conname);
  end loop;
  alter table public.recovery_cases add constraint recovery_cases_kind_check check (kind in ('publisher_rejection', 'link_restoration', 'publisher_timeout'));
end $$;

create or replace function public.open_recovery_case(p_order uuid, p_kind text, p_reason text, p_actor uuid, p_deadline_hours int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o record; lst record; v_id uuid;
begin
  if p_kind not in ('publisher_rejection', 'link_restoration', 'publisher_timeout') then raise exception 'invalid case kind'; end if;
  select id, website_id into o from public.orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;
  select id into v_id from public.recovery_cases where order_id = p_order and kind = p_kind and status in ('OPEN', 'REASSIGNED', 'ESCALATED');
  if v_id is not null then return v_id; end if;
  select w.id, w.publisher_id into lst from public.publisher_websites w where w.id = o.website_id;
  insert into public.recovery_cases (order_id, kind, reason, original_publisher_id, original_listing_id, opened_by, deadline_at)
  values (p_order, p_kind, left(p_reason, 1000), lst.publisher_id, lst.id, p_actor, now() + make_interval(hours => greatest(1, least(p_deadline_hours, 720))))
  returning id into v_id;
  return v_id;
end $$;

-- Admin gives the order to a different approved listing. Same as the finance version; new: a 'publisher_timeout' case is handled
-- like a decline, and the delivery window follows the NEW listing's stated turnaround.
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
  select w.id, w.status, w.publisher_id, w.price_guest_post, w.price_link_insertion, w.turnaround_days_max into lst from public.publisher_websites w where w.id = p_new_listing;
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
  update public.orders set website_id = p_new_listing, turnaround_hours = public.turnaround_hours_for(lst.turnaround_days_max) where id = p_order;
  perform set_config('postatlas.reassign', '', true);
  if not public.transition_order(p_order, from_status, 'PENDING_PUBLISHER', p_admin, 'admin', left('Reassigned to another publisher. ' || coalesce(p_note, ''), 1500)) then raise exception 'order state changed'; end if;
  update public.published_placements set health = 'PENDING', next_check_at = null, consecutive_failures = 0, verified_at = null, verified_by = null, updated_at = now() where order_id = p_order;
  update public.recovery_cases set status = 'REASSIGNED', replacement_listing_id = p_new_listing, replacement_list_price_usd = price, replacement_entitlement_usd = v_ent, updated_at = now() where id = p_case;
  perform public.cancel_unpaid_payouts(p_order, p_admin, case c.kind when 'publisher_rejection' then 'Original publisher declined the order'
                                                                      when 'publisher_timeout' then 'Original publisher missed the delivery deadline; order reassigned'
                                                                      else 'Original publisher did not keep the link; order reassigned' end);
end $$;

-- ---- 8. the customer's choice after the deadline has passed -----------------------------------------------------------
-- One transaction: re-checks everything in the database (membership, payment, status, deadline), closes the order out of the
-- publisher's hands (-> PUBLISHER_REJECTED, the existing "needs recovery" state), cancels the publisher's UNPAID entitlement,
-- opens a recovery case for the admin queue and, for a refund, files a refund REQUEST (the normal manual refund workflow:
-- REQUESTED -> APPROVED -> PROCESSING -> COMPLETED; the order becomes CANCELLED only after a completed full refund).
-- Nothing is refunded here. Idempotent per order: a second call finds the order no longer ACCEPTED / IN_PROGRESS and refuses.
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
  if o.status not in ('ACCEPTED', 'IN_PROGRESS') or o.due_at is null or o.due_at > now() then
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

-- ---- 9. site reviews ----------------------------------------------------------------------------------------------
-- One review per order. It belongs to the LISTING (the website that delivered the placement), is written only by a member of
-- the buying workspace who may manage orders, and only after the placement was verified. It is shown on the public listing
-- page; reviewer identity is never exposed (the public grant below has no reviewer or workspace column).
create table if not exists public.site_reviews (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null unique references public.orders (id) on delete cascade,      -- unique: no duplicate review for an order
  listing_id      uuid not null references public.publisher_websites (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  reviewer_id     uuid references public.profiles (id) on delete set null,
  rating          smallint not null check (rating between 1 and 5),
  comment         text check (comment is null or char_length(comment) between 3 and 1500),
  status          text not null default 'published' check (status in ('published', 'hidden')),
  hidden_reason   text check (hidden_reason is null or char_length(hidden_reason) <= 500),
  hidden_by       uuid references public.profiles (id) on delete set null,
  hidden_at       timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists site_reviews_listing_idx on public.site_reviews (listing_id, created_at desc) where status = 'published';

-- Rating, text, order and listing are frozen once written; only moderation fields may change; rows are never deleted by hand.
-- (Rows still disappear when their listing / workspace / order is deleted: those cascades run at trigger depth > 1.)
create or replace function public.site_reviews_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then raise exception 'reviews cannot be deleted; hide them instead'; end if;
  if new.id is distinct from old.id or new.order_id is distinct from old.order_id or new.listing_id is distinct from old.listing_id
     or new.organization_id is distinct from old.organization_id or new.reviewer_id is distinct from old.reviewer_id
     or new.rating is distinct from old.rating or new.comment is distinct from old.comment or new.created_at is distinct from old.created_at then
    raise exception 'a submitted review cannot be edited';
  end if;
  return new;
end $$;
drop trigger if exists site_reviews_guard_trg on public.site_reviews;
create trigger site_reviews_guard_trg before update or delete on public.site_reviews for each row execute function public.site_reviews_guard();

alter table public.site_reviews enable row level security;
revoke all on public.site_reviews from anon, authenticated;
-- The public sees ONLY these columns of PUBLISHED reviews on APPROVED listings. No order, workspace or reviewer column is granted.
grant select (id, listing_id, rating, comment, status, created_at) on public.site_reviews to anon, authenticated;
drop policy if exists site_reviews_public on public.site_reviews;
create policy site_reviews_public on public.site_reviews for select to anon, authenticated
  using (status = 'published' and exists (select 1 from public.publisher_websites w where w.id = site_reviews.listing_id and w.status = 'approved'));

-- Per-listing aggregate for cards and the listing page. security_invoker: it can only ever show what the caller may read.
create or replace view public.site_review_stats with (security_invoker = true) as
  select listing_id, count(*)::int as review_count, round(avg(rating)::numeric, 2) as avg_rating
    from public.site_reviews where status = 'published' group by listing_id;
revoke all on public.site_review_stats from anon, authenticated;
grant select on public.site_review_stats to anon, authenticated;

-- Creates the review. Every rule is enforced here (the app checks them too, for friendlier messages):
--   * the caller belongs to the workspace that placed the order, as owner or SEO manager (the roles that may manage orders);
--   * the placement was delivered and verified (VERIFIED / MONITORING / COMPLETED with a verified placement on record);
--   * one review per order (row lock + unique constraint).
create or replace function public.submit_site_review(p_order uuid, p_user uuid, p_rating int, p_comment text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o record; v_id uuid; v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'choose a rating from 1 to 5 stars'; end if;
  if v_comment is not null and char_length(v_comment) < 3 then raise exception 'the written feedback is too short'; end if;
  select id, status, organization_id, website_id into o from public.orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;
  if not exists (select 1 from public.organization_members m where m.organization_id = o.organization_id and m.user_id = p_user and m.role in ('owner', 'seo_manager')) then
    raise exception 'your role in this workspace does not allow that action';
  end if;
  if o.status not in ('VERIFIED', 'MONITORING', 'COMPLETED')
     or not exists (select 1 from public.published_placements pl where pl.order_id = p_order and pl.verified_at is not null) then
    raise exception 'you can review a website once your placement has been published and verified';
  end if;
  if exists (select 1 from public.site_reviews r where r.order_id = p_order) then raise exception 'this order has already been reviewed'; end if;
  insert into public.site_reviews (order_id, listing_id, organization_id, reviewer_id, rating, comment)
  values (p_order, o.website_id, o.organization_id, p_user, p_rating, left(v_comment, 1500))
  returning id into v_id;
  return v_id;
end $$;

-- Admin moderation: hide (with a reason) or restore. The review text itself is never altered.
create or replace function public.moderate_site_review(p_review uuid, p_admin uuid, p_hide boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin(p_admin);
  if p_hide and char_length(coalesce(btrim(p_reason), '')) < 5 then raise exception 'a reason is required to hide a review'; end if;
  update public.site_reviews
     set status = case when p_hide then 'hidden' else 'published' end,
         hidden_reason = case when p_hide then left(btrim(p_reason), 500) else null end,
         hidden_by = case when p_hide then p_admin else null end,
         hidden_at = case when p_hide then now() else null end
   where id = p_review;
  if not found then raise exception 'review not found'; end if;
end $$;

-- ---- 10. privileges: everything new and server-side is service_role only ------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'turnaround_hours_for(int)', 'transition_order(uuid,text,text,uuid,text,text)',
    'create_order_priced(uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,numeric,text,timestamptz,numeric)',
    'open_recovery_case(uuid,text,text,uuid,int)', 'reassign_order(uuid,uuid,uuid,uuid,text)',
    'request_expiry_remedy(uuid,uuid,text,text)', 'submit_site_review(uuid,uuid,int,text)', 'moderate_site_review(uuid,uuid,boolean,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
grant all on public.site_reviews to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- VERIFY (read-only). Each should return the stated result.
--   select count(*) from information_schema.columns where table_schema='public' and table_name='orders'
--     and column_name in ('turnaround_hours','accepted_at','due_at','expiry_notified_at','expiry_choice','expiry_choice_at');   -- 6
--   select count(*) from public.orders where turnaround_hours is null;                                                        -- 0
--   select count(*) from public.order_status_transitions where to_status='PUBLISHER_REJECTED' and from_status in ('ACCEPTED','IN_PROGRESS');  -- 2
--   select has_function_privilege('authenticated','public.request_expiry_remedy(uuid,uuid,text,text)','execute');             -- false
-- ---------------------------------------------------------------------------------------------------------------------
