create or replace function public.ensure_task_evidence_requirements()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if cardinality(coalesce(new.evidence_required, '{}')) = 0 then
    new.evidence_required := array['first_attempt', 'tutor_review', 'correction', 'independent_redo'];
    if new.requires_submission then
      new.evidence_required := new.evidence_required || array['school_submission_confirmation'];
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists homework_tasks_ensure_evidence_requirements on public.homework_tasks;
create trigger homework_tasks_ensure_evidence_requirements
before insert or update of requires_submission, evidence_required on public.homework_tasks
for each row execute function public.ensure_task_evidence_requirements();

update public.homework_tasks
set evidence_required = case when requires_submission
  then array['first_attempt', 'tutor_review', 'correction', 'independent_redo', 'school_submission_confirmation']
  else array['first_attempt', 'tutor_review', 'correction', 'independent_redo'] end
where cardinality(coalesce(evidence_required, '{}')) = 0;

drop function if exists public.revise_homework(uuid, integer, text, text, date, timestamptz, text);

create function public.revise_homework(
  target_homework_id uuid,
  expected_version integer,
  homework_title text,
  homework_requirements text,
  target_deadline_date date,
  target_deadline_at timestamptz,
  revision_reason text,
  target_requirement_level text,
  target_answer_policy text,
  target_answer_basis text,
  target_submission_requirement text,
  target_knowledge_tags text[]
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  homework_row public.homeworks%rowtype;
  current_row public.homework_versions%rowtype;
  new_version_id uuid;
  target_task_id uuid;
  first_task_id uuid;
  effective_tags text[];
  tag text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into homework_row from public.homeworks where id = target_homework_id and deleted_at is null for update;
  if homework_row.id is null or not public.is_family_parent(homework_row.family_id) then raise exception 'parent access required'; end if;
  if homework_row.version <> expected_version then raise exception 'version conflict'; end if;
  if nullif(trim(revision_reason), '') is null then raise exception 'revision reason required'; end if;
  if nullif(trim(homework_title), '') is null then raise exception 'title required'; end if;
  if target_requirement_level not in ('required', 'optional', 'pending_confirmation') then raise exception 'invalid requirement level'; end if;
  if target_answer_policy not in ('after_school_submission', 'guardian_held_until_attempt', 'weekly_teacher_release', 'locked_until_first_attempt') then raise exception 'invalid answer policy'; end if;
  if target_deadline_at is not null and target_deadline_date is not null
    and (target_deadline_at at time zone 'Asia/Shanghai')::date <> target_deadline_date
  then raise exception 'deadline date mismatch'; end if;
  select * into current_row from public.homework_versions where id = homework_row.current_version_id;

  select coalesce(array_agg(clean_tag order by first_ordinal), '{}') into effective_tags
  from (
    select trim(raw_tag) clean_tag, min(ordinal) first_ordinal
    from unnest(coalesce(target_knowledge_tags, '{}')) with ordinality input(raw_tag, ordinal)
    where nullif(trim(raw_tag), '') is not null
    group by trim(raw_tag)
  ) normalized;
  if cardinality(effective_tags) = 0 then effective_tags := array[trim(homework_title)]; end if;

  insert into public.homework_versions(
    homework_id, version_number, title, requirements, source_reference, requirement_level,
    answer_policy, answer_basis, submission_requirement, deadline_date, deadline_at,
    deadline_precision, knowledge_tags, created_by
  ) values (
    homework_row.id, homework_row.version + 1, trim(homework_title), coalesce(homework_requirements, ''),
    current_row.source_reference, target_requirement_level, target_answer_policy,
    coalesce(target_answer_basis, ''), coalesce(target_submission_requirement, ''),
    target_deadline_date, target_deadline_at,
    case when target_deadline_at is not null then 'time' when target_deadline_date is not null then 'date' else 'unknown' end,
    effective_tags, auth.uid()
  ) returning id into new_version_id;

  foreach tag in array effective_tags loop
    insert into public.knowledge_nodes(family_id, student_id, subject_id, knowledge_key, display_name, created_by)
    values(homework_row.family_id, homework_row.student_id, homework_row.subject_id, lower(tag), tag, auth.uid())
    on conflict (student_id, subject_id, knowledge_key) do update set display_name = excluded.display_name, active = true;
    insert into public.homework_knowledge_links(homework_version_id, knowledge_node_id, created_by)
    select new_version_id, id, auth.uid() from public.knowledge_nodes
    where student_id = homework_row.student_id and subject_id = homework_row.subject_id and knowledge_key = lower(tag)
    on conflict do nothing;
  end loop;

  update public.homeworks
  set current_version_id = new_version_id, version = version + 1, updated_by = auth.uid()
  where id = homework_row.id;

  for target_task_id in
    update public.homework_tasks task
    set homework_version_id = new_version_id,
        title = case when (select count(*) from public.homework_tasks sibling where sibling.homework_id = homework_row.id and sibling.deleted_at is null) = 1 then trim(homework_title) else task.title end,
        notes = case when (select count(*) from public.homework_tasks sibling where sibling.homework_id = homework_row.id and sibling.deleted_at is null) = 1 then coalesce(homework_requirements, '') else task.notes end,
        knowledge = effective_tags[1], knowledge_tags = effective_tags,
        answer_basis = coalesce(target_answer_basis, ''),
        submission_requirement = coalesce(target_submission_requirement, ''),
        requires_submission = nullif(trim(coalesce(target_submission_requirement, '')), '') is not null,
        optional = target_requirement_level = 'optional',
        uncertainty = target_requirement_level = 'pending_confirmation',
        answer_policy = target_answer_policy, requirement_level = target_requirement_level,
        deadline_date = target_deadline_date, deadline_at = target_deadline_at,
        deadline_precision = case when target_deadline_at is not null then 'time' when target_deadline_date is not null then 'date' else 'unknown' end,
        version = version + 1, updated_by = auth.uid()
    where task.homework_id = homework_row.id and task.deleted_at is null
      and not exists (
        select 1 from public.study_session_events event
        where event.task_id = task.id and event.event_type in ('started', 'resumed', 'paused', 'completed', 'reopened')
      )
    returning task.id
  loop
    perform public.sync_task_knowledge_links(target_task_id);
  end loop;

  select id into first_task_id from public.homework_tasks
  where homework_id = homework_row.id and deleted_at is null
  order by sequence_number, created_at limit 1;
  if nullif(trim(coalesce(target_submission_requirement, '')), '') is null then
    update public.submission_checkpoints
    set archived_at = now(), archived_by = auth.uid(), required = false,
      homework_version_id = new_version_id, version = version + 1
    where homework_id = homework_row.id and checkpoint_type = 'initial'
      and archived_at is null and status <> 'confirmed';
  elsif exists (
    select 1 from public.submission_checkpoints
    where homework_id = homework_row.id and checkpoint_type = 'initial' and archived_at is null
  ) then
    update public.submission_checkpoints
    set homework_version_id = new_version_id, label = trim(target_submission_requirement),
      due_date = target_deadline_date, due_at = target_deadline_at, version = version + 1
    where homework_id = homework_row.id and checkpoint_type = 'initial'
      and archived_at is null and status <> 'confirmed';
  else
    insert into public.submission_checkpoints(
      homework_id, homework_version_id, task_id, checkpoint_type, label,
      required, due_date, due_at, status, created_by
    ) values (
      homework_row.id, new_version_id, first_task_id, 'initial', trim(target_submission_requirement),
      true, target_deadline_date, target_deadline_at,
      case when target_deadline_date is not null and target_deadline_date <= current_date
        then 'awaiting_confirmation'::public.checkpoint_status else 'not_due'::public.checkpoint_status end,
      auth.uid()
    );
  end if;

  insert into public.change_events(
    family_id, student_id, subject_id, entity_type, entity_id, event_type,
    before_value, after_value, reason, actor_id
  ) values (
    homework_row.family_id, homework_row.student_id, homework_row.subject_id,
    'homework', homework_row.id::text, 'version_created',
    jsonb_build_object('version', current_row.version_number, 'title', current_row.title, 'knowledge_tags', current_row.knowledge_tags),
    jsonb_build_object('version', homework_row.version + 1, 'title', trim(homework_title), 'knowledge_tags', effective_tags),
    trim(revision_reason), auth.uid()
  );
  if first_task_id is not null then
    perform public.notify_task_audience(first_task_id, 'tutor', 'homework_revised', '家长已更新作业本体', trim(revision_reason));
  end if;
  return new_version_id;
end;
$$;

revoke all on function public.ensure_task_evidence_requirements() from public;
revoke all on function public.revise_homework(uuid, integer, text, text, date, timestamptz, text, text, text, text, text, text[]) from public;
grant execute on function public.revise_homework(uuid, integer, text, text, date, timestamptz, text, text, text, text, text, text[]) to authenticated;

create or replace function public.set_homework_archived(target_homework_id uuid, archive_value boolean, change_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare homework_row public.homeworks%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into homework_row from public.homeworks where id = target_homework_id and deleted_at is null for update;
  if homework_row.id is null or not public.is_family_parent(homework_row.family_id) then raise exception 'parent access required'; end if;
  if nullif(trim(change_reason), '') is null then raise exception 'reason required'; end if;
  update public.homeworks set
    status = case when archive_value then 'archived'::public.homework_status else 'active'::public.homework_status end,
    version = version + 1, updated_by = auth.uid()
  where id = target_homework_id;
  update public.homework_tasks set
    deleted_at = case when archive_value then now() else null end,
    deleted_by = case when archive_value then auth.uid() else null end,
    version = version + 1, updated_by = auth.uid()
  where homework_id = target_homework_id;
  insert into public.change_events(
    family_id, student_id, subject_id, entity_type, entity_id, event_type,
    before_value, after_value, reason, actor_id
  ) values (
    homework_row.family_id, homework_row.student_id, homework_row.subject_id,
    'homework', homework_row.id::text,
    case when archive_value then 'archived' else 'restored' end,
    jsonb_build_object('status', homework_row.status),
    jsonb_build_object('status', case when archive_value then 'archived' else 'active' end),
    trim(change_reason), auth.uid()
  );
end;
$$;
