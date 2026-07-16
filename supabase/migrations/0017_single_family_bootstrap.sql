-- This deployment is a private, single-family platform. Only the server-side
-- configured parent email may claim the first family; ordinary authenticated
-- users can only join through an invitation.
create table if not exists public.platform_bootstrap (
  singleton boolean primary key default true check (singleton),
  parent_email text not null check (
    parent_email = lower(trim(parent_email))
    and position('@' in parent_email) > 1
  ),
  configured_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by uuid references public.profiles(id) on delete set null,
  constraint platform_bootstrap_claim_consistency check (
    (claimed_at is null and claimed_by is null)
    or (claimed_at is not null and claimed_by is not null)
  )
);

alter table public.platform_bootstrap enable row level security;

revoke all on table public.platform_bootstrap from anon, authenticated;
grant select, insert, update, delete on table public.platform_bootstrap to service_role;

create or replace function public.create_family_space(family_name text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  bootstrap_row public.platform_bootstrap%rowtype;
  current_email text;
  existing_family_id uuid;
  new_family_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if nullif(trim(family_name), '') is null then raise exception 'family name required'; end if;

  select membership.family_id
    into existing_family_id
  from public.family_memberships membership
  where membership.user_id = auth.uid()
    and membership.role = 'parent'
    and membership.removed_at is null
  limit 1;

  if existing_family_id is not null then
    return existing_family_id;
  end if;

  select lower(trim(coalesce(users.email, '')))
    into current_email
  from auth.users users
  where users.id = auth.uid();

  select *
    into bootstrap_row
  from public.platform_bootstrap
  where singleton
  for update;

  if bootstrap_row.singleton is null then
    raise exception 'platform bootstrap not configured';
  end if;
  if bootstrap_row.claimed_at is not null
    or exists (select 1 from public.family_spaces family where family.deleted_at is null) then
    raise exception 'platform already initialized';
  end if;
  if current_email = '' or current_email <> bootstrap_row.parent_email then
    raise exception 'parent email not authorized';
  end if;

  insert into public.family_spaces (name, created_by)
  values (trim(family_name), auth.uid())
  returning id into new_family_id;

  insert into public.family_memberships (family_id, user_id, role)
  values (new_family_id, auth.uid(), 'parent');

  update public.platform_bootstrap
  set claimed_at = now(), claimed_by = auth.uid()
  where singleton;

  return new_family_id;
end;
$$;

revoke all on function public.create_family_space(text) from public;
grant execute on function public.create_family_space(text) to authenticated;
