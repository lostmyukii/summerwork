create or replace function public.create_account_invitation(
  target_email text,
  target_role public.app_role,
  target_student_id uuid,
  target_subject_id text default null,
  valid_hours integer default 168
)
returns table(invitation_id uuid, raw_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_family_id uuid;
  generated_token text;
  generated_expiry timestamptz;
  generated_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if target_role not in ('tutor', 'student') then raise exception 'invite role must be tutor or student'; end if;
  if nullif(trim(target_email), '') is null then raise exception 'email required'; end if;
  if valid_hours < 1 or valid_hours > 720 then raise exception 'valid hours out of range'; end if;

  select family_id into target_family_id
  from public.students
  where id = target_student_id and deleted_at is null;

  if target_family_id is null or not public.is_family_parent(target_family_id) then
    raise exception 'parent access required';
  end if;
  if target_role = 'tutor' and target_subject_id is null then raise exception 'tutor subject required'; end if;
  if target_role = 'student' and target_subject_id is not null then raise exception 'student invitation cannot include subject'; end if;

  generated_token := encode(gen_random_bytes(32), 'hex');
  generated_expiry := now() + make_interval(hours => valid_hours);

  insert into public.invitations (
    family_id, email, role, student_id, subject_id,
    token_hash, expires_at, created_by
  ) values (
    target_family_id, lower(trim(target_email)), target_role, target_student_id, target_subject_id,
    encode(digest(generated_token, 'sha256'), 'hex'), generated_expiry, auth.uid()
  ) returning id into generated_id;

  return query select generated_id, generated_token, generated_expiry;
end;
$$;

revoke all on function public.create_account_invitation(text, public.app_role, uuid, text, integer) from public;
grant execute on function public.create_account_invitation(text, public.app_role, uuid, text, integer) to authenticated;
