-- PostAtlas ADD-ON: public "check your website" tool.
-- Run ONCE in the Supabase SQL Editor on a database that already has PostAtlas_fresh_supabase_schema.sql installed.
-- (The same table is already included in the fresh schema file for new installs - do NOT run this on top of that.)

create table public.site_checks (
  id         uuid primary key default gen_random_uuid(),
  domain     text not null check (domain = lower(domain) and domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  category   text not null check (category in ('SEO & Marketing', 'Technology', 'Business', 'Finance', 'Health & Wellness', 'Travel', 'Education', 'Lifestyle', 'E-commerce', 'Real Estate', 'Other')),
  result     jsonb not null check (pg_column_size(result) < 200000),
  created_at timestamptz not null default now()
);
create index site_checks_lookup_idx on public.site_checks (domain, category, created_at desc);

alter table public.site_checks enable row level security;       -- no policy and no grant: server (service role) only
revoke all on public.site_checks from anon, authenticated;
grant all on public.site_checks to service_role;
