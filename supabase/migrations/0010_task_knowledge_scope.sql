create table if not exists public.task_knowledge_links (
  task_id uuid not null references public.homework_tasks(id) on delete cascade,
  knowledge_node_id uuid not null references public.knowledge_nodes(id) on delete restrict,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key(task_id, knowledge_node_id)
);

create index if not exists task_knowledge_links_node_idx on public.task_knowledge_links(knowledge_node_id, task_id);

create or replace function public.sync_task_knowledge_links(target_task_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  task_row public.homework_tasks%rowtype;
  inserted_count integer := 0;
begin
  select * into task_row from public.homework_tasks where id = target_task_id;
  if task_row.id is null or task_row.homework_version_id is null then return 0; end if;

  insert into public.task_knowledge_links(task_id, knowledge_node_id, created_by)
  select task_row.id, link.knowledge_node_id, coalesce(task_row.updated_by, task_row.created_by)
  from public.homework_knowledge_links link
  join public.knowledge_nodes node on node.id = link.knowledge_node_id
  where link.homework_version_id = task_row.homework_version_id
    and (
      cardinality(task_row.knowledge_tags) = 0
      or node.knowledge_key = any (
        select lower(trim(tag)) from unnest(task_row.knowledge_tags) tag
      )
    )
  on conflict (task_id, knowledge_node_id) do nothing;
  get diagnostics inserted_count = row_count;

  if not exists (select 1 from public.task_knowledge_links where task_id = task_row.id) then
    insert into public.task_knowledge_links(task_id, knowledge_node_id, created_by)
    select task_row.id, link.knowledge_node_id, coalesce(task_row.updated_by, task_row.created_by)
    from public.homework_knowledge_links link
    where link.homework_version_id = task_row.homework_version_id
    on conflict (task_id, knowledge_node_id) do nothing;
    get diagnostics inserted_count = row_count;
  end if;
  return inserted_count;
end;
$$;

create or replace function public.sync_inserted_task_knowledge()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.sync_task_knowledge_links(new.id);
  return new;
end;
$$;

drop trigger if exists homework_tasks_sync_knowledge_links on public.homework_tasks;
create trigger homework_tasks_sync_knowledge_links
after insert or update of homework_version_id, knowledge_tags on public.homework_tasks
for each row execute function public.sync_inserted_task_knowledge();

do $$
declare target_task_id uuid;
begin
  for target_task_id in select id from public.homework_tasks loop
    perform public.sync_task_knowledge_links(target_task_id);
  end loop;
end $$;

alter table public.task_knowledge_links enable row level security;
create policy task_knowledge_links_select_authorized on public.task_knowledge_links
for select to authenticated using (public.can_access_task(task_id));
revoke all on public.task_knowledge_links from authenticated;
grant select on public.task_knowledge_links to authenticated;
revoke all on function public.sync_task_knowledge_links(uuid) from public;
revoke all on function public.sync_inserted_task_knowledge() from public;
