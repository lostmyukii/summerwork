alter table public.homework_task_templates add column if not exists deadline_date date;
alter table public.homework_task_templates add column if not exists deadline_at timestamptz;
alter table public.homework_task_templates add column if not exists deadline_precision text not null default 'unknown';
alter table public.homework_tasks add column if not exists deadline_date date;
alter table public.homework_tasks add column if not exists deadline_at timestamptz;
alter table public.homework_tasks add column if not exists deadline_precision text not null default 'unknown';

do $$
begin
  alter table public.homework_task_templates add constraint homework_task_templates_deadline_precision_check
    check (deadline_precision in ('time', 'date', 'unknown'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.homework_tasks add constraint homework_tasks_deadline_precision_check
    check (deadline_precision in ('time', 'date', 'unknown'));
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.homework_status as enum ('active', 'archived');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.plan_block_type as enum ('knowledge_review', 'first_attempt', 'continuation', 'tutor_review', 'correction', 'independent_redo', 'submission_confirmation', 'reading');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.checkpoint_status as enum ('not_due', 'awaiting_confirmation', 'confirmed', 'revoked');
exception when duplicate_object then null;
end $$;

create table if not exists public.homeworks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family_spaces(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id text not null references public.subjects(id),
  catalog_id text references public.plan_catalogs(id) on delete set null,
  homework_key text,
  template_id text references public.homework_task_templates(id) on delete set null,
  status public.homework_status not null default 'active',
  current_version_id uuid,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id)
);

create table if not exists public.homework_versions (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.homeworks(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  title text not null,
  requirements text not null default '',
  source_reference text not null default '',
  requirement_level text not null default 'required' check (requirement_level in ('required', 'optional', 'pending_confirmation')),
  answer_policy text not null check (answer_policy in ('after_school_submission', 'guardian_held_until_attempt', 'weekly_teacher_release', 'locked_until_first_attempt')),
  answer_basis text not null default '',
  submission_requirement text not null default '',
  deadline_date date,
  deadline_at timestamptz,
  deadline_precision text not null default 'unknown' check (deadline_precision in ('time', 'date', 'unknown')),
  knowledge_tags text[] not null default '{}',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(homework_id, version_number)
);

do $$
begin
  alter table public.homeworks add constraint homeworks_current_version_fk
    foreign key (current_version_id) references public.homework_versions(id) on delete restrict;
exception when duplicate_object then null;
end $$;

create table if not exists public.knowledge_nodes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family_spaces(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id text not null references public.subjects(id),
  parent_id uuid references public.knowledge_nodes(id) on delete restrict,
  node_type text not null default 'knowledge' check (node_type in ('module', 'unit', 'knowledge', 'ability')),
  knowledge_key text not null,
  display_name text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(student_id, subject_id, knowledge_key)
);

create table if not exists public.homework_knowledge_links (
  homework_version_id uuid not null references public.homework_versions(id) on delete cascade,
  knowledge_node_id uuid not null references public.knowledge_nodes(id) on delete restrict,
  relation_type text not null default 'primary' check (relation_type in ('primary', 'secondary', 'integrated', 'required', 'extension')),
  weight numeric(4,3) not null default 1 check (weight > 0 and weight <= 1),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key(homework_version_id, knowledge_node_id)
);

alter table public.homework_tasks add column if not exists homework_id uuid references public.homeworks(id) on delete restrict;
alter table public.homework_tasks add column if not exists homework_version_id uuid references public.homework_versions(id) on delete restrict;
alter table public.homework_tasks add column if not exists block_type public.plan_block_type not null default 'first_attempt';
alter table public.homework_tasks add column if not exists sequence_number integer not null default 1;
alter table public.homework_tasks add column if not exists version integer not null default 1;
alter table public.homework_tasks add column if not exists updated_by uuid references public.profiles(id);
alter table public.homework_tasks add column if not exists deleted_by uuid references public.profiles(id);
alter table public.homework_tasks drop constraint if exists homework_task_student_template_unique;
create unique index if not exists homework_tasks_student_template_unique
  on public.homework_tasks(student_id, template_id) where template_id is not null;

create table if not exists public.submission_checkpoints (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.homeworks(id) on delete cascade,
  homework_version_id uuid not null references public.homework_versions(id) on delete restrict,
  task_id uuid references public.homework_tasks(id) on delete set null,
  checkpoint_type text not null default 'initial' check (checkpoint_type in ('initial', 'correction_return', 'paper_retention', 'custom')),
  label text not null,
  required boolean not null default true,
  due_date date,
  due_at timestamptz,
  status public.checkpoint_status not null default 'not_due',
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  revoked_by uuid references public.profiles(id),
  revoked_at timestamptz,
  revoke_reason text,
  note text not null default '',
  version integer not null default 1,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(homework_id, checkpoint_type, label),
  constraint checkpoint_confirmation_fields check (
    (status = 'confirmed' and confirmed_by is not null and confirmed_at is not null)
    or status <> 'confirmed'
  ),
  constraint checkpoint_revocation_fields check (
    (status = 'revoked' and revoked_by is not null and revoked_at is not null and nullif(trim(revoke_reason), '') is not null)
    or status <> 'revoked'
  )
);

create table if not exists public.change_events (
  id bigint generated by default as identity primary key,
  family_id uuid not null references public.family_spaces(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id text references public.subjects(id),
  entity_type text not null,
  entity_id text not null,
  event_type text not null,
  before_value jsonb,
  after_value jsonb,
  reason text not null default '',
  actor_id uuid not null references public.profiles(id),
  idempotency_key uuid,
  created_at timestamptz not null default now()
);

create index if not exists homeworks_student_subject_idx on public.homeworks(student_id, subject_id) where deleted_at is null;
alter table public.homeworks drop constraint if exists homeworks_student_id_template_id_key;
create unique index if not exists homeworks_student_template_unique on public.homeworks(student_id, template_id) where template_id is not null;
create unique index if not exists homeworks_student_catalog_key_unique
  on public.homeworks(student_id, catalog_id, homework_key)
  where catalog_id is not null and homework_key is not null;
create index if not exists homework_versions_homework_idx on public.homework_versions(homework_id, version_number desc);
create index if not exists knowledge_nodes_student_subject_idx on public.knowledge_nodes(student_id, subject_id) where active;
create index if not exists submission_checkpoints_due_idx on public.submission_checkpoints(due_date, status) where required;
create index if not exists change_events_student_created_idx on public.change_events(student_id, created_at desc);
create unique index if not exists change_events_actor_idempotency_unique
  on public.change_events(actor_id, idempotency_key) where idempotency_key is not null;

drop trigger if exists homeworks_set_updated_at on public.homeworks;
create trigger homeworks_set_updated_at before update on public.homeworks for each row execute function public.set_updated_at();
drop trigger if exists knowledge_nodes_set_updated_at on public.knowledge_nodes;
create trigger knowledge_nodes_set_updated_at before update on public.knowledge_nodes for each row execute function public.set_updated_at();
drop trigger if exists submission_checkpoints_set_updated_at on public.submission_checkpoints;
create trigger submission_checkpoints_set_updated_at before update on public.submission_checkpoints for each row execute function public.set_updated_at();

create or replace function public.can_access_homework(target_homework_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.homeworks
    where id = target_homework_id and deleted_at is null
      and (
        public.is_family_parent(family_id)
        or public.is_student_owner(student_id)
        or public.is_subject_tutor(student_id, subject_id)
      )
  );
$$;

create or replace function public.is_homework_parent(target_homework_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.homeworks
    where id = target_homework_id and deleted_at is null and public.is_family_parent(family_id)
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
  inserted_count integer := 0;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select family_id into target_family_id from public.students where id = target_student_id and deleted_at is null;
  if target_family_id is null or not public.is_family_parent(target_family_id) then raise exception 'parent access required'; end if;

  insert into public.homeworks(family_id, student_id, subject_id, catalog_id, homework_key, created_by, updated_by)
  select distinct target_family_id, target_student_id, template.subject_id,
    template.catalog_id, template.homework_key, auth.uid(), auth.uid()
  from public.homework_task_templates template
  where template.catalog_id = target_catalog_id
  on conflict (student_id, catalog_id, homework_key) where catalog_id is not null and homework_key is not null do nothing;

  insert into public.homework_versions(
    homework_id, version_number, title, requirements, source_reference,
    requirement_level, answer_policy, answer_basis, submission_requirement,
    deadline_date, deadline_at, deadline_precision, knowledge_tags, created_by
  )
  select homework.id, 1, template.title, template.notes, template.source_reference,
    template.requirement_level, template.answer_policy, template.answer_basis,
    template.submission_requirement, template.deadline_date, template.deadline_at,
    template.deadline_precision, template.knowledge_tags, auth.uid()
  from public.homeworks homework
  join lateral (
    select candidate.* from public.homework_task_templates candidate
    where candidate.catalog_id = homework.catalog_id and candidate.homework_key = homework.homework_key
    order by candidate.planned_date, candidate.id limit 1
  ) template on true
  where homework.student_id = target_student_id and homework.catalog_id = target_catalog_id
  on conflict (homework_id, version_number) do nothing;

  update public.homeworks homework
  set current_version_id = version.id, updated_by = auth.uid()
  from public.homework_versions version
  where version.homework_id = homework.id and version.version_number = 1
    and homework.student_id = target_student_id and homework.current_version_id is null;

  insert into public.knowledge_nodes(family_id, student_id, subject_id, knowledge_key, display_name, created_by)
  select distinct target_family_id, target_student_id, template.subject_id, lower(trim(tag)), trim(tag), auth.uid()
  from public.homework_task_templates template
  cross join lateral unnest(
    case when cardinality(template.knowledge_tags) > 0 then template.knowledge_tags
      else array[coalesce(nullif(template.knowledge, ''), template.title)] end
  ) tag
  where template.catalog_id = target_catalog_id and nullif(trim(tag), '') is not null
  on conflict (student_id, subject_id, knowledge_key) do nothing;

  insert into public.homework_knowledge_links(homework_version_id, knowledge_node_id, relation_type, created_by)
  select distinct version.id, node.id,
    case when template.requirement_level = 'optional' then 'extension' else 'primary' end,
    auth.uid()
  from public.homeworks homework
  join public.homework_versions version on version.homework_id = homework.id and version.version_number = 1
  join public.homework_task_templates template on template.catalog_id = homework.catalog_id and template.homework_key = homework.homework_key
  cross join lateral unnest(
    case when cardinality(template.knowledge_tags) > 0 then template.knowledge_tags
      else array[coalesce(nullif(template.knowledge, ''), template.title)] end
  ) tag
  join public.knowledge_nodes node on node.student_id = target_student_id
    and node.subject_id = template.subject_id and node.knowledge_key = lower(trim(tag))
  where homework.student_id = target_student_id and template.catalog_id = target_catalog_id
  on conflict (homework_version_id, knowledge_node_id) do nothing;

  insert into public.homework_tasks(
    family_id, student_id, catalog_id, template_id, homework_id, homework_version_id,
    subject_id, title, planned_date, original_date, slot_type, knowledge, knowledge_tags,
    answer_basis, submission_requirement, notes, task_kind, block_minutes,
    recommended_minutes, requires_submission, course_integrated, optional, uncertainty, priority,
    answer_policy, requirement_level, evidence_required, source_reference,
    deadline_date, deadline_at, deadline_precision, block_type, sequence_number,
    created_by, updated_by
  )
  select target_family_id, target_student_id, template.catalog_id, template.id,
    homework.id, version.id, template.subject_id, template.title,
    template.planned_date, template.planned_date, template.slot_type,
    template.knowledge, template.knowledge_tags, template.answer_basis,
    template.submission_requirement, template.notes, template.task_kind,
    template.block_minutes, template.recommended_minutes, template.requires_submission,
    template.course_integrated, template.optional, template.uncertainty, template.priority,
    template.answer_policy, template.requirement_level, template.evidence_required,
    template.source_reference, template.deadline_date, template.deadline_at,
    template.deadline_precision,
    case template.task_kind
      when 'reading' then 'reading'::public.plan_block_type
      when 'review' then 'tutor_review'::public.plan_block_type
      when 'submission' then 'submission_confirmation'::public.plan_block_type
      else 'first_attempt'::public.plan_block_type end,
    row_number() over (partition by template.homework_key order by template.planned_date, template.id)::integer,
    auth.uid(), auth.uid()
  from public.homework_task_templates template
  join public.homeworks homework on homework.student_id = target_student_id
    and homework.catalog_id = template.catalog_id and homework.homework_key = template.homework_key
  join public.homework_versions version on version.homework_id = homework.id and version.version_number = 1
  where template.catalog_id = target_catalog_id
  on conflict (student_id, template_id) where template_id is not null do nothing;
  get diagnostics inserted_count = row_count;

  update public.homework_tasks task
  set homework_id = homework.id, homework_version_id = version.id,
      deadline_date = template.deadline_date, deadline_at = template.deadline_at,
      deadline_precision = template.deadline_precision, updated_by = auth.uid()
  from public.homeworks homework
  join public.homework_versions version on version.homework_id = homework.id and version.version_number = 1
  join public.homework_task_templates template on template.catalog_id = homework.catalog_id and template.homework_key = homework.homework_key
  where task.student_id = target_student_id and task.template_id = template.id
    and (task.homework_id is null or task.homework_version_id is null);

  insert into public.submission_checkpoints(
    homework_id, homework_version_id, task_id, checkpoint_type, label,
    required, due_date, due_at, status, created_by
  )
  select homework.id, version.id, task.id, 'initial',
    coalesce(nullif(template.submission_requirement, ''), '学校平台提交'),
    template.requires_submission, template.deadline_date, template.deadline_at,
    case when template.deadline_date is not null and template.deadline_date <= current_date
      then 'awaiting_confirmation'::public.checkpoint_status else 'not_due'::public.checkpoint_status end,
    auth.uid()
  from public.homeworks homework
  join public.homework_versions version on version.homework_id = homework.id and version.version_number = 1
  join public.homework_task_templates template on template.catalog_id = homework.catalog_id and template.homework_key = homework.homework_key
  left join public.homework_tasks task on task.student_id = target_student_id and task.template_id = template.id
  where homework.student_id = target_student_id and template.catalog_id = target_catalog_id
    and template.requires_submission
  on conflict (homework_id, checkpoint_type, label) do nothing;

  return inserted_count;
end;
$$;

create or replace function public.create_manual_homework(
  target_student_id uuid,
  target_subject_id text,
  homework_title text,
  homework_requirements text,
  target_planned_date date,
  target_deadline_date date,
  target_deadline_at timestamptz,
  target_requirement_level text,
  target_answer_policy text,
  target_answer_basis text,
  target_submission_requirement text,
  target_knowledge_tags text[] default '{}'
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target_family_id uuid;
  new_homework_id uuid;
  new_version_id uuid;
  new_task_id uuid;
  effective_knowledge_tags text[];
  tag text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select family_id into target_family_id from public.students where id = target_student_id and deleted_at is null;
  if target_family_id is null or not public.is_family_parent(target_family_id) then raise exception 'parent access required'; end if;
  if nullif(trim(homework_title), '') is null then raise exception 'title required'; end if;
  if target_planned_date is null then raise exception 'planned date required'; end if;
  if not exists (select 1 from public.subjects where id = target_subject_id and active) then raise exception 'active subject required'; end if;
  if target_requirement_level not in ('required', 'optional', 'pending_confirmation') then raise exception 'invalid requirement level'; end if;
  if target_answer_policy not in ('after_school_submission', 'guardian_held_until_attempt', 'weekly_teacher_release', 'locked_until_first_attempt') then raise exception 'invalid answer policy'; end if;
  if target_deadline_at is not null and target_deadline_date is not null and (target_deadline_at at time zone 'Asia/Shanghai')::date <> target_deadline_date then raise exception 'deadline date mismatch'; end if;
  effective_knowledge_tags := case
    when cardinality(coalesce(target_knowledge_tags, '{}')) > 0 then target_knowledge_tags
    else array[trim(homework_title)] end;

  insert into public.homeworks(family_id, student_id, subject_id, created_by, updated_by)
  values(target_family_id, target_student_id, target_subject_id, auth.uid(), auth.uid())
  returning id into new_homework_id;

  insert into public.homework_versions(
    homework_id, version_number, title, requirements, source_reference,
    requirement_level, answer_policy, answer_basis, submission_requirement,
    deadline_date, deadline_at, deadline_precision, knowledge_tags, created_by
  ) values (
    new_homework_id, 1, trim(homework_title), coalesce(homework_requirements, ''), '家长手工录入',
    target_requirement_level, target_answer_policy, coalesce(target_answer_basis, ''),
    coalesce(target_submission_requirement, ''), target_deadline_date, target_deadline_at,
    case when target_deadline_at is not null then 'time' when target_deadline_date is not null then 'date' else 'unknown' end,
    effective_knowledge_tags, auth.uid()
  ) returning id into new_version_id;

  update public.homeworks set current_version_id = new_version_id where id = new_homework_id;

  insert into public.homework_tasks(
    family_id, student_id, homework_id, homework_version_id, subject_id, title,
    planned_date, original_date, slot_type, knowledge, knowledge_tags,
    answer_basis, submission_requirement, notes, task_kind, block_minutes,
    recommended_minutes, requires_submission, course_integrated, optional,
    uncertainty, priority, answer_policy, requirement_level, evidence_required,
    source_reference, deadline_date, deadline_at, deadline_precision, block_type,
    sequence_number, created_by, updated_by
  ) values (
    target_family_id, target_student_id, new_homework_id, new_version_id,
    target_subject_id, trim(homework_title), target_planned_date,
    target_planned_date, 'manual', coalesce(effective_knowledge_tags[1], ''),
    effective_knowledge_tags, coalesce(target_answer_basis, ''),
    coalesce(target_submission_requirement, ''), coalesce(homework_requirements, ''),
    'practice', 90, 90, nullif(trim(target_submission_requirement), '') is not null,
    false, target_requirement_level = 'optional',
    target_requirement_level = 'pending_confirmation',
    case when target_deadline_date is not null and target_planned_date > target_deadline_date then 'high' else 'standard' end,
    target_answer_policy, target_requirement_level, '{}', '家长手工录入',
    target_deadline_date, target_deadline_at,
    case when target_deadline_at is not null then 'time' when target_deadline_date is not null then 'date' else 'unknown' end,
    'first_attempt', 1, auth.uid(), auth.uid()
  ) returning id into new_task_id;

  foreach tag in array effective_knowledge_tags loop
    if nullif(trim(tag), '') is not null then
      insert into public.knowledge_nodes(family_id, student_id, subject_id, knowledge_key, display_name, created_by)
      values(target_family_id, target_student_id, target_subject_id, lower(trim(tag)), trim(tag), auth.uid())
      on conflict (student_id, subject_id, knowledge_key) do nothing;
      insert into public.homework_knowledge_links(homework_version_id, knowledge_node_id, created_by)
      select new_version_id, id, auth.uid() from public.knowledge_nodes
      where student_id = target_student_id and subject_id = target_subject_id and knowledge_key = lower(trim(tag))
      on conflict do nothing;
    end if;
  end loop;

  perform public.sync_task_knowledge_links(new_task_id);

  if nullif(trim(target_submission_requirement), '') is not null then
    insert into public.submission_checkpoints(homework_id, homework_version_id, task_id, checkpoint_type, label, required, due_date, due_at, created_by)
    values(new_homework_id, new_version_id, new_task_id, 'initial', trim(target_submission_requirement), true, target_deadline_date, target_deadline_at, auth.uid());
  end if;

  insert into public.change_events(family_id, student_id, subject_id, entity_type, entity_id, event_type, after_value, actor_id)
  values(target_family_id, target_student_id, target_subject_id, 'homework', new_homework_id::text, 'created', jsonb_build_object('version', 1, 'title', trim(homework_title)), auth.uid());
  return new_homework_id;
end;
$$;

create or replace function public.revise_homework(
  target_homework_id uuid,
  expected_version integer,
  homework_title text,
  homework_requirements text,
  target_deadline_date date,
  target_deadline_at timestamptz,
  revision_reason text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  homework_row public.homeworks%rowtype;
  current_row public.homework_versions%rowtype;
  new_version_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into homework_row from public.homeworks where id = target_homework_id and deleted_at is null for update;
  if homework_row.id is null or not public.is_family_parent(homework_row.family_id) then raise exception 'parent access required'; end if;
  if homework_row.version <> expected_version then raise exception 'version conflict'; end if;
  if nullif(trim(revision_reason), '') is null then raise exception 'revision reason required'; end if;
  if nullif(trim(homework_title), '') is null then raise exception 'title required'; end if;
  if target_deadline_at is not null and target_deadline_date is not null and (target_deadline_at at time zone 'Asia/Shanghai')::date <> target_deadline_date then raise exception 'deadline date mismatch'; end if;
  select * into current_row from public.homework_versions where id = homework_row.current_version_id;

  insert into public.homework_versions(
    homework_id, version_number, title, requirements, source_reference, requirement_level,
    answer_policy, answer_basis, submission_requirement, deadline_date, deadline_at,
    deadline_precision, knowledge_tags, created_by
  ) values (
    homework_row.id, homework_row.version + 1, trim(homework_title), coalesce(homework_requirements, ''),
    current_row.source_reference, current_row.requirement_level, current_row.answer_policy,
    current_row.answer_basis, current_row.submission_requirement, target_deadline_date,
    target_deadline_at, case when target_deadline_at is not null then 'time' when target_deadline_date is not null then 'date' else 'unknown' end,
    current_row.knowledge_tags, auth.uid()
  ) returning id into new_version_id;

  insert into public.homework_knowledge_links(homework_version_id, knowledge_node_id, relation_type, weight, created_by)
  select new_version_id, knowledge_node_id, relation_type, weight, auth.uid()
  from public.homework_knowledge_links where homework_version_id = current_row.id;

  update public.homeworks set current_version_id = new_version_id, version = version + 1, updated_by = auth.uid() where id = homework_row.id;
  update public.homework_tasks task
  set homework_version_id = new_version_id,
      title = case when (select count(*) from public.homework_tasks sibling where sibling.homework_id = homework_row.id and sibling.deleted_at is null) = 1 then trim(homework_title) else task.title end,
      notes = case when (select count(*) from public.homework_tasks sibling where sibling.homework_id = homework_row.id and sibling.deleted_at is null) = 1 then coalesce(homework_requirements, '') else task.notes end,
      deadline_date = target_deadline_date,
      deadline_at = target_deadline_at,
      deadline_precision = case when target_deadline_at is not null then 'time' when target_deadline_date is not null then 'date' else 'unknown' end,
      version = version + 1, updated_by = auth.uid()
  where task.homework_id = homework_row.id and task.deleted_at is null
    and not exists (
      select 1 from public.student_task_activity activity
      where activity.task_id = task.id and activity.run_state = 'completed'
    );
  update public.submission_checkpoints checkpoint
  set homework_version_id = new_version_id,
      due_date = case when (select count(*) from public.submission_checkpoints sibling where sibling.homework_id = homework_row.id) = 1 then target_deadline_date else checkpoint.due_date end,
      due_at = case when (select count(*) from public.submission_checkpoints sibling where sibling.homework_id = homework_row.id) = 1 then target_deadline_at else checkpoint.due_at end,
      version = version + 1
  where checkpoint.homework_id = homework_row.id and checkpoint.status <> 'confirmed';
  insert into public.change_events(family_id, student_id, subject_id, entity_type, entity_id, event_type, before_value, after_value, reason, actor_id)
  values(homework_row.family_id, homework_row.student_id, homework_row.subject_id, 'homework', homework_row.id::text, 'version_created',
    jsonb_build_object('version', current_row.version_number, 'title', current_row.title),
    jsonb_build_object('version', homework_row.version + 1, 'title', trim(homework_title)), trim(revision_reason), auth.uid());
  return new_version_id;
end;
$$;

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
  update public.homeworks set status = case when archive_value then 'archived' else 'active' end,
    version = version + 1, updated_by = auth.uid() where id = target_homework_id;
  update public.homework_tasks set
    deleted_at = case when archive_value then now() else null end,
    deleted_by = case when archive_value then auth.uid() else null end,
    version = version + 1,
    updated_by = auth.uid()
  where homework_id = target_homework_id;
  insert into public.change_events(family_id, student_id, subject_id, entity_type, entity_id, event_type, before_value, after_value, reason, actor_id)
  values(homework_row.family_id, homework_row.student_id, homework_row.subject_id, 'homework', homework_row.id::text,
    case when archive_value then 'archived' else 'restored' end,
    jsonb_build_object('status', homework_row.status),
    jsonb_build_object('status', case when archive_value then 'archived' else 'active' end), trim(change_reason), auth.uid());
end;
$$;

alter table public.homeworks enable row level security;
alter table public.homework_versions enable row level security;
alter table public.knowledge_nodes enable row level security;
alter table public.homework_knowledge_links enable row level security;
alter table public.submission_checkpoints enable row level security;
alter table public.change_events enable row level security;

create policy homeworks_select_authorized on public.homeworks for select to authenticated using (public.can_access_homework(id));
create policy homework_versions_select_authorized on public.homework_versions for select to authenticated using (public.can_access_homework(homework_id));
create policy knowledge_nodes_select_authorized on public.knowledge_nodes for select to authenticated using (
  public.is_family_parent(family_id) or public.is_student_owner(student_id) or public.is_subject_tutor(student_id, subject_id)
);
create policy homework_knowledge_links_select_authorized on public.homework_knowledge_links for select to authenticated using (
  exists (select 1 from public.homework_versions where id = homework_knowledge_links.homework_version_id and public.can_access_homework(homework_id))
);
create policy submission_checkpoints_select_authorized on public.submission_checkpoints for select to authenticated using (public.can_access_homework(homework_id));
create policy change_events_select_authorized on public.change_events for select to authenticated using (
  public.is_family_parent(family_id) or public.is_student_owner(student_id) or (subject_id is not null and public.is_subject_tutor(student_id, subject_id))
);

revoke all on function public.can_access_homework(uuid) from public;
revoke all on function public.is_homework_parent(uuid) from public;
revoke all on function public.create_manual_homework(uuid, text, text, text, date, date, timestamptz, text, text, text, text, text[]) from public;
revoke all on function public.revise_homework(uuid, integer, text, text, date, timestamptz, text) from public;
revoke all on function public.set_homework_archived(uuid, boolean, text) from public;
grant execute on function public.can_access_homework(uuid) to authenticated;
grant execute on function public.is_homework_parent(uuid) to authenticated;
grant execute on function public.create_manual_homework(uuid, text, text, text, date, date, timestamptz, text, text, text, text, text[]) to authenticated;
grant execute on function public.revise_homework(uuid, integer, text, text, date, timestamptz, text) to authenticated;
grant execute on function public.set_homework_archived(uuid, boolean, text) to authenticated;

do $$ begin alter publication supabase_realtime add table public.homeworks; exception when duplicate_object or undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.submission_checkpoints; exception when duplicate_object or undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.change_events; exception when duplicate_object or undefined_object then null; end $$;
