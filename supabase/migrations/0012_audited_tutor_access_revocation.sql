-- Identity writes that change authorization must go through explicit commands.
create or replace function public.revoke_tutor_access(
  target_assignment_id uuid,
  revoke_reason text,
  target_idempotency_key uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  assignment_row public.tutor_assignments%rowtype;
  effective_end timestamptz;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if nullif(trim(revoke_reason), '') is null then raise exception 'revoke reason required'; end if;
  if target_idempotency_key is null then raise exception 'idempotency key required'; end if;
  if exists (
    select 1 from public.change_events
    where actor_id = auth.uid() and idempotency_key = target_idempotency_key
  ) then return; end if;

  select * into assignment_row
  from public.tutor_assignments
  where id = target_assignment_id
  for update;
  if assignment_row.id is null or not public.is_family_parent(assignment_row.family_id) then
    raise exception 'parent access required';
  end if;
  if assignment_row.ends_at is not null and assignment_row.ends_at <= now() then
    raise exception 'tutor assignment already revoked';
  end if;

  effective_end := greatest(now(), assignment_row.starts_at + interval '1 millisecond');
  update public.tutor_assignments
  set ends_at = effective_end
  where id = assignment_row.id;

  if not exists (
    select 1 from public.tutor_assignments other_assignment
    where other_assignment.family_id = assignment_row.family_id
      and other_assignment.tutor_user_id = assignment_row.tutor_user_id
      and other_assignment.id <> assignment_row.id
      and other_assignment.starts_at <= effective_end
      and (other_assignment.ends_at is null or other_assignment.ends_at > effective_end)
  ) then
    update public.family_memberships
    set removed_at = effective_end
    where family_id = assignment_row.family_id
      and user_id = assignment_row.tutor_user_id
      and role = 'tutor'
      and removed_at is null;
  end if;

  insert into public.change_events(
    family_id, student_id, subject_id, entity_type, entity_id, event_type,
    before_value, after_value, reason, actor_id, idempotency_key
  ) values (
    assignment_row.family_id, assignment_row.student_id, assignment_row.subject_id,
    'tutor_assignment', assignment_row.id::text, 'tutor_access_revoked',
    jsonb_build_object('ends_at', assignment_row.ends_at, 'tutor_user_id', assignment_row.tutor_user_id),
    jsonb_build_object('ends_at', effective_end, 'tutor_user_id', assignment_row.tutor_user_id),
    trim(revoke_reason), auth.uid(), target_idempotency_key
  );

  insert into public.notifications(
    family_id, student_id, subject_id, recipient_id, notification_type,
    title, body, entity_type, entity_id
  ) values (
    assignment_row.family_id, assignment_row.student_id, assignment_row.subject_id,
    assignment_row.tutor_user_id, 'permission_revoked', '本科家教权限已撤销',
    trim(revoke_reason), 'tutor_assignment', assignment_row.id::text
  );
end;
$$;

revoke insert, update, delete on public.tutor_assignments from authenticated;
revoke insert, update, delete on public.family_memberships from authenticated;
revoke insert, update, delete on public.invitations from authenticated;
grant select on public.tutor_assignments to authenticated;
grant select on public.family_memberships to authenticated;
grant select on public.invitations to authenticated;
revoke all on function public.revoke_tutor_access(uuid, text, uuid) from public;
grant execute on function public.revoke_tutor_access(uuid, text, uuid) to authenticated;
