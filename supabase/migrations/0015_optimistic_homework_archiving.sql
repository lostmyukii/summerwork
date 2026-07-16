drop function if exists public.set_homework_archived(uuid, boolean, text);

create function public.set_homework_archived(
  target_homework_id uuid,
  archive_value boolean,
  change_reason text,
  expected_version integer,
  target_idempotency_key uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
declare homework_row public.homeworks%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if nullif(trim(change_reason), '') is null then raise exception 'reason required'; end if;
  if target_idempotency_key is null then raise exception 'idempotency key required'; end if;
  if exists (
    select 1 from public.change_events
    where actor_id = auth.uid() and idempotency_key = target_idempotency_key
  ) then return; end if;
  select * into homework_row from public.homeworks where id = target_homework_id and deleted_at is null for update;
  if homework_row.id is null or not public.is_family_parent(homework_row.family_id) then raise exception 'parent access required'; end if;
  if homework_row.version <> expected_version then raise exception 'version conflict'; end if;
  if archive_value and homework_row.status = 'archived' then raise exception 'homework already archived'; end if;
  if not archive_value and homework_row.status = 'active' then raise exception 'homework already active'; end if;

  update public.homeworks set
    status = case when archive_value then 'archived'::public.homework_status else 'active'::public.homework_status end,
    version = version + 1, updated_by = auth.uid()
  where id = target_homework_id;
  update public.homework_tasks set
    deleted_at = case when archive_value then now() else null end,
    deleted_by = case when archive_value then auth.uid() else null end,
    version = version + 1, updated_by = auth.uid()
  where homework_id = target_homework_id;
  insert into public.change_events(
    family_id, student_id, subject_id, entity_type, entity_id, event_type,
    before_value, after_value, reason, actor_id, idempotency_key
  ) values (
    homework_row.family_id, homework_row.student_id, homework_row.subject_id,
    'homework', homework_row.id::text,
    case when archive_value then 'archived' else 'restored' end,
    jsonb_build_object('status', homework_row.status, 'version', homework_row.version),
    jsonb_build_object('status', case when archive_value then 'archived' else 'active' end, 'version', homework_row.version + 1),
    trim(change_reason), auth.uid(), target_idempotency_key
  );
end;
$$;

revoke all on function public.set_homework_archived(uuid, boolean, text, integer, uuid) from public;
grant execute on function public.set_homework_archived(uuid, boolean, text, integer, uuid) to authenticated;
