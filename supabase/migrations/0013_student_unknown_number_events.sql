alter table public.study_session_events
  drop constraint if exists study_session_events_event_type_check;
alter table public.study_session_events
  add constraint study_session_events_event_type_check
  check (event_type in ('started', 'paused', 'resumed', 'completed', 'reopened', 'unknown_updated'));

create or replace function public.record_student_task_event(
  target_task_id uuid,
  target_event text,
  target_unknown_numbers text[],
  expected_version integer,
  target_idempotency_key uuid
)
returns public.task_workflow_current
language plpgsql security definer set search_path = public
as $$
declare
  task_row public.homework_tasks%rowtype;
  workflow_row public.task_workflow_current%rowtype;
  elapsed integer := 0;
  normalized_unknowns text[] := '{}';
  logged_event text;
  node_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if target_idempotency_key is null then raise exception 'idempotency key required'; end if;
  if target_event not in ('started', 'paused', 'completed', 'unknown_updated') then raise exception 'invalid student event'; end if;

  if exists (
    select 1 from public.study_session_events
    where actor_id = auth.uid() and idempotency_key = target_idempotency_key
  ) then
    select * into workflow_row from public.task_workflow_current where task_id = target_task_id;
    return workflow_row;
  end if;

  select * into task_row from public.homework_tasks where id = target_task_id and deleted_at is null;
  if task_row.id is null or not public.is_student_owner(task_row.student_id) then raise exception 'student access required'; end if;
  select * into workflow_row from public.task_workflow_current where task_id = target_task_id for update;
  if workflow_row.task_id is null then raise exception 'workflow not initialized'; end if;
  if workflow_row.version <> expected_version then raise exception 'version conflict'; end if;

  select coalesce(array_agg(value order by ordinal), '{}') into normalized_unknowns
  from (
    select trim(raw_value) value, min(ordinal) ordinal
    from unnest(coalesce(target_unknown_numbers, '{}')) with ordinality input(raw_value, ordinal)
    where nullif(trim(raw_value), '') is not null
    group by trim(raw_value)
  ) normalized;

  if target_event = 'started' then
    if workflow_row.stage not in ('ready', 'in_progress') then raise exception 'task cannot be started from current stage'; end if;
    if workflow_row.active_started_at is not null then raise exception 'task already running'; end if;
    logged_event := case when workflow_row.stage = 'in_progress' then 'resumed' else 'started' end;
    update public.task_workflow_current set active_started_at = now() where task_id = target_task_id;
    insert into public.student_task_activity(task_id, student_id, run_state, unknown_numbers, started_at)
    values(target_task_id, task_row.student_id, 'running', normalized_unknowns, now())
    on conflict (task_id) do update set
      run_state = 'running', unknown_numbers = excluded.unknown_numbers,
      started_at = coalesce(public.student_task_activity.started_at, excluded.started_at), updated_at = now();
  elsif target_event = 'paused' then
    if workflow_row.stage <> 'in_progress' or workflow_row.active_started_at is null then raise exception 'task is not running'; end if;
    elapsed := greatest(0, floor(extract(epoch from (now() - workflow_row.active_started_at)))::integer);
    logged_event := 'paused';
    update public.task_workflow_current
    set actual_seconds = actual_seconds + elapsed, active_started_at = null
    where task_id = target_task_id;
    update public.student_task_activity
    set run_state = 'paused', unknown_numbers = normalized_unknowns, updated_at = now()
    where task_id = target_task_id;
  elsif target_event = 'completed' then
    if workflow_row.stage <> 'in_progress' then raise exception 'task is not in progress'; end if;
    if workflow_row.active_started_at is not null then
      elapsed := greatest(0, floor(extract(epoch from (now() - workflow_row.active_started_at)))::integer);
    end if;
    logged_event := 'completed';
    update public.task_workflow_current
    set actual_seconds = actual_seconds + elapsed, active_started_at = null, last_completed_at = now()
    where task_id = target_task_id;
    update public.student_task_activity
    set run_state = 'completed', unknown_numbers = normalized_unknowns,
      completed_at = now(), updated_at = now()
    where task_id = target_task_id;

    for node_id in
      select link.knowledge_node_id from public.task_knowledge_links link
      where link.task_id = task_row.id
    loop
      insert into public.mastery_evidence(
        student_id, subject_id, knowledge_node_id, task_id, homework_version_id,
        evidence_type, level, detail, created_by
      ) values (
        task_row.student_id, task_row.subject_id, node_id, task_row.id,
        task_row.homework_version_id, 'first_attempt', 'practiced',
        jsonb_build_object('unknown_numbers', normalized_unknowns), auth.uid()
      );
      perform public.recalculate_mastery_snapshot(node_id);
    end loop;
  else
    if workflow_row.stage not in ('ready', 'in_progress') then raise exception 'unknown numbers cannot be changed after completion'; end if;
    logged_event := 'unknown_updated';
    insert into public.student_task_activity(task_id, student_id, run_state, unknown_numbers)
    values(target_task_id, task_row.student_id, 'ready', normalized_unknowns)
    on conflict (task_id) do update set
      unknown_numbers = excluded.unknown_numbers, updated_at = now();
  end if;

  insert into public.study_session_events(
    task_id, student_id, event_type, unknown_numbers, elapsed_seconds,
    actor_id, idempotency_key
  ) values (
    target_task_id, task_row.student_id, logged_event, normalized_unknowns,
    elapsed, auth.uid(), target_idempotency_key
  );

  perform public.refresh_task_workflow(target_task_id);
  insert into public.change_events(
    family_id, student_id, subject_id, entity_type, entity_id, event_type,
    after_value, actor_id, idempotency_key
  ) values (
    task_row.family_id, task_row.student_id, task_row.subject_id, 'task',
    task_row.id::text, 'student_' || logged_event,
    jsonb_build_object('unknown_numbers', normalized_unknowns, 'elapsed_seconds', elapsed),
    auth.uid(), target_idempotency_key
  );
  if logged_event = 'completed' then
    perform public.notify_task_audience(target_task_id, 'tutor', 'task_awaiting_review', '孩子已完成，等待批改', task_row.title);
  end if;
  select * into workflow_row from public.task_workflow_current where task_id = target_task_id;
  return workflow_row;
end;
$$;
