alter table public.homeworks add column if not exists catalog_version integer;
alter table public.homeworks add column if not exists catalog_source_digest text;

update public.homeworks homework
set catalog_version = catalog.version,
    catalog_source_digest = catalog.source_digest
from public.plan_catalogs catalog
where homework.catalog_id = catalog.id
  and (homework.catalog_version is null or homework.catalog_source_digest is null);

create or replace function public.stamp_homework_catalog_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  catalog_row public.plan_catalogs%rowtype;
begin
  if new.catalog_id is null then return new; end if;
  select * into catalog_row from public.plan_catalogs where id = new.catalog_id;
  if catalog_row.id is null then raise exception 'plan catalog not found'; end if;
  if new.catalog_version is null then new.catalog_version := catalog_row.version; end if;
  if new.catalog_source_digest is null then new.catalog_source_digest := catalog_row.source_digest; end if;
  return new;
end;
$$;

drop trigger if exists homeworks_stamp_catalog_snapshot on public.homeworks;
create trigger homeworks_stamp_catalog_snapshot
before insert on public.homeworks
for each row execute function public.stamp_homework_catalog_snapshot();

create or replace view public.student_plan_version_status
with (security_invoker = true)
as
select
  homework.student_id,
  homework.catalog_id,
  min(homework.catalog_version) as applied_version,
  catalog.version as available_version,
  min(homework.catalog_source_digest) as applied_source_digest,
  catalog.source_digest as available_source_digest,
  bool_or(
    homework.catalog_version is distinct from catalog.version
    or homework.catalog_source_digest is distinct from catalog.source_digest
  ) as update_available
from public.homeworks homework
join public.plan_catalogs catalog on catalog.id = homework.catalog_id
where homework.deleted_at is null and homework.catalog_id is not null
group by homework.student_id, homework.catalog_id, catalog.version, catalog.source_digest;

revoke all on function public.stamp_homework_catalog_snapshot() from public;
grant select on public.student_plan_version_status to authenticated;
