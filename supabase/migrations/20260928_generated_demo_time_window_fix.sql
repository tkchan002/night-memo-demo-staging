-- Night Memo generated demo data: server-clock submission-time fix
--
-- Replaces only the import RPC. Generated reports can carry
-- submitted_minutes_ago, which is converted with PostgreSQL now().
-- This ensures demo "current" reports and Manager's rolling 120-minute
-- submission window use the same server clock regardless of browser timezone.

create or replace function public.import_generated_demo_batch(
  p_bundle jsonb
)
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
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.user_access ua
    where ua.auth_user_id = v_user_id
      and ua.role = 'maintenance'
      and ua.active = true
  ) then
    raise exception 'Maintenance access required';
  end if;

  if coalesce(p_bundle->>'format', '') <> 'night-memo-generated-v2' then
    raise exception 'Unsupported generated demo format';
  end if;

  if jsonb_typeof(p_bundle->'reports') <> 'array'
     or jsonb_array_length(p_bundle->'reports') = 0 then
    raise exception 'Generated demo bundle must contain at least one report';
  end if;

  if jsonb_array_length(p_bundle->'reports') > 500 then
    raise exception 'Generated demo batch is limited to 500 reports';
  end if;

  begin
    v_seed := nullif(p_bundle->>'seed', '')::bigint;
  exception when others then
    v_seed := null;
  end;

  insert into public.demo_data_batches (
    generated_by, scenario, seed, description, source_format, report_count
  ) values (
    v_user_id,
    nullif(trim(v_scenario), ''),
    v_seed,
    nullif(trim(v_description), ''),
    'night-memo-generated-v2',
    0
  ) returning id into v_batch_id;

  for v_report in select value from jsonb_array_elements(p_bundle->'reports')
  loop
    v_ward_name := upper(trim(coalesce(v_report->>'ward_name', '')));
    if v_ward_name = '' then
      raise exception 'Every generated report requires ward_name';
    end if;

    select w.id into v_ward_id
    from public.wards w
    where upper(w.name) = v_ward_name
    limit 1;

    if v_ward_id is null then
      raise exception 'Unknown ward name: %', v_ward_name;
    end if;

    begin
      v_report_date := (v_report->>'report_date')::date;

      -- For generated demo data, prefer an age relative to the database server's
      -- clock. This avoids client timezone/clock differences and guarantees that
      -- a "current" demo memo is inside the same rolling window Manager uses.
      if nullif(v_report->>'submitted_minutes_ago', '') is not null then
        v_submitted_at := now() - make_interval(
          mins => greatest(0, (v_report->>'submitted_minutes_ago')::integer)
        );
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
      select 1
      from public.ward_operating_periods op
      where op.ward_id = v_ward_id
        and op.start_date <= v_report_date
        and (op.end_date is null or op.end_date >= v_report_date)
    ) then
      raise exception 'Ward % is not operational on %', v_ward_name, v_report_date;
    end if;

    v_payload := coalesce(v_report->'payload', '{}'::jsonb);
    if jsonb_typeof(v_payload) <> 'object' then
      raise exception 'payload must be a JSON object for ward %', v_ward_name;
    end if;

    select c.bed_capacity into v_capacity
    from public.ward_capacity_history c
    where c.ward_id = v_ward_id
      and c.effective_from <= v_report_date
      and (c.effective_to is null or c.effective_to >= v_report_date)
    order by c.effective_from desc
    limit 1;

    v_capacity := coalesce(v_capacity, 0);

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'key', i.key,
        'label', i.label,
        'section', i.section,
        'input_type', i.input_type,
        'options', coalesce(to_jsonb(i.options), '[]'::jsonb),
        'sort_order', i.sort_order,
        'builtin', coalesce(i.builtin, false),
        'config', to_jsonb(i.config)
      ) order by i.sort_order
    ), '[]'::jsonb)
    into v_snapshot
    from public.report_items i
    where (i.effective_from is null or i.effective_from <= v_report_date)
      and (i.effective_to is null or i.effective_to >= v_report_date)
      and coalesce(i.active, true) = true;

    insert into public.ward_reports (
      ward_id,
      report_date,
      payload,
      bed_capacity_snapshot,
      form_version,
      report_item_snapshot,
      submitted_at,
      created_at,
      updated_at
    ) values (
      v_ward_id,
      v_report_date,
      v_payload,
      v_capacity,
      2,
      v_snapshot,
      v_submitted_at,
      v_submitted_at,
      v_submitted_at
    ) returning id into v_report_id;

    insert into public.demo_data_reports (batch_id, report_id)
    values (v_batch_id, v_report_id);

    v_count := v_count + 1;
  end loop;

  update public.demo_data_batches
  set report_count = v_count
  where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'report_count', v_count,
    'scenario', v_scenario
  );
exception
  when others then
    -- One RPC call is one transaction. Any error rolls back the whole batch.
    raise;
end;
$$;

create or replace function public.list_generated_demo_batches()
returns table (
  id uuid,
  generated_at timestamptz,
  generated_by uuid,
  scenario text,
  seed bigint,
  description text,
  report_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.user_access ua
    where ua.auth_user_id = auth.uid()
      and ua.role = 'maintenance'
      and ua.active = true
  ) then
    raise exception 'Maintenance access required';
  end if;

  return query
  select b.id, b.generated_at, b.generated_by, b.scenario, b.seed, b.description, b.report_count
  from public.demo_data_batches b
  order by b.generated_at desc;
end;
$$;

create or replace function public.delete_generated_demo_batch(
  p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.user_access ua
    where ua.auth_user_id = auth.uid()
      and ua.role = 'maintenance'
      and ua.active = true
  ) then
    raise exception 'Maintenance access required';
  end if;

  if not exists (select 1 from public.demo_data_batches where id = p_batch_id) then
    raise exception 'Generated demo batch not found';
  end if;

  with deleted as (
    delete from public.ward_reports r
    using public.demo_data_reports l
    where l.batch_id = p_batch_id
      and l.report_id = r.id
    returning r.id
  )
  select count(*) into v_deleted from deleted;

  delete from public.demo_data_batches where id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'deleted_reports', v_deleted
  );
end;
$$;


grant execute on function public.import_generated_demo_batch(jsonb) to authenticated;
