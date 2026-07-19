create or replace function public.save_task_review(
  target_task_id uuid,
  target_accuracy_band text,
  target_wrong_numbers text[],
  target_error_tags text[],
  target_correction_required boolean,
  target_redo_required boolean,
  target_note text,
  expected_version integer,
  target_idempotency_key uuid
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  task_row public.homework_tasks%rowtype;
  workflow_row public.task_workflow_current%rowtype;
  activity_row public.student_task_activity%rowtype;
  review_id uuid;
  next_review_number integer;
  normalized_wrongs text[] := '{}';
  normalized_tags text[] := '{}';
  normalized_unknowns text[] := '{}';
  node_id uuid;
  evidence_level public.mastery_level;
  elapsed integer := 0;
  tutor_completed_first_attempt boolean := false;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if target_idempotency_key is null then raise exception 'idempotency key required'; end if;
  if target_accuracy_band not in ('100', '90+', '70-89', 'below-70') then raise exception 'invalid accuracy band'; end if;
  if exists (select 1 from public.change_events where actor_id = auth.uid() and idempotency_key = target_idempotency_key) then
    select (after_value ->> 'review_id')::uuid into review_id
    from public.change_events where actor_id = auth.uid() and idempotency_key = target_idempotency_key;
    return review_id;
  end if;

  select * into task_row from public.homework_tasks where id = target_task_id and deleted_at is null;
  if task_row.id is null or not public.is_task_tutor(task_row.id) then raise exception 'subject tutor access required'; end if;
  select * into workflow_row from public.task_workflow_current where task_id = target_task_id for update;
  if workflow_row.task_id is null then raise exception 'workflow not initialized'; end if;
  if workflow_row.version <> expected_version then raise exception 'version conflict'; end if;
  if workflow_row.stage not in ('ready', 'in_progress', 'awaiting_review') then raise exception 'task is not ready for tutor review'; end if;

  select * into activity_row from public.student_task_activity where task_id = target_task_id for update;
  normalized_unknowns := coalesce(activity_row.unknown_numbers, '{}');

  if workflow_row.stage in ('ready', 'in_progress') then
    tutor_completed_first_attempt := true;
    if workflow_row.active_started_at is not null then
      elapsed := greatest(0, floor(extract(epoch from (now() - workflow_row.active_started_at)))::integer);
    end if;

    update public.task_workflow_current
    set actual_seconds = actual_seconds + elapsed,
      active_started_at = null,
      last_completed_at = now(),
      updated_by = auth.uid(),
      updated_at = now()
    where task_id = target_task_id;

    insert into public.student_task_activity(task_id, student_id, run_state, unknown_numbers, started_at, completed_at)
    values(target_task_id, task_row.student_id, 'completed', normalized_unknowns, coalesce(activity_row.started_at, now()), now())
    on conflict (task_id) do update set
      run_state = 'completed',
      unknown_numbers = case
        when cardinality(public.student_task_activity.unknown_numbers) > 0 then public.student_task_activity.unknown_numbers
        else excluded.unknown_numbers
      end,
      started_at = coalesce(public.student_task_activity.started_at, excluded.started_at),
      completed_at = coalesce(public.student_task_activity.completed_at, excluded.completed_at),
      updated_at = now();

    insert into public.study_session_events(
      task_id, student_id, event_type, unknown_numbers, elapsed_seconds,
      payload, actor_id, idempotency_key
    ) values (
      target_task_id, task_row.student_id, 'completed', normalized_unknowns,
      elapsed, jsonb_build_object('confirmed_by', 'tutor', 'source', 'save_task_review'),
      auth.uid(), target_idempotency_key
    );

    for node_id in
      select link.knowledge_node_id from public.task_knowledge_links link
      where link.task_id = task_row.id
    loop
      insert into public.mastery_evidence(
        student_id, subject_id, knowledge_node_id, task_id, homework_version_id,
        evidence_type, level, detail, created_by
      )
      select task_row.student_id, task_row.subject_id, node_id, task_row.id,
        task_row.homework_version_id, 'first_attempt', 'practiced',
        jsonb_build_object('unknown_numbers', normalized_unknowns, 'confirmed_by', 'tutor'),
        auth.uid()
      where not exists (
        select 1 from public.mastery_evidence evidence
        where evidence.task_id = task_row.id
          and evidence.knowledge_node_id = node_id
          and evidence.evidence_type = 'first_attempt'
          and not exists (
            select 1 from public.mastery_evidence_revocations revoked
            where revoked.evidence_id = evidence.id
          )
      );
      perform public.recalculate_mastery_snapshot(node_id);
    end loop;

    perform public.refresh_task_workflow(target_task_id);
    insert into public.change_events(
      family_id, student_id, subject_id, entity_type, entity_id, event_type,
      after_value, reason, actor_id, idempotency_key
    ) values (
      task_row.family_id, task_row.student_id, task_row.subject_id, 'task',
      task_row.id::text, 'tutor_confirmed_first_attempt',
      jsonb_build_object('unknown_numbers', normalized_unknowns, 'elapsed_seconds', elapsed),
      '家教直接批改时自动代确认首做', auth.uid(), gen_random_uuid()
    );
    perform public.notify_task_audience(target_task_id, 'parent', 'tutor_confirmed_first_attempt', '家教已代确认首做完成', task_row.title);
  end if;

  select coalesce(array_agg(value order by ordinal), '{}') into normalized_wrongs
  from (
    select trim(raw_value) value, min(ordinal) ordinal
    from unnest(coalesce(target_wrong_numbers, '{}')) with ordinality input(raw_value, ordinal)
    where nullif(trim(raw_value), '') is not null
    group by trim(raw_value)
  ) normalized;
  select coalesce(array_agg(value order by ordinal), '{}') into normalized_tags
  from (
    select trim(raw_value) value, min(ordinal) ordinal
    from unnest(coalesce(target_error_tags, '{}')) with ordinality input(raw_value, ordinal)
    where nullif(trim(raw_value), '') is not null
    group by trim(raw_value)
  ) normalized;
  if cardinality(normalized_wrongs) > 0 and not target_correction_required then raise exception 'wrong answers require correction'; end if;
  if target_redo_required and not target_correction_required then raise exception 'redo requires correction'; end if;
  if exists (
    select 1 from public.task_review_records review
    where review.task_id = target_task_id
      and not exists (select 1 from public.task_review_revocations revoked where revoked.review_id = review.id)
  ) then raise exception 'active review already exists'; end if;

  select coalesce(max(review_number), 0) + 1 into next_review_number
  from public.task_review_records where task_id = target_task_id;
  insert into public.task_review_records(
    task_id, homework_version_id, review_number, accuracy_band, wrong_numbers,
    error_tags, correction_required, redo_required, note, reviewed_by, idempotency_key
  ) values (
    target_task_id, task_row.homework_version_id, next_review_number,
    target_accuracy_band, normalized_wrongs, normalized_tags,
    target_correction_required, target_redo_required, coalesce(target_note, ''),
    auth.uid(), target_idempotency_key
  ) returning id into review_id;

  evidence_level := case when cardinality(normalized_wrongs) > 0 then 'reinforce'::public.mastery_level else 'practiced'::public.mastery_level end;
  for node_id in
    select link.knowledge_node_id from public.task_knowledge_links link
    where link.task_id = task_row.id
  loop
    insert into public.mastery_evidence(
      student_id, subject_id, knowledge_node_id, task_id, homework_version_id,
      review_id, evidence_type, level, detail, created_by
    ) values (
      task_row.student_id, task_row.subject_id, node_id, task_row.id,
      task_row.homework_version_id, review_id,
      case when cardinality(normalized_wrongs) > 0 then 'wrong_answer' else 'tutor_assessment' end,
      evidence_level,
      jsonb_build_object('accuracy_band', target_accuracy_band, 'wrong_numbers', normalized_wrongs, 'error_tags', normalized_tags),
      auth.uid()
    );
    perform public.recalculate_mastery_snapshot(node_id);
  end loop;

  insert into public.task_reviews(
    task_id, reviewed_by, accuracy_band, wrong_numbers, error_tags,
    correction_passed, redo_required, redo_passed, mastery_confirmed,
    review_confirmed_at, review_saved_at, note
  ) values (
    target_task_id, auth.uid(), target_accuracy_band, normalized_wrongs,
    normalized_tags, false, target_redo_required, false, false, now(), now(),
    coalesce(target_note, '')
  )
  on conflict (task_id) do update set
    reviewed_by = excluded.reviewed_by, accuracy_band = excluded.accuracy_band,
    wrong_numbers = excluded.wrong_numbers, error_tags = excluded.error_tags,
    correction_passed = false, redo_required = excluded.redo_required,
    redo_passed = false, mastery_confirmed = false,
    review_confirmed_at = excluded.review_confirmed_at,
    review_saved_at = excluded.review_saved_at, note = excluded.note, updated_at = now();

  perform public.refresh_task_workflow(target_task_id);
  insert into public.change_events(
    family_id, student_id, subject_id, entity_type, entity_id, event_type,
    after_value, actor_id, idempotency_key
  ) values (
    task_row.family_id, task_row.student_id, task_row.subject_id, 'review',
    review_id::text, 'review_confirmed',
    jsonb_build_object('review_id', review_id, 'accuracy_band', target_accuracy_band,
      'wrong_count', cardinality(normalized_wrongs), 'correction_required', target_correction_required,
      'redo_required', target_redo_required, 'tutor_completed_first_attempt', tutor_completed_first_attempt),
    auth.uid(), target_idempotency_key
  );
  perform public.notify_task_audience(target_task_id, 'student',
    case when target_correction_required then 'correction_required' else 'mastery_pending' end,
    case when target_correction_required then '批改完成，请按错题订正' else '批改完成' end,
    task_row.title);
  return review_id;
end;
$$;
