-- Night Memo: multi-submission sessions + Manager current-window features
--
-- A ward may submit more than one memo on the same calendar date. A save within
-- the current 120-minute session updates that session; after the window expires,
-- the next save creates a new ward_reports row.
--
-- All functions remain SECURITY INVOKER so existing RLS policies continue to
-- apply to the authenticated caller.

alter table public.ward_reports
  add column if not exists report_item_snapshot jsonb;

alter table public.ward_reports
  add column if not exists submitted_at timestamptz;

update public.ward_reports
set submitted_at = coalesce(updated_at, created_at, now())
where submitted_at is null;

alter table public.ward_reports
  alter column submitted_at set default now();

alter table public.ward_reports
  alter column submitted_at set not null;

-- Remove the legacy one-report-per-ward-per-date uniqueness rule. The exact
-- constraint name can differ between Supabase projects, so identify it by its
-- definition rather than by a hard-coded name.
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'ward_reports'
      and c.contype = 'u'
      and replace(pg_get_constraintdef(c.oid), ' ', '') ilike 'UNIQUE(ward_id,report_date)%'
  loop
    execute format('alter table public.ward_reports drop constraint %I', r.conname);
  end loop;
end $$;

create index if not exists idx_nightmemo_reports_ward_submitted
  on public.ward_reports (ward_id, submitted_at desc);

create index if not exists idx_nightmemo_reports_submitted
  on public.ward_reports (submitted_at desc);

create index if not exists idx_nightmemo_reports_date_submitted
  on public.ward_reports (report_date, ward_id, submitted_at desc);


create or replace function public.save_ward_report_session(
  p_row jsonb,
  p_window_minutes integer default 120
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ward_id uuid := (p_row->>'ward_id')::uuid;
  v_report_date date := (p_row->>'report_date')::date;
  v_window integer := greatest(coalesce(p_window_minutes, 120), 1);
  v_existing_id uuid;
  v_result public.ward_reports;
begin
  if v_ward_id is null or v_report_date is null then
    raise exception 'ward_id and report_date are required';
  end if;

  -- Serialize saves for one ward so two workstations cannot both create a new
  -- session row at the same instant.
  perform pg_advisory_xact_lock(hashtextextended(v_ward_id::text, 0));

  select r.id
    into v_existing_id
  from public.ward_reports r
  where r.ward_id = v_ward_id
    and r.submitted_at >= now() - make_interval(mins => v_window)
  order by r.submitted_at desc
  limit 1
  for update;

  if v_existing_id is not null then
    update public.ward_reports
    set report_date = v_report_date,
        payload = coalesce(p_row->'payload', '{}'::jsonb),
        bed_capacity_snapshot = nullif(p_row->>'bed_capacity_snapshot', '')::integer,
        form_version = coalesce(nullif(p_row->>'form_version', '')::integer, 2),
        report_item_snapshot = case when p_row ? 'report_item_snapshot' then p_row->'report_item_snapshot' else report_item_snapshot end,
        submitted_at = now(),
        updated_at = now()
    where id = v_existing_id
    returning * into v_result;
  else
    insert into public.ward_reports (
      ward_id,
      report_date,
      payload,
      bed_capacity_snapshot,
      form_version,
      report_item_snapshot,
      submitted_at,
      updated_at
    ) values (
      v_ward_id,
      v_report_date,
      coalesce(p_row->'payload', '{}'::jsonb),
      nullif(p_row->>'bed_capacity_snapshot', '')::integer,
      coalesce(nullif(p_row->>'form_version', '')::integer, 2),
      p_row->'report_item_snapshot',
      now(),
      now()
    )
    returning * into v_result;
  end if;

  return to_jsonb(v_result);
end;
$$;


-- Redefine the fast Ward RPC so multiple same-date submissions return the most
-- recently submitted report rather than an arbitrary row.
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
      order by r.submitted_at desc
      limit 1
    )
  );
$$;


-- Keep the historical/date Manager RPC deterministic when a date contains more
-- than one submission for a ward.
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
  ),
  latest_reports as (
    select distinct on (r.ward_id) r.*
    from public.ward_reports r
    where r.report_date = p_date
    order by r.ward_id, r.submitted_at desc
  )
  select jsonb_build_object(
    'wards', coalesce((select jsonb_agg(to_jsonb(w) order by w.display_order, w.name) from open_wards w), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(r)) from latest_reports r), '[]'::jsonb),
    'capacities', coalesce((
      select jsonb_agg(jsonb_build_object('ward_id', c.ward_id, 'bed_capacity', c.bed_capacity))
      from selected_capacity c
    ), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order) from public.report_items i), '[]'::jsonb)
  );
$$;


-- Current Manager summary: all currently open wards, but only a report submitted
-- within the requested rolling window counts as Submitted.
create or replace function public.get_manager_recent_snapshot(
  p_window_minutes integer default 120
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      greatest(coalesce(p_window_minutes, 120), 1) as window_minutes,
      (now() at time zone 'Asia/Hong_Kong')::date as hk_date
  ),
  open_wards as (
    select w.*
    from public.wards w, params x
    where exists (
      select 1
      from public.ward_operating_periods p
      where p.ward_id = w.id
        and p.start_date <= x.hk_date
        and (p.end_date is null or p.end_date >= x.hk_date)
    )
  ),
  recent_reports as (
    select distinct on (r.ward_id) r.*
    from public.ward_reports r
    join open_wards w on w.id = r.ward_id
    cross join params x
    where r.submitted_at >= now() - make_interval(mins => x.window_minutes)
    order by r.ward_id, r.submitted_at desc
  ),
  selected_capacity as (
    select distinct on (c.ward_id)
      c.ward_id,
      c.bed_capacity
    from public.ward_capacity_history c
    join open_wards w on w.id = c.ward_id
    cross join params x
    where c.effective_from <= x.hk_date
      and (c.effective_to is null or c.effective_to >= x.hk_date)
    order by c.ward_id, c.effective_from desc
  )
  select jsonb_build_object(
    'wards', coalesce((select jsonb_agg(to_jsonb(w) order by w.display_order, w.name) from open_wards w), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(r) order by r.submitted_at desc) from recent_reports r), '[]'::jsonb),
    'capacities', coalesce((
      select jsonb_agg(jsonb_build_object('ward_id', c.ward_id, 'bed_capacity', c.bed_capacity))
      from selected_capacity c
    ), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order) from public.report_items i), '[]'::jsonb)
  );
$$;

grant execute on function public.save_ward_report_session(jsonb, integer) to authenticated;
grant execute on function public.get_ward_night_context(uuid, date) to authenticated;
grant execute on function public.get_manager_night_snapshot(date) to authenticated;
grant execute on function public.get_manager_recent_snapshot(integer) to authenticated;
