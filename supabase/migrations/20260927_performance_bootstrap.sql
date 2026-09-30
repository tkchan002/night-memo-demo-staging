-- Night Memo performance bootstrap RPCs
--
-- Purpose:
--   * Ward page: one round trip for operational status, capacity, report items,
--     active staff and the selected report.
--   * Manager page: one round trip for open wards, capacities, reports and
--     report-item definitions for a date.
--
-- Both functions are SECURITY INVOKER, so the caller's existing RLS policies
-- continue to apply. No service-role privileges are introduced.

create index if not exists idx_nightmemo_ward_period_lookup
  on public.ward_operating_periods (ward_id, start_date, end_date);

create index if not exists idx_nightmemo_capacity_lookup
  on public.ward_capacity_history (ward_id, effective_from desc, effective_to);

create index if not exists idx_nightmemo_reports_date_ward
  on public.ward_reports (report_date, ward_id);

create index if not exists idx_nightmemo_staff_ward_active
  on public.ward_staff (ward_id, active);


create or replace function public.get_maintenance_wards_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'wards', coalesce((
      select jsonb_agg(to_jsonb(w) order by w.display_order, w.name)
      from public.wards w
    ), '[]'::jsonb),
    'periods', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.start_date desc)
      from public.ward_operating_periods p
    ), '[]'::jsonb)
  );
$$;

create or replace function public.get_ward_night_context(
  p_ward_id uuid,
  p_date date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with selected_capacity as (
    select c.bed_capacity
    from public.ward_capacity_history c
    where c.ward_id = p_ward_id
      and c.effective_from <= p_date
      and (c.effective_to is null or c.effective_to >= p_date)
    order by c.effective_from desc
    limit 1
  )
  select jsonb_build_object(
    'operational', exists (
      select 1
      from public.ward_operating_periods p
      where p.ward_id = p_ward_id
        and p.start_date <= p_date
        and (p.end_date is null or p.end_date >= p_date)
    ),
    'capacity', coalesce((select bed_capacity from selected_capacity), 0),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.sort_order)
      from public.report_items i
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(to_jsonb(s) order by coalesce(s.display_order, 0), s.name)
      from public.ward_staff s
      where s.ward_id = p_ward_id
        and s.active = true
    ), '[]'::jsonb),
    'report', (
      select to_jsonb(r)
      from public.ward_reports r
      where r.ward_id = p_ward_id
        and r.report_date = p_date
      limit 1
    )
  );
$$;

create or replace function public.get_manager_night_snapshot(
  p_date date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with open_wards as (
    select w.*
    from public.wards w
    where exists (
      select 1
      from public.ward_operating_periods p
      where p.ward_id = w.id
        and p.start_date <= p_date
        and (p.end_date is null or p.end_date >= p_date)
    )
  ),
  selected_capacity as (
    select distinct on (c.ward_id)
      c.ward_id,
      c.bed_capacity
    from public.ward_capacity_history c
    join open_wards w on w.id = c.ward_id
    where c.effective_from <= p_date
      and (c.effective_to is null or c.effective_to >= p_date)
    order by c.ward_id, c.effective_from desc
  )
  select jsonb_build_object(
    'wards', coalesce((
      select jsonb_agg(to_jsonb(w) order by w.display_order, w.name)
      from open_wards w
    ), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(to_jsonb(r))
      from public.ward_reports r
      where r.report_date = p_date
    ), '[]'::jsonb),
    'capacities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ward_id', c.ward_id,
        'bed_capacity', c.bed_capacity
      ))
      from selected_capacity c
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.sort_order)
      from public.report_items i
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.get_maintenance_wards_snapshot() to authenticated;
grant execute on function public.get_ward_night_context(uuid, date) to authenticated;
grant execute on function public.get_manager_night_snapshot(date) to authenticated;
