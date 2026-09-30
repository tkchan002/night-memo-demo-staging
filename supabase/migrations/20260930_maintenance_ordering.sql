-- Maintenance ordering model
-- User-facing ordering is controlled only by Up / Down actions.
-- Numeric display_order / sort_order values remain internal implementation details.

begin;

-- Existing installations used sparse values such as 10, 20, 30 and a 999
-- catch-all. Normalize both lists once to simple sequential positions.
with ranked as (
  select id, row_number() over (order by display_order, name, id)::integer as position
  from public.wards
)
update public.wards w
set display_order = ranked.position
from ranked
where w.id = ranked.id
  and w.display_order is distinct from ranked.position;

with ranked as (
  select id, row_number() over (order by sort_order, section, key, id)::integer as position
  from public.report_items
)
update public.report_items i
set sort_order = ranked.position
from ranked
where i.id = ranked.id
  and i.sort_order is distinct from ranked.position;

-- New records no longer use 999. A zero default means "append me" and the
-- insert triggers assign the next real sequence position inside the database.
alter table public.wards alter column display_order set default 0;
alter table public.report_items alter column sort_order set default 0;

create or replace function public.assign_ward_display_order()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.display_order is null or new.display_order <= 0 or new.display_order = 999 then
    perform pg_advisory_xact_lock(92411, 1);
    select coalesce(max(display_order), 0) + 1
      into new.display_order
      from public.wards;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_wards_assign_display_order on public.wards;
create trigger trg_wards_assign_display_order
before insert on public.wards
for each row execute function public.assign_ward_display_order();

create or replace function public.assign_report_item_sort_order()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.sort_order is null or new.sort_order <= 0 or new.sort_order = 999 then
    perform pg_advisory_xact_lock(92411, 2);
    select coalesce(max(sort_order), 0) + 1
      into new.sort_order
      from public.report_items;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_report_items_assign_sort_order on public.report_items;
create trigger trg_report_items_assign_sort_order
before insert on public.report_items
for each row execute function public.assign_report_item_sort_order();

-- Reordering is atomic: the browser sends the complete ordered ID list and
-- PostgreSQL rewrites positions 1..N in one statement.
create or replace function public.reorder_wards(p_order uuid[])
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_total integer;
  v_unique integer;
begin
  if public.app_role() <> 'maintenance' then
    raise exception 'maintenance role required';
  end if;

  select count(*) into v_total from public.wards;
  select count(distinct id) into v_unique from unnest(coalesce(p_order, '{}'::uuid[])) as ids(id);

  if cardinality(coalesce(p_order, '{}'::uuid[])) <> v_total or v_unique <> v_total then
    raise exception 'ward order must contain every ward exactly once';
  end if;

  if exists (
    select 1
    from unnest(p_order) as requested(id)
    left join public.wards w on w.id = requested.id
    where w.id is null
  ) then
    raise exception 'ward order contains an unknown ward';
  end if;

  update public.wards w
  set display_order = requested.position::integer
  from unnest(p_order) with ordinality as requested(id, position)
  where w.id = requested.id;
end;
$$;

create or replace function public.reorder_report_items(p_order uuid[])
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_total integer;
  v_unique integer;
begin
  if public.app_role() <> 'maintenance' then
    raise exception 'maintenance role required';
  end if;

  select count(*) into v_total from public.report_items;
  select count(distinct id) into v_unique from unnest(coalesce(p_order, '{}'::uuid[])) as ids(id);

  if cardinality(coalesce(p_order, '{}'::uuid[])) <> v_total or v_unique <> v_total then
    raise exception 'report item order must contain every report item exactly once';
  end if;

  if exists (
    select 1
    from unnest(p_order) as requested(id)
    left join public.report_items i on i.id = requested.id
    where i.id is null
  ) then
    raise exception 'report item order contains an unknown report item';
  end if;

  update public.report_items i
  set sort_order = requested.position::integer
  from unnest(p_order) with ordinality as requested(id, position)
  where i.id = requested.id;
end;
$$;

revoke all on function public.reorder_wards(uuid[]) from public;
revoke all on function public.reorder_report_items(uuid[]) from public;
grant execute on function public.reorder_wards(uuid[]) to authenticated;
grant execute on function public.reorder_report_items(uuid[]) to authenticated;

commit;
