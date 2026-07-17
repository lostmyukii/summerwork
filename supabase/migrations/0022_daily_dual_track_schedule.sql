alter table public.prestudy_lessons
  add column if not exists active boolean not null default true,
  add column if not exists archived_at timestamptz,
  add column if not exists archival_reason text not null default '';

create index if not exists prestudy_lessons_active_student_date_idx
on public.prestudy_lessons(student_id, planned_date, subject_id) where active;

create table if not exists public.study_blocks (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  family_id uuid not null references public.family_spaces(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id text not null references public.subjects(id),
  planned_date date not null,
  block_kind text not null check (block_kind in ('tutor_homework', 'travel_independent')),
  tutor_lane text not null check (tutor_lane in ('本科', '考背', '生物课内共享', '旅行自主')),
  title text not null,
  capacity_minutes smallint not null check (capacity_minutes between 15 and 240),
  estimated_minutes smallint not null check (estimated_minutes between 0 and 1440),
  overflow_minutes smallint not null default 0 check (overflow_minutes >= 0),
  supplement_minutes smallint not null default 0 check (supplement_minutes in (0, 60)),
  fallback_date date,
  active boolean not null default true,
  source_reference text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(student_id, source_key),
  check ((block_kind = 'travel_independent' and fallback_date is not null) or block_kind = 'tutor_homework')
);

create table if not exists public.study_block_items (
  block_id uuid not null references public.study_blocks(id) on delete cascade,
  task_id uuid not null references public.homework_tasks(id) on delete cascade,
  sort_order smallint not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  primary key (block_id, task_id),
  unique(task_id)
);

create index if not exists study_blocks_student_date_idx
on public.study_blocks(student_id, planned_date, subject_id) where active;

create index if not exists study_block_items_task_idx
on public.study_block_items(task_id);

drop trigger if exists study_blocks_set_updated_at on public.study_blocks;
create trigger study_blocks_set_updated_at
before update on public.study_blocks
for each row execute function public.set_updated_at();

create or replace function public.can_access_study_block(target_block_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.study_blocks block
    where block.id = target_block_id and block.active
      and (
        public.is_family_parent(block.family_id)
        or public.is_student_owner(block.student_id)
        or public.is_subject_tutor(block.student_id, block.subject_id)
      )
  );
$$;

drop view if exists public.prestudy_lesson_overview;
create view public.prestudy_lesson_overview
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
left join public.prestudy_execution_records execution on execution.lesson_id = lesson.id
where lesson.active;

create or replace view public.study_block_overview
with (security_invoker = true)
as
select
  block.*,
  count(item.task_id)::integer as task_count
from public.study_blocks block
left join public.study_block_items item on item.block_id = block.id
where block.active
group by block.id;

alter table public.study_blocks enable row level security;
alter table public.study_block_items enable row level security;

drop policy if exists study_blocks_select_authorized on public.study_blocks;
create policy study_blocks_select_authorized
on public.study_blocks for select to authenticated
using (public.can_access_study_block(id));

drop policy if exists study_block_items_select_authorized on public.study_block_items;
create policy study_block_items_select_authorized
on public.study_block_items for select to authenticated
using (public.can_access_study_block(block_id));

revoke all on table public.study_blocks from public, anon, authenticated;
revoke all on table public.study_block_items from public, anon, authenticated;
grant select on table public.study_blocks to authenticated;
grant select on table public.study_block_items to authenticated;
grant select on table public.study_block_overview to authenticated;
grant select on table public.prestudy_lesson_overview to authenticated;
grant all on table public.study_blocks to service_role;
grant all on table public.study_block_items to service_role;

revoke all on function public.can_access_study_block(uuid) from public, anon;
grant execute on function public.can_access_study_block(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = 'study_blocks'
    ) then
      alter publication supabase_realtime add table public.study_blocks;
    end if;
  end if;
end;
$$;
