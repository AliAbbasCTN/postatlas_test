-- =====================================================================================================
-- PostAtlas - complete fresh database schema for Supabase (PostgreSQL 15+)
--
-- Run ONCE, in the Supabase SQL Editor, against an EMPTY `public` schema.
-- It does not depend on any earlier PostAtlas SQL file, table, policy or function.
--
-- ARCHITECTURE (read this first)
--   * Browser roles (`anon`, `authenticated`) are READ-ONLY and only on the tables the app's
--     session client actually reads. Row Level Security filters those reads.
--   * EVERY write goes through a Next.js server action that has already authenticated the caller,
--     checked role + record ownership and validated the input, and then uses the SERVICE ROLE
--     (which bypasses RLS). Because the service role bypasses RLS, the most important integrity rules
--     are ALSO enforced by triggers and constraints below, so a bug in application code cannot,
--     for example, change an order price or jump an order to PAID.
--   * Order status can only change through public.transition_order() (compare-and-set + history row).
--   * Platform roles (`publisher`, `admin`, `super_admin`) can never be set by signup, by user
--     metadata, or by the user's own session. Only the service role (after an admin check in the
--     app) or SQL run by you in this editor can change them.
--
-- Everything is created in dependency order and is not safe to re-run (it is a first-time install).
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------
-- 0. EXTENSIONS
-- ---------------------------------------------------------------------------------------------
-- None are required: gen_random_uuid() is built into PostgreSQL 13+. Nothing is installed into `public`.

-- ---------------------------------------------------------------------------------------------
-- 1. IDENTITY: profiles, organizations, members, invitations
-- ---------------------------------------------------------------------------------------------

-- One row per auth user. Created ONLY by the trigger in section 11 (the application never inserts here).
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text check (full_name is null or char_length(full_name) <= 100),
  email         text check (email is null or (email = lower(email) and char_length(email) <= 254)),
  platform_role text not null default 'user' check (platform_role in ('user', 'publisher', 'admin', 'super_admin')),
  disabled      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (lower(email));
create index profiles_role_idx on public.profiles (platform_role) where platform_role <> 'user';

-- A "workspace" owns customer data (websites, opportunities, orders, advice). It is either a customer-created TEAM
-- (an organisation or agency with members and roles) or a PERSONAL workspace: a private, single-owner container that
-- the server creates automatically the first time an individual customer needs one (see ensure_personal_workspace).
-- Customers are never required to create a team.
create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 1 and 100),
  kind          text not null default 'team' check (kind in ('team', 'personal')),
  owner_user_id uuid references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint organizations_personal_owner_check check (kind <> 'personal' or owner_user_id is not null)
);
create unique index organizations_one_personal_per_user on public.organizations (owner_user_id) where kind = 'personal';

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  role            text not null check (role in ('owner', 'seo_manager', 'seo_specialist', 'content_manager', 'viewer')),
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

create table public.organization_invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email           text not null check (email = lower(email) and char_length(email) <= 254),
  role            text not null check (role in ('seo_manager', 'seo_specialist', 'content_manager', 'viewer')),
  invited_by      uuid not null references public.profiles (id),
  status          text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'REVOKED')),
  created_at      timestamptz not null default now()
);
-- At most one pending invitation per organization + address (history rows are unrestricted).
create unique index organization_invitations_one_pending on public.organization_invitations (organization_id, lower(email)) where status = 'PENDING';
create index organization_invitations_email_idx on public.organization_invitations (lower(email), status);

-- ---------------------------------------------------------------------------------------------
-- 2. PUBLISHERS (supply side)
-- ---------------------------------------------------------------------------------------------

create table public.publisher_profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references public.profiles (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 100),
  bio         text check (bio is null or char_length(bio) <= 1000),
  approved    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.publisher_websites (
  id                   uuid primary key default gen_random_uuid(),
  publisher_id         uuid not null references public.publisher_profiles (id) on delete cascade,
  domain               text not null unique check (domain = lower(domain) and domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  description          text check (description is null or char_length(description) <= 1000),
  niche                text check (niche is null or niche in ('SEO & Marketing', 'Technology', 'Business', 'Finance', 'Health & Wellness', 'Travel', 'Education', 'Lifestyle', 'E-commerce', 'Real Estate', 'Other')),
  country              text check (country is null or char_length(country) <= 60),
  language             text check (language is null or char_length(language) <= 40),
  price_guest_post     numeric(10, 2) check (price_guest_post is null or (price_guest_post > 0 and price_guest_post <= 100000)),
  price_link_insertion numeric(10, 2) check (price_link_insertion is null or (price_link_insertion > 0 and price_link_insertion <= 100000)),
  turnaround_days_min  int check (turnaround_days_min is null or turnaround_days_min between 1 and 120),
  turnaround_days_max  int check (turnaround_days_max is null or turnaround_days_max between 1 and 120),
  link_type            text check (link_type is null or link_type in ('dofollow', 'nofollow', 'mixed')),
  article_requirements text check (article_requirements is null or char_length(article_requirements) <= 2000),
  status               text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected', 'suspended')),
  rejection_reason     text check (rejection_reason is null or char_length(rejection_reason) <= 500),
  reviewed_by          uuid references public.profiles (id) on delete set null,
  last_verified_at     timestamptz,
  -- 'confirmed' must only ever be set from real evidence (an admin check or a provider); default is unknown.
  indexed_status       text not null default 'unknown' check (indexed_status in ('unknown', 'confirmed')),
  created_at           timestamptz not null default now(),
  check (turnaround_days_min is null or turnaround_days_max is null or turnaround_days_min <= turnaround_days_max),
  check (price_guest_post is not null or price_link_insertion is not null or status <> 'approved')
);
create index publisher_websites_publisher_idx on public.publisher_websites (publisher_id);
create index publisher_websites_status_idx on public.publisher_websites (status, niche);
create index publisher_websites_created_idx on public.publisher_websites (created_at desc) where status = 'approved';

-- DR / DA / traffic. `verified` may only be true when the source is NOT the publisher's own claim.
create table public.publisher_metrics (
  website_id        uuid primary key references public.publisher_websites (id) on delete cascade,
  dr                int check (dr is null or dr between 0 and 100),
  da                int check (da is null or da between 0 and 100),
  organic_traffic   bigint check (organic_traffic is null or organic_traffic >= 0),
  spam_score        int check (spam_score is null or spam_score between 0 and 100),
  verified          boolean not null default false,
  verified_at       timestamptz,
  metrics_source    text not null default 'self_reported' check (metrics_source in ('self_reported', 'admin_verified', 'provider')),
  verified_by       uuid references public.profiles (id) on delete set null,
  verification_note text check (verification_note is null or char_length(verification_note) <= 300),
  constraint publisher_metrics_verified_needs_source check (not verified or metrics_source <> 'self_reported')
);

-- PRIVATE. Cost / margin / supplier data. Never granted to any browser role and no policy exists.
create table public.publisher_supplier_info (
  website_id            uuid primary key references public.publisher_websites (id) on delete cascade,
  supplier_name         text,
  supplier_contact      text,
  supplier_cost         numeric(10, 2),
  margin                numeric(10, 2),
  payment_method        text,
  reliability_notes     text,
  last_negotiated_price numeric(10, 2),
  updated_at            timestamptz not null default now()
);

create table public.saved_publishers (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  website_id      uuid not null references public.publisher_websites (id) on delete cascade,
  saved_by        uuid not null references public.profiles (id),
  created_at      timestamptz not null default now(),
  primary key (organization_id, website_id)
);

-- ---------------------------------------------------------------------------------------------
-- 3. CUSTOMER WEBSITES, AUDITS, OPPORTUNITIES
-- ---------------------------------------------------------------------------------------------

create table public.websites (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  domain          text not null check (domain = lower(domain) and domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  category        text not null check (category in ('SEO & Marketing', 'Technology', 'Business', 'Finance', 'Health & Wellness', 'Travel', 'Education', 'Lifestyle', 'E-commerce', 'Real Estate', 'Other')),
  created_by      uuid not null references public.profiles (id),
  last_audit_at   timestamptz,
  created_at      timestamptz not null default now(),
  unique (organization_id, domain)
);
create index websites_org_idx on public.websites (organization_id);

create table public.audits (
  id                uuid primary key default gen_random_uuid(),
  website_id        uuid not null references public.websites (id) on delete cascade,
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  requested_by      uuid not null references public.profiles (id),
  status            text not null default 'RUNNING' check (status in ('RUNNING', 'COMPLETED', 'FAILED')),
  pages_found       int not null default 0 check (pages_found >= 0),
  provider          text not null default 'none',
  link_data_status  text not null default 'unavailable' check (link_data_status in ('ok', 'unavailable', 'partial')),
  error             text,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz
);
create index audits_website_idx on public.audits (website_id, created_at desc);
create index audits_org_idx on public.audits (organization_id);
-- Only one analysis may run per website at a time.
create unique index audits_one_running on public.audits (website_id) where status = 'RUNNING';

-- Observed facts only (what the fetch actually returned). Nothing in this table is estimated.
create table public.audit_pages (
  id          uuid primary key default gen_random_uuid(),
  audit_id    uuid not null references public.audits (id) on delete cascade,
  website_id  uuid not null references public.websites (id) on delete cascade,
  url         text not null check (char_length(url) <= 2048),
  http_status int,
  title       text,
  noindex     boolean,
  canonical   text,
  observed_at timestamptz not null default now(),
  unique (audit_id, url)
);
create index audit_pages_website_idx on public.audit_pages (website_id, observed_at desc);

-- Result of the PUBLIC "check your website" tool (no account needed). Written and read only by the server;
-- the report page is addressed by this unguessable id. Contains observed facts only, kept for a limited time.
create table public.site_checks (
  id         uuid primary key default gen_random_uuid(),
  domain     text not null check (domain = lower(domain) and domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  category   text not null check (category in ('SEO & Marketing', 'Technology', 'Business', 'Finance', 'Health & Wellness', 'Travel', 'Education', 'Lifestyle', 'E-commerce', 'Real Estate', 'Other')),
  result     jsonb not null check (pg_column_size(result) < 200000),
  created_at timestamptz not null default now()
);
create index site_checks_lookup_idx on public.site_checks (domain, category, created_at desc);

create table public.opportunities (
  id                          uuid primary key default gen_random_uuid(),
  website_id                  uuid not null references public.websites (id) on delete cascade,
  organization_id             uuid not null references public.organizations (id) on delete cascade,
  audit_id                    uuid references public.audits (id) on delete set null,
  page_url                    text not null check (char_length(page_url) <= 2048),
  page_title                  text,
  category                    text,
  kind                        text not null check (kind in ('authority_gap', 'customer_selected')),
  level                       text check (level in ('HIGH', 'MEDIUM', 'LOW')),
  page_referring_domains      int check (page_referring_domains is null or page_referring_domains >= 0),   -- observed (provider)
  reference_referring_domains int check (reference_referring_domains is null or reference_referring_domains >= 0), -- observed (provider)
  gap                         int,                                                                         -- calculated
  est_links_min               int,                                                                         -- estimated
  est_links_max               int,                                                                         -- estimated
  data_source                 text,
  data_fetched_at             timestamptz,
  status                      text not null default 'OPEN' check (status in ('OPEN', 'DISMISSED')),
  created_at                  timestamptz not null default now(),
  -- An "authority gap" must carry real measured data and its source. Customer-selected pages carry none.
  check (kind <> 'authority_gap' or (level is not null and page_referring_domains is not null and reference_referring_domains is not null and data_source is not null)),
  unique (website_id, page_url)
);
create index opportunities_org_idx on public.opportunities (organization_id, status);

-- ---------------------------------------------------------------------------------------------
-- 4. ORDERS, PAYMENTS, CONTENT, PLACEMENTS
-- ---------------------------------------------------------------------------------------------

create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  website_id          uuid not null references public.publisher_websites (id),          -- the PUBLISHER listing being bought
  customer_website_id uuid references public.websites (id) on delete set null,          -- the customer's own site
  opportunity_id      uuid references public.opportunities (id) on delete set null,
  order_type          text not null check (order_type in ('guest_post', 'link_insertion')),
  target_url          text not null check (target_url ~* '^https?://' and char_length(target_url) <= 2048),
  anchor_text         text check (anchor_text is null or char_length(anchor_text) <= 100),
  customer_price      numeric(10, 2) not null check (customer_price > 0),                 -- read from the listing by the server, never from the browser
  status              text not null default 'PAYMENT_PENDING' check (status in (
    'PAYMENT_PENDING', 'PAYMENT_UNDER_REVIEW', 'PAID', 'CONTENT_SUBMITTED', 'PENDING_PUBLISHER',
    'ACCEPTED', 'IN_PROGRESS', 'PUBLISHED', 'VERIFICATION_PENDING', 'VERIFIED', 'MONITORING',
    'ISSUE_DETECTED', 'REPLACEMENT_REQUESTED', 'COMPLETED', 'PUBLISHER_REJECTED', 'CANCELLED', 'DISPUTED'
  )),
  disputed_from       text,                                                               -- status the order was in when a dispute opened
  created_by          uuid not null references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index orders_org_idx on public.orders (organization_id, created_at desc);
create index orders_website_idx on public.orders (website_id, status);
create index orders_status_idx on public.orders (status);
-- No second live order for the same customer + publisher + target page + type.
create unique index orders_no_duplicate_live on public.orders (organization_id, website_id, target_url, order_type)
  where status not in ('CANCELLED', 'COMPLETED', 'PUBLISHER_REJECTED');

-- Legal (from -> to) pairs. Mirrors src/lib/order-state.ts; a test in the repo fails if they ever differ.
create table public.order_status_transitions (
  from_status text not null,
  to_status   text not null,
  primary key (from_status, to_status)
);
-- BEGIN order_status_transitions
insert into public.order_status_transitions (from_status, to_status) values
  ('PAYMENT_PENDING', 'PAYMENT_UNDER_REVIEW'),
  ('PAYMENT_PENDING', 'CANCELLED'),
  ('PAYMENT_UNDER_REVIEW', 'PAID'),
  ('PAYMENT_UNDER_REVIEW', 'PAYMENT_PENDING'),
  ('PAYMENT_UNDER_REVIEW', 'CANCELLED'),
  ('PAID', 'CONTENT_SUBMITTED'),
  ('PAID', 'CANCELLED'),
  ('CONTENT_SUBMITTED', 'PENDING_PUBLISHER'),
  ('CONTENT_SUBMITTED', 'PAID'),
  ('CONTENT_SUBMITTED', 'CANCELLED'),
  ('PENDING_PUBLISHER', 'ACCEPTED'),
  ('PENDING_PUBLISHER', 'PUBLISHER_REJECTED'),
  ('PENDING_PUBLISHER', 'CANCELLED'),
  ('PUBLISHER_REJECTED', 'CANCELLED'),
  ('ACCEPTED', 'IN_PROGRESS'),
  ('ACCEPTED', 'PUBLISHED'),
  ('ACCEPTED', 'CANCELLED'),
  ('IN_PROGRESS', 'PUBLISHED'),
  ('IN_PROGRESS', 'CANCELLED'),
  ('PUBLISHED', 'VERIFICATION_PENDING'),
  ('VERIFICATION_PENDING', 'VERIFIED'),
  ('VERIFICATION_PENDING', 'PUBLISHED'),
  ('VERIFIED', 'MONITORING'),
  ('MONITORING', 'ISSUE_DETECTED'),
  ('MONITORING', 'COMPLETED'),
  ('ISSUE_DETECTED', 'MONITORING'),
  ('ISSUE_DETECTED', 'REPLACEMENT_REQUESTED'),
  ('REPLACEMENT_REQUESTED', 'IN_PROGRESS'),
  ('REPLACEMENT_REQUESTED', 'CANCELLED'),
  ('PAID', 'DISPUTED'),
  ('CONTENT_SUBMITTED', 'DISPUTED'),
  ('PENDING_PUBLISHER', 'DISPUTED'),
  ('ACCEPTED', 'DISPUTED'),
  ('IN_PROGRESS', 'DISPUTED'),
  ('PUBLISHED', 'DISPUTED'),
  ('VERIFICATION_PENDING', 'DISPUTED'),
  ('VERIFIED', 'DISPUTED'),
  ('MONITORING', 'DISPUTED'),
  ('ISSUE_DETECTED', 'DISPUTED'),
  ('DISPUTED', 'MONITORING'),
  ('DISPUTED', 'IN_PROGRESS'),
  ('DISPUTED', 'REPLACEMENT_REQUESTED'),
  ('DISPUTED', 'COMPLETED'),
  ('DISPUTED', 'CANCELLED'),
  ('PUBLISHER_REJECTED', 'PENDING_PUBLISHER'),
  ('REPLACEMENT_REQUESTED', 'PENDING_PUBLISHER'),
  ('ACCEPTED', 'PUBLISHER_REJECTED'),
  ('IN_PROGRESS', 'PUBLISHER_REJECTED'),
  ('REPLACEMENT_REQUESTED', 'PUBLISHED'),
  ('REPLACEMENT_REQUESTED', 'PUBLISHER_REJECTED')
;
-- END order_status_transitions

-- Append-only history of everything that happens to an order.
create table public.order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  actor_id    uuid references public.profiles (id) on delete set null,
  actor_role  text not null check (actor_role in ('customer', 'publisher', 'admin', 'system')),
  event_type  text not null default 'status_change',
  from_status text,
  to_status   text,
  note        text check (note is null or char_length(note) <= 2000),
  created_at  timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, created_at);

-- Manual payment instructions shown to customers (bank / NayaPay / wallet details). Server-side access only.
create table public.payment_methods (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(name) between 1 and 80),
  account_identifier text not null check (char_length(account_identifier) <= 300),
  instructions       text check (instructions is null or char_length(instructions) <= 1000),
  enabled            boolean not null default true
);

create table public.payments (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders (id) on delete cascade,
  amount                numeric(10, 2) not null check (amount > 0),
  currency              text not null default 'USD' check (currency = 'USD'),
  method_id             uuid references public.payment_methods (id) on delete set null,
  transaction_reference text not null check (char_length(transaction_reference) between 4 and 100),
  note                  text check (note is null or char_length(note) <= 500),
  status                text not null default 'PAYMENT_UNDER_REVIEW' check (status in ('PAYMENT_UNDER_REVIEW', 'PAID', 'PAYMENT_REJECTED')),
  submitted_at          timestamptz not null default now(),
  verified_by           uuid references public.profiles (id) on delete set null,
  verified_at           timestamptz,
  rejection_reason      text check (rejection_reason is null or char_length(rejection_reason) <= 500)
);
create index payments_order_idx on public.payments (order_id);
create index payments_status_idx on public.payments (status, submitted_at);
-- One payment awaiting review per order, and a reference cannot be reused unless the earlier one was rejected.
create unique index payments_one_under_review on public.payments (order_id) where status = 'PAYMENT_UNDER_REVIEW';
create unique index payments_reference_unique on public.payments (lower(transaction_reference)) where status <> 'PAYMENT_REJECTED';

-- Reserved for future publisher payouts. Private: no browser access.
create table public.publisher_payouts (
  id                    uuid primary key default gen_random_uuid(),
  publisher_id          uuid not null references public.publisher_profiles (id),
  order_id              uuid references public.orders (id),
  amount                numeric(10, 2) not null check (amount > 0),
  method                text,
  transaction_reference text,
  status                text not null default 'NOT_REQUESTED' check (status in ('NOT_REQUESTED', 'REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PROCESSED')),
  processed_at          timestamptz
);
create index publisher_payouts_publisher_idx on public.publisher_payouts (publisher_id);

create table public.content_submissions (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null unique references public.orders (id) on delete cascade,
  submitted_by  uuid not null references public.profiles (id),
  title         text check (title is null or char_length(title) <= 200),
  body          text check (body is null or char_length(body) <= 60000),
  target_url    text,
  anchor_text   text,
  instructions  text check (instructions is null or char_length(instructions) <= 2000),
  word_count    int check (word_count is null or word_count >= 0),
  policy_flags  jsonb not null default '[]'::jsonb,
  review_status text not null default 'AUTO_CLEARED' check (review_status in ('AUTO_CLEARED', 'HELD', 'APPROVED', 'CHANGES_REQUESTED')),
  review_note   text check (review_note is null or char_length(review_note) <= 1000),
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,
  revision      int not null default 1 check (revision >= 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.published_placements (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null unique references public.orders (id) on delete cascade,
  published_url        text not null check (published_url ~* '^https?://' and char_length(published_url) <= 2048),
  submitted_by         uuid not null references public.publisher_profiles (id),
  health               text not null default 'PENDING' check (health in ('PENDING', 'HEALTHY', 'ISSUE', 'NEEDS_REVIEW')),
  consecutive_failures int not null default 0 check (consecutive_failures >= 0),
  last_checked_at      timestamptz,
  next_check_at        timestamptz,
  verified_at          timestamptz,
  verified_by          uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index placements_due_idx on public.published_placements (next_check_at) where health in ('HEALTHY', 'ISSUE', 'NEEDS_REVIEW');

create table public.backlink_checks (
  id              uuid primary key default gen_random_uuid(),
  placement_id    uuid not null references public.published_placements (id) on delete cascade,
  result          text not null check (result in ('VERIFIED', 'LINK_MISSING', 'LINK_CHANGED', 'PAGE_UNAVAILABLE', 'REQUIRES_REVIEW')),
  http_status     int,
  link_found      boolean,
  anchor_matched  boolean,
  attribute       text check (attribute is null or attribute in ('dofollow', 'nofollow', 'sponsored', 'ugc')),
  reason          text,
  message         text,
  final_url       text,
  response_ms     int,
  noindex_detected boolean,
  "trigger"       text not null default 'scheduled' check ("trigger" in ('publisher_submit', 'customer_request', 'scheduled', 'admin')),
  checked_by      uuid references public.profiles (id) on delete set null,
  checked_at      timestamptz not null default now()
);
create index backlink_checks_placement_idx on public.backlink_checks (placement_id, checked_at desc);
create index backlink_checks_checked_idx on public.backlink_checks (checked_at desc);

create table public.backlink_monitoring_events (
  id           uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.published_placements (id) on delete cascade,
  event_type   text not null check (event_type in ('LINK_MISSING', 'LINK_CHANGED', 'PAGE_UNAVAILABLE', 'NEEDS_REVIEW', 'RECOVERED')),
  message      text,
  detail       jsonb,
  created_at   timestamptz not null default now()
);
create index backlink_monitoring_events_placement_idx on public.backlink_monitoring_events (placement_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- 5. ADVICE / DISCUSSION  (pre-purchase conversations; deliberately separate from disputes)
-- ---------------------------------------------------------------------------------------------

create table public.advice_threads (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  created_by           uuid not null references public.profiles (id),
  subject              text not null check (char_length(subject) between 3 and 140),
  website_id           uuid references public.websites (id) on delete set null,
  opportunity_id       uuid references public.opportunities (id) on delete set null,
  publisher_website_id uuid references public.publisher_websites (id) on delete set null,
  order_id             uuid references public.orders (id) on delete set null,
  status               text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  awaiting             text not null default 'team' check (awaiting in ('team', 'customer')),
  last_message_at      timestamptz not null default now(),
  last_customer_email_at timestamptz,   -- throttles notification emails to the customer
  last_team_email_at   timestamptz,     -- throttles notification emails to the team
  created_at           timestamptz not null default now()
);
create index advice_threads_org_idx on public.advice_threads (organization_id, last_message_at desc);
create index advice_threads_open_idx on public.advice_threads (status, awaiting, last_message_at desc);

create table public.advice_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.advice_threads (id) on delete cascade,
  sender_id   uuid not null references public.profiles (id),
  sender_role text not null check (sender_role in ('customer', 'team')),
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index advice_messages_thread_idx on public.advice_messages (thread_id, created_at);

-- ---------------------------------------------------------------------------------------------
-- 6. DISPUTES (issues with an existing order)
-- ---------------------------------------------------------------------------------------------

create table public.disputes (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders (id) on delete cascade,
  raised_by         uuid not null references public.profiles (id),
  category          text not null default 'other' check (category in (
    'not_published', 'wrong_url', 'link_missing', 'page_removed', 'wrong_attribute',
    'requirements_not_followed', 'publisher_failed', 'changed_after_publication', 'payment', 'other'
  )),
  reason            text not null check (char_length(reason) between 1 and 2000),
  evidence          text check (evidence is null or char_length(evidence) <= 2000),
  status            text not null default 'OPEN' check (status in ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED')),
  resolution        text check (resolution is null or char_length(resolution) <= 2000),
  resolved_by       uuid references public.profiles (id) on delete set null,
  resolution_status text,                       -- the order status the admin chose when closing
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz,
  -- A closed dispute always records what was decided and when.
  check (status in ('OPEN', 'UNDER_REVIEW') or (resolution is not null and resolved_at is not null))
);
create index disputes_order_idx on public.disputes (order_id);
create index disputes_status_idx on public.disputes (status, created_at desc);
-- At most one open / under-review dispute per order.
create unique index disputes_one_open_per_order on public.disputes (order_id) where status in ('OPEN', 'UNDER_REVIEW');

create table public.dispute_messages (
  id          uuid primary key default gen_random_uuid(),
  dispute_id  uuid not null references public.disputes (id) on delete cascade,
  sender_id   uuid not null references public.profiles (id),
  sender_role text not null check (sender_role in ('customer', 'publisher', 'admin')),
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index dispute_messages_dispute_idx on public.dispute_messages (dispute_id, created_at);

-- ---------------------------------------------------------------------------------------------
-- 7. NOTIFICATIONS, INTERNAL MESSAGES, EDITORIAL, PLATFORM, SECURITY
-- ---------------------------------------------------------------------------------------------

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  event_type text not null,
  payload    jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- Internal order messages (staff / parties). Reserved; private, server-side only.
create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid references public.orders (id) on delete cascade,
  sender_id  uuid not null references public.profiles (id),
  body       text not null check (char_length(body) <= 4000),
  created_at timestamptz not null default now()
);
create index messages_order_idx on public.messages (order_id);

create table public.article_categories (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- Public blog. Plain text only (the app renders it escaped). Written only by super admin via the server.
create table public.articles (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(title) between 1 and 200),
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  excerpt          text check (excerpt is null or char_length(excerpt) <= 300),
  content          text not null,
  author_name      text check (author_name is null or char_length(author_name) <= 100),
  category_id      uuid references public.article_categories (id) on delete set null,
  featured_image   text,
  meta_title       text check (meta_title is null or char_length(meta_title) <= 200),
  meta_description text check (meta_description is null or char_length(meta_description) <= 200),
  canonical_url    text,
  status           text not null default 'DRAFT' check (status in ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED')),
  published_at     timestamptz,
  updated_at       timestamptz not null default now()
);
create index articles_status_idx on public.articles (status, published_at desc);

-- Private platform configuration. No browser access.
create table public.platform_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Append-only audit trail (enforced by a trigger below). Never log passwords, tokens or payment references.
create table public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  actor_id        uuid references public.profiles (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete set null,
  action          text not null,
  resource_type   text not null,
  resource_id     uuid,
  metadata        jsonb,
  ip              inet,
  user_agent      text,
  created_at      timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs (organization_id);
create index audit_logs_resource_idx on public.audit_logs (resource_type, resource_id);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_action_idx on public.audit_logs (action text_pattern_ops, created_at desc);

-- Counters for public.rate_limit_hit(). Internal only.
create table public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  count        int not null default 1,
  primary key (key, window_start)
);
create index rate_limits_window_idx on public.rate_limits (window_start);

-- ---------------------------------------------------------------------------------------------
-- 8. HELPER FUNCTIONS used by RLS policies
--    SECURITY DEFINER + empty search_path: they read profiles / organization_members without being
--    blocked (or recursing) through those tables' own RLS, and cannot be hijacked by a malicious
--    search_path. Every object inside is schema-qualified.
-- ---------------------------------------------------------------------------------------------

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.platform_role in ('admin', 'super_admin') and not p.disabled
  );
$$;

create function public.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.platform_role = 'super_admin' and not p.disabled
  );
$$;

create function public.is_org_member(org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id and m.user_id = auth.uid()
  );
$$;

create function public.is_org_owner(org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

create function public.is_publisher_owner(p_publisher_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.publisher_profiles pp
    where pp.id = p_publisher_id and pp.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- 8b. PERSONAL WORKSPACES (individual customers)
-- ---------------------------------------------------------------------------------------------
-- kind / owner are fixed at creation.
create function public.organizations_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.kind is distinct from old.kind or new.owner_user_id is distinct from old.owner_user_id) then
    raise exception 'workspace kind and owner cannot be changed';
  end if;
  return new;
end $$;
create trigger organizations_guard_trg before update on public.organizations for each row execute function public.organizations_guard();

-- A personal workspace has exactly one member: its owner, with the owner role.
create function public.org_members_personal_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text; o uuid;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;           -- cascades (workspace or account removal) pass
    select kind into k from public.organizations where id = old.organization_id;
    if k = 'personal' then raise exception 'the owner cannot leave a personal workspace'; end if;
    return old;
  end if;
  select kind, owner_user_id into k, o from public.organizations where id = new.organization_id;
  if k = 'personal' and (new.user_id is distinct from o or new.role <> 'owner') then
    raise exception 'a personal workspace can only have its owner as a member';
  end if;
  return new;
end $$;
create trigger organization_members_personal_guard_trg before insert or update or delete on public.organization_members
  for each row execute function public.org_members_personal_guard();

-- No invitations into a personal workspace.
create function public.org_invitations_personal_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.organizations o where o.id = new.organization_id and o.kind = 'personal') then
    raise exception 'personal workspaces cannot have invitations';
  end if;
  return new;
end $$;
create trigger organization_invitations_personal_guard_trg before insert on public.organization_invitations
  for each row execute function public.org_invitations_personal_guard();

-- Server-only: returns the user's personal workspace id, creating it (and the owner membership) if needed.
-- Idempotent and safe under concurrent calls. The application only calls it for customer (and publisher) accounts.
create function public.ensure_personal_workspace(p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid; is_disabled boolean;
begin
  select disabled into is_disabled from public.profiles where id = p_user;
  if not found or is_disabled then raise exception 'unknown or disabled user'; end if;

  select id into v from public.organizations where kind = 'personal' and owner_user_id = p_user;
  if v is null then
    insert into public.organizations (name, kind, owner_user_id) values ('Personal workspace', 'personal', p_user)
      on conflict (owner_user_id) where kind = 'personal' do nothing
      returning id into v;
    if v is null then select id into v from public.organizations where kind = 'personal' and owner_user_id = p_user; end if;
  end if;
  insert into public.organization_members (organization_id, user_id, role) values (v, p_user, 'owner') on conflict do nothing;
  return v;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 9. SERVER-ONLY FUNCTIONS (executable by service_role only; see grants in section 13)
-- ---------------------------------------------------------------------------------------------

-- The ONLY way an order's status changes. Compare-and-set: succeeds only if the order is still in
-- p_from, so two simultaneous actions cannot both win. Writes the history row in the same transaction.
-- (WHO may perform which transition is decided by the application's rule table in src/lib/order-state.ts;
--  the database enforces that the (from, to) pair is legal and that the change came through this function.)
create function public.transition_order(
  p_order uuid, p_from text, p_to text, p_actor uuid, p_actor_role text, p_note text default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_actor_role is null or p_actor_role not in ('customer', 'publisher', 'admin', 'system') then
    raise exception 'invalid actor role';
  end if;
  perform set_config('postatlas.transition', '1', true);   -- transaction-local flag read by orders_guard()
  update public.orders set status = p_to where id = p_order and status = p_from;
  get diagnostics n = row_count;
  perform set_config('postatlas.transition', '', true);
  if n = 0 then
    return false;
  end if;
  insert into public.order_events (order_id, actor_id, actor_role, from_status, to_status, note)
  values (p_order, p_actor, p_actor_role, p_from, p_to, left(p_note, 2000));
  return true;
end $$;

-- Atomically leases placements that are due for a check (only while the order is actually being monitored),
-- so two overlapping scheduler runs never check the same placement twice.
create function public.claim_due_placements(p_limit int) returns setof public.published_placements
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.published_placements p
     set next_check_at = now() + interval '30 minutes'
   where p.id in (
     select q.id
       from public.published_placements q
      where q.health in ('HEALTHY', 'ISSUE', 'NEEDS_REVIEW')
        and q.next_check_at is not null
        and q.next_check_at <= now()
        and exists (select 1 from public.orders o where o.id = q.order_id and o.status in ('MONITORING', 'ISSUE_DETECTED'))
      order by q.next_check_at
      limit greatest(1, least(coalesce(p_limit, 25), 100))
      for update skip locked
   )
  returning p.*;
end $$;

-- Atomic fixed-window counter. Returns true while the caller is within the limit.
create function public.rate_limit_hit(p_key text, p_window_seconds int, p_max int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare w timestamptz; c int;
begin
  if p_key is null or char_length(p_key) = 0 or char_length(p_key) > 200 or p_window_seconds < 1 or p_max < 1 then
    raise exception 'invalid rate limit arguments';
  end if;
  w := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as r (key, window_start) values (p_key, w)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into c;
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;
  return c <= p_max;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 10. INTEGRITY TRIGGERS (defence in depth: these also bind the service role)
-- ---------------------------------------------------------------------------------------------

-- 10.1 profiles: role / disabled / email / id can never be changed from a user's own session.
-- auth.uid() is non-null only for requests carrying a user JWT. The service role (used by server actions
-- after an admin check) and sessions you run in the SQL editor have no auth.uid().
create function public.profiles_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and (
       new.id is distinct from old.id
    or new.platform_role is distinct from old.platform_role
    or new.disabled is distinct from old.disabled
    or new.email is distinct from old.email
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'profile id, role, status and email can only be changed by the platform';
  end if;
  return new;
end $$;
create trigger profiles_guard_trg before update on public.profiles for each row execute function public.profiles_guard();

-- 10.2 orders
create function public.orders_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- Every order starts at the beginning of the lifecycle, whatever the caller sent.
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

  -- UPDATE (cascading actions from other tables, e.g. ON DELETE SET NULL, pass through untouched)
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.website_id is distinct from old.website_id
     or new.order_type is distinct from old.order_type
     or new.target_url is distinct from old.target_url
     or new.customer_price is distinct from old.customer_price
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'order price, owner, publisher, type and target cannot be changed';
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
create trigger orders_guard_trg before insert or update on public.orders for each row execute function public.orders_guard();

-- 10.3 payments: amount must equal the order price; reviewed payments are frozen.
create function public.payments_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o_price numeric; o_status text;
begin
  if tg_op = 'INSERT' then
    select o.customer_price, o.status into o_price, o_status from public.orders o where o.id = new.order_id;
    if o_price is null then raise exception 'order not found'; end if;
    if o_status <> 'PAYMENT_PENDING' then raise exception 'this order is not waiting for payment'; end if;
    if new.amount <> o_price then raise exception 'payment amount must equal the order price'; end if;
    new.currency := 'USD';
    new.status := 'PAYMENT_UNDER_REVIEW';
    new.submitted_at := now();
    new.verified_by := null; new.verified_at := null; new.rejection_reason := null;
    return new;
  elsif tg_op = 'UPDATE' then
    if pg_trigger_depth() > 1 then return new; end if;     -- cascading SET NULL actions
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
  else -- DELETE: only an unreviewed payment may be removed (the app does this to roll back a failed submit)
    if pg_trigger_depth() = 1 and old.status <> 'PAYMENT_UNDER_REVIEW' then
      raise exception 'a reviewed payment cannot be deleted';
    end if;
    return old;
  end if;
end $$;
create trigger payments_guard_trg before insert or update or delete on public.payments for each row execute function public.payments_guard();

-- 10.4 disputes: fixed identity, forward-only status, closed disputes are frozen.
create function public.disputes_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() = 1 and old.status <> 'OPEN' then raise exception 'a dispute that has been reviewed cannot be deleted'; end if;
    return old;
  end if;
  if pg_trigger_depth() > 1 then return new; end if;
  if new.id is distinct from old.id or new.order_id is distinct from old.order_id or new.raised_by is distinct from old.raised_by
     or new.category is distinct from old.category or new.reason is distinct from old.reason
     or new.evidence is distinct from old.evidence or new.created_at is distinct from old.created_at then
    raise exception 'dispute details cannot be changed';
  end if;
  if old.status in ('RESOLVED', 'REJECTED') then raise exception 'a closed dispute cannot be changed'; end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'OPEN' and new.status in ('UNDER_REVIEW', 'RESOLVED', 'REJECTED'))
         or (old.status = 'UNDER_REVIEW' and new.status in ('RESOLVED', 'REJECTED'))) then
      raise exception 'illegal dispute transition % -> %', old.status, new.status;
    end if;
    if new.status in ('RESOLVED', 'REJECTED') and new.resolved_by is null then
      raise exception 'a dispute can only be closed by recording who resolved it';
    end if;
  end if;
  return new;
end $$;
create trigger disputes_guard_trg before update or delete on public.disputes for each row execute function public.disputes_guard();

-- 10.5 content submissions: cannot be moved to another order or author.
create function public.content_submissions_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() = 1 and (new.id is distinct from old.id or new.order_id is distinct from old.order_id
     or new.submitted_by is distinct from old.submitted_by or new.created_at is distinct from old.created_at) then
    raise exception 'a submission cannot be moved to another order or author';
  end if;
  return new;
end $$;
create trigger content_submissions_guard_trg before update on public.content_submissions for each row execute function public.content_submissions_guard();

-- 10.6 placements: a placement belongs to its order for life.
create function public.placements_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() = 1 and (new.id is distinct from old.id or new.order_id is distinct from old.order_id or new.created_at is distinct from old.created_at) then
    raise exception 'a placement cannot be moved to another order';
  end if;
  return new;
end $$;
create trigger placements_guard_trg before update on public.published_placements for each row execute function public.placements_guard();

-- 10.7 append-only tables. Direct UPDATE/DELETE is refused. Referential actions fired by a parent row
-- (ON DELETE CASCADE / SET NULL, trigger depth > 1) are allowed so users and orders remain deletable.
create function public.append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception '% is append-only', tg_table_name;
end $$;
create function public.block_truncate() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% cannot be truncated', tg_table_name;
end $$;

create trigger audit_logs_append_only before update or delete on public.audit_logs for each row execute function public.append_only();
create trigger audit_logs_no_truncate before truncate on public.audit_logs for each statement execute function public.block_truncate();
create trigger order_events_append_only before update or delete on public.order_events for each row execute function public.append_only();
create trigger order_events_no_truncate before truncate on public.order_events for each statement execute function public.block_truncate();
create trigger backlink_checks_append_only before update or delete on public.backlink_checks for each row execute function public.append_only();
create trigger backlink_monitoring_events_append_only before update or delete on public.backlink_monitoring_events for each row execute function public.append_only();
create trigger advice_messages_append_only before update or delete on public.advice_messages for each row execute function public.append_only();
create trigger dispute_messages_append_only before update or delete on public.dispute_messages for each row execute function public.append_only();

-- 10.8 articles.updated_at
create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger articles_updated_at before update on public.articles for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- 11. AUTH INTEGRATION: the ONE place a profile row is created
--     Runs inside Supabase Auth's own transaction when a user signs up. The role is always 'user':
--     nothing in raw_user_meta_data (which the user controls) is ever used for authorization.
-- ---------------------------------------------------------------------------------------------

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email, platform_role)
  values (new.id, nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 100), ''), lower(new.email), 'user')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Keeps profiles.email in step when Supabase Auth completes a (confirmed) email change.
create function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end $$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function public.sync_profile_email();

-- ---------------------------------------------------------------------------------------------
-- 12. ROW LEVEL SECURITY
--     RLS is enabled on EVERY table. A table with RLS enabled and no policy is unreachable for
--     anon / authenticated (these are also revoked in section 13). Only SELECT policies exist:
--     the browser has no write path at all.
-- ---------------------------------------------------------------------------------------------

alter table public.profiles                    enable row level security;
alter table public.organizations               enable row level security;
alter table public.organization_members        enable row level security;
alter table public.organization_invitations    enable row level security;
alter table public.publisher_profiles          enable row level security;
alter table public.publisher_websites          enable row level security;
alter table public.publisher_metrics           enable row level security;
alter table public.publisher_supplier_info     enable row level security;
alter table public.saved_publishers            enable row level security;
alter table public.websites                    enable row level security;
alter table public.audits                      enable row level security;
alter table public.audit_pages                 enable row level security;
alter table public.opportunities               enable row level security;
alter table public.site_checks                 enable row level security;
alter table public.orders                      enable row level security;
alter table public.order_status_transitions    enable row level security;
alter table public.order_events                enable row level security;
alter table public.payment_methods             enable row level security;
alter table public.payments                    enable row level security;
alter table public.publisher_payouts           enable row level security;
alter table public.content_submissions         enable row level security;
alter table public.published_placements        enable row level security;
alter table public.backlink_checks             enable row level security;
alter table public.backlink_monitoring_events  enable row level security;
alter table public.advice_threads              enable row level security;
alter table public.advice_messages             enable row level security;
alter table public.disputes                    enable row level security;
alter table public.dispute_messages            enable row level security;
alter table public.notifications               enable row level security;
alter table public.messages                    enable row level security;
alter table public.article_categories          enable row level security;
alter table public.articles                    enable row level security;
alter table public.platform_settings           enable row level security;
alter table public.audit_logs                  enable row level security;
alter table public.rate_limits                 enable row level security;

-- Identity
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_platform_admin());
create policy organizations_select on public.organizations for select to authenticated
  using (public.is_org_member(id) or public.is_platform_admin());
create policy organization_members_select on public.organization_members for select to authenticated
  using (user_id = auth.uid() or public.is_org_member(organization_id) or public.is_platform_admin());

-- Marketplace (public read of APPROVED listings only)
create policy publisher_websites_public on public.publisher_websites for select to anon, authenticated
  using (status = 'approved');
-- Owners see their own pending / rejected listings; admins see all; a customer keeps seeing the listing of an order they placed.
create policy publisher_websites_private on public.publisher_websites for select to authenticated
  using (
    public.is_publisher_owner(publisher_id)
    or public.is_platform_admin()
    or exists (select 1 from public.orders o where o.website_id = publisher_websites.id and public.is_org_member(o.organization_id))
  );
create policy publisher_metrics_public on public.publisher_metrics for select to anon, authenticated
  using (exists (select 1 from public.publisher_websites w where w.id = publisher_metrics.website_id and w.status = 'approved'));
create policy publisher_metrics_private on public.publisher_metrics for select to authenticated
  using (exists (select 1 from public.publisher_websites w where w.id = publisher_metrics.website_id
                 and (public.is_publisher_owner(w.publisher_id) or public.is_platform_admin())));
create policy article_categories_select on public.article_categories for select to anon, authenticated using (true);
create policy articles_published on public.articles for select to anon, authenticated using (status = 'PUBLISHED');
create policy articles_admin on public.articles for select to authenticated using (public.is_platform_admin());

-- Customer organization data (strict organization isolation)
create policy saved_publishers_select on public.saved_publishers for select to authenticated using (public.is_org_member(organization_id));
create policy websites_select on public.websites for select to authenticated using (public.is_org_member(organization_id) or public.is_platform_admin());
create policy audits_select on public.audits for select to authenticated using (public.is_org_member(organization_id) or public.is_platform_admin());
create policy audit_pages_select on public.audit_pages for select to authenticated
  using (exists (select 1 from public.websites w where w.id = audit_pages.website_id));   -- inherits websites' policy
create policy opportunities_select on public.opportunities for select to authenticated using (public.is_org_member(organization_id) or public.is_platform_admin());
create policy orders_select on public.orders for select to authenticated using (public.is_org_member(organization_id) or public.is_platform_admin());

-- Everything hanging off an order inherits the order's visibility (the EXISTS runs under orders' own policy).
create policy order_events_select on public.order_events for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_events.order_id));
create policy content_submissions_select on public.content_submissions for select to authenticated
  using (exists (select 1 from public.orders o where o.id = content_submissions.order_id));
create policy published_placements_select on public.published_placements for select to authenticated
  using (exists (select 1 from public.orders o where o.id = published_placements.order_id));
create policy backlink_checks_select on public.backlink_checks for select to authenticated
  using (exists (select 1 from public.published_placements p where p.id = backlink_checks.placement_id));
create policy backlink_monitoring_events_select on public.backlink_monitoring_events for select to authenticated
  using (exists (select 1 from public.published_placements p where p.id = backlink_monitoring_events.placement_id));
create policy disputes_select on public.disputes for select to authenticated
  using (exists (select 1 from public.orders o where o.id = disputes.order_id));
create policy dispute_messages_select on public.dispute_messages for select to authenticated
  using (exists (select 1 from public.disputes d where d.id = dispute_messages.dispute_id));

-- Advice / discussion
create policy advice_threads_select on public.advice_threads for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());
create policy advice_messages_select on public.advice_messages for select to authenticated
  using (exists (select 1 from public.advice_threads t where t.id = advice_messages.thread_id));

create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());

-- NO policy (and no grant) on: site_checks, organization_invitations, publisher_profiles, publisher_supplier_info, order_status_transitions,
-- payment_methods, payments, publisher_payouts, messages, platform_settings, audit_logs, rate_limits.
-- Those are reachable only through the service role, behind the application's server-side authorization checks.

-- ---------------------------------------------------------------------------------------------
-- 13. PRIVILEGES
--     Start from nothing for the browser roles, then grant back the minimum.
-- ---------------------------------------------------------------------------------------------

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- The RLS helper functions must be callable by the roles whose policies use them.
grant execute on function public.is_platform_admin(), public.is_super_admin(), public.is_org_member(uuid),
  public.is_org_owner(uuid), public.is_publisher_owner(uuid) to anon, authenticated;

-- Public marketplace: approved rows only (RLS), and only the columns that are safe to publish.
-- Deliberately NOT granted: rejection_reason, reviewed_by (publisher_websites); spam_score, verified_by, verification_note (publisher_metrics).
grant select (id, publisher_id, domain, description, niche, country, language, price_guest_post, price_link_insertion,
              turnaround_days_min, turnaround_days_max, link_type, article_requirements, status, last_verified_at, indexed_status, created_at)
  on public.publisher_websites to anon, authenticated;
grant select (website_id, dr, da, organic_traffic, verified, verified_at, metrics_source)
  on public.publisher_metrics to anon, authenticated;
grant select on public.articles, public.article_categories to anon, authenticated;

-- Signed-in customers: read-only, RLS-filtered.
grant select on public.profiles, public.organizations, public.organization_members, public.saved_publishers,
  public.websites, public.audits, public.audit_pages, public.opportunities,
  public.orders, public.order_events, public.content_submissions, public.published_placements,
  public.backlink_checks, public.backlink_monitoring_events,
  public.advice_threads, public.advice_messages, public.disputes, public.dispute_messages, public.notifications
  to authenticated;

-- Trusted server (service role): full table access and the three server-only functions.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant execute on function public.transition_order(uuid, text, text, uuid, text, text) to service_role;
grant execute on function public.claim_due_placements(int) to service_role;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
grant execute on function public.ensure_personal_workspace(uuid) to service_role;
grant execute on function public.is_platform_admin(), public.is_super_admin(), public.is_org_member(uuid),
  public.is_org_owner(uuid), public.is_publisher_owner(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 14. FIRST SUPER ADMIN  (manual, deliberately NOT available from the application)
--     1) Sign up normally in the app and confirm the email.  2) Run this in the SQL editor with that email.
-- ---------------------------------------------------------------------------------------------
-- UPDATE public.profiles
--    SET platform_role = 'super_admin'
--  WHERE email = 'your-admin-email@example.com';

-- ---------------------------------------------------------------------------------------------
-- 15. OPTIONAL SEED DATA (commented out - nothing fake is inserted automatically)
-- ---------------------------------------------------------------------------------------------
-- Replace the account details with your real ones before enabling. Customers see these on their order page.
-- INSERT INTO public.payment_methods (name, account_identifier, instructions, enabled) VALUES
--   ('NayaPay', 'YOUR-NAYAPAY-ID', 'Send the exact order amount and keep the transaction ID.', true),
--   ('Bank transfer', 'YOUR BANK / ACCOUNT TITLE / IBAN', 'Use your order number as the payment reference.', true);
--
-- INSERT INTO public.article_categories (name, slug) VALUES
--   ('Link building', 'link-building'), ('SEO', 'seo'), ('Publishing', 'publishing');

-- End of PostAtlas schema.

-- =============================================================================================
-- 15. MARKETPLACE FINANCE (pricing snapshot, payments, payouts, recovery, refunds, ledger)
--     Identical to supabase/PostAtlas_upgrade_marketplace_finance.sql; included so a fresh install needs one file.
-- =============================================================================================
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

-- =============================================================================================
-- 16. SITE REVIEWS, ORDER DEADLINES AND EXPIRED-ORDER REMEDIES
--     Identical to supabase/PostAtlas_upgrade_reviews_deadlines.sql; included so a fresh install needs one file.
-- =============================================================================================
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


-- =============================================================================================
-- 17. TURNAROUND IN HOURS AND THE REPLACEMENT-ORDER FIX
--     Identical to supabase/PostAtlas_upgrade_hours_replacement.sql; included so a fresh install needs one file.
-- =============================================================================================
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
