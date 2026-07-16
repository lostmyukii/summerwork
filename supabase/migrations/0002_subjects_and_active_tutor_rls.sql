insert into public.subjects (id, name, color, sort_order, active) values
  ('chinese', '语文', '#ff375f', 10, true),
  ('math', '数学', '#007aff', 20, true),
  ('russian', '俄语', '#af52de', 30, true),
  ('physics', '物理', '#5856d6', 40, true),
  ('chemistry', '化学', '#ff9f0a', 50, true),
  ('biology', '生物', '#30b45b', 60, true)
on conflict (id) do update set
  name = excluded.name,
  color = excluded.color,
  sort_order = excluded.sort_order,
  active = excluded.active;

drop policy if exists tutor_assignments_select_authorized on public.tutor_assignments;
create policy tutor_assignments_select_authorized
on public.tutor_assignments
for select
to authenticated
using (
  public.is_family_parent(family_id)
  or (
    tutor_user_id = auth.uid()
    and starts_at <= now()
    and (ends_at is null or ends_at > now())
  )
);
