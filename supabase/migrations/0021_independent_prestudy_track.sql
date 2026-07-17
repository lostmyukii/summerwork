create table if not exists public.prestudy_course_slots (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family_spaces(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id text not null references public.subjects(id),
  course_date date not null,
  tutor_lane text not null default '本科' check (tutor_lane in ('本科', '考背')),
  planned_minutes integer not null default 90 check (planned_minutes = 90),
  active boolean not null default true,
  source_reference text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(student_id, subject_id, course_date, tutor_lane)
);

create table if not exists public.prestudy_lessons (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  source_digest text not null,
  family_id uuid not null references public.family_spaces(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id text not null references public.subjects(id),
  assigned_tutor_user_id uuid not null references public.profiles(id),
  original_date date not null,
  planned_date date not null,
  schedule_adjustment_reason text not null default '',
  tutor_lane text not null default '本科' check (tutor_lane in ('本科', '考背')),
  module_code text not null,
  lesson_code text not null,
  title text not null,
  input_0_25 text not null,
  analysis_25_55 text not null,
  practice_55_80 text not null,
  output_80_90 text not null,
  acceptance_criteria text not null,
  planned_minutes integer not null default 90 check (planned_minutes = 90),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(student_id, source_key)
);

create table if not exists public.prestudy_knowledge_items (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.prestudy_lessons(id) on delete cascade,
  label text not null check (nullif(trim(label), '') is not null),
  sort_order smallint not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique(lesson_id, label),
  unique(id, lesson_id)
);

create table if not exists public.prestudy_execution_records (
  lesson_id uuid primary key references public.prestudy_lessons(id) on delete cascade,
  led_at timestamptz,
  led_by uuid references public.profiles(id),
  validated_at timestamptz,
  validated_by uuid references public.profiles(id),
  actual_question_count integer check (actual_question_count is null or actual_question_count >= 0),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((led_at is null and led_by is null) or (led_at is not null and led_by is not null)),
  check ((validated_at is null and validated_by is null) or (validated_at is not null and validated_by is not null)),
  check (validated_at is null or (led_at is not null and actual_question_count is not null))
);

create table if not exists public.prestudy_unmastered_items (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.prestudy_lessons(id) on delete cascade,
  knowledge_item_id uuid,
  custom_label text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (
    (knowledge_item_id is not null and custom_label is null)
    or (knowledge_item_id is null and nullif(trim(custom_label), '') is not null)
  ),
  foreign key (knowledge_item_id, lesson_id)
    references public.prestudy_knowledge_items(id, lesson_id) on delete cascade,
  unique(lesson_id, knowledge_item_id)
);

create unique index if not exists prestudy_unmastered_custom_unique
on public.prestudy_unmastered_items(lesson_id, lower(trim(custom_label)))
where custom_label is not null;

create index if not exists prestudy_lessons_student_date_idx
on public.prestudy_lessons(student_id, planned_date, subject_id);

create index if not exists prestudy_lessons_tutor_date_idx
on public.prestudy_lessons(assigned_tutor_user_id, planned_date, subject_id);

create index if not exists prestudy_course_slots_student_date_idx
on public.prestudy_course_slots(student_id, course_date, subject_id) where active;

create index if not exists prestudy_unmastered_lesson_idx
on public.prestudy_unmastered_items(lesson_id, created_at);

drop trigger if exists prestudy_course_slots_set_updated_at on public.prestudy_course_slots;
create trigger prestudy_course_slots_set_updated_at
before update on public.prestudy_course_slots
for each row execute function public.set_updated_at();

drop trigger if exists prestudy_lessons_set_updated_at on public.prestudy_lessons;
create trigger prestudy_lessons_set_updated_at
before update on public.prestudy_lessons
for each row execute function public.set_updated_at();

drop trigger if exists prestudy_execution_set_updated_at on public.prestudy_execution_records;
create trigger prestudy_execution_set_updated_at
before update on public.prestudy_execution_records
for each row execute function public.set_updated_at();

create or replace function public.can_access_prestudy_lesson(target_lesson_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.prestudy_lessons lesson
    where lesson.id = target_lesson_id
      and (
        public.is_family_parent(lesson.family_id)
        or public.is_student_owner(lesson.student_id)
        or public.is_subject_tutor(lesson.student_id, lesson.subject_id)
      )
  );
$$;

create or replace function public.notify_prestudy_audience(
  target_lesson_id uuid,
  target_type text,
  target_title text,
  target_body text default ''
)
returns void
language plpgsql security definer set search_path = public
as $$
declare lesson_row public.prestudy_lessons%rowtype;
begin
  select * into lesson_row from public.prestudy_lessons where id = target_lesson_id;
  if lesson_row.id is null then return; end if;

  insert into public.notifications(
    family_id, student_id, subject_id, recipient_id, notification_type,
    title, body, entity_type, entity_id
  )
  select lesson_row.family_id, lesson_row.student_id, lesson_row.subject_id,
    membership.user_id, target_type, target_title, coalesce(target_body, ''),
    'prestudy_lesson', lesson_row.id::text
  from public.family_memberships membership
  where membership.family_id = lesson_row.family_id
    and membership.role = 'parent' and membership.removed_at is null
  union all
  select lesson_row.family_id, lesson_row.student_id, lesson_row.subject_id,
    student.user_id, target_type, target_title, coalesce(target_body, ''),
    'prestudy_lesson', lesson_row.id::text
  from public.students student
  where student.id = lesson_row.student_id and student.user_id is not null;
end;
$$;

create or replace function public.mark_prestudy_led(
  target_lesson_id uuid,
  expected_version integer,
  target_idempotency_key uuid
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  lesson_row public.prestudy_lessons%rowtype;
  execution_row public.prestudy_execution_records%rowtype;
  prior_version integer;
  next_version integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if expected_version is null or expected_version < 0 then raise exception 'expected version required'; end if;
  if target_idempotency_key is null then raise exception 'idempotency key required'; end if;

  select (after_value ->> 'version')::integer into prior_version
  from public.change_events
  where actor_id = auth.uid() and idempotency_key = target_idempotency_key;
  if prior_version is not null then return prior_version; end if;

  select * into lesson_row from public.prestudy_lessons
  where id = target_lesson_id for update;
  if lesson_row.id is null or not public.is_subject_tutor(lesson_row.student_id, lesson_row.subject_id) then
    raise exception 'subject tutor access required';
  end if;

  select * into execution_row from public.prestudy_execution_records
  where lesson_id = target_lesson_id for update;

  if execution_row.lesson_id is null then
    if expected_version <> 0 then raise exception 'version conflict'; end if;
    insert into public.prestudy_execution_records(lesson_id, led_at, led_by, version)
    values(target_lesson_id, now(), auth.uid(), 1);
    next_version := 1;
  else
    if execution_row.version <> expected_version then raise exception 'version conflict'; end if;
    if execution_row.led_at is not null then raise exception 'prestudy lesson already led'; end if;
    next_version := execution_row.version + 1;
    update public.prestudy_execution_records
    set led_at = now(), led_by = auth.uid(), version = next_version
    where lesson_id = target_lesson_id;
  end if;

  insert into public.change_events(
    family_id, student_id, subject_id, entity_type, entity_id, event_type,
    after_value, actor_id, idempotency_key
  ) values (
    lesson_row.family_id, lesson_row.student_id, lesson_row.subject_id,
    'prestudy_lesson', lesson_row.id::text, 'prestudy_led',
    jsonb_build_object('version', next_version, 'led_at', now()),
    auth.uid(), target_idempotency_key
  );
  perform public.notify_prestudy_audience(
    lesson_row.id, 'prestudy_led', '预习已完成带学', lesson_row.title
  );
  return next_version;
end;
$$;

create or replace function public.validate_prestudy_lesson(
  target_lesson_id uuid,
  target_actual_question_count integer,
  target_knowledge_item_ids uuid[],
  target_custom_unmastered text[],
  expected_version integer,
  target_idempotency_key uuid
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  lesson_row public.prestudy_lessons%rowtype;
  execution_row public.prestudy_execution_records%rowtype;
  prior_version integer;
  next_version integer;
  requested_knowledge_count integer;
  valid_knowledge_count integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if target_actual_question_count is null or target_actual_question_count < 0 then
    raise exception 'actual question count must be a non-negative integer';
  end if;
  if expected_version is null or expected_version < 1 then raise exception 'expected version required'; end if;
  if target_idempotency_key is null then raise exception 'idempotency key required'; end if;

  select (after_value ->> 'version')::integer into prior_version
  from public.change_events
  where actor_id = auth.uid() and idempotency_key = target_idempotency_key;
  if prior_version is not null then return prior_version; end if;

  select * into lesson_row from public.prestudy_lessons
  where id = target_lesson_id for update;
  if lesson_row.id is null or not public.is_subject_tutor(lesson_row.student_id, lesson_row.subject_id) then
    raise exception 'subject tutor access required';
  end if;

  select * into execution_row from public.prestudy_execution_records
  where lesson_id = target_lesson_id for update;
  if execution_row.lesson_id is null or execution_row.led_at is null then
    raise exception 'prestudy lesson must be led before validation';
  end if;
  if execution_row.version <> expected_version then raise exception 'version conflict'; end if;
  if execution_row.validated_at is not null then raise exception 'prestudy lesson already validated'; end if;

  select count(distinct item_id) into requested_knowledge_count
  from unnest(coalesce(target_knowledge_item_ids, '{}'::uuid[])) item_id
  where item_id is not null;
  select count(*) into valid_knowledge_count
  from public.prestudy_knowledge_items item
  where item.lesson_id = target_lesson_id
    and item.id = any(coalesce(target_knowledge_item_ids, '{}'::uuid[]));
  if requested_knowledge_count <> valid_knowledge_count then
    raise exception 'unmastered knowledge item does not belong to lesson';
  end if;
  if exists (
    select 1 from unnest(coalesce(target_custom_unmastered, '{}'::text[])) value
    where nullif(trim(value), '') is null or length(trim(value)) > 80
  ) then raise exception 'custom unmastered knowledge must be 1 to 80 characters'; end if;

  delete from public.prestudy_unmastered_items where lesson_id = target_lesson_id;
  insert into public.prestudy_unmastered_items(lesson_id, knowledge_item_id, created_by)
  select target_lesson_id, item_id, auth.uid()
  from (
    select distinct item_id
    from unnest(coalesce(target_knowledge_item_ids, '{}'::uuid[])) item_id
    where item_id is not null
  ) selected;
  insert into public.prestudy_unmastered_items(lesson_id, custom_label, created_by)
  select target_lesson_id, value, auth.uid()
  from (
    select distinct on (lower(trim(raw_value))) trim(raw_value) as value
    from unnest(coalesce(target_custom_unmastered, '{}'::text[])) raw_value
    where nullif(trim(raw_value), '') is not null
    order by lower(trim(raw_value)), trim(raw_value)
  ) selected;

  next_version := execution_row.version + 1;
  update public.prestudy_execution_records
  set validated_at = now(), validated_by = auth.uid(),
      actual_question_count = target_actual_question_count,
      version = next_version
  where lesson_id = target_lesson_id;

  insert into public.change_events(
    family_id, student_id, subject_id, entity_type, entity_id, event_type,
    before_value, after_value, actor_id, idempotency_key
  ) values (
    lesson_row.family_id, lesson_row.student_id, lesson_row.subject_id,
    'prestudy_lesson', lesson_row.id::text, 'prestudy_validated',
    jsonb_build_object('version', execution_row.version),
    jsonb_build_object(
      'version', next_version,
      'actual_question_count', target_actual_question_count,
      'unmastered_count', requested_knowledge_count + cardinality(coalesce(target_custom_unmastered, '{}'::text[]))
    ),
    auth.uid(), target_idempotency_key
  );
  perform public.notify_prestudy_audience(
    lesson_row.id, 'prestudy_validated', '预习已验收', lesson_row.title
  );
  return next_version;
end;
$$;

create or replace function public.revoke_prestudy_state(
  target_lesson_id uuid,
  target_state text,
  change_reason text,
  expected_version integer,
  target_idempotency_key uuid
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  lesson_row public.prestudy_lessons%rowtype;
  execution_row public.prestudy_execution_records%rowtype;
  prior_version integer;
  next_version integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if target_state not in ('led', 'validated') then raise exception 'state must be led or validated'; end if;
  if nullif(trim(change_reason), '') is null then raise exception 'reason required'; end if;
  if expected_version is null or expected_version < 1 then raise exception 'expected version required'; end if;
  if target_idempotency_key is null then raise exception 'idempotency key required'; end if;

  select (after_value ->> 'version')::integer into prior_version
  from public.change_events
  where actor_id = auth.uid() and idempotency_key = target_idempotency_key;
  if prior_version is not null then return prior_version; end if;

  select * into lesson_row from public.prestudy_lessons where id = target_lesson_id for update;
  if lesson_row.id is null or not public.is_subject_tutor(lesson_row.student_id, lesson_row.subject_id) then
    raise exception 'subject tutor access required';
  end if;
  select * into execution_row from public.prestudy_execution_records
  where lesson_id = target_lesson_id for update;
  if execution_row.lesson_id is null or execution_row.version <> expected_version then
    raise exception 'version conflict';
  end if;

  next_version := execution_row.version + 1;
  if target_state = 'validated' then
    if execution_row.validated_at is null then raise exception 'prestudy lesson is not validated'; end if;
    update public.prestudy_execution_records
    set validated_at = null, validated_by = null, version = next_version
    where lesson_id = target_lesson_id;
  else
    if execution_row.led_at is null then raise exception 'prestudy lesson is not led'; end if;
    update public.prestudy_execution_records
    set led_at = null, led_by = null, validated_at = null, validated_by = null,
        version = next_version
    where lesson_id = target_lesson_id;
  end if;

  insert into public.change_events(
    family_id, student_id, subject_id, entity_type, entity_id, event_type,
    before_value, after_value, reason, actor_id, idempotency_key
  ) values (
    lesson_row.family_id, lesson_row.student_id, lesson_row.subject_id,
    'prestudy_lesson', lesson_row.id::text, 'prestudy_' || target_state || '_revoked',
    jsonb_build_object('version', execution_row.version),
    jsonb_build_object('version', next_version), trim(change_reason),
    auth.uid(), target_idempotency_key
  );
  perform public.notify_prestudy_audience(
    lesson_row.id, 'prestudy_revoked', '预习状态已撤销', trim(change_reason)
  );
  return next_version;
end;
$$;

create or replace function public.move_prestudy_lesson(
  target_lesson_id uuid,
  target_planned_date date,
  change_reason text,
  expected_version integer,
  target_idempotency_key uuid
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  lesson_row public.prestudy_lessons%rowtype;
  prior_version integer;
  next_version integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if target_planned_date is null then raise exception 'planned date required'; end if;
  if target_planned_date = date '2026-08-12' then raise exception '2026-08-12 is a travel day without tutor lessons'; end if;
  if nullif(trim(change_reason), '') is null then raise exception 'reason required'; end if;
  if expected_version is null or expected_version < 1 then raise exception 'expected version required'; end if;
  if target_idempotency_key is null then raise exception 'idempotency key required'; end if;

  select (after_value ->> 'version')::integer into prior_version
  from public.change_events
  where actor_id = auth.uid() and idempotency_key = target_idempotency_key;
  if prior_version is not null then return prior_version; end if;

  select * into lesson_row from public.prestudy_lessons where id = target_lesson_id for update;
  if lesson_row.id is null or not public.is_subject_tutor(lesson_row.student_id, lesson_row.subject_id) then
    raise exception 'subject tutor access required';
  end if;
  if lesson_row.version <> expected_version then raise exception 'version conflict'; end if;
  if not exists (
    select 1 from public.prestudy_course_slots slot
    where slot.student_id = lesson_row.student_id
      and slot.subject_id = lesson_row.subject_id
      and slot.course_date = target_planned_date
      and slot.tutor_lane = lesson_row.tutor_lane
      and slot.active
  ) then raise exception 'active tutor course slot required'; end if;

  next_version := lesson_row.version + 1;
  update public.prestudy_lessons
  set planned_date = target_planned_date,
      schedule_adjustment_reason = trim(change_reason),
      assigned_tutor_user_id = auth.uid(),
      version = next_version
  where id = target_lesson_id;

  insert into public.change_events(
    family_id, student_id, subject_id, entity_type, entity_id, event_type,
    before_value, after_value, reason, actor_id, idempotency_key
  ) values (
    lesson_row.family_id, lesson_row.student_id, lesson_row.subject_id,
    'prestudy_lesson', lesson_row.id::text, 'prestudy_moved',
    jsonb_build_object('planned_date', lesson_row.planned_date, 'version', lesson_row.version),
    jsonb_build_object('planned_date', target_planned_date, 'version', next_version),
    trim(change_reason), auth.uid(), target_idempotency_key
  );
  perform public.notify_prestudy_audience(
    lesson_row.id, 'prestudy_moved', '家教已调整预习日期', trim(change_reason)
  );
  return next_version;
end;
$$;

create or replace view public.prestudy_lesson_overview
with (security_invoker = true)
as
select
  lesson.*,
  case
    when execution.validated_at is not null then 'validated'
    when execution.led_at is not null then 'led'
    else 'pending'
  end as prestudy_state,
  execution.led_at,
  execution.led_by,
  execution.validated_at,
  execution.validated_by,
  execution.actual_question_count,
  coalesce(execution.version, 0) as execution_version
from public.prestudy_lessons lesson
left join public.prestudy_execution_records execution on execution.lesson_id = lesson.id;

alter table public.prestudy_course_slots enable row level security;
alter table public.prestudy_lessons enable row level security;
alter table public.prestudy_knowledge_items enable row level security;
alter table public.prestudy_execution_records enable row level security;
alter table public.prestudy_unmastered_items enable row level security;

drop policy if exists prestudy_course_slots_select_authorized on public.prestudy_course_slots;
create policy prestudy_course_slots_select_authorized
on public.prestudy_course_slots for select to authenticated
using (
  public.is_family_parent(family_id)
  or public.is_student_owner(student_id)
  or public.is_subject_tutor(student_id, subject_id)
);

drop policy if exists prestudy_lessons_select_authorized on public.prestudy_lessons;
create policy prestudy_lessons_select_authorized
on public.prestudy_lessons for select to authenticated
using (public.can_access_prestudy_lesson(id));

drop policy if exists prestudy_knowledge_select_authorized on public.prestudy_knowledge_items;
create policy prestudy_knowledge_select_authorized
on public.prestudy_knowledge_items for select to authenticated
using (public.can_access_prestudy_lesson(lesson_id));

drop policy if exists prestudy_execution_select_authorized on public.prestudy_execution_records;
create policy prestudy_execution_select_authorized
on public.prestudy_execution_records for select to authenticated
using (public.can_access_prestudy_lesson(lesson_id));

drop policy if exists prestudy_unmastered_select_authorized on public.prestudy_unmastered_items;
create policy prestudy_unmastered_select_authorized
on public.prestudy_unmastered_items for select to authenticated
using (public.can_access_prestudy_lesson(lesson_id));

revoke all on table public.prestudy_course_slots from public, anon, authenticated;
revoke all on table public.prestudy_lessons from public, anon, authenticated;
revoke all on table public.prestudy_knowledge_items from public, anon, authenticated;
revoke all on table public.prestudy_execution_records from public, anon, authenticated;
revoke all on table public.prestudy_unmastered_items from public, anon, authenticated;
grant select on table public.prestudy_course_slots to authenticated;
grant select on table public.prestudy_lessons to authenticated;
grant select on table public.prestudy_knowledge_items to authenticated;
grant select on table public.prestudy_execution_records to authenticated;
grant select on table public.prestudy_unmastered_items to authenticated;
grant select on table public.prestudy_lesson_overview to authenticated;
grant all on table public.prestudy_course_slots to service_role;
grant all on table public.prestudy_lessons to service_role;
grant all on table public.prestudy_knowledge_items to service_role;
grant all on table public.prestudy_execution_records to service_role;
grant all on table public.prestudy_unmastered_items to service_role;

revoke all on function public.can_access_prestudy_lesson(uuid) from public, anon;
grant execute on function public.can_access_prestudy_lesson(uuid) to authenticated;
revoke all on function public.notify_prestudy_audience(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.mark_prestudy_led(uuid, integer, uuid) from public, anon;
grant execute on function public.mark_prestudy_led(uuid, integer, uuid) to authenticated;
revoke all on function public.validate_prestudy_lesson(uuid, integer, uuid[], text[], integer, uuid) from public, anon;
grant execute on function public.validate_prestudy_lesson(uuid, integer, uuid[], text[], integer, uuid) to authenticated;
revoke all on function public.revoke_prestudy_state(uuid, text, text, integer, uuid) from public, anon;
grant execute on function public.revoke_prestudy_state(uuid, text, text, integer, uuid) to authenticated;
revoke all on function public.move_prestudy_lesson(uuid, date, text, integer, uuid) from public, anon;
grant execute on function public.move_prestudy_lesson(uuid, date, text, integer, uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = 'prestudy_execution_records'
    ) then
      alter publication supabase_realtime add table public.prestudy_execution_records;
    end if;
  end if;
end $$;
