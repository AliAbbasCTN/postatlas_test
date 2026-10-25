-- =====================================================================================================
-- PostAtlas UPGRADE: individual customers (no organisation required)
--
-- Run ONCE in the Supabase SQL Editor on a database that already has PostAtlas_fresh_supabase_schema.sql installed
-- (an older install, before this change). It is additive and safe on a populated database:
--   * no table is dropped, no row is deleted or rewritten, no policy is loosened;
--   * every existing organisation becomes kind = 'team' (the default), so current teams, members, roles, orders
--     and payments behave exactly as before;
--   * it is safe to re-run (every statement is idempotent).
-- Do NOT run this on top of a fresh install made from the updated PostAtlas_fresh_supabase_schema.sql (already included).
--
-- ROLLBACK (only if no personal workspace has been created yet, otherwise move that data first):
--   drop trigger if exists organizations_guard_trg on public.organizations;
--   drop trigger if exists organization_members_personal_guard_trg on public.organization_members;
--   drop trigger if exists organization_invitations_personal_guard_trg on public.organization_invitations;
--   drop function if exists public.organizations_guard(), public.org_members_personal_guard(),
--                           public.org_invitations_personal_guard(), public.ensure_personal_workspace(uuid);
--   drop index if exists public.organizations_one_personal_per_user;
--   alter table public.organizations drop constraint if exists organizations_personal_owner_check,
--                                    drop constraint if exists organizations_kind_check,
--                                    drop column if exists owner_user_id, drop column if exists kind;
-- =====================================================================================================

-- ---- Individual customers: personal workspaces --------------------------------------------------------
-- A customer never has to create an organisation. Everything that is owned by "an organisation" in this schema
-- (websites, opportunities, orders, advice) is owned by a workspace. A workspace is either:
--   kind = 'team'      a customer-created organisation / agency with members and roles (the original model), or
--   kind = 'personal'  a private, single-owner workspace created automatically by the server the first time an
--                      individual customer needs one. It can never have other members or invitations.
alter table public.organizations add column if not exists kind text not null default 'team';
alter table public.organizations add column if not exists owner_user_id uuid references public.profiles (id) on delete cascade;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_kind_check' and conrelid = 'public.organizations'::regclass) then
    alter table public.organizations add constraint organizations_kind_check check (kind in ('team', 'personal'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_personal_owner_check' and conrelid = 'public.organizations'::regclass) then
    alter table public.organizations add constraint organizations_personal_owner_check check (kind <> 'personal' or owner_user_id is not null);
  end if;
end $$;

-- At most one personal workspace per user (this is what makes lazy provisioning race-safe).
create unique index if not exists organizations_one_personal_per_user on public.organizations (owner_user_id) where kind = 'personal';

-- kind / owner are fixed at creation.
create or replace function public.organizations_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.kind is distinct from old.kind or new.owner_user_id is distinct from old.owner_user_id) then
    raise exception 'workspace kind and owner cannot be changed';
  end if;
  return new;
end $$;
drop trigger if exists organizations_guard_trg on public.organizations;
create trigger organizations_guard_trg before update on public.organizations for each row execute function public.organizations_guard();

-- A personal workspace has exactly one member: its owner, with the owner role.
create or replace function public.org_members_personal_guard() returns trigger
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
drop trigger if exists organization_members_personal_guard_trg on public.organization_members;
create trigger organization_members_personal_guard_trg before insert or update or delete on public.organization_members
  for each row execute function public.org_members_personal_guard();

-- No invitations into a personal workspace.
create or replace function public.org_invitations_personal_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.organizations o where o.id = new.organization_id and o.kind = 'personal') then
    raise exception 'personal workspaces cannot have invitations';
  end if;
  return new;
end $$;
drop trigger if exists organization_invitations_personal_guard_trg on public.organization_invitations;
create trigger organization_invitations_personal_guard_trg before insert on public.organization_invitations
  for each row execute function public.org_invitations_personal_guard();

-- Server-only: returns the user's personal workspace id, creating it (and the owner membership) if needed.
-- Idempotent and safe under concurrent calls. The application only calls it for customer (and publisher) accounts.
create or replace function public.ensure_personal_workspace(p_user uuid) returns uuid
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
revoke all on function public.ensure_personal_workspace(uuid) from public, anon, authenticated;
grant execute on function public.ensure_personal_workspace(uuid) to service_role;

-- Verify: select kind, count(*) from public.organizations group by 1;   -- existing rows show kind = team
