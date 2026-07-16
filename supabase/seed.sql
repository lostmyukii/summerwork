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
