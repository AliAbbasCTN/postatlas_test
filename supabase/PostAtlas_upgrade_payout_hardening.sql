-- =====================================================================================================
-- PostAtlas - payout hardening (additive, idempotent: safe to run more than once)
--
-- Run AFTER PostAtlas_upgrade_marketplace_finance.sql on an existing database. New installs already include
-- everything here (PostAtlas_fresh_supabase_schema.sql) and must NOT need this file (running it is harmless).
--
-- WHAT IT FIXES (each was reproduced by executing the previous functions in a real PostgreSQL engine):
--   1. reassign_order() accepted a replacement listing priced ABOVE the customer's original budget.
--   2. create_payout_obligation() computed a replacement publisher's pay from their LIVE listing price at verification
--      time, so a publisher could raise their own price after being assigned (e.g. $100 order -> $392 payout).
--      The pay is now fixed and stored on the recovery case at the moment of reassignment, and can never exceed the
--      original publisher entitlement (98% of the customer's list price).
--   3. Reassigning after a link loss left the original publisher's UNPAID entitlement ELIGIBLE (docs said it was cancelled),
--      so both publishers were paid. Unpaid original entitlement is now cancelled for both case kinds; money already
--      paid is never clawed back and PostAtlas absorbs that replacement cost.
--   4. create_payout_obligation() was not idempotent: a repeated call raised an error instead of returning the payout.
--   5. Saving new payout details disabled the old destination and inserted the new one in two separate statements;
--      a failure between them left the publisher with no destination. It is now one atomic function.
-- No data is rewritten. Existing REASSIGNED cases without a stored snapshot fall back to the live price CAPPED at the budget.
-- =====================================================================================================

alter table public.recovery_cases add column if not exists replacement_list_price_usd numeric(14, 2);
alter table public.recovery_cases add column if not exists replacement_entitlement_usd numeric(14, 2);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'recovery_replacement_amounts_check') then
    alter table public.recovery_cases add constraint recovery_replacement_amounts_check check (
      (replacement_list_price_usd is null and replacement_entitlement_usd is null)
      or (replacement_list_price_usd > 0 and replacement_entitlement_usd > 0 and replacement_entitlement_usd <= replacement_list_price_usd));
  end if;
end $$;

-- BEGIN payout-hardening functions
create or replace function public.create_payout_obligation(p_order uuid, p_verified_at timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o record; snap record; lst record; mine record; other record; cs record;
        v_amount numeric; v_price numeric; v_live numeric; v_kind text; v_id uuid; v_status text := 'ELIGIBLE'; v_hold text;
begin
  select id, status, website_id, order_type into o from public.orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;
  if o.status not in ('VERIFIED', 'MONITORING') then raise exception 'only a verified placement creates a payout obligation (status %)', o.status; end if;
  if not exists (select 1 from public.payments pa where pa.order_id = p_order and pa.status = 'PAID') then raise exception 'an unpaid order cannot create a payout obligation'; end if;
  select * into snap from public.order_pricing where order_id = p_order;
  if not found then raise exception 'order has no pricing snapshot'; end if;
  select w.id, w.publisher_id, w.price_guest_post, w.price_link_insertion into lst from public.publisher_websites w where w.id = o.website_id;

  -- Idempotent: the publisher the order is assigned to right now already has a live payout for it, so that is the answer.
  -- (This also covers the ORIGINAL publisher restoring a lost link: no second payout and no change in pay.)
  select * into mine from public.publisher_payouts where order_id = p_order and publisher_id = lst.publisher_id and status <> 'CANCELLED' order by created_at limit 1;
  if mine.id is not null then return mine.id; end if;

  select * into other from public.publisher_payouts where order_id = p_order and publisher_id <> lst.publisher_id and status <> 'CANCELLED' order by created_at limit 1;
  select * into cs from public.recovery_cases where order_id = p_order and status = 'REASSIGNED' and replacement_listing_id = o.website_id order by created_at desc limit 1;

  if o.website_id = snap.listing_id then
    v_price := snap.list_price_usd; v_amount := snap.publisher_net_usd;
  else
    if cs.id is null then raise exception 'a replacement payout needs a recovery case'; end if;
    v_live := case o.order_type when 'guest_post' then lst.price_guest_post else lst.price_link_insertion end;
    -- Pay was fixed when the admin reassigned the order. The live-price fallback only serves cases reassigned before this fix
    -- existed, and is capped at the customer's budget either way.
    v_price := coalesce(cs.replacement_list_price_usd, least(v_live, snap.list_price_usd));
    v_amount := coalesce(cs.replacement_entitlement_usd, v_price - round(v_price * snap.commission_bps / 10000.0, 2));
  end if;
  if v_amount is null or v_amount <= 0 then raise exception 'the payout amount could not be determined'; end if;
  if v_amount > snap.publisher_net_usd then raise exception 'a payout cannot exceed the original order budget (% > %)', v_amount, snap.publisher_net_usd; end if;

  v_kind := case when other.id is not null then 'replacement' else 'fulfillment' end;
  if v_kind = 'replacement' and cs.id is null then raise exception 'a replacement payout needs a recovery case'; end if;

  if exists (select 1 from public.disputes d where d.order_id = p_order and d.status in ('OPEN', 'UNDER_REVIEW')) then
    v_status := 'HELD'; v_hold := 'dispute';
  end if;
  insert into public.publisher_payouts (publisher_id, order_id, amount, currency, kind, listing_id, recovery_case_id, status, verified_at, eligible_at, process_by,
                                        hold_kind, hold_reason, held_at)
  values (lst.publisher_id, p_order, v_amount, 'USD', v_kind, o.website_id, case when v_kind = 'replacement' then cs.id end, v_status, p_verified_at, p_verified_at,
          p_verified_at + interval '12 hours', v_hold, case when v_hold is not null then 'A dispute is open on this order' end, case when v_hold is not null then now() end)
  returning id into v_id;

  perform public.ledger_add(p_order, 'publisher_entitlement_accrued', 'memo', v_amount, 'USD', 'payout', v_id, 'accrue:' || v_id, 'Publisher entitlement (' || v_kind || ')', null);
  if v_kind = 'fulfillment' then
    perform public.ledger_add(p_order, 'commission_earned', 'memo', v_price - v_amount, 'USD', 'payout', v_id, 'commission:' || v_id, 'PostAtlas commission', null);
  else
    perform public.ledger_add(p_order, 'replacement_cost', 'memo', v_amount, 'USD', 'recovery_case', cs.id, 'replacement:' || cs.id, 'Cost of alternative publisher, borne by PostAtlas (the original publisher already has a live payout)', null);
  end if;
  if cs.id is not null then
    update public.recovery_cases set status = 'RESOLVED_REPLACED', resolved_at = now(), resolution = 'Replacement placement verified', updated_at = now() where id = cs.id;
  end if;
  return v_id;
end $$;

-- Admin gives the order to a different approved listing. Customer price, target page, anchor and pricing snapshot are
-- untouched. The replacement must fit the ORIGINAL budget (its list price may not exceed what the customer paid for),
-- its pay is fixed here (not read from the live listing later), and the original publisher's unpaid entitlement is cancelled.
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
  if c.kind = 'publisher_rejection' and from_status <> 'PUBLISHER_REJECTED' then raise exception 'the order is not in the rejected state'; end if;
  if c.kind = 'link_restoration' and from_status not in ('ISSUE_DETECTED', 'REPLACEMENT_REQUESTED') then raise exception 'the order has no confirmed link issue'; end if;
  select w.id, w.status, w.publisher_id, w.price_guest_post, w.price_link_insertion into lst from public.publisher_websites w where w.id = p_new_listing;
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
  update public.orders set website_id = p_new_listing where id = p_order;
  perform set_config('postatlas.reassign', '', true);
  if not public.transition_order(p_order, from_status, 'PENDING_PUBLISHER', p_admin, 'admin', left('Reassigned to another publisher. ' || coalesce(p_note, ''), 1500)) then raise exception 'order state changed'; end if;
  update public.published_placements set health = 'PENDING', next_check_at = null, consecutive_failures = 0, verified_at = null, verified_by = null, updated_at = now() where order_id = p_order;
  update public.recovery_cases set status = 'REASSIGNED', replacement_listing_id = p_new_listing, replacement_list_price_usd = price, replacement_entitlement_usd = v_ent, updated_at = now() where id = p_case;
  -- The original publisher is owed nothing further: cancel whatever has NOT been paid out (in both case kinds). Money already
  -- paid is never clawed back; the replacement is then PostAtlas's cost (recorded as replacement_cost when it is created).
  perform public.cancel_unpaid_payouts(p_order, p_admin, case c.kind when 'publisher_rejection' then 'Original publisher declined the order'
                                                                      else 'Original publisher did not keep the link; order reassigned' end);
end $$;

-- Replaces a publisher's payout destination for one currency in ONE transaction: the old one is disabled and the new one
-- (always unverified) inserted together, so a failure can never leave the publisher with neither.
create or replace function public.replace_payout_destination(
  p_publisher uuid, p_currency text, p_country text, p_holder text, p_bank text, p_swift text, p_cipher text, p_last4 text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform 1 from public.publisher_profiles where id = p_publisher for update;          -- serialises concurrent saves by the same publisher
  if not found then raise exception 'publisher not found'; end if;
  update public.payout_destinations set status = 'DISABLED', disabled_reason = 'Replaced by the publisher'
   where publisher_id = p_publisher and currency = p_currency and status <> 'DISABLED';
  insert into public.payout_destinations (publisher_id, currency, country, account_holder, bank_name, swift_bic, account_cipher, account_last4)
  values (p_publisher, p_currency, p_country, p_holder, p_bank, nullif(p_swift, ''), p_cipher, p_last4)
  returning id into v_id;
  return v_id;
end $$;
-- END payout-hardening functions

revoke all on function public.replace_payout_destination(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.replace_payout_destination(uuid, text, text, text, text, text, text, text) to service_role;
