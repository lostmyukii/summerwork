alter table public.submission_checkpoints add column if not exists archived_at timestamptz;
alter table public.submission_checkpoints add column if not exists archived_by uuid references public.profiles(id);

create or replace function public.add_submission_checkpoint(
  target_homework_id uuid,
  target_checkpoint_type text,
  target_label text,
  target_required boolean,
  target_due_date date,
  target_due_at timestamptz,
  target_idempotency_key uuid
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  homework_row public.homeworks%rowtype;
  checkpoint_id uuid;
  first_task_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if target_idempotency_key is null then raise exception 'idempotency key required'; end if;
  if target_checkpoint_type not in ('initial', 'correction_return', 'paper_retention', 'custom') then raise exception 'invalid checkpoint type'; end if;
  if nullif(trim(target_label), '') is null then raise exception 'checkpoint label required'; end if;
  if target_due_at is not null and target_due_date is not null and (target_due_at at time zone 'Asia/Shanghai')::date <> target_due_date then raise exception 'due date mismatch'; end if;
  if exists (select 1 from public.change_events where actor_id = auth.uid() and idempotency_key = target_idempotency_key) then
    select (after_value ->> 'checkpoint_id')::uuid into checkpoint_id
    from public.change_events where actor_id = auth.uid() and idempotency_key = target_idempotency_key;
    return checkpoint_id;
  end if;
  select * into homework_row from public.homeworks where id = target_homework_id and status = 'active' and deleted_at is null;
  if homework_row.id is null or not public.is_family_parent(homework_row.family_id) then raise exception 'parent access required'; end if;
  select id into first_task_id from public.homework_tasks where homework_id = homework_row.id and deleted_at is null order by sequence_number, created_at limit 1;
  insert into public.submission_checkpoints(
    homework_id, homework_version_id, task_id, checkpoint_type, label, required,
    due_date, due_at, status, created_by
  ) values (
    homework_row.id, homework_row.current_version_id, first_task_id,
    target_checkpoint_type, trim(target_label), target_required, target_due_date,
    target_due_at,
    case when target_due_date is not null and target_due_date <= current_date then 'awaiting_confirmation'::public.checkpoint_status else 'not_due'::public.checkpoint_status end,
    auth.uid()
  ) returning id into checkpoint_id;
  insert into public.change_events(
    family_id, student_id, subject_id, entity_type, entity_id, event_type,
    after_value, actor_id, idempotency_key
  ) values (
    homework_row.family_id, homework_row.student_id, homework_row.subject_id,
    'submission_checkpoint', checkpoint_id::text, 'submission_checkpoint_created',
    jsonb_build_object('checkpoint_id', checkpoint_id, 'label', trim(target_label), 'required', target_required, 'due_date', target_due_date),
    auth.uid(), target_idempotency_key
  );
  return checkpoint_id;
end;
$$;

create or replace function public.revise_submission_checkpoint(
  target_checkpoint_id uuid,
  expected_version integer,
  target_label text,
  target_required boolean,
  target_due_date date,
  target_due_at timestamptz,
  revision_reason text,
  target_idempotency_key uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  checkpoint_row public.submission_checkpoints%rowtype;
  homework_row public.homeworks%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if target_idempotency_key is null then raise exception 'idempotency key required'; end if;
  if nullif(trim(target_label), '') is null then raise exception 'checkpoint label required'; end if;
  if nullif(trim(revision_reason), '') is null then raise exception 'revision reason required'; end if;
  if target_due_at is not null and target_due_date is not null and (target_due_at at time zone 'Asia/Shanghai')::date <> target_due_date then raise exception 'due date mismatch'; end if;
  if exists (select 1 from public.change_events where actor_id = auth.uid() and idempotency_key = target_idempotency_key) then return; end if;
  select * into checkpoint_row from public.submission_checkpoints where id = target_checkpoint_id and archived_at is null for update;
  if checkpoint_row.id is null then raise exception 'checkpoint not found'; end if;
  select * into homework_row from public.homeworks where id = checkpoint_row.homework_id and deleted_at is null;
  if homework_row.id is null or not public.is_family_parent(homework_row.family_id) then raise exception 'parent access required'; end if;
  if checkpoint_row.version <> expected_version then raise exception 'version conflict'; end if;
  update public.submission_checkpoints set
    label = trim(target_label), required = target_required, due_date = target_due_date,
    due_at = target_due_at,
    status = case
      when checkpoint_row.status = 'confirmed' then checkpoint_row.status
      when target_due_date is not null and target_due_date <= current_date then 'awaiting_confirmation'::public.checkpoint_status
      else 'not_due'::public.checkpoint_status end,
    version = version + 1
  where id = checkpoint_row.id;
  insert into public.change_events(
    family_id, student_id, subject_id, entity_type, entity_id, event_type,
    before_value, after_value, reason, actor_id, idempotency_key
  ) values (
    homework_row.family_id, homework_row.student_id, homework_row.subject_id,
    'submission_checkpoint', checkpoint_row.id::text, 'submission_checkpoint_revised',
    jsonb_build_object('label', checkpoint_row.label, 'required', checkpoint_row.required, 'due_date', checkpoint_row.due_date),
    jsonb_build_object('label', trim(target_label), 'required', target_required, 'due_date', target_due_date),
    trim(revision_reason), auth.uid(), target_idempotency_key
  );
end;
$$;

create or replace function public.set_submission_checkpoint_archived(
  target_checkpoint_id uuid,
  archive_value boolean,
  required_on_restore boolean,
  change_reason text,
  expected_version integer,
  target_idempotency_key uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  checkpoint_row public.submission_checkpoints%rowtype;
  homework_row public.homeworks%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if nullif(trim(change_reason), '') is null then raise exception 'change reason required'; end if;
  if target_idempotency_key is null then raise exception 'idempotency key required'; end if;
  if exists (select 1 from public.change_events where actor_id = auth.uid() and idempotency_key = target_idempotency_key) then return; end if;
  select * into checkpoint_row from public.submission_checkpoints where id = target_checkpoint_id for update;
  if checkpoint_row.id is null then raise exception 'checkpoint not found'; end if;
  select * into homework_row from public.homeworks where id = checkpoint_row.homework_id and deleted_at is null;
  if homework_row.id is null or not public.is_family_parent(homework_row.family_id) then raise exception 'parent access required'; end if;
  if checkpoint_row.version <> expected_version then raise exception 'version conflict'; end if;
  update public.submission_checkpoints set
    archived_at = case when archive_value then now() else null end,
    archived_by = case when archive_value then auth.uid() else null end,
    required = case when archive_value then false else required_on_restore end,
    version = version + 1
  where id = checkpoint_row.id;
  insert into public.change_events(
    family_id, student_id, subject_id, entity_type, entity_id, event_type,
    before_value, after_value, reason, actor_id, idempotency_key
  ) values (
    homework_row.family_id, homework_row.student_id, homework_row.subject_id,
    'submission_checkpoint', checkpoint_row.id::text,
    case when archive_value then 'submission_checkpoint_archived' else 'submission_checkpoint_restored' end,
    jsonb_build_object('archived_at', checkpoint_row.archived_at, 'required', checkpoint_row.required),
    jsonb_build_object('archived', archive_value, 'required', case when archive_value then false else required_on_restore end),
    trim(change_reason), auth.uid(), target_idempotency_key
  );
end;
$$;

create or replace function public.refresh_submission_deadlines(target_student_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  changed_count integer := 0;
  checkpoint_row record;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.can_access_student(target_student_id) then raise exception 'student access required'; end if;
  for checkpoint_row in
    select checkpoint.id, checkpoint.label, homework.family_id, homework.student_id,
      homework.subject_id, checkpoint.task_id
    from public.submission_checkpoints checkpoint
    join public.homeworks homework on homework.id = checkpoint.homework_id
    where homework.student_id = target_student_id and homework.deleted_at is null
      and checkpoint.archived_at is null and checkpoint.required
      and checkpoint.status = 'not_due'
      and (checkpoint.due_at <= now() or (checkpoint.due_at is null and checkpoint.due_date <= current_date))
    for update of checkpoint
  loop
    update public.submission_checkpoints set status = 'awaiting_confirmation', version = version + 1 where id = checkpoint_row.id;
    if not exists (
      select 1 from public.change_events event
      where event.entity_type = 'submission_checkpoint' and event.entity_id = checkpoint_row.id::text and event.event_type = 'submission_due'
    ) then
      insert into public.change_events(family_id, student_id, subject_id, entity_type, entity_id, event_type, after_value, actor_id)
      values(checkpoint_row.family_id, checkpoint_row.student_id, checkpoint_row.subject_id,
        'submission_checkpoint', checkpoint_row.id::text, 'submission_due',
        jsonb_build_object('label', checkpoint_row.label), auth.uid());
      if checkpoint_row.task_id is not null then
        perform public.notify_task_audience(checkpoint_row.task_id, 'tutor', 'submission_due', '学校提交节点待确认', checkpoint_row.label);
      end if;
    end if;
    changed_count := changed_count + 1;
  end loop;
  return changed_count;
end;
$$;

revoke all on function public.add_submission_checkpoint(uuid, text, text, boolean, date, timestamptz, uuid) from public;
revoke all on function public.revise_submission_checkpoint(uuid, integer, text, boolean, date, timestamptz, text, uuid) from public;
revoke all on function public.set_submission_checkpoint_archived(uuid, boolean, boolean, text, integer, uuid) from public;
revoke all on function public.refresh_submission_deadlines(uuid) from public;
grant execute on function public.add_submission_checkpoint(uuid, text, text, boolean, date, timestamptz, uuid) to authenticated;
grant execute on function public.revise_submission_checkpoint(uuid, integer, text, boolean, date, timestamptz, text, uuid) to authenticated;
grant execute on function public.set_submission_checkpoint_archived(uuid, boolean, boolean, text, integer, uuid) to authenticated;
grant execute on function public.refresh_submission_deadlines(uuid) to authenticated;
