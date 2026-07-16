create extension if not exists pgcrypto;

do $$
begin
  create type public.app_role as enum ('parent', 'tutor', 'student');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.family_spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Shanghai',
  daily_block_capacity smallint not null default 2 check (daily_block_capacity between 1 and 8),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.family_memberships (
  family_id uuid not null references public.family_spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (family_id, user_id)
);

create table if not exists public.subjects (
  id text primary key,
  name text not null unique,
  color text not null,
  sort_order smallint not null,
  active boolean not null default true
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family_spaces(id) on delete cascade,
  user_id uuid unique references public.profiles(id) on delete set null,
  display_name text not null,
  grade text not null,
  school_year text not null,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.tutor_assignments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family_spaces(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id text not null references public.subjects(id),
  tutor_user_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint tutor_assignment_period check (ends_at is null or ends_at > starts_at)
);

create unique index if not exists one_active_tutor_per_student_subject
  on public.tutor_assignments (student_id, subject_id)
  where ends_at is null;

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family_spaces(id) on delete cascade,
  email text not null,
  role public.app_role not null check (role in ('tutor', 'student')),
  student_id uuid references public.students(id) on delete cascade,
  subject_id text references public.subjects(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint tutor_invitation_scope check (
    (role = 'tutor' and student_id is not null and subject_id is not null)
    or (role = 'student' and student_id is not null and subject_id is null)
  )
);

create index if not exists family_memberships_user_idx on public.family_memberships(user_id) where removed_at is null;
create index if not exists students_family_idx on public.students(family_id) where deleted_at is null;
create index if not exists tutor_assignments_tutor_idx on public.tutor_assignments(tutor_user_id) where ends_at is null;
create index if not exists invitations_active_idx on public.invitations(token_hash, expires_at) where used_at is null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists family_spaces_set_updated_at on public.family_spaces;
create trigger family_spaces_set_updated_at before update on public.family_spaces for each row execute function public.set_updated_at();
drop trigger if exists students_set_updated_at on public.students;
create trigger students_set_updated_at before update on public.students for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

create or replace function public.is_family_member(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.family_memberships
    where family_id = target_family_id and user_id = auth.uid() and removed_at is null
  );
$$;

create or replace function public.is_family_parent(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.family_memberships
    where family_id = target_family_id and user_id = auth.uid() and role = 'parent' and removed_at is null
  );
$$;

create or replace function public.can_access_student(target_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.students s
    where s.id = target_student_id
      and s.deleted_at is null
      and (
        s.user_id = auth.uid()
        or public.is_family_parent(s.family_id)
        or exists (
          select 1 from public.tutor_assignments ta
          where ta.student_id = s.id and ta.tutor_user_id = auth.uid()
            and ta.starts_at <= now() and (ta.ends_at is null or ta.ends_at > now())
        )
      )
  );
$$;

create or replace function public.is_subject_tutor(target_student_id uuid, target_subject_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tutor_assignments
    where student_id = target_student_id and subject_id = target_subject_id
      and tutor_user_id = auth.uid() and starts_at <= now()
      and (ends_at is null or ends_at > now())
  );
$$;

create or replace function public.create_family_space(family_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_family_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if nullif(trim(family_name), '') is null then raise exception 'family name required'; end if;

  insert into public.family_spaces (name, created_by)
  values (trim(family_name), auth.uid())
  returning id into new_family_id;

  insert into public.family_memberships (family_id, user_id, role)
  values (new_family_id, auth.uid(), 'parent');

  return new_family_id;
end;
$$;

create or replace function public.accept_invitation(raw_token text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  invitation_row public.invitations%rowtype;
  current_email text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select lower(coalesce(email, '')) into current_email from auth.users where id = auth.uid();
  select * into invitation_row
  from public.invitations
  where token_hash = encode(digest(raw_token, 'sha256'), 'hex')
    and used_at is null and expires_at > now()
  for update;

  if invitation_row.id is null then raise exception 'invitation invalid or expired'; end if;
  if lower(invitation_row.email) <> current_email then raise exception 'invitation email mismatch'; end if;

  insert into public.family_memberships (family_id, user_id, role, removed_at)
  values (invitation_row.family_id, auth.uid(), invitation_row.role, null)
  on conflict (family_id, user_id) do update set role = excluded.role, removed_at = null;

  if invitation_row.role = 'student' then
    update public.students set user_id = auth.uid(), updated_at = now() where id = invitation_row.student_id;
  else
    insert into public.tutor_assignments (family_id, student_id, subject_id, tutor_user_id, created_by)
    values (invitation_row.family_id, invitation_row.student_id, invitation_row.subject_id, auth.uid(), invitation_row.created_by)
    on conflict (student_id, subject_id) where ends_at is null
    do update set tutor_user_id = excluded.tutor_user_id, starts_at = now(), created_by = excluded.created_by;
  end if;

  update public.invitations set used_at = now() where id = invitation_row.id;
  return invitation_row.family_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.family_spaces enable row level security;
alter table public.family_memberships enable row level security;
alter table public.subjects enable row level security;
alter table public.students enable row level security;
alter table public.tutor_assignments enable row level security;
alter table public.invitations enable row level security;

drop policy if exists profiles_select_self_or_shared_family on public.profiles;
create policy profiles_select_self_or_shared_family on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1
    from public.family_memberships mine
    join public.family_memberships theirs on theirs.family_id = mine.family_id
    where mine.user_id = auth.uid() and mine.removed_at is null
      and theirs.user_id = profiles.id and theirs.removed_at is null
  )
);
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists family_spaces_select_member on public.family_spaces;
create policy family_spaces_select_member on public.family_spaces for select to authenticated using (public.is_family_member(id));
drop policy if exists family_spaces_update_parent on public.family_spaces;
create policy family_spaces_update_parent on public.family_spaces for update to authenticated using (public.is_family_parent(id)) with check (public.is_family_parent(id));

drop policy if exists memberships_select_family on public.family_memberships;
create policy memberships_select_family on public.family_memberships for select to authenticated using (public.is_family_member(family_id));
drop policy if exists memberships_write_parent on public.family_memberships;
create policy memberships_write_parent on public.family_memberships for all to authenticated using (public.is_family_parent(family_id)) with check (public.is_family_parent(family_id));

drop policy if exists subjects_select_authenticated on public.subjects;
create policy subjects_select_authenticated on public.subjects for select to authenticated using (active);

drop policy if exists students_select_authorized on public.students;
create policy students_select_authorized on public.students for select to authenticated using (public.can_access_student(id));
drop policy if exists students_write_parent on public.students;
create policy students_write_parent on public.students for all to authenticated using (public.is_family_parent(family_id)) with check (public.is_family_parent(family_id));

drop policy if exists tutor_assignments_select_authorized on public.tutor_assignments;
create policy tutor_assignments_select_authorized on public.tutor_assignments for select to authenticated using (
  public.is_family_parent(family_id) or tutor_user_id = auth.uid()
);
drop policy if exists tutor_assignments_write_parent on public.tutor_assignments;
create policy tutor_assignments_write_parent on public.tutor_assignments for all to authenticated using (public.is_family_parent(family_id)) with check (public.is_family_parent(family_id));

drop policy if exists invitations_select_parent on public.invitations;
create policy invitations_select_parent on public.invitations for select to authenticated using (public.is_family_parent(family_id));
drop policy if exists invitations_write_parent on public.invitations;
create policy invitations_write_parent on public.invitations for all to authenticated using (public.is_family_parent(family_id)) with check (public.is_family_parent(family_id));

revoke all on function public.is_family_member(uuid) from public;
revoke all on function public.is_family_parent(uuid) from public;
revoke all on function public.can_access_student(uuid) from public;
revoke all on function public.is_subject_tutor(uuid, text) from public;
revoke all on function public.create_family_space(text) from public;
revoke all on function public.accept_invitation(text) from public;

grant execute on function public.is_family_member(uuid) to authenticated;
grant execute on function public.is_family_parent(uuid) to authenticated;
grant execute on function public.can_access_student(uuid) to authenticated;
grant execute on function public.is_subject_tutor(uuid, text) to authenticated;
grant execute on function public.create_family_space(text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.is_family_member(uuid) to authenticated;
grant execute on function public.is_family_parent(uuid) to authenticated;
grant execute on function public.can_access_student(uuid) to authenticated;
grant execute on function public.is_subject_tutor(uuid, text) to authenticated;
grant execute on function public.create_family_space(text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
