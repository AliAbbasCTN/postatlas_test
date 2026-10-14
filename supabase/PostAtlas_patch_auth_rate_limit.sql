-- PostAtlas: OPTIONAL, idempotent patch. Run in the Supabase SQL Editor ONLY if the diagnostic query below shows
-- rate_limits / rate_limit_hit / ensure_personal_workspace missing or without service_role access.
-- It never drops, truncates or deletes anything, and does not touch RLS on other tables. Safe to run more than once.
-- Do NOT run PostAtlas_fresh_supabase_schema.sql on an existing database.

-- 0) DIAGNOSE FIRST (read-only). Expect: all three true.
select to_regclass('public.rate_limits') is not null                                       as rate_limits_table,
       has_function_privilege('service_role','public.rate_limit_hit(text,int,int)','execute')  as rate_limit_hit_ok,
       has_function_privilege('service_role','public.ensure_personal_workspace(uuid)','execute') as ensure_workspace_ok;
-- (If a function does not exist, the has_function_privilege call above errors; that error IS the finding.)

-- 1) Counter table (matches the fresh schema).
create table if not exists public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  count        int not null default 1,
  primary key (key, window_start)
);
create index if not exists rate_limits_window_idx on public.rate_limits (window_start);
alter table public.rate_limits enable row level security;   -- no policies: only the service role can use it

-- 2) Atomic limiter (identical to the fresh schema, made re-runnable).
create or replace function public.rate_limit_hit(p_key text, p_window_seconds int, p_max int) returns boolean
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

-- 3) Server-only access.
revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant usage on schema public to service_role;
grant all on public.rate_limits to service_role;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;

-- 4) Verify. Expect: table true, anon false, signed_in false, service_role true.
select to_regclass('public.rate_limits') is not null as table_exists,
       has_function_privilege('anon','public.rate_limit_hit(text,int,int)','execute')          as anon_can_run,
       has_function_privilege('authenticated','public.rate_limit_hit(text,int,int)','execute') as signed_in_can_run,
       has_function_privilege('service_role','public.rate_limit_hit(text,int,int)','execute')  as service_role_can_run;
select public.rate_limit_hit('patch-selftest', 60, 1000) as within_limit;   -- expect true
