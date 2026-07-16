do $$
begin
  create type public.task_run_state as enum ('ready', 'running', 'paused', 'completed');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.mastery_level as enum ('unpracticed', 'practiced', 'reinforce', 'basic', 'mastered');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.plan_catalogs (
  id text primary key,
  title text not null,
  version integer not null check (version > 0),
  starts_on date not null,
  ends_on date not null,
  default_block_minutes smallint not null default 90 check (default_block_minutes between 15 and 360),
  configuration jsonb not null default '{}'::jsonb,
  source_digest text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_catalog_date_range check (ends_on >= starts_on)
);

create table if not exists public.homework_task_templates (
  id text primary key,
  catalog_id text not null references public.plan_catalogs(id) on delete cascade,
  subject_id text not null references public.subjects(id),
  planned_date date not null,
  slot_type text not null,
  source_slot_type text not null,
  title text not null,
  knowledge text not null default '',
  knowledge_tags text[] not null default '{}',
  answer_basis text not null,
  submission_requirement text not null,
  notes text not null default '',
  task_kind text not null check (task_kind in ('practice', 'reading', 'review', 'submission')),
  block_minutes smallint not null default 90 check (block_minutes between 15 and 360),
  recommended_minutes smallint not null default 90 check (recommended_minutes between 15 and 360),
  requires_submission boolean not null default false,
  course_integrated boolean not null default false,
  optional boolean not null default false,
  uncertainty boolean not null default false,
  priority text not null default 'standard' check (priority in ('standard', 'attention', 'high')),
  answer_policy text not null check (answer_policy in ('after_school_submission', 'guardian_held_until_attempt', 'weekly_teacher_release', 'locked_until_first_attempt')),
  requirement_level text not null check (requirement_level in ('required', 'optional', 'pending_confirmation')),
  evidence_required text[] not null default '{}',
  source_reference text not null,
  deadline_date date,
  deadline_at timestamptz,
  deadline_precision text not null default 'unknown' check (deadline_precision in ('time', 'date', 'unknown')),
  created_at timestamptz not null default now()
);

create index if not exists homework_task_templates_catalog_date_idx
  on public.homework_task_templates(catalog_id, planned_date, subject_id);

create table if not exists public.homework_tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family_spaces(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  catalog_id text references public.plan_catalogs(id) on delete set null,
  template_id text references public.homework_task_templates(id) on delete set null,
  subject_id text not null references public.subjects(id),
  title text not null,
  planned_date date not null,
  original_date date not null,
  slot_type text not null,
  knowledge text not null default '',
  knowledge_tags text[] not null default '{}',
  answer_basis text not null,
  submission_requirement text not null,
  notes text not null default '',
  task_kind text not null check (task_kind in ('practice', 'reading', 'review', 'submission')),
  block_minutes smallint not null default 90 check (block_minutes between 15 and 360),
  recommended_minutes smallint not null default 90 check (recommended_minutes between 15 and 360),
  requires_submission boolean not null default false,
  course_integrated boolean not null default false,
  optional boolean not null default false,
  uncertainty boolean not null default false,
  priority text not null default 'standard' check (priority in ('standard', 'attention', 'high')),
  answer_policy text not null,
  requirement_level text not null,
  evidence_required text[] not null default '{}',
  source_reference text not null,
  deadline_date date,
  deadline_at timestamptz,
  deadline_precision text not null default 'unknown' check (deadline_precision in ('time', 'date', 'unknown')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint homework_task_student_template_unique unique nulls not distinct (student_id, template_id)
);

create index if not exists homework_tasks_student_date_idx
  on public.homework_tasks(student_id, planned_date, subject_id) where deleted_at is null;

create table if not exists public.student_task_activity (
  task_id uuid primary key references public.homework_tasks(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  run_state public.task_run_state not null default 'ready',
  unknown_numbers text[] not null default '{}',
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.task_reviews (
  task_id uuid primary key references public.homework_tasks(id) on delete cascade,
  reviewed_by uuid not null references public.profiles(id),
  accuracy_band text not null default '70-89' check (accuracy_band in ('100', '90+', '70-89', 'below-70')),
  wrong_numbers text[] not null default '{}',
  error_tags text[] not null default '{}',
  correction_passed boolean not null default false,
  redo_required boolean not null default true,
  redo_passed boolean not null default false,
  mastery_confirmed boolean not null default false,
  review_confirmed_at timestamptz,
  review_saved_at timestamptz,
  school_submitted_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint redo_pass_requires_redo check (not redo_passed or redo_required),
  constraint mastery_requires_evidence check (
    not mastery_confirmed
    or (
      review_saved_at is not null
      and (cardinality(wrong_numbers) = 0 or correction_passed)
      and (not redo_required or redo_passed)
    )
  )
);

create table if not exists public.task_plan_changes (
  id bigint generated by default as identity primary key,
  task_id uuid not null references public.homework_tasks(id) on delete cascade,
  old_date date not null,
  new_date date not null,
  reason text not null,
  changed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists task_plan_changes_task_created_idx
  on public.task_plan_changes(task_id, created_at desc);

create table if not exists public.knowledge_mastery (
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id text not null references public.subjects(id),
  knowledge_key text not null,
  display_name text not null,
  level public.mastery_level not null default 'unpracticed',
  evidence_task_id uuid references public.homework_tasks(id) on delete set null,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (student_id, subject_id, knowledge_key)
);

drop trigger if exists plan_catalogs_set_updated_at on public.plan_catalogs;
create trigger plan_catalogs_set_updated_at before update on public.plan_catalogs for each row execute function public.set_updated_at();
drop trigger if exists homework_tasks_set_updated_at on public.homework_tasks;
create trigger homework_tasks_set_updated_at before update on public.homework_tasks for each row execute function public.set_updated_at();
drop trigger if exists student_task_activity_set_updated_at on public.student_task_activity;
create trigger student_task_activity_set_updated_at before update on public.student_task_activity for each row execute function public.set_updated_at();
drop trigger if exists task_reviews_set_updated_at on public.task_reviews;
create trigger task_reviews_set_updated_at before update on public.task_reviews for each row execute function public.set_updated_at();
drop trigger if exists knowledge_mastery_set_updated_at on public.knowledge_mastery;
create trigger knowledge_mastery_set_updated_at before update on public.knowledge_mastery for each row execute function public.set_updated_at();

create or replace function public.is_student_owner(target_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.students
    where id = target_student_id and user_id = auth.uid() and deleted_at is null
  );
$$;

create or replace function public.can_access_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.homework_tasks
    where id = target_task_id and deleted_at is null
      and (
        public.is_family_parent(family_id)
        or public.is_student_owner(student_id)
        or public.is_subject_tutor(student_id, subject_id)
      )
  );
$$;

create or replace function public.can_manage_task_subject(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.homework_tasks
    where id = target_task_id and deleted_at is null
      and (
        public.is_family_parent(family_id)
        or public.is_subject_tutor(student_id, subject_id)
      )
  );
$$;

create or replace function public.create_student_plan(target_student_id uuid, target_catalog_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target_family_id uuid;
  inserted_count integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select family_id into target_family_id
  from public.students
  where id = target_student_id and deleted_at is null;

  if target_family_id is null or not public.is_family_parent(target_family_id) then
    raise exception 'parent access required';
  end if;

  insert into public.homework_tasks (
    family_id, student_id, catalog_id, template_id, subject_id, title,
    planned_date, original_date, slot_type, knowledge, knowledge_tags,
    answer_basis, submission_requirement, notes, task_kind, block_minutes,
    recommended_minutes, requires_submission, course_integrated, optional, uncertainty, priority,
    answer_policy, requirement_level, evidence_required, source_reference,
    deadline_date, deadline_at, deadline_precision, created_by
  )
  select
    target_family_id, target_student_id, template.catalog_id, template.id,
    template.subject_id, template.title, template.planned_date, template.planned_date,
    template.slot_type, template.knowledge, template.knowledge_tags,
    template.answer_basis, template.submission_requirement, template.notes,
    template.task_kind, template.block_minutes, template.recommended_minutes,
    template.requires_submission, template.course_integrated, template.optional, template.uncertainty, template.priority,
    template.answer_policy, template.requirement_level, template.evidence_required,
    template.source_reference, template.deadline_date, template.deadline_at,
    template.deadline_precision, auth.uid()
  from public.homework_task_templates template
  where template.catalog_id = target_catalog_id
  on conflict (student_id, template_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.move_homework_task(target_task_id uuid, target_date date, change_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_date date;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if target_date is null then raise exception 'target date required'; end if;
  if nullif(trim(change_reason), '') is null then raise exception 'change reason required'; end if;
  if not public.can_manage_task_subject(target_task_id) then raise exception 'subject access required'; end if;

  select planned_date into previous_date
  from public.homework_tasks
  where id = target_task_id and deleted_at is null
  for update;

  if previous_date is null then raise exception 'task not found'; end if;
  if previous_date = target_date then return; end if;

  update public.homework_tasks set planned_date = target_date where id = target_task_id;
  insert into public.task_plan_changes(task_id, old_date, new_date, reason, changed_by)
  values (target_task_id, previous_date, target_date, trim(change_reason), auth.uid());
end;
$$;

create or replace function public.sync_review_knowledge_mastery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.homework_tasks%rowtype;
  knowledge_name text;
  derived_level public.mastery_level;
begin
  select * into task_row from public.homework_tasks where id = new.task_id;
  if task_row.id is null then return new; end if;

  derived_level := case
    when new.mastery_confirmed then 'mastered'::public.mastery_level
    when cardinality(new.wrong_numbers) > 0 and not new.correction_passed then 'reinforce'::public.mastery_level
    when new.redo_required and not new.redo_passed then 'basic'::public.mastery_level
    else 'practiced'::public.mastery_level
  end;

  for knowledge_name in
    select unnest(
      case
        when cardinality(task_row.knowledge_tags) > 0 then task_row.knowledge_tags
        else array[coalesce(nullif(task_row.knowledge, ''), task_row.title)]
      end
    )
  loop
    insert into public.knowledge_mastery (
      student_id, subject_id, knowledge_key, display_name, level,
      evidence_task_id, confirmed_by, confirmed_at
    ) values (
      task_row.student_id, task_row.subject_id, lower(trim(knowledge_name)), trim(knowledge_name), derived_level,
      task_row.id, new.reviewed_by, case when derived_level = 'mastered' then now() else null end
    )
    on conflict (student_id, subject_id, knowledge_key) do update set
      display_name = excluded.display_name,
      level = excluded.level,
      evidence_task_id = excluded.evidence_task_id,
      confirmed_by = excluded.confirmed_by,
      confirmed_at = excluded.confirmed_at,
      updated_at = now();
  end loop;
  return new;
end;
$$;

drop trigger if exists task_reviews_sync_knowledge on public.task_reviews;
create trigger task_reviews_sync_knowledge
after insert or update on public.task_reviews
for each row execute function public.sync_review_knowledge_mastery();

alter table public.plan_catalogs enable row level security;
alter table public.homework_task_templates enable row level security;
alter table public.homework_tasks enable row level security;
alter table public.student_task_activity enable row level security;
alter table public.task_reviews enable row level security;
alter table public.task_plan_changes enable row level security;
alter table public.knowledge_mastery enable row level security;

drop policy if exists plan_catalogs_select_authenticated on public.plan_catalogs;
create policy plan_catalogs_select_authenticated on public.plan_catalogs for select to authenticated using (true);
drop policy if exists task_templates_select_authenticated on public.homework_task_templates;
create policy task_templates_select_authenticated on public.homework_task_templates for select to authenticated using (true);

drop policy if exists homework_tasks_select_authorized on public.homework_tasks;
create policy homework_tasks_select_authorized on public.homework_tasks for select to authenticated using (public.can_access_task(id));
drop policy if exists homework_tasks_insert_parent on public.homework_tasks;
create policy homework_tasks_insert_parent on public.homework_tasks for insert to authenticated with check (public.is_family_parent(family_id));
drop policy if exists homework_tasks_update_parent on public.homework_tasks;
create policy homework_tasks_update_parent on public.homework_tasks for update to authenticated using (public.is_family_parent(family_id)) with check (public.is_family_parent(family_id));
drop policy if exists homework_tasks_delete_parent on public.homework_tasks;
create policy homework_tasks_delete_parent on public.homework_tasks for delete to authenticated using (public.is_family_parent(family_id));

drop policy if exists task_activity_select_authorized on public.student_task_activity;
create policy task_activity_select_authorized on public.student_task_activity for select to authenticated using (public.can_access_task(task_id));
drop policy if exists task_activity_insert_student on public.student_task_activity;
create policy task_activity_insert_student on public.student_task_activity for insert to authenticated with check (public.is_student_owner(student_id) and public.can_access_task(task_id));
drop policy if exists task_activity_update_student on public.student_task_activity;
create policy task_activity_update_student on public.student_task_activity for update to authenticated using (public.is_student_owner(student_id)) with check (public.is_student_owner(student_id) and public.can_access_task(task_id));

drop policy if exists task_reviews_select_authorized on public.task_reviews;
create policy task_reviews_select_authorized on public.task_reviews for select to authenticated using (public.can_access_task(task_id));
drop policy if exists task_reviews_insert_subject_tutor on public.task_reviews;
create policy task_reviews_insert_subject_tutor on public.task_reviews for insert to authenticated with check (public.can_manage_task_subject(task_id) and reviewed_by = auth.uid());
drop policy if exists task_reviews_update_subject_tutor on public.task_reviews;
create policy task_reviews_update_subject_tutor on public.task_reviews for update to authenticated using (public.can_manage_task_subject(task_id)) with check (public.can_manage_task_subject(task_id) and reviewed_by = auth.uid());

drop policy if exists task_plan_changes_select_authorized on public.task_plan_changes;
create policy task_plan_changes_select_authorized on public.task_plan_changes for select to authenticated using (public.can_access_task(task_id));

drop policy if exists knowledge_mastery_select_authorized on public.knowledge_mastery;
create policy knowledge_mastery_select_authorized on public.knowledge_mastery for select to authenticated using (
  public.is_student_owner(student_id)
  or exists (
    select 1 from public.students
    where students.id = knowledge_mastery.student_id and public.is_family_parent(students.family_id)
  )
  or public.is_subject_tutor(student_id, subject_id)
);
drop policy if exists knowledge_mastery_insert_subject_tutor on public.knowledge_mastery;
create policy knowledge_mastery_insert_subject_tutor on public.knowledge_mastery for insert to authenticated with check (
  public.is_subject_tutor(student_id, subject_id) and confirmed_by = auth.uid()
);
drop policy if exists knowledge_mastery_update_subject_tutor on public.knowledge_mastery;
create policy knowledge_mastery_update_subject_tutor on public.knowledge_mastery for update to authenticated using (
  public.is_subject_tutor(student_id, subject_id)
) with check (
  public.is_subject_tutor(student_id, subject_id) and confirmed_by = auth.uid()
);

revoke all on function public.is_student_owner(uuid) from public;
revoke all on function public.can_access_task(uuid) from public;
revoke all on function public.can_manage_task_subject(uuid) from public;
revoke all on function public.create_student_plan(uuid, text) from public;
revoke all on function public.move_homework_task(uuid, date, text) from public;
revoke all on function public.sync_review_knowledge_mastery() from public;

grant execute on function public.is_student_owner(uuid) to authenticated;
grant execute on function public.can_access_task(uuid) to authenticated;
grant execute on function public.can_manage_task_subject(uuid) to authenticated;
grant execute on function public.create_student_plan(uuid, text) to authenticated;
grant execute on function public.move_homework_task(uuid, date, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.homework_tasks;
exception when duplicate_object or undefined_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.student_task_activity;
exception when duplicate_object or undefined_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.task_reviews;
exception when duplicate_object or undefined_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.task_plan_changes;
exception when duplicate_object or undefined_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.knowledge_mastery;
exception when duplicate_object or undefined_object then null;
end $$;
