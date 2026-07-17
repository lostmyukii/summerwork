create table if not exists public.task_travel_recovery_schedules (
  task_id uuid primary key references public.homework_tasks(id) on delete cascade,
  original_planned_date date not null,
  travel_date date not null,
  fallback_date date not null,
  planned_minutes integer not null default 90 check (planned_minutes between 1 and 240),
  original_purpose text not null,
  current_purpose text not null,
  released_at timestamptz,
  released_by uuid references auth.users(id),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fallback_date >= travel_date)
);

create table if not exists public.task_travel_recovery_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.homework_tasks(id) on delete cascade,
  event_type text not null check (event_type in ('configured', 'reassigned', 'released')),
  old_travel_date date,
  new_travel_date date,
  old_fallback_date date,
  new_fallback_date date,
  old_purpose text,
  new_purpose text,
  reason text not null,
  actor_id uuid references auth.users(id),
  idempotency_key uuid,
  schedule_version integer not null,
  occurred_at timestamptz not null default now(),
  unique(actor_id, idempotency_key)
);

create index if not exists task_travel_recovery_fallback_idx
on public.task_travel_recovery_schedules(fallback_date, travel_date);

create index if not exists task_travel_recovery_events_task_idx
on public.task_travel_recovery_events(task_id, occurred_at desc);

alter table public.task_travel_recovery_schedules enable row level security;
alter table public.task_travel_recovery_events enable row level security;

drop policy if exists travel_recovery_schedule_select_authorized on public.task_travel_recovery_schedules;
create policy travel_recovery_schedule_select_authorized
on public.task_travel_recovery_schedules for select to authenticated
using (public.can_access_task(task_id));

drop policy if exists travel_recovery_events_select_authorized on public.task_travel_recovery_events;
create policy travel_recovery_events_select_authorized
on public.task_travel_recovery_events for select to authenticated
using (public.can_access_task(task_id));

create or replace function public.set_travel_recovery_schedule(
  target_task_id uuid,
  target_travel_date date,
  target_fallback_date date,
  target_planned_minutes integer,
  target_new_purpose text,
  change_reason text,
  expected_version integer,
  target_idempotency_key uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.homework_tasks%rowtype;
  schedule_row public.task_travel_recovery_schedules%rowtype;
  event_version integer;
  next_version integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if target_travel_date is null or target_fallback_date is null then raise exception 'travel and fallback dates required'; end if;
  if target_fallback_date < target_travel_date then raise exception 'fallback date must not precede travel date'; end if;
  if target_planned_minutes is null or target_planned_minutes not between 1 and 240 then raise exception 'planned minutes out of range'; end if;
  if nullif(trim(target_new_purpose), '') is null then raise exception 'new purpose required'; end if;
  if nullif(trim(change_reason), '') is null then raise exception 'change reason required'; end if;
  if expected_version is null or expected_version < 0 then raise exception 'expected version required'; end if;
  if target_idempotency_key is null then raise exception 'idempotency key required'; end if;

  select schedule_version into event_version
  from public.task_travel_recovery_events
  where actor_id = auth.uid() and idempotency_key = target_idempotency_key;
  if event_version is not null then return event_version; end if;

  select * into task_row
  from public.homework_tasks
  where id = target_task_id and deleted_at is null
  for update;
  if task_row.id is null or not public.is_task_tutor(task_row.id) then raise exception 'subject tutor access required'; end if;

  select * into schedule_row
  from public.task_travel_recovery_schedules
  where task_id = target_task_id
  for update;

  if schedule_row.task_id is null then
    if expected_version <> 0 then raise exception 'version conflict'; end if;
    insert into public.task_travel_recovery_schedules(
      task_id, original_planned_date, travel_date, fallback_date, planned_minutes,
      original_purpose, current_purpose, created_by
    ) values (
      task_row.id, task_row.original_date, target_travel_date, target_fallback_date,
      target_planned_minutes, task_row.slot_type, trim(target_new_purpose), auth.uid()
    );
    next_version := 1;
    insert into public.task_travel_recovery_events(
      task_id, event_type, new_travel_date, new_fallback_date, old_purpose,
      new_purpose, reason, actor_id, idempotency_key, schedule_version
    ) values (
      task_row.id, 'configured', target_travel_date, target_fallback_date,
      task_row.slot_type, trim(target_new_purpose), trim(change_reason), auth.uid(),
      target_idempotency_key, next_version
    );
  else
    if schedule_row.version <> expected_version then raise exception 'version conflict'; end if;
    next_version := schedule_row.version + 1;
    update public.task_travel_recovery_schedules
    set travel_date = target_travel_date,
        fallback_date = target_fallback_date,
        planned_minutes = target_planned_minutes,
        current_purpose = trim(target_new_purpose),
        version = next_version,
        updated_at = now()
    where task_id = target_task_id;
    insert into public.task_travel_recovery_events(
      task_id, event_type, old_travel_date, new_travel_date,
      old_fallback_date, new_fallback_date, old_purpose, new_purpose,
      reason, actor_id, idempotency_key, schedule_version
    ) values (
      task_row.id, 'reassigned', schedule_row.travel_date, target_travel_date,
      schedule_row.fallback_date, target_fallback_date, schedule_row.current_purpose,
      trim(target_new_purpose), trim(change_reason), auth.uid(),
      target_idempotency_key, next_version
    );
  end if;

  perform public.notify_task_audience(
    task_row.id,
    'parent',
    'plan_changed',
    '家教已调整旅行作业补位',
    trim(change_reason)
  );
  return next_version;
end;
$$;

create or replace function public.release_travel_recovery_on_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  schedule_row public.task_travel_recovery_schedules%rowtype;
  next_version integer;
begin
  if new.run_state <> 'completed' then return new; end if;
  select * into schedule_row
  from public.task_travel_recovery_schedules
  where task_id = new.task_id
  for update;
  if schedule_row.task_id is null or schedule_row.released_at is not null then return new; end if;

  next_version := schedule_row.version + 1;
  update public.task_travel_recovery_schedules
  set released_at = coalesce(new.completed_at, now()),
      released_by = auth.uid(),
      version = next_version,
      updated_at = now()
  where task_id = new.task_id;

  insert into public.task_travel_recovery_events(
    task_id, event_type, old_travel_date, new_travel_date,
    old_fallback_date, new_fallback_date, old_purpose, new_purpose,
    reason, actor_id, schedule_version
  ) values (
    new.task_id, 'released', schedule_row.travel_date, schedule_row.travel_date,
    schedule_row.fallback_date, null, schedule_row.current_purpose,
    '旅行任务已完成，补位释放', '孩子完成首做', auth.uid(), next_version
  );
  return new;
end;
$$;

drop trigger if exists student_activity_release_travel_recovery on public.student_task_activity;
create trigger student_activity_release_travel_recovery
after insert or update of run_state, completed_at on public.student_task_activity
for each row execute function public.release_travel_recovery_on_completion();

create or replace view public.task_travel_recovery_status
with (security_invoker = true)
as
select
  schedule.task_id,
  schedule.original_planned_date,
  schedule.travel_date,
  schedule.fallback_date,
  schedule.planned_minutes,
  schedule.original_purpose,
  schedule.current_purpose,
  case
    when schedule.released_at is not null then schedule.planned_minutes
    else least(schedule.planned_minutes, floor(coalesce(workflow.actual_seconds, 0) / 60.0)::integer)
  end as completed_minutes,
  case
    when schedule.released_at is not null then 0
    else greatest(0, schedule.planned_minutes - floor(coalesce(workflow.actual_seconds, 0) / 60.0)::integer)
  end as remaining_minutes,
  case
    when schedule.released_at is not null then 'released'
    when current_date > schedule.fallback_date then 'overdue_recovery'
    when current_date >= schedule.fallback_date then 'recovery'
    when coalesce(workflow.actual_seconds, 0) > 0 then 'partial'
    else 'soft'
  end as recovery_state,
  schedule.released_at,
  schedule.released_by,
  schedule.version,
  schedule.updated_at
from public.task_travel_recovery_schedules schedule
left join public.task_workflow_current workflow on workflow.task_id = schedule.task_id;

revoke all on table public.task_travel_recovery_schedules from public, anon, authenticated;
revoke all on table public.task_travel_recovery_events from public, anon, authenticated;
grant select on table public.task_travel_recovery_schedules to authenticated;
grant select on table public.task_travel_recovery_events to authenticated;
grant select on table public.task_travel_recovery_status to authenticated;

revoke all on function public.set_travel_recovery_schedule(uuid, date, date, integer, text, text, integer, uuid) from public, anon;
grant execute on function public.set_travel_recovery_schedule(uuid, date, date, integer, text, text, integer, uuid) to authenticated;
revoke all on function public.release_travel_recovery_on_completion() from public, anon, authenticated;
