-- Let parents and the currently assigned subject tutor discover recoverable
-- soft-deleted plan blocks. Students must never see archived blocks, and all
-- mutations still go through the audited restore_plan_block RPC.
create or replace function public.can_access_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.homework_tasks task
    where task.id = target_task_id
      and (
        public.is_family_parent(task.family_id)
        or public.is_subject_tutor(task.student_id, task.subject_id)
        or (
          task.deleted_at is null
          and public.is_student_owner(task.student_id)
        )
      )
  );
$$;

revoke all on function public.can_access_task(uuid) from public;
grant execute on function public.can_access_task(uuid) to authenticated;
