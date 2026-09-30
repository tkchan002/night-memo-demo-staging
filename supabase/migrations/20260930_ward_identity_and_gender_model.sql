-- Canonical Ward model
-- - one ward identity field: wards.name
-- - one empty-bed mode vocabulary: male / female / mixed / none
-- - no wards.code or wards.display_name compatibility columns
-- - generated Test Data uses ward_name and night-memo-generated-v2

begin;

-- Existing databases: rename the canonical short ward identifier in place.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='wards' and column_name='code'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='wards' and column_name='name'
  ) then
    execute 'alter table public.wards rename column code to name';
  end if;


  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='wards' and column_name='name'
  ) then
    raise exception 'wards.name is missing and wards.code could not be migrated';
  end if;
end $$;

-- The former display_name duplicated the ward identifier and allowed impossible
-- states such as code=C10 / display_name=E10. The UUID remains the stable key.
alter table public.wards drop column if exists display_name;

-- Keep one case-insensitive unique ward name.
drop index if exists public.wards_code_lower_uq;
create unique index if not exists wards_name_lower_uq on public.wards(lower(name));

-- Replace the implementation term "dynamic" with the actual domain term "mixed".
alter table public.wards drop constraint if exists wards_empty_bed_gender_mode_check;
update public.wards
set empty_bed_gender_mode = 'mixed'
where empty_bed_gender_mode = 'dynamic';
alter table public.wards
  add constraint wards_empty_bed_gender_mode_check
  check (empty_bed_gender_mode in ('male','female','mixed','none'));

-- Manager memo source snapshots are persisted JSON and must use the same ward model.
do $$
begin
  if to_regclass('public.manager_memos') is not null then
    update public.manager_memos m
    set source_snapshot = coalesce((
      select jsonb_agg(
        case when elem ? 'ward_code'
          then (elem - 'ward_code') || jsonb_build_object('ward_name', elem->'ward_code')
          else elem end
        order by ord
      )
      from jsonb_array_elements(coalesce(m.source_snapshot, '[]'::jsonb)) with ordinality as x(elem, ord)
    ), '[]'::jsonb)
    where exists (
      select 1
      from jsonb_array_elements(coalesce(m.source_snapshot, '[]'::jsonb)) e
      where e ? 'ward_code'
    );
  end if;

  if to_regclass('public.manager_memo_revisions') is not null then
    update public.manager_memo_revisions r
    set source_snapshot = coalesce((
      select jsonb_agg(
        case when elem ? 'ward_code'
          then (elem - 'ward_code') || jsonb_build_object('ward_name', elem->'ward_code')
          else elem end
        order by ord
      )
      from jsonb_array_elements(coalesce(r.source_snapshot, '[]'::jsonb)) with ordinality as x(elem, ord)
    ), '[]'::jsonb)
    where exists (select 1 from jsonb_array_elements(coalesce(r.source_snapshot, '[]'::jsonb)) e where e ? 'ward_code');
  end if;
end $$;

-- Fresh Test Data batches use the new format identifier.
do $$
begin
  if to_regclass('public.demo_data_batches') is not null then
    alter table public.demo_data_batches
      alter column source_format set default 'night-memo-generated-v2';
  end if;
end $$;

-- Recreate snapshot RPCs whose SQL text previously ordered by wards.code.
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

create or replace function public.get_manager_night_snapshot(p_date date)
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
      select 1 from public.ward_operating_periods p
      where p.ward_id = w.id
        and p.start_date <= p_date
        and (p.end_date is null or p.end_date >= p_date)
    )
  ),
  selected_capacity as (
    select distinct on (c.ward_id) c.ward_id, c.bed_capacity
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

create or replace function public.get_manager_recent_snapshot(p_window_minutes integer default 120)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select greatest(coalesce(p_window_minutes, 120), 1) as window_minutes,
           (now() at time zone 'Asia/Hong_Kong')::date as hk_date
  ),
  open_wards as (
    select w.*
    from public.wards w, params x
    where exists (
      select 1 from public.ward_operating_periods p
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
    select distinct on (c.ward_id) c.ward_id, c.bed_capacity
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

grant execute on function public.get_maintenance_wards_snapshot() to authenticated;
grant execute on function public.get_manager_night_snapshot(date) to authenticated;
grant execute on function public.get_manager_recent_snapshot(integer) to authenticated;

-- Replace the generated-demo importer so its contract uses ward_name, not ward_code.
create or replace function public.import_generated_demo_batch(p_bundle jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch_id uuid;
  v_report jsonb;
  v_ward_id uuid;
  v_ward_name text;
  v_report_date date;
  v_submitted_at timestamptz;
  v_payload jsonb;
  v_capacity integer;
  v_snapshot jsonb;
  v_report_id uuid;
  v_count integer := 0;
  v_description text := coalesce(p_bundle->>'description', '');
  v_scenario text := coalesce(p_bundle->>'scenario', 'typical');
  v_seed bigint;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.user_access ua
    where ua.auth_user_id = v_user_id and ua.role = 'maintenance' and ua.active = true
  ) then raise exception 'Maintenance access required'; end if;

  if coalesce(p_bundle->>'format', '') <> 'night-memo-generated-v2' then
    raise exception 'Unsupported generated demo format';
  end if;
  if jsonb_typeof(p_bundle->'reports') <> 'array' or jsonb_array_length(p_bundle->'reports') = 0 then
    raise exception 'Generated demo bundle must contain at least one report';
  end if;
  if jsonb_array_length(p_bundle->'reports') > 500 then raise exception 'Generated demo batch is limited to 500 reports'; end if;

  begin v_seed := nullif(p_bundle->>'seed', '')::bigint; exception when others then v_seed := null; end;

  insert into public.demo_data_batches(generated_by, scenario, seed, description, source_format, report_count)
  values (v_user_id, nullif(trim(v_scenario), ''), v_seed, nullif(trim(v_description), ''), 'night-memo-generated-v2', 0)
  returning id into v_batch_id;

  for v_report in select value from jsonb_array_elements(p_bundle->'reports') loop
    v_ward_name := trim(coalesce(v_report->>'ward_name', ''));
    if v_ward_name = '' then raise exception 'Every generated report requires ward_name'; end if;

    select w.id into v_ward_id
    from public.wards w
    where lower(w.name) = lower(v_ward_name)
    limit 1;
    if v_ward_id is null then raise exception 'Unknown ward name: %', v_ward_name; end if;

    begin
      v_report_date := (v_report->>'report_date')::date;
      if nullif(v_report->>'submitted_minutes_ago', '') is not null then
        v_submitted_at := now() - make_interval(mins => greatest(0, (v_report->>'submitted_minutes_ago')::integer));
      else
        v_submitted_at := (v_report->>'submitted_at')::timestamptz;
      end if;
    exception when others then
      raise exception 'Invalid report_date or submission time for ward %', v_ward_name;
    end;

    if v_report_date is null or v_submitted_at is null then
      raise exception 'report_date and a submission time are required for ward %', v_ward_name;
    end if;
    if not exists (
      select 1 from public.ward_operating_periods op
      where op.ward_id = v_ward_id
        and op.start_date <= v_report_date
        and (op.end_date is null or op.end_date >= v_report_date)
    ) then raise exception 'Ward % is not operational on %', v_ward_name, v_report_date; end if;

    v_payload := coalesce(v_report->'payload', '{}'::jsonb);
    if jsonb_typeof(v_payload) <> 'object' then raise exception 'payload must be a JSON object for ward %', v_ward_name; end if;

    select c.bed_capacity into v_capacity
    from public.ward_capacity_history c
    where c.ward_id = v_ward_id
      and c.effective_from <= v_report_date
      and (c.effective_to is null or c.effective_to >= v_report_date)
    order by c.effective_from desc limit 1;
    v_capacity := coalesce(v_capacity, 0);

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'key', i.key, 'label', i.label, 'section', i.section,
      'input_type', i.input_type, 'options', coalesce(to_jsonb(i.options), '[]'::jsonb),
      'sort_order', i.sort_order, 'builtin', coalesce(i.builtin, false), 'config', to_jsonb(i.config)
    ) order by i.sort_order), '[]'::jsonb)
    into v_snapshot
    from public.report_items i
    where (i.effective_from is null or i.effective_from <= v_report_date)
      and (i.effective_to is null or i.effective_to >= v_report_date)
      and coalesce(i.active, true) = true;

    insert into public.ward_reports(
      ward_id, report_date, payload, bed_capacity_snapshot, form_version,
      report_item_snapshot, submitted_at, created_at, updated_at
    ) values (
      v_ward_id, v_report_date, v_payload, v_capacity, 2,
      v_snapshot, v_submitted_at, v_submitted_at, v_submitted_at
    ) returning id into v_report_id;

    insert into public.demo_data_reports(batch_id, report_id) values (v_batch_id, v_report_id);
    v_count := v_count + 1;
  end loop;

  update public.demo_data_batches set report_count = v_count where id = v_batch_id;
  return jsonb_build_object('batch_id', v_batch_id, 'report_count', v_count, 'scenario', v_scenario);
end;
$$;

revoke all on function public.import_generated_demo_batch(jsonb) from public;
grant execute on function public.import_generated_demo_batch(jsonb) to authenticated;

commit;
