-- =====================================================================================================
-- PostAtlas UPGRADE: marketplace finance (USD pricing + 2% commission, USD/PKR checkout, payouts, recovery, refunds)
--
-- Run ONCE in the Supabase SQL Editor on a database that already has the PostAtlas schema (and, if you
-- are upgrading in order, PostAtlas_upgrade_individual_customers.sql). Additive and re-runnable:
--   * no table is dropped, no order/payment/payout row is deleted; existing payments and orders keep their values;
--   * every existing order receives a USD pricing snapshot equal to the price it already had;
--   * existing payment methods default to USD-only until an administrator enables PKR on a method that really accepts it;
--   * the legacy publisher_payouts status values stay valid.
-- Do NOT run it on top of a fresh install made from the updated PostAtlas_fresh_supabase_schema.sql (already included).
-- This file has NOT been executed against a database by the author: run it on a staging copy first, then
-- PostAtlas_verify_schema.sql.
-- =====================================================================================================

-- ---- helpers --------------------------------------------------------------------------------------------------
create or replace function public.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;     -- cascades from a parent delete are the parent's business
  raise exception '% rows are append-only', tg_table_name;
end $$;

create or replace function public.assert_admin(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles p where p.id = p_user and p.platform_role in ('admin', 'super_admin') and not p.disabled) then
    raise exception 'only an active administrator may do this';
  end if;
end $$;

-- ---- 1. exchange rates (USD -> PKR) ------------------------------------------------------------------------
create table if not exists public.fx_rates (
  id                  uuid primary key default gen_random_uuid(),
  base                text not null default 'USD' check (base = 'USD'),
  quote               text not null check (quote = 'PKR'),
  rate                numeric(18, 6) not null check (rate between 50 and 1000),
  source              text not null check (char_length(source) between 1 and 80),
  manual              boolean not null default false,
  set_by              uuid references public.profiles (id) on delete set null,
  provider_updated_at timestamptz,
  fetched_at          timestamptz not null default now(),
  check (not manual or set_by is not null)
);
create index if not exists fx_rates_latest_idx on public.fx_rates (quote, fetched_at desc);
drop trigger if exists fx_rates_append_only on public.fx_rates;
create trigger fx_rates_append_only before update or delete on public.fx_rates for each row execute function public.forbid_mutation();

-- ---- 2. payment methods know which currencies they really accept ------------------------------------------------
alter table public.payment_methods add column if not exists currencies text[] not null default array['USD']::text[];
alter table public.payment_methods add column if not exists kind text not null default 'manual';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payment_methods_currencies_check') then
    alter table public.payment_methods add constraint payment_methods_currencies_check check (currencies <@ array['USD', 'PKR']::text[] and cardinality(currencies) >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_methods_kind_check') then
    alter table public.payment_methods add constraint payment_methods_kind_check check (kind in ('manual', 'provider'));
  end if;
end $$;

-- ---- 3. immutable pricing snapshot per order ---------------------------------------------------------------------
-- Everything the customer agreed to at checkout. The CHECK constraints re-derive the commission, the net and the
-- converted amount, so even a buggy or hostile caller cannot store numbers that break the pricing model.
create table if not exists public.order_pricing (
  order_id          uuid primary key references public.orders (id) on delete cascade,
  listing_id        uuid not null references public.publisher_websites (id),
  list_price_usd    numeric(12, 2) not null check (list_price_usd > 0),
  customer_base_usd numeric(12, 2) not null,
  commission_bps    int not null check (commission_bps between 0 and 5000),
  commission_usd    numeric(12, 2) not null,
  publisher_net_usd numeric(12, 2) not null,
  checkout_currency text not null check (checkout_currency in ('USD', 'PKR')),
  fx_rate           numeric(18, 6),
  fx_source         text,
  fx_rate_at        timestamptz,
  amount_due        numeric(14, 2) not null check (amount_due > 0),
  payment_method_id uuid references public.payment_methods (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint pricing_no_markup check (customer_base_usd = list_price_usd),
  constraint pricing_commission_formula check (commission_usd = round(list_price_usd * commission_bps / 10000.0, 2)),
  constraint pricing_net_formula check (publisher_net_usd = list_price_usd - commission_usd),
  constraint pricing_currency_formula check (
    (checkout_currency = 'USD' and fx_rate is null and amount_due = list_price_usd)
    or (checkout_currency = 'PKR' and fx_rate is not null and fx_source is not null and fx_rate_at is not null and amount_due = round(list_price_usd * fx_rate, 0))
  )
);
create index if not exists order_pricing_listing_idx on public.order_pricing (listing_id);

create or replace function public.order_pricing_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if coalesce(current_setting('postatlas.pricing_correction', true), '') <> '1' then
    raise exception 'the pricing snapshot of an order cannot be changed; use admin_correct_checkout()';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists order_pricing_guard_trg on public.order_pricing;
create trigger order_pricing_guard_trg before update or delete on public.order_pricing for each row execute function public.order_pricing_guard();

-- Orders that existed before this upgrade get a snapshot that reproduces what they agreed to: USD, list price = their price.
insert into public.order_pricing (order_id, listing_id, list_price_usd, customer_base_usd, commission_bps, commission_usd, publisher_net_usd, checkout_currency, amount_due)
select o.id, o.website_id, o.customer_price, o.customer_price, 200, round(o.customer_price * 200 / 10000.0, 2), o.customer_price - round(o.customer_price * 200 / 10000.0, 2), 'USD', o.customer_price
  from public.orders o where not exists (select 1 from public.order_pricing p where p.order_id = o.id)
on conflict (order_id) do nothing;

-- ---- 4. payments: currency aware, amount must equal the locked snapshot ----------------------------------------------
alter table public.payments drop constraint if exists payments_currency_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_currency_supported') then
    alter table public.payments add constraint payments_currency_supported check (currency in ('USD', 'PKR'));
  end if;
end $$;
alter table public.payments alter column amount type numeric(14, 2);
create unique index if not exists payments_one_paid on public.payments (order_id) where status = 'PAID';

create or replace function public.payments_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o_price numeric; o_status text; snap record;
begin
  if tg_op = 'INSERT' then
    select o.customer_price, o.status into o_price, o_status from public.orders o where o.id = new.order_id;
    if o_price is null then raise exception 'order not found'; end if;
    if o_status <> 'PAYMENT_PENDING' then raise exception 'this order is not waiting for payment'; end if;
    select * into snap from public.order_pricing p where p.order_id = new.order_id;
    if not found then raise exception 'this order has no pricing snapshot'; end if;
    if new.amount <> snap.amount_due or new.currency <> snap.checkout_currency then
      raise exception 'payment amount and currency must equal the amount locked at checkout';
    end if;
    if snap.payment_method_id is not null and new.method_id is distinct from snap.payment_method_id then
      raise exception 'payment must use the payment method chosen at checkout';
    end if;
    if new.method_id is not null and not exists (
         select 1 from public.payment_methods m where m.id = new.method_id and m.enabled and new.currency = any (m.currencies)) then
      raise exception 'that payment method is not available in %', new.currency;
    end if;
    new.status := 'PAYMENT_UNDER_REVIEW';
    new.submitted_at := now();
    new.verified_by := null; new.verified_at := null; new.rejection_reason := null;
    return new;
  elsif tg_op = 'UPDATE' then
    if pg_trigger_depth() > 1 and coalesce(current_setting('postatlas.payment_review', true), '') <> '1' then return new; end if;     -- cascading SET NULL actions
    if old.status <> 'PAYMENT_UNDER_REVIEW' then raise exception 'a reviewed payment cannot be changed'; end if;
    if new.id is distinct from old.id or new.order_id is distinct from old.order_id or new.amount is distinct from old.amount
       or new.currency is distinct from old.currency or new.transaction_reference is distinct from old.transaction_reference
       or new.method_id is distinct from old.method_id or new.submitted_at is distinct from old.submitted_at then
      raise exception 'payment amount, order and reference cannot be changed';
    end if;
    if new.status not in ('PAYMENT_UNDER_REVIEW', 'PAID', 'PAYMENT_REJECTED') then raise exception 'invalid payment status'; end if;
    if new.status <> old.status then
      if new.verified_by is null or new.verified_at is null then raise exception 'a review must record who reviewed and when'; end if;
      if new.status = 'PAYMENT_REJECTED' and coalesce(btrim(new.rejection_reason), '') = '' then raise exception 'a rejection needs a reason'; end if;
    end if;
    return new;
  else
    if pg_trigger_depth() = 1 and old.status <> 'PAYMENT_UNDER_REVIEW' then
      raise exception 'a reviewed payment cannot be deleted';
    end if;
    return old;
  end if;
end $$;

-- ---- 5. order guard: the listing can change ONLY through reassign_order() ---------------------------------------------
create or replace function public.orders_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'PAYMENT_PENDING';
    new.disputed_from := null;
    new.created_at := now();
    new.updated_at := now();
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

insert into public.order_status_transitions (from_status, to_status) values
  ('PUBLISHER_REJECTED', 'PENDING_PUBLISHER'),
  ('REPLACEMENT_REQUESTED', 'PENDING_PUBLISHER')
on conflict do nothing;

-- ---- 6. ledger (append-only) -----------------------------------------------------------------------------------
create table if not exists public.ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid references public.orders (id) on delete restrict,
  kind            text not null check (kind in (
    'customer_payment_confirmed', 'commission_earned', 'publisher_entitlement_accrued', 'publisher_entitlement_cancelled',
    'payout_paid', 'refund_paid', 'replacement_cost', 'adjustment')),
  direction       text not null check (direction in ('in', 'out', 'memo')),
  amount          numeric(14, 2) not null check (amount > 0),
  currency        text not null check (currency in ('USD', 'PKR')),
  ref_type        text,
  ref_id          uuid,
  idempotency_key text not null unique check (char_length(idempotency_key) between 3 and 200),
  note            text check (note is null or char_length(note) <= 500),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists ledger_order_idx on public.ledger_entries (order_id, created_at);
drop trigger if exists ledger_append_only on public.ledger_entries;
create trigger ledger_append_only before update or delete on public.ledger_entries for each row execute function public.forbid_mutation();

create or replace function public.ledger_add(p_order uuid, p_kind text, p_dir text, p_amount numeric, p_currency text, p_ref_type text, p_ref uuid, p_key text, p_note text, p_by uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ledger_entries (order_id, kind, direction, amount, currency, ref_type, ref_id, idempotency_key, note, created_by)
  values (p_order, p_kind, p_dir, p_amount, p_currency, p_ref_type, p_ref, p_key, left(p_note, 500), p_by)
  on conflict (idempotency_key) do nothing;                     -- a retry of the same financial event is a no-op
end $$;

-- ---- 7. payout destinations (publisher bank details; secrets encrypted by the application) ------------------------
create table if not exists public.payout_destinations (
  id              uuid primary key default gen_random_uuid(),
  publisher_id    uuid not null references public.publisher_profiles (id) on delete cascade,
  method          text not null default 'bank_transfer' check (method in ('bank_transfer')),
  currency        text not null check (currency in ('USD', 'PKR')),
  country         text not null check (char_length(country) between 2 and 60),
  account_holder  text not null check (char_length(account_holder) between 2 and 120),
  bank_name       text not null check (char_length(bank_name) between 2 and 120),
  swift_bic       text check (swift_bic is null or swift_bic ~ '^[A-Za-z0-9]{8,11}$'),
  account_cipher  text not null check (char_length(account_cipher) between 20 and 2000),   -- AES-256-GCM (app-side); never plaintext
  account_last4   text not null check (char_length(account_last4) between 2 and 4),
  status          text not null default 'PENDING_VERIFICATION' check (status in ('PENDING_VERIFICATION', 'VERIFIED', 'DISABLED')),
  verified_by     uuid references public.profiles (id) on delete set null,
  verified_at     timestamptz,
  disabled_reason text check (disabled_reason is null or char_length(disabled_reason) <= 300),
  created_at      timestamptz not null default now(),
  check (status <> 'VERIFIED' or (verified_by is not null and verified_at is not null))
);
create unique index if not exists payout_destinations_one_active on public.payout_destinations (publisher_id, currency) where status <> 'DISABLED';

-- ---- 8. publisher payouts: extend the existing table into real payout obligations ----------------------------------
alter table public.publisher_payouts add column if not exists kind text not null default 'fulfillment';
alter table public.publisher_payouts add column if not exists currency text not null default 'USD';
alter table public.publisher_payouts add column if not exists listing_id uuid references public.publisher_websites (id);
alter table public.publisher_payouts add column if not exists recovery_case_id uuid;
alter table public.publisher_payouts add column if not exists verified_at timestamptz;
alter table public.publisher_payouts add column if not exists eligible_at timestamptz;
alter table public.publisher_payouts add column if not exists process_by timestamptz;
alter table public.publisher_payouts add column if not exists initiated_at timestamptz;
alter table public.publisher_payouts add column if not exists hold_kind text;
alter table public.publisher_payouts add column if not exists hold_reason text;
alter table public.publisher_payouts add column if not exists held_by uuid references public.profiles (id) on delete set null;
alter table public.publisher_payouts add column if not exists held_at timestamptz;
alter table public.publisher_payouts add column if not exists destination_id uuid references public.payout_destinations (id);
alter table public.publisher_payouts add column if not exists payout_currency text;
alter table public.publisher_payouts add column if not exists payout_amount numeric(14, 2);
alter table public.publisher_payouts add column if not exists fx_rate numeric(18, 6);
alter table public.publisher_payouts add column if not exists fx_source text;
alter table public.publisher_payouts add column if not exists fx_rate_at timestamptz;
alter table public.publisher_payouts add column if not exists conversion_cost numeric(14, 2) not null default 0;
alter table public.publisher_payouts add column if not exists execution text not null default 'manual';
alter table public.publisher_payouts add column if not exists provider text;
alter table public.publisher_payouts add column if not exists provider_reference text;
alter table public.publisher_payouts add column if not exists attempts int not null default 0;
alter table public.publisher_payouts add column if not exists last_error text;
alter table public.publisher_payouts add column if not exists confirmed_by uuid references public.profiles (id) on delete set null;
alter table public.publisher_payouts add column if not exists confirmed_at timestamptz;
alter table public.publisher_payouts add column if not exists evidence_note text;
alter table public.publisher_payouts add column if not exists overdue_alerted_at timestamptz;
alter table public.publisher_payouts add column if not exists created_at timestamptz not null default now();
alter table public.publisher_payouts add column if not exists updated_at timestamptz not null default now();
alter table public.publisher_payouts alter column status set default 'ELIGIBLE';
alter table public.publisher_payouts drop constraint if exists publisher_payouts_status_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'publisher_payouts_status_v2') then
    alter table public.publisher_payouts add constraint publisher_payouts_status_v2 check (status in (
      'NOT_REQUESTED', 'REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PROCESSED',                  -- legacy values, kept so old rows stay valid
      'ELIGIBLE', 'HELD', 'PROCESSING', 'PAID', 'FAILED', 'UNCERTAIN', 'CANCELLED'));
    alter table public.publisher_payouts add constraint publisher_payouts_kind_check check (kind in ('fulfillment', 'replacement'));
    alter table public.publisher_payouts add constraint publisher_payouts_exec_check check (execution in ('manual', 'provider'));
    alter table public.publisher_payouts add constraint publisher_payouts_currency_check check (currency = 'USD' and (payout_currency is null or payout_currency in ('USD', 'PKR')));
    alter table public.publisher_payouts add constraint publisher_payouts_held_needs_reason check (status <> 'HELD' or (hold_reason is not null and hold_kind is not null));
    alter table public.publisher_payouts add constraint publisher_payouts_paid_needs_proof check (
      status <> 'PAID' or (coalesce(provider_reference, transaction_reference) is not null and confirmed_by is not null and confirmed_at is not null
                           and payout_amount is not null and payout_currency is not null and char_length(coalesce(evidence_note, '')) >= 10));
  end if;
end $$;
create unique index if not exists publisher_payouts_one_fulfillment on public.publisher_payouts (order_id) where kind = 'fulfillment' and status <> 'CANCELLED' and order_id is not null;
create unique index if not exists publisher_payouts_one_replacement on public.publisher_payouts (recovery_case_id) where kind = 'replacement' and status <> 'CANCELLED';
create index if not exists publisher_payouts_queue_idx on public.publisher_payouts (status, process_by);

create or replace function public.payouts_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'payout records cannot be deleted'; end if;
  if pg_trigger_depth() > 1 then return new; end if;
  if old.status in ('PAID', 'CANCELLED', 'PROCESSED') then raise exception 'a % payout cannot be changed', old.status; end if;
  if new.id is distinct from old.id or new.publisher_id is distinct from old.publisher_id or new.order_id is distinct from old.order_id
     or new.amount is distinct from old.amount or new.kind is distinct from old.kind or new.currency is distinct from old.currency then
    raise exception 'payout entitlement, publisher and order cannot be changed';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists payouts_guard_trg on public.publisher_payouts;
create trigger payouts_guard_trg before update or delete on public.publisher_payouts for each row execute function public.payouts_guard();

-- ---- 9. recovery cases (publisher rejection after payment; link restoration) ------------------------------------------
create table if not exists public.recovery_cases (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null references public.orders (id) on delete restrict,
  kind                   text not null check (kind in ('publisher_rejection', 'link_restoration')),
  status                 text not null default 'OPEN' check (status in ('OPEN', 'REASSIGNED', 'RESTORED', 'ESCALATED', 'RESOLVED_REPLACED', 'RESOLVED_REFUND', 'RESOLVED_OTHER', 'CANCELLED')),
  reason                 text not null check (char_length(reason) between 1 and 1000),
  original_publisher_id  uuid references public.publisher_profiles (id),
  original_listing_id    uuid references public.publisher_websites (id),
  replacement_listing_id uuid references public.publisher_websites (id),
  opened_by              uuid references public.profiles (id) on delete set null,
  deadline_at            timestamptz not null,
  escalated_at           timestamptz,
  escalation_reason      text check (escalation_reason is null or char_length(escalation_reason) <= 1000),
  resolved_by            uuid references public.profiles (id) on delete set null,
  resolved_at            timestamptz,
  resolution             text check (resolution is null or char_length(resolution) <= 1000),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create unique index if not exists recovery_one_open on public.recovery_cases (order_id, kind) where status in ('OPEN', 'REASSIGNED', 'ESCALATED');
create index if not exists recovery_deadline_idx on public.recovery_cases (status, deadline_at);

alter table public.recovery_cases add column if not exists replacement_list_price_usd numeric(14, 2);
alter table public.recovery_cases add column if not exists replacement_entitlement_usd numeric(14, 2);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'recovery_replacement_amounts_check') then
    alter table public.recovery_cases add constraint recovery_replacement_amounts_check check (
      (replacement_list_price_usd is null and replacement_entitlement_usd is null)
      or (replacement_list_price_usd > 0 and replacement_entitlement_usd > 0 and replacement_entitlement_usd <= replacement_list_price_usd));
  end if;
end $$;


-- ---- 10. refunds -------------------------------------------------------------------------------------------------
create table if not exists public.refunds (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders (id) on delete restrict,
  payment_id         uuid not null references public.payments (id) on delete restrict,
  amount             numeric(14, 2) not null check (amount > 0),
  currency           text not null check (currency in ('USD', 'PKR')),
  status             text not null default 'REQUESTED' check (status in ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'UNCERTAIN', 'REJECTED')),
  reason             text not null check (char_length(reason) between 3 and 1000),
  requested_by       uuid references public.profiles (id) on delete set null,
  requested_role     text not null check (requested_role in ('customer', 'admin', 'system')),
  approved_by        uuid references public.profiles (id) on delete set null,
  approved_at        timestamptz,
  processing_at      timestamptz,
  completed_by       uuid references public.profiles (id) on delete set null,
  completed_at       timestamptz,
  transfer_reference text check (transfer_reference is null or char_length(transfer_reference) between 4 and 120),
  evidence_note      text check (evidence_note is null or char_length(evidence_note) <= 1000),
  failure_reason     text check (failure_reason is null or char_length(failure_reason) <= 1000),
  execution          text not null default 'manual' check (execution in ('manual', 'provider')),
  provider           text,
  provider_reference text,
  idempotency_key    text unique,
  overdue_alerted_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint refunds_completed_needs_proof check (status <> 'COMPLETED' or (
    coalesce(provider_reference, transfer_reference) is not null and completed_by is not null and completed_at is not null and char_length(coalesce(evidence_note, '')) >= 10))
);
create index if not exists refunds_order_idx on public.refunds (order_id);
create index if not exists refunds_status_idx on public.refunds (status, created_at);

create or replace function public.refunds_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'refund records cannot be deleted'; end if;
  if pg_trigger_depth() > 1 then return new; end if;
  if old.status in ('COMPLETED', 'REJECTED') then raise exception 'a % refund cannot be changed', old.status; end if;
  if new.id is distinct from old.id or new.order_id is distinct from old.order_id or new.payment_id is distinct from old.payment_id
     or new.amount is distinct from old.amount or new.currency is distinct from old.currency then
    raise exception 'refund amount, payment and order cannot be changed';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists refunds_guard_trg on public.refunds;
create trigger refunds_guard_trg before update or delete on public.refunds for each row execute function public.refunds_guard();

-- ---- 11. disputes: recorded remedy ------------------------------------------------------------------------------
alter table public.disputes add column if not exists remedy text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'disputes_remedy_check') then
    alter table public.disputes add constraint disputes_remedy_check check (remedy is null or remedy in ('none', 'restoration', 'replacement', 'refund', 'release_payout'));
  end if;
end $$;

-- ============================================================================================================
-- FUNCTIONS (server-only: service_role). All pin search_path, lock the rows they decide on, and are safe to retry.
-- ============================================================================================================
create or replace function public.commission_bps() returns int language sql immutable set search_path = '' as $$ select 200 $$;   -- 2.00%

-- Creates an order AND its pricing snapshot in one transaction. The price comes from the listing row here, never from the
-- caller; p_expected_due is the application's own calculation and must agree to the cent/rupee or nothing is created.
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
  select w.id, w.status, w.price_guest_post, w.price_link_insertion into lst from public.publisher_websites w where w.id = p_listing;
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

  insert into public.orders (organization_id, website_id, customer_website_id, opportunity_id, order_type, target_url, anchor_text, customer_price, created_by)
  values (p_org, p_listing, p_customer_site, p_opportunity, p_type, p_target, p_anchor, price, p_user)
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

-- Customer reports a payment. Amount, currency and method come from the locked snapshot, not from the caller.
create or replace function public.submit_payment(p_order uuid, p_actor uuid, p_reference text, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o record; snap record; pid uuid;
begin
  select id, status into o from public.orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;
  if o.status <> 'PAYMENT_PENDING' then raise exception 'this order is not waiting for payment details'; end if;
  select * into snap from public.order_pricing where order_id = p_order;
  if not found then raise exception 'this order has no pricing snapshot'; end if;
  insert into public.payments (order_id, amount, currency, method_id, transaction_reference, note)
  values (p_order, snap.amount_due, snap.checkout_currency, snap.payment_method_id, p_reference, nullif(p_note, ''))
  returning id into pid;                                                    -- a duplicate reference raises 23505 and rolls everything back
  if not public.transition_order(p_order, 'PAYMENT_PENDING', 'PAYMENT_UNDER_REVIEW', p_actor, 'customer', 'Payment details submitted') then
    raise exception 'the order changed while submitting; please try again';
  end if;
  return pid;
end $$;

-- Admin decision on a payment: payment row, order status, ledger and history change together or not at all. The
-- order row is locked first, then the payment, so two admins (or an admin and a cancellation) serialise cleanly.
create or replace function public.review_payment(p_payment uuid, p_admin uuid, p_decision text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pay record; o record;
begin
  perform public.assert_admin(p_admin);
  if p_decision not in ('approve', 'reject') then raise exception 'invalid decision'; end if;
  select order_id into pay from public.payments where id = p_payment;
  if not found then raise exception 'payment not found'; end if;
  select id, status into o from public.orders where id = pay.order_id for update;
  select * into pay from public.payments where id = p_payment for update;
  if pay.status <> 'PAYMENT_UNDER_REVIEW' then raise exception 'this payment has already been reviewed'; end if;
  if o.status <> 'PAYMENT_UNDER_REVIEW' then raise exception 'the order is no longer waiting for payment review (status %)', o.status; end if;
  if p_decision = 'reject' and coalesce(btrim(p_reason), '') = '' then raise exception 'a rejection needs a reason'; end if;

  update public.payments set status = case p_decision when 'approve' then 'PAID' else 'PAYMENT_REJECTED' end,
         verified_by = p_admin, verified_at = now(), rejection_reason = case when p_decision = 'reject' then left(p_reason, 500) end
   where id = p_payment;
  if p_decision = 'approve' then
    if not public.transition_order(o.id, 'PAYMENT_UNDER_REVIEW', 'PAID', p_admin, 'admin', 'Payment approved') then raise exception 'order state changed'; end if;
    perform public.ledger_add(o.id, 'customer_payment_confirmed', 'in', pay.amount, pay.currency, 'payment', pay.id, 'payment:' || pay.id, 'Payment approved by admin', p_admin);
  else
    if not public.transition_order(o.id, 'PAYMENT_UNDER_REVIEW', 'PAYMENT_PENDING', p_admin, 'admin', 'Payment rejected: ' || left(p_reason, 400)) then raise exception 'order state changed'; end if;
  end if;
  return jsonb_build_object('order_id', o.id, 'decision', p_decision, 'amount', pay.amount, 'currency', pay.currency);
end $$;

-- Authorised, audited correction of checkout terms. Only while nothing has been paid or submitted.
create or replace function public.admin_correct_checkout(
  p_order uuid, p_admin uuid, p_currency text, p_method uuid, p_fx_rate numeric, p_fx_source text, p_fx_at timestamptz, p_reason text
) returns void
language plpgsql security definer set search_path = '' as $$
declare o record; snap record; due numeric;
begin
  perform public.assert_admin(p_admin);
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a correction needs a reason'; end if;
  select id, status into o from public.orders where id = p_order for update;
  if not found or o.status <> 'PAYMENT_PENDING' then raise exception 'checkout terms can only be corrected before a payment is submitted'; end if;
  select * into snap from public.order_pricing where order_id = p_order;
  if not exists (select 1 from public.payment_methods m where m.id = p_method and m.enabled and p_currency = any (m.currencies)) then raise exception 'method does not support that currency'; end if;
  due := case p_currency when 'USD' then snap.list_price_usd else round(snap.list_price_usd * p_fx_rate, 0) end;
  perform set_config('postatlas.pricing_correction', '1', true);
  update public.order_pricing set checkout_currency = p_currency, payment_method_id = p_method,
         fx_rate = case when p_currency = 'PKR' then p_fx_rate end, fx_source = case when p_currency = 'PKR' then p_fx_source end,
         fx_rate_at = case when p_currency = 'PKR' then p_fx_at end, amount_due = due
   where order_id = p_order;
  perform set_config('postatlas.pricing_correction', '', true);
  insert into public.order_events (order_id, actor_id, actor_role, event_type, note)
  values (p_order, p_admin, 'admin', 'pricing_correction', left('Checkout changed from ' || snap.checkout_currency || ' ' || snap.amount_due || ' to ' || p_currency || ' ' || due || ': ' || p_reason, 2000));
end $$;

-- ---- payouts -------------------------------------------------------------------------------------------------
-- Called once a placement has been verified. Idempotent: the same order never yields two fulfilment payouts, and a
-- restoration by the ORIGINAL publisher never yields a second one. Only an unpaid, verified, paid-for order qualifies.
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

-- Moves eligible payouts into the processing queue (first verified destination). Safe to run repeatedly and concurrently.
create or replace function public.start_due_payouts(p_limit int default 50) returns setof public.publisher_payouts
language plpgsql security definer set search_path = '' as $$
declare r record; d record;
begin
  for r in
    select p.id, p.publisher_id, p.order_id from public.publisher_payouts p
     where p.status = 'ELIGIBLE' and p.order_id is not null
     order by p.process_by nulls last
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update skip locked
  loop
    if exists (select 1 from public.disputes x where x.order_id = r.order_id and x.status in ('OPEN', 'UNDER_REVIEW'))
       or exists (select 1 from public.refunds f where f.order_id = r.order_id and f.status in ('REQUESTED', 'APPROVED', 'PROCESSING', 'UNCERTAIN')) then
      update public.publisher_payouts set status = 'HELD', hold_kind = 'dispute', hold_reason = 'A dispute or refund is open on this order', held_at = now() where id = r.id;
      continue;
    end if;
    select * into d from public.payout_destinations x where x.publisher_id = r.publisher_id and x.status = 'VERIFIED' order by x.currency, x.created_at limit 1;
    if not found then
      update public.publisher_payouts set last_error = 'No verified payout destination' where id = r.id;
      continue;
    end if;
    update public.publisher_payouts set status = 'PROCESSING', destination_id = d.id, initiated_at = now(), last_error = null, attempts = attempts + 1 where id = r.id;
    return query select * from public.publisher_payouts where id = r.id;
  end loop;
  return;
end $$;

create or replace function public.retry_payout(p_payout uuid, p_admin uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p record;
begin
  perform public.assert_admin(p_admin);
  select * into p from public.publisher_payouts where id = p_payout for update;
  if not found then raise exception 'payout not found'; end if;
  if p.status = 'UNCERTAIN' then raise exception 'an uncertain payout must be reconciled before it can be retried'; end if;
  if p.status <> 'FAILED' then raise exception 'only a failed payout can be retried'; end if;
  update public.publisher_payouts set status = 'ELIGIBLE', last_error = null where id = p_payout;
end $$;

-- Admin records what actually happened to a transfer. PAID needs a real reference and evidence; an UNCERTAIN transfer
-- can only be settled by reconciliation (paid or confirmed-not-sent), never by blindly retrying.
create or replace function public.record_payout_result(
  p_payout uuid, p_admin uuid, p_outcome text, p_reference text, p_payout_currency text, p_payout_amount numeric,
  p_fx_rate numeric, p_fx_source text, p_fx_at timestamptz, p_conversion_cost numeric, p_evidence text, p_error text
) returns text
language plpgsql security definer set search_path = '' as $$
declare p record; d record;
begin
  perform public.assert_admin(p_admin);
  if p_outcome not in ('paid', 'failed', 'uncertain') then raise exception 'invalid outcome'; end if;
  select * into p from public.publisher_payouts where id = p_payout for update;
  if not found then raise exception 'payout not found'; end if;
  if p.status not in ('PROCESSING', 'UNCERTAIN') then raise exception 'payout is % and cannot be settled now', p.status; end if;
  if p_outcome = 'uncertain' and p.status = 'UNCERTAIN' then raise exception 'already marked uncertain'; end if;
  if p_outcome = 'paid' then
    select * into d from public.payout_destinations where id = p.destination_id;
    if not found then raise exception 'payout has no destination'; end if;
    if coalesce(btrim(p_reference), '') = '' or char_length(coalesce(p_evidence, '')) < 10 then raise exception 'a paid payout needs a transfer reference and evidence'; end if;
    if p_payout_currency is distinct from d.currency then raise exception 'payout currency must match the destination account currency (%)', d.currency; end if;
    if p_payout_amount is null or p_payout_amount <= 0 then raise exception 'payout amount required'; end if;
    if p_payout_currency = 'PKR' and (p_fx_rate is null or p_fx_source is null or p_fx_at is null) then raise exception 'a PKR payout needs the exchange rate used'; end if;
    update public.publisher_payouts set status = 'PAID', provider_reference = left(p_reference, 120), transaction_reference = left(p_reference, 120), method = 'bank_transfer',
           payout_currency = p_payout_currency, payout_amount = p_payout_amount,
           fx_rate = case when p_payout_currency = 'PKR' then p_fx_rate end, fx_source = case when p_payout_currency = 'PKR' then p_fx_source end,
           fx_rate_at = case when p_payout_currency = 'PKR' then p_fx_at end, conversion_cost = coalesce(p_conversion_cost, 0),
           confirmed_by = p_admin, confirmed_at = now(), processed_at = now(), evidence_note = left(p_evidence, 1000), last_error = null
     where id = p_payout;
    perform public.ledger_add(p.order_id, 'payout_paid', 'out', p_payout_amount, p_payout_currency, 'payout', p_payout, 'payout:' || p_payout, 'Transfer ' || left(p_reference, 60), p_admin);
    return 'PAID';
  elsif p_outcome = 'failed' then
    update public.publisher_payouts set status = 'FAILED', last_error = left(coalesce(p_error, 'Transfer failed'), 500), evidence_note = left(coalesce(p_evidence, evidence_note), 1000) where id = p_payout;
    return 'FAILED';
  else
    update public.publisher_payouts set status = 'UNCERTAIN', last_error = left(coalesce(p_error, 'Outcome unknown; reconcile with the bank'), 500) where id = p_payout;
    return 'UNCERTAIN';
  end if;
end $$;

create or replace function public.hold_payouts_for_order(p_order uuid, p_actor uuid, p_kind text, p_reason text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_kind not in ('dispute', 'admin', 'refund', 'compliance') then raise exception 'invalid hold kind'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a hold needs a reason'; end if;
  update public.publisher_payouts set status = 'HELD', hold_kind = p_kind, hold_reason = left(p_reason, 300), held_by = p_actor, held_at = now()
   where order_id = p_order and status in ('ELIGIBLE', 'FAILED');
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.release_payouts_for_order(p_order uuid, p_actor uuid, p_kind text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform public.assert_admin(p_actor);
  update public.publisher_payouts set status = 'ELIGIBLE', hold_kind = null, hold_reason = null
   where order_id = p_order and status = 'HELD' and hold_kind = p_kind;
  get diagnostics n = row_count;
  return n;
end $$;

-- A publisher who did not fulfil the order is owed nothing: cancel entitlement that has not been paid out.
create or replace function public.cancel_unpaid_payouts(p_order uuid, p_actor uuid, p_reason text) returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id, amount from public.publisher_payouts where order_id = p_order and status in ('ELIGIBLE', 'HELD', 'FAILED') for update loop
    update public.publisher_payouts set status = 'CANCELLED', hold_reason = left(p_reason, 300) where id = r.id;
    perform public.ledger_add(p_order, 'publisher_entitlement_cancelled', 'memo', r.amount, 'USD', 'payout', r.id, 'cancel:' || r.id, left(p_reason, 300), p_actor);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---- recovery --------------------------------------------------------------------------------------------------
create or replace function public.open_recovery_case(p_order uuid, p_kind text, p_reason text, p_actor uuid, p_deadline_hours int) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o record; lst record; v_id uuid;
begin
  if p_kind not in ('publisher_rejection', 'link_restoration') then raise exception 'invalid case kind'; end if;
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

create or replace function public.escalate_recovery_case(p_case uuid, p_actor uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.recovery_cases set status = 'ESCALATED', escalated_at = now(), escalation_reason = left(p_reason, 1000), updated_at = now()
   where id = p_case and status = 'OPEN';
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function public.mark_case_restored(p_order uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.recovery_cases set status = 'RESTORED', resolved_at = now(), resolution = 'Original publisher restored the link; verified by an automatic check', updated_at = now()
   where order_id = p_order and kind = 'link_restoration' and status in ('OPEN', 'ESCALATED');
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Admin gives the order to a different approved listing. Customer price, target page, anchor and pricing snapshot are
-- untouched. The previous publisher's unpaid entitlement is cancelled when they never fulfilled the order.
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

create or replace function public.resolve_recovery_case(p_case uuid, p_admin uuid, p_status text, p_resolution text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin(p_admin);
  if p_status not in ('RESOLVED_REFUND', 'RESOLVED_OTHER', 'CANCELLED') then raise exception 'invalid resolution'; end if;
  if char_length(coalesce(btrim(p_resolution), '')) < 5 then raise exception 'a resolution note is required'; end if;
  update public.recovery_cases set status = p_status, resolved_by = p_admin, resolved_at = now(), resolution = left(p_resolution, 1000), updated_at = now()
   where id = p_case and status in ('OPEN', 'ESCALATED', 'REASSIGNED');
  if not found then raise exception 'the recovery case is not open'; end if;
end $$;

-- ---- refunds ---------------------------------------------------------------------------------------------------
-- Requesting a refund records an OBLIGATION to review; it never changes the order to "refunded" and moves no money.
create or replace function public.request_refund(p_order uuid, p_amount numeric, p_reason text, p_actor uuid, p_role text, p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare pay record; v_live numeric; v_amount numeric; v_id uuid;
begin
  if p_role not in ('customer', 'admin', 'system') then raise exception 'invalid role'; end if;
  if p_role = 'admin' then perform public.assert_admin(p_actor); end if;
  if p_key is not null then
    select id into v_id from public.refunds where idempotency_key = p_key;
    if v_id is not null then return v_id; end if;
  end if;
  perform 1 from public.orders where id = p_order for update;
  select * into pay from public.payments where order_id = p_order and status = 'PAID' for update;
  if not found then raise exception 'there is no confirmed payment to refund'; end if;
  select coalesce(sum(amount), 0) into v_live from public.refunds where payment_id = pay.id and status in ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'UNCERTAIN');
  v_amount := coalesce(p_amount, pay.amount - v_live);
  if v_amount <= 0 or v_amount + v_live > pay.amount then raise exception 'the refund would exceed the amount paid (paid %, already requested or refunded %)', pay.amount, v_live; end if;
  insert into public.refunds (order_id, payment_id, amount, currency, reason, requested_by, requested_role, idempotency_key)
  values (p_order, pay.id, v_amount, pay.currency, left(p_reason, 1000), p_actor, p_role, p_key) returning id into v_id;
  return v_id;
end $$;

create or replace function public.advance_refund(p_refund uuid, p_admin uuid, p_action text, p_note text) returns text
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  perform public.assert_admin(p_admin);
  select * into r from public.refunds where id = p_refund for update;
  if not found then raise exception 'refund not found'; end if;
  if p_action = 'approve' and r.status = 'REQUESTED' then
    update public.refunds set status = 'APPROVED', approved_by = p_admin, approved_at = now() where id = p_refund;
    perform public.hold_payouts_for_order(r.order_id, p_admin, 'refund', 'A refund was approved for this order');
    return 'APPROVED';
  elsif p_action = 'reject' and r.status in ('REQUESTED', 'APPROVED') then
    if char_length(coalesce(btrim(p_note), '')) < 5 then raise exception 'a rejection needs a reason'; end if;
    update public.refunds set status = 'REJECTED', failure_reason = left(p_note, 1000), approved_by = p_admin, approved_at = now() where id = p_refund;
    perform public.release_payouts_for_order(r.order_id, p_admin, 'refund');
    return 'REJECTED';
  elsif p_action = 'start' and r.status = 'APPROVED' then
    update public.refunds set status = 'PROCESSING', processing_at = now() where id = p_refund;
    return 'PROCESSING';
  elsif p_action = 'retry' and r.status = 'FAILED' then
    update public.refunds set status = 'PROCESSING', processing_at = now(), failure_reason = null where id = p_refund;
    return 'PROCESSING';
  end if;
  raise exception 'cannot % a refund that is %', p_action, r.status;
end $$;

create or replace function public.record_refund_result(p_refund uuid, p_admin uuid, p_outcome text, p_reference text, p_evidence text, p_error text) returns text
language plpgsql security definer set search_path = '' as $$
declare r record; pay record; v_done numeric;
begin
  perform public.assert_admin(p_admin);
  if p_outcome not in ('completed', 'failed', 'uncertain') then raise exception 'invalid outcome'; end if;
  select * into r from public.refunds where id = p_refund for update;
  if not found then raise exception 'refund not found'; end if;
  if r.status not in ('PROCESSING', 'UNCERTAIN') then raise exception 'refund is % and cannot be settled now', r.status; end if;
  if p_outcome = 'uncertain' and r.status = 'UNCERTAIN' then raise exception 'already marked uncertain'; end if;
  if p_outcome = 'completed' then
    if char_length(coalesce(btrim(p_reference), '')) < 4 or char_length(coalesce(p_evidence, '')) < 10 then raise exception 'a completed refund needs a real transfer reference and evidence'; end if;
    update public.refunds set status = 'COMPLETED', transfer_reference = left(p_reference, 120), evidence_note = left(p_evidence, 1000), completed_by = p_admin, completed_at = now(), failure_reason = null where id = p_refund;
    perform public.ledger_add(r.order_id, 'refund_paid', 'out', r.amount, r.currency, 'refund', r.id, 'refund:' || r.id, 'Refund transfer ' || left(p_reference, 60), p_admin);
    select * into pay from public.payments where id = r.payment_id;
    select coalesce(sum(amount), 0) into v_done from public.refunds where payment_id = r.payment_id and status = 'COMPLETED';
    if v_done >= pay.amount then
      perform public.cancel_unpaid_payouts(r.order_id, p_admin, 'Order fully refunded');
      if exists (select 1 from public.orders o join public.order_status_transitions t on t.from_status = o.status and t.to_status = 'CANCELLED' where o.id = r.order_id) then
        perform public.transition_order(r.order_id, (select status from public.orders where id = r.order_id), 'CANCELLED', p_admin, 'admin', 'Order cancelled after a completed full refund');
      end if;
    end if;
    return 'COMPLETED';
  elsif p_outcome = 'failed' then
    update public.refunds set status = 'FAILED', failure_reason = left(coalesce(p_error, 'Transfer failed'), 1000) where id = p_refund;
    return 'FAILED';
  else
    update public.refunds set status = 'UNCERTAIN', failure_reason = left(coalesce(p_error, 'Outcome unknown; reconcile with the bank'), 1000) where id = p_refund;
    return 'UNCERTAIN';
  end if;
end $$;


-- Verified placements whose payout obligation is missing (e.g. the app crashed between verifying and recording it).
create or replace function public.orders_missing_payout_obligation(p_limit int default 100) returns table (order_id uuid, verified_at timestamptz)
language sql security definer set search_path = '' as $$
  select o.id, pl.verified_at
    from public.orders o
    join public.published_placements pl on pl.order_id = o.id and pl.verified_at is not null
   where o.status in ('VERIFIED', 'MONITORING')
     and exists (select 1 from public.payments p where p.order_id = o.id and p.status = 'PAID')
     and not exists (select 1 from public.publisher_payouts x where x.order_id = o.id and x.status <> 'CANCELLED' and x.publisher_id = (select w.publisher_id from public.publisher_websites w where w.id = o.website_id))
   order by pl.verified_at
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

-- ---- privileges: everything above is service_role only ----------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'forbid_mutation()', 'assert_admin(uuid)', 'commission_bps()', 'ledger_add(uuid,text,text,numeric,text,text,uuid,text,text,uuid)',
    'create_order_priced(uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,numeric,text,timestamptz,numeric)',
    'submit_payment(uuid,uuid,text,text)', 'review_payment(uuid,uuid,text,text)',
    'admin_correct_checkout(uuid,uuid,text,uuid,numeric,text,timestamptz,text)',
    'create_payout_obligation(uuid,timestamptz)', 'start_due_payouts(int)', 'retry_payout(uuid,uuid)',
    'record_payout_result(uuid,uuid,text,text,text,numeric,numeric,text,timestamptz,numeric,text,text)',
    'hold_payouts_for_order(uuid,uuid,text,text)', 'release_payouts_for_order(uuid,uuid,text)', 'cancel_unpaid_payouts(uuid,uuid,text)',
    'open_recovery_case(uuid,text,text,uuid,int)', 'escalate_recovery_case(uuid,uuid,text)', 'mark_case_restored(uuid)',
    'reassign_order(uuid,uuid,uuid,uuid,text)', 'replace_payout_destination(uuid,text,text,text,text,text,text,text)',  'resolve_recovery_case(uuid,uuid,text,text)',
    'orders_missing_payout_obligation(int)', 'request_refund(uuid,numeric,text,uuid,text,text)', 'advance_refund(uuid,uuid,text,text)', 'record_refund_result(uuid,uuid,text,text,text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---- row level security: no browser access except reading one's own order's snapshot ---------------------------------
alter table public.fx_rates            enable row level security;
alter table public.order_pricing       enable row level security;
alter table public.ledger_entries      enable row level security;
alter table public.payout_destinations enable row level security;
alter table public.recovery_cases      enable row level security;
alter table public.refunds             enable row level security;
revoke all on public.fx_rates, public.order_pricing, public.ledger_entries, public.payout_destinations, public.recovery_cases, public.refunds from anon, authenticated;
grant select on public.order_pricing to authenticated;
drop policy if exists order_pricing_select on public.order_pricing;
create policy order_pricing_select on public.order_pricing for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_pricing.order_id and (public.is_org_member(o.organization_id) or public.is_platform_admin())));
-- fx_rates, ledger_entries, payout_destinations, recovery_cases, refunds, publisher_payouts: NO policy -> service role only.
