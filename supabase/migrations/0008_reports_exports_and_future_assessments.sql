create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family_spaces(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  metrics jsonb not null default '{}'::jsonb,
  narrative text not null default '',
  version integer not null default 1 check (version > 0),
  generated_by uuid not null references public.profiles(id),
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(student_id, week_start),
  check (week_end = week_start + 6)
);

create table if not exists public.backup_snapshots (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family_spaces(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  snapshot_version integer not null default 1 check (snapshot_version > 0),
  payload jsonb not null,
  checksum text not null,
  label text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family_spaces(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  title text not null,
  starts_on date not null,
  ends_on date not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id),
  check (ends_on >= starts_on)
);

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  term_id uuid references public.academic_terms(id) on delete set null,
  family_id uuid not null references public.family_spaces(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id text not null references public.subjects(id),
  assessment_type text not null default 'exam' check (assessment_type in ('quiz', 'unit_test', 'midterm', 'final', 'mock', 'exam', 'other')),
  title text not null,
  occurred_on date not null,
  score numeric(8,2),
  full_score numeric(8,2),
  rank_value integer,
  class_size integer,
  note text not null default '',
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id),
  check (score is null or score >= 0),
  check (full_score is null or full_score > 0),
  check (score is null or full_score is null or score <= full_score),
  check (rank_value is null or rank_value > 0),
  check (class_size is null or class_size > 0),
  check (rank_value is null or class_size is null or rank_value <= class_size)
);

create table if not exists public.assessment_knowledge_results (
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  knowledge_node_id uuid not null references public.knowledge_nodes(id) on delete restrict,
  accuracy numeric(5,4) check (accuracy is null or (accuracy >= 0 and accuracy <= 1)),
  error_count integer check (error_count is null or error_count >= 0),
  level public.mastery_level,
  note text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key(assessment_id, knowledge_node_id)
);

create index if not exists weekly_reports_student_week_idx on public.weekly_reports(student_id, week_start desc);
create index if not exists backup_snapshots_student_created_idx on public.backup_snapshots(student_id, created_at desc);
create index if not exists assessments_student_subject_date_idx on public.assessments(student_id, subject_id, occurred_on desc) where deleted_at is null;

drop trigger if exists weekly_reports_set_updated_at on public.weekly_reports;
create trigger weekly_reports_set_updated_at before update on public.weekly_reports for each row execute function public.set_updated_at();
drop trigger if exists academic_terms_set_updated_at on public.academic_terms;
create trigger academic_terms_set_updated_at before update on public.academic_terms for each row execute function public.set_updated_at();
drop trigger if exists assessments_set_updated_at on public.assessments;
create trigger assessments_set_updated_at before update on public.assessments for each row execute function public.set_updated_at();

create or replace function public.generate_weekly_report(target_student_id uuid, target_week_start date)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target_family_id uuid;
  report_id uuid;
  report_metrics jsonb;
  report_narrative text;
  planned_count integer;
  completed_count integer;
  reviewed_count integer;
  corrected_count integer;
  redo_passed_count integer;
  required_submission_count integer;
  confirmed_submission_count integer;
  mastered_count integer;
  reinforce_count integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if target_week_start is null then raise exception 'week start required'; end if;
  select family_id into target_family_id from public.students where id = target_student_id and deleted_at is null;
  if target_family_id is null or not public.is_family_parent(target_family_id) then raise exception 'parent access required'; end if;

  select count(*) into planned_count from public.homework_tasks task
  where task.student_id = target_student_id and task.deleted_at is null
    and task.planned_date between target_week_start and target_week_start + 6;
  select count(*) into completed_count from public.homework_tasks task
  join public.student_task_activity activity on activity.task_id = task.id and activity.run_state = 'completed'
  where task.student_id = target_student_id and task.deleted_at is null
    and task.planned_date between target_week_start and target_week_start + 6;
  select count(*) into reviewed_count from public.task_review_records review
  join public.homework_tasks task on task.id = review.task_id
  where task.student_id = target_student_id and task.deleted_at is null
    and task.planned_date between target_week_start and target_week_start + 6
    and not exists (select 1 from public.task_review_revocations revoked where revoked.review_id = review.id);
  select count(*) into corrected_count from public.correction_attempts correction
  join public.homework_tasks task on task.id = correction.task_id
  where task.student_id = target_student_id and task.deleted_at is null
    and task.planned_date between target_week_start and target_week_start + 6
    and correction.correction_passed
    and not exists (select 1 from public.correction_attempt_revocations revoked where revoked.correction_attempt_id = correction.id);
  select count(*) into redo_passed_count from public.correction_attempts correction
  join public.homework_tasks task on task.id = correction.task_id
  where task.student_id = target_student_id and task.deleted_at is null
    and task.planned_date between target_week_start and target_week_start + 6
    and correction.redo_passed
    and not exists (select 1 from public.correction_attempt_revocations revoked where revoked.correction_attempt_id = correction.id);
  select count(*) filter (where checkpoint.required),
    count(*) filter (where checkpoint.required and checkpoint.status = 'confirmed')
  into required_submission_count, confirmed_submission_count
  from public.submission_checkpoints checkpoint
  join public.homeworks homework on homework.id = checkpoint.homework_id
  where homework.student_id = target_student_id and homework.deleted_at is null
    and coalesce(checkpoint.due_date, target_week_start) between target_week_start and target_week_start + 6;
  select count(*) filter (where current_level = 'mastered'),
    count(*) filter (where current_level = 'reinforce')
  into mastered_count, reinforce_count
  from public.mastery_snapshots where student_id = target_student_id;

  report_metrics := jsonb_build_object(
    'planned_blocks', planned_count,
    'completed_blocks', completed_count,
    'completion_rate', case when planned_count = 0 then 0 else round(completed_count::numeric / planned_count, 4) end,
    'reviewed_blocks', reviewed_count,
    'correction_passed_attempts', corrected_count,
    'redo_passed_attempts', redo_passed_count,
    'required_submissions', required_submission_count,
    'confirmed_submissions', confirmed_submission_count,
    'submission_rate', case when required_submission_count = 0 then 1 else round(confirmed_submission_count::numeric / required_submission_count, 4) end,
    'mastered_nodes', mastered_count,
    'reinforce_nodes', reinforce_count
  );
  report_narrative := format(
    '本周计划 %s 个任务块，完成 %s 个，已批改 %s 个；订正通过 %s 次，独立复做通过 %s 次；必需提交确认 %s/%s。',
    planned_count, completed_count, reviewed_count, corrected_count,
    redo_passed_count, confirmed_submission_count, required_submission_count
  );

  insert into public.weekly_reports(
    family_id, student_id, week_start, week_end, metrics, narrative, generated_by
  ) values (
    target_family_id, target_student_id, target_week_start, target_week_start + 6,
    report_metrics, report_narrative, auth.uid()
  )
  on conflict (student_id, week_start) do update set
    metrics = excluded.metrics, narrative = excluded.narrative,
    generated_by = excluded.generated_by, generated_at = now(),
    version = public.weekly_reports.version + 1
  returning id into report_id;

  insert into public.change_events(
    family_id, student_id, entity_type, entity_id, event_type, after_value, actor_id
  ) values (
    target_family_id, target_student_id, 'weekly_report', report_id::text,
    'weekly_report_generated', report_metrics, auth.uid()
  );
  return report_id;
end;
$$;

create or replace function public.export_student_archive(target_student_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare target_family_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select family_id into target_family_id from public.students where id = target_student_id and deleted_at is null;
  if target_family_id is null or not public.is_family_parent(target_family_id) then raise exception 'parent access required'; end if;
  return jsonb_build_object(
    'schema_version', 1,
    'exported_at', now(),
    'student', (select to_jsonb(student) - 'user_id' from public.students student where student.id = target_student_id),
    'homeworks', coalesce((select jsonb_agg(to_jsonb(homework) order by homework.created_at) from public.homeworks homework where homework.student_id = target_student_id), '[]'::jsonb),
    'homework_versions', coalesce((select jsonb_agg(to_jsonb(version) order by version.created_at) from public.homework_versions version join public.homeworks homework on homework.id = version.homework_id where homework.student_id = target_student_id), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(to_jsonb(task) order by task.planned_date, task.sequence_number) from public.homework_tasks task where task.student_id = target_student_id), '[]'::jsonb),
    'study_events', coalesce((select jsonb_agg(to_jsonb(event) order by event.occurred_at) from public.study_session_events event where event.student_id = target_student_id), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(to_jsonb(review) order by review.reviewed_at) from public.task_review_records review join public.homework_tasks task on task.id = review.task_id where task.student_id = target_student_id), '[]'::jsonb),
    'corrections', coalesce((select jsonb_agg(to_jsonb(correction) order by correction.validated_at) from public.correction_attempts correction join public.homework_tasks task on task.id = correction.task_id where task.student_id = target_student_id), '[]'::jsonb),
    'submission_events', coalesce((select jsonb_agg(to_jsonb(event) order by event.created_at) from public.submission_confirmations event join public.submission_checkpoints checkpoint on checkpoint.id = event.checkpoint_id join public.homeworks homework on homework.id = checkpoint.homework_id where homework.student_id = target_student_id), '[]'::jsonb),
    'mastery_evidence', coalesce((select jsonb_agg(to_jsonb(evidence) order by evidence.created_at) from public.mastery_evidence evidence where evidence.student_id = target_student_id), '[]'::jsonb),
    'mastery_snapshots', coalesce((select jsonb_agg(to_jsonb(snapshot) order by snapshot.subject_id, snapshot.knowledge_node_id) from public.mastery_snapshots snapshot where snapshot.student_id = target_student_id), '[]'::jsonb),
    'change_events', coalesce((select jsonb_agg(to_jsonb(event) order by event.created_at) from public.change_events event where event.student_id = target_student_id), '[]'::jsonb),
    'weekly_reports', coalesce((select jsonb_agg(to_jsonb(report) order by report.week_start) from public.weekly_reports report where report.student_id = target_student_id), '[]'::jsonb),
    'assessments', coalesce((select jsonb_agg(to_jsonb(assessment) order by assessment.occurred_on) from public.assessments assessment where assessment.student_id = target_student_id), '[]'::jsonb)
  );
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
    encode(digest(archive_payload::text, 'sha256'), 'hex'),
    coalesce(snapshot_label, ''), auth.uid()
  ) returning id into new_snapshot_id;
  return new_snapshot_id;
end;
$$;

create or replace function public.restore_plan_block(
  target_task_id uuid,
  restore_reason text,
  expected_version integer,
  target_idempotency_key uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  task_row public.homework_tasks%rowtype;
  homework_row public.homeworks%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if nullif(trim(restore_reason), '') is null then raise exception 'restore reason required'; end if;
  if target_idempotency_key is null then raise exception 'idempotency key required'; end if;
  if exists (select 1 from public.change_events where actor_id = auth.uid() and idempotency_key = target_idempotency_key) then return; end if;
  select * into task_row from public.homework_tasks where id = target_task_id for update;
  if task_row.id is null or task_row.deleted_at is null then raise exception 'soft-deleted block not found'; end if;
  if not public.is_subject_tutor(task_row.student_id, task_row.subject_id) then raise exception 'subject tutor access required'; end if;
  if task_row.version <> expected_version then raise exception 'version conflict'; end if;
  select * into homework_row from public.homeworks where id = task_row.homework_id;
  if homework_row.status <> 'active' or homework_row.deleted_at is not null then raise exception 'homework is not active'; end if;
  update public.homework_tasks set deleted_at = null, deleted_by = null,
    version = version + 1, updated_by = auth.uid() where id = task_row.id;
  insert into public.change_events(
    family_id, student_id, subject_id, entity_type, entity_id, event_type,
    before_value, after_value, reason, actor_id, idempotency_key
  ) values (
    task_row.family_id, task_row.student_id, task_row.subject_id, 'task', task_row.id::text,
    'plan_block_restored', jsonb_build_object('deleted_at', task_row.deleted_at),
    jsonb_build_object('deleted_at', null), trim(restore_reason), auth.uid(), target_idempotency_key
  );
  perform public.notify_task_audience(task_row.id, 'parent', 'plan_changed', '家教已恢复任务块', trim(restore_reason));
end;
$$;

alter table public.weekly_reports enable row level security;
alter table public.backup_snapshots enable row level security;
alter table public.academic_terms enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_knowledge_results enable row level security;

create policy weekly_reports_select_family on public.weekly_reports for select to authenticated using (
  public.is_family_parent(family_id) or public.is_student_owner(student_id)
);
create policy backup_snapshots_select_parent on public.backup_snapshots for select to authenticated using (public.is_family_parent(family_id));
create policy academic_terms_select_authorized on public.academic_terms for select to authenticated using (public.can_access_student(student_id));
create policy academic_terms_write_parent on public.academic_terms for all to authenticated using (public.is_family_parent(family_id)) with check (public.is_family_parent(family_id));
create policy assessments_select_authorized on public.assessments for select to authenticated using (
  public.is_family_parent(family_id) or public.is_student_owner(student_id) or public.is_subject_tutor(student_id, subject_id)
);
create policy assessments_write_parent on public.assessments for all to authenticated using (public.is_family_parent(family_id)) with check (public.is_family_parent(family_id));
create policy assessment_results_select_authorized on public.assessment_knowledge_results for select to authenticated using (
  exists (select 1 from public.assessments assessment where assessment.id = assessment_knowledge_results.assessment_id and public.can_access_student(assessment.student_id))
);
create policy assessment_results_write_parent on public.assessment_knowledge_results for all to authenticated using (
  exists (select 1 from public.assessments assessment where assessment.id = assessment_knowledge_results.assessment_id and public.is_family_parent(assessment.family_id))
) with check (
  exists (select 1 from public.assessments assessment where assessment.id = assessment_knowledge_results.assessment_id and public.is_family_parent(assessment.family_id))
);

revoke insert, update, delete on public.weekly_reports from authenticated;
revoke insert, update, delete on public.backup_snapshots from authenticated;
revoke all on function public.generate_weekly_report(uuid, date) from public;
revoke all on function public.export_student_archive(uuid) from public;
revoke all on function public.create_backup_snapshot(uuid, text) from public;
revoke all on function public.restore_plan_block(uuid, text, integer, uuid) from public;
grant execute on function public.generate_weekly_report(uuid, date) to authenticated;
grant execute on function public.export_student_archive(uuid) to authenticated;
grant execute on function public.create_backup_snapshot(uuid, text) to authenticated;
grant execute on function public.restore_plan_block(uuid, text, integer, uuid) to authenticated;

do $$ begin alter publication supabase_realtime add table public.weekly_reports; exception when duplicate_object or undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object or undefined_object then null; end $$;
