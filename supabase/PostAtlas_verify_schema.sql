-- PostAtlas: run AFTER PostAtlas_fresh_supabase_schema.sql. Read-only. Every query should return the stated result.

-- 1) Expected tables: should return 35 rows, all present = true, and NO row with present = false.
with expected(t) as (values
 ('profiles'),('organizations'),('organization_members'),('organization_invitations'),('publisher_profiles'),('publisher_websites'),
 ('publisher_metrics'),('publisher_supplier_info'),('saved_publishers'),('websites'),('audits'),('audit_pages'),('opportunities'),
 ('orders'),('order_status_transitions'),('order_events'),('payment_methods'),('payments'),('publisher_payouts'),('content_submissions'),
 ('published_placements'),('backlink_checks'),('backlink_monitoring_events'),('advice_threads'),('advice_messages'),('disputes'),
 ('dispute_messages'),('notifications'),('messages'),('article_categories'),('articles'),('platform_settings'),('audit_logs'),('rate_limits'),('site_checks'))
select e.t as table_name, (c.oid is not null) as present
from expected e left join pg_class c on c.relname = e.t and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
order by present, e.t;

-- 2) Unexpected tables in public (legacy or stray). Should return 0 rows.
select c.relname as unexpected_table
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  and c.relname not in ('profiles','organizations','organization_members','organization_invitations','publisher_profiles','publisher_websites',
   'publisher_metrics','publisher_supplier_info','saved_publishers','websites','audits','audit_pages','opportunities','orders','order_status_transitions',
   'order_events','payment_methods','payments','publisher_payouts','content_submissions','published_placements','backlink_checks',
   'backlink_monitoring_events','advice_threads','advice_messages','disputes','dispute_messages','notifications','messages',
   'article_categories','articles','platform_settings','audit_logs','rate_limits','site_checks');

-- 3) RLS enabled everywhere. Should return 0 rows.
select relname as table_without_rls from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity;

-- 4) Required functions. Should return 14 rows.
select p.proname as function_name, p.prosecdef as security_definer, p.proconfig as settings
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('transition_order','claim_due_placements','rate_limit_hit','is_platform_admin','is_super_admin','is_org_member','is_org_owner',
                    'is_publisher_owner','handle_new_user','sync_profile_email','orders_guard','payments_guard','profiles_guard','disputes_guard')
order by 1;

-- 5) Every SECURITY DEFINER function pins an empty search_path. Should return 0 rows.
select proname as definer_without_search_path from pg_proc
where pronamespace = 'public'::regnamespace and prosecdef and not coalesce(proconfig @> array['search_path=""'], false);

-- 6) Server-only functions: browser roles must NOT be able to execute them. All three columns should be false.
select f as function_name,
       has_function_privilege('anon', f, 'execute') as anon_can_run,
       has_function_privilege('authenticated', f, 'execute') as signed_in_can_run,
       has_function_privilege('service_role', f, 'execute') as service_role_can_run   -- this one should be TRUE
from (values ('public.transition_order(uuid,text,text,uuid,text,text)'), ('public.claim_due_placements(int)'), ('public.rate_limit_hit(text,int,int)')) v(f);

-- 7) Browser roles must not be able to write anywhere. Should return 0 rows.
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','authenticated')
  and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');

-- 8) Private tables must not be readable by browser roles. Should return 0 rows.
select table_name, grantee from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','authenticated') and privilege_type = 'SELECT'
  and table_name in ('publisher_supplier_info','publisher_payouts','payments','payment_methods','platform_settings','audit_logs','rate_limits',
                     'messages','organization_invitations','publisher_profiles','order_status_transitions','site_checks');

-- 9) Policies. Should list policies on the tables below, and every cmd should be SELECT.
select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public' order by tablename, policyname;
select count(*) as non_select_policies from pg_policies where schemaname = 'public' and cmd <> 'SELECT';   -- should be 0

-- 10) Triggers: expect the profile trigger on auth.users plus the guards. Should return 17+ rows.
select event_object_schema as schema, event_object_table as table_name, trigger_name
from information_schema.triggers
where (event_object_schema = 'public') or (event_object_schema = 'auth' and event_object_table = 'users' and trigger_name like 'on_auth_user_%')
group by 1, 2, 3 order by 1, 2, 3;

-- 11) Order transition table: should return 44 rows.
select count(*) as legal_transitions from public.order_status_transitions;

-- 12) Nobody is an admin yet. Should return 0 rows on a fresh install.
select id, email, platform_role from public.profiles where platform_role <> 'user';

-- 13) Behaviour test inside a rolled-back transaction: the order status guard must refuse a direct status change.
-- (Optional. Needs at least one order, so run it only after you have placed a test order. Expect an ERROR containing
--  "order status can only change through transition_order()".)
-- begin;
--   update public.orders set status = 'PAID' where id = (select id from public.orders limit 1);
-- rollback;

-- 14) Individual customers (workspaces). Every existing organisation must be kind = team before any customer has used the app:
select kind, count(*) from public.organizations group by 1;
-- ensure_personal_workspace must exist, pin search_path and be service_role-only. Expect: exists, anon false, signed_in false, service_role true.
select to_regprocedure('public.ensure_personal_workspace(uuid)') is not null as exists,
       has_function_privilege('anon', 'public.ensure_personal_workspace(uuid)', 'execute') as anon_can_run,
       has_function_privilege('authenticated', 'public.ensure_personal_workspace(uuid)', 'execute') as signed_in_can_run,
       has_function_privilege('service_role', 'public.ensure_personal_workspace(uuid)', 'execute') as service_role_can_run;
-- No personal workspace may have a member other than its owner, or any invitation. Expect 0 rows each.
select o.id from public.organizations o join public.organization_members m on m.organization_id = o.id
 where o.kind = 'personal' and (m.user_id <> o.owner_user_id or m.role <> 'owner');
select i.id from public.organization_invitations i join public.organizations o on o.id = i.organization_id where o.kind = 'personal';

-- 15) Marketplace finance. Every existing order must have a pricing snapshot. Expect 0.
select count(*) as orders_without_snapshot from public.orders o where not exists (select 1 from public.order_pricing p where p.order_id = o.id);
-- Snapshot arithmetic: commission 2% of list, net = list - commission, customer base = list. Expect 0 rows.
select order_id from public.order_pricing where commission_usd <> round(list_price_usd * commission_bps / 10000.0, 2) or publisher_net_usd <> list_price_usd - commission_usd or customer_base_usd <> list_price_usd;
-- Finance functions exist and are service_role only. Expect anon false / signed_in false / service_role true on every row.
select f as function_name,
       has_function_privilege('anon', to_regprocedure('public.' || f)::oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', to_regprocedure('public.' || f)::oid, 'execute') as signed_in_can_run,
       has_function_privilege('service_role', to_regprocedure('public.' || f)::oid, 'execute') as service_role_can_run
  from unnest(array['create_order_priced(uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,numeric,text,timestamptz,numeric)', 'submit_payment(uuid,uuid,text,text)', 'review_payment(uuid,uuid,text,text)',
                    'create_payout_obligation(uuid,timestamptz)', 'start_due_payouts(int)', 'record_payout_result(uuid,uuid,text,text,text,numeric,numeric,text,timestamptz,numeric,text,text)',
                    'reassign_order(uuid,uuid,uuid,uuid,text)', 'replace_payout_destination(uuid,text,text,text,text,text,text,text)',  'request_refund(uuid,numeric,text,uuid,text,text)', 'record_refund_result(uuid,uuid,text,text,text,text)']) as f;
-- Sensitive tables must have RLS on. Expect rls_enabled = true on every row.
select relname, relrowsecurity as rls_enabled from pg_class where relnamespace = 'public'::regnamespace and relname in ('fx_rates', 'order_pricing', 'ledger_entries', 'payout_destinations', 'recovery_cases', 'refunds', 'publisher_payouts');
-- No order may have two live fulfilment payouts, no payment two confirmations. Expect 0 rows each.
select order_id from public.publisher_payouts where kind = 'fulfillment' and status <> 'CANCELLED' group by order_id having count(*) > 1;
select order_id from public.payments where status = 'PAID' group by order_id having count(*) > 1;
-- Payment methods: review which currencies each really accepts (new column defaults to USD only).
select name, enabled, currencies from public.payment_methods order by name;
