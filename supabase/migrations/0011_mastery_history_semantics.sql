-- Keep an invalidated assessment out of the current workflow while retaining a
-- legitimate previously achieved level in the student's long-term high-water mark.
alter table public.mastery_evidence_revocations
  add column if not exists preserve_for_highest boolean not null default false;

create or replace function public.recalculate_mastery_snapshot(target_knowledge_node_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  node_row public.knowledge_nodes%rowtype;
  current_evidence public.mastery_evidence%rowtype;
  highest_evidence public.mastery_evidence%rowtype;
begin
  select * into node_row from public.knowledge_nodes where id = target_knowledge_node_id;
  if node_row.id is null then return; end if;

  select evidence.* into current_evidence
  from public.mastery_evidence evidence
  where evidence.knowledge_node_id = target_knowledge_node_id
    and not exists (
      select 1 from public.mastery_evidence_revocations revocation
      where revocation.evidence_id = evidence.id
    )
  order by evidence.created_at desc, evidence.id desc
  limit 1;

  select evidence.* into highest_evidence
  from public.mastery_evidence evidence
  where evidence.knowledge_node_id = target_knowledge_node_id
    and (
      not exists (
        select 1 from public.mastery_evidence_revocations revocation
        where revocation.evidence_id = evidence.id
      )
      or exists (
        select 1 from public.mastery_evidence_revocations revocation
        where revocation.evidence_id = evidence.id and revocation.preserve_for_highest
      )
    )
  order by case evidence.level
      when 'mastered' then 4
      when 'basic' then 3
      when 'practiced' then 2
      when 'reinforce' then 1
      else 0 end desc,
    evidence.created_at desc, evidence.id desc
  limit 1;

  insert into public.mastery_snapshots(
    student_id, knowledge_node_id, subject_id, current_level, highest_level,
    current_evidence_id, latest_evidence_at, highest_achieved_at
  ) values (
    node_row.student_id, node_row.id, node_row.subject_id,
    coalesce(current_evidence.level, 'unpracticed'::public.mastery_level),
    coalesce(highest_evidence.level, 'unpracticed'::public.mastery_level),
    current_evidence.id, current_evidence.created_at, highest_evidence.created_at
  )
  on conflict (student_id, knowledge_node_id) do update set
    current_level = excluded.current_level,
    highest_level = excluded.highest_level,
    current_evidence_id = excluded.current_evidence_id,
    latest_evidence_at = excluded.latest_evidence_at,
    highest_achieved_at = excluded.highest_achieved_at,
    version = public.mastery_snapshots.version + 1,
    updated_at = now();
end;
$$;

create or replace function public.reopen_task_workflow(
  target_task_id uuid,
  reopen_reason text,
  expected_version integer,
  target_idempotency_key uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  task_row public.homework_tasks%rowtype;
  workflow_row public.task_workflow_current%rowtype;
  evidence_row record;
  node_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if nullif(trim(reopen_reason), '') is null then raise exception 'reopen reason required'; end if;
  if target_idempotency_key is null then raise exception 'idempotency key required'; end if;
  if exists (select 1 from public.change_events where actor_id = auth.uid() and idempotency_key = target_idempotency_key) then return; end if;
  select * into task_row from public.homework_tasks where id = target_task_id and deleted_at is null;
  if task_row.id is null or not public.is_task_tutor(task_row.id) then raise exception 'subject tutor access required'; end if;
  select * into workflow_row from public.task_workflow_current where task_id = target_task_id for update;
  if workflow_row.version <> expected_version then raise exception 'version conflict'; end if;
  if workflow_row.stage not in ('awaiting_acceptance', 'closed_loop') then raise exception 'only accepted workflow can be reopened'; end if;

  for evidence_row in
    select evidence.id, evidence.knowledge_node_id from public.mastery_evidence evidence
    where evidence.task_id = target_task_id and evidence.evidence_type = 'tutor_assessment'
      and not exists (select 1 from public.mastery_evidence_revocations revoked where revoked.evidence_id = evidence.id)
  loop
    insert into public.mastery_evidence_revocations(evidence_id, reason, revoked_by, preserve_for_highest)
    values(evidence_row.id, trim(reopen_reason), auth.uid(), true);
  end loop;

  for node_id in
    select link.knowledge_node_id from public.task_knowledge_links link
    where link.task_id = task_row.id
  loop
    insert into public.mastery_evidence(
      student_id, subject_id, knowledge_node_id, task_id, homework_version_id,
      evidence_type, level, detail, created_by
    ) values (
      task_row.student_id, task_row.subject_id, node_id, task_row.id,
      task_row.homework_version_id, 'reopen', 'reinforce',
      jsonb_build_object('reason', trim(reopen_reason)), auth.uid()
    );
    perform public.recalculate_mastery_snapshot(node_id);
  end loop;

  update public.student_task_activity
  set run_state = 'ready', completed_at = null, updated_at = now()
  where task_id = target_task_id;
  update public.task_workflow_current
  set active_started_at = null, last_completed_at = null
  where task_id = target_task_id;
  update public.task_reviews
  set mastery_confirmed = false, updated_at = now()
  where task_id = target_task_id;
  insert into public.study_session_events(task_id, student_id, event_type, actor_id, idempotency_key, payload)
  values(target_task_id, task_row.student_id, 'reopened', auth.uid(), target_idempotency_key,
    jsonb_build_object('reason', trim(reopen_reason)));
  perform public.refresh_task_workflow(target_task_id);
  insert into public.change_events(
    family_id, student_id, subject_id, entity_type, entity_id, event_type,
    before_value, after_value, reason, actor_id, idempotency_key
  ) values (
    task_row.family_id, task_row.student_id, task_row.subject_id, 'task', task_row.id::text,
    'workflow_reopened', jsonb_build_object('stage', workflow_row.stage),
    jsonb_build_object('stage', 'ready'), trim(reopen_reason), auth.uid(), target_idempotency_key
  );
  perform public.notify_task_audience(target_task_id, 'parent', 'workflow_reopened', '家教已重新打开任务', trim(reopen_reason));
  perform public.notify_task_audience(target_task_id, 'student', 'workflow_reopened', '任务已重新打开', task_row.title);
end;
$$;
