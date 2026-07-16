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
  where token_hash = encode(extensions.digest(raw_token, 'sha256'), 'hex')
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

  generated_token := encode(extensions.gen_random_bytes(32), 'hex');
  generated_expiry := now() + make_interval(hours => valid_hours);

  insert into public.invitations (
    family_id, email, role, student_id, subject_id,
    token_hash, expires_at, created_by
  ) values (
    target_family_id, lower(trim(target_email)), target_role, target_student_id, target_subject_id,
    encode(extensions.digest(generated_token, 'sha256'), 'hex'), generated_expiry, auth.uid()
  ) returning id into generated_id;

  return query select generated_id, generated_token, generated_expiry;
end;
$$;

create or replace function public.create_backup_snapshot(target_student_id uuid, snapshot_label text default '')
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target_family_id uuid;
  archive_payload jsonb;
  new_snapshot_id uuid;
begin
  select family_id into target_family_id from public.students where id = target_student_id and deleted_at is null;
  if target_family_id is null or not public.is_family_parent(target_family_id) then raise exception 'parent access required'; end if;
  archive_payload := public.export_student_archive(target_student_id);
  insert into public.backup_snapshots(
    family_id, student_id, payload, checksum, label, created_by
  ) values (
    target_family_id, target_student_id, archive_payload,
    encode(extensions.digest(archive_payload::text, 'sha256'), 'hex'),
    coalesce(snapshot_label, ''), auth.uid()
  ) returning id into new_snapshot_id;
  return new_snapshot_id;
end;
$$;

create or replace function public.purge_verification_family(target_family_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_name text;
begin
  select name into target_name
  from public.family_spaces
  where id = target_family_id
  for update;

  if target_name is null then return; end if;
  if target_name not like '权限验收-%' then
    raise exception 'only synthetic verification families can be purged';
  end if;

  delete from public.assessment_knowledge_results result
  using public.assessments assessment
  where result.assessment_id = assessment.id and assessment.family_id = target_family_id;

  delete from public.mastery_evidence evidence
  where evidence.student_id in (
    select id from public.students where family_id = target_family_id
  );

  delete from public.homework_tasks where family_id = target_family_id;

  delete from public.submission_checkpoints checkpoint
  using public.homeworks homework
  where checkpoint.homework_id = homework.id and homework.family_id = target_family_id;

  update public.homeworks
  set current_version_id = null
  where family_id = target_family_id;
  delete from public.homeworks where family_id = target_family_id;

  update public.knowledge_nodes
  set parent_id = null
  where family_id = target_family_id;
  delete from public.knowledge_nodes where family_id = target_family_id;

  delete from public.family_spaces where id = target_family_id;
end;
$$;

revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;
revoke all on function public.create_account_invitation(text, public.app_role, uuid, text, integer) from public;
grant execute on function public.create_account_invitation(text, public.app_role, uuid, text, integer) to authenticated;
revoke all on function public.create_backup_snapshot(uuid, text) from public;
grant execute on function public.create_backup_snapshot(uuid, text) to authenticated;
revoke all on function public.purge_verification_family(uuid) from public, anon, authenticated;
grant execute on function public.purge_verification_family(uuid) to service_role;
