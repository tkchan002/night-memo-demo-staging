-- Night Memo: canonical form-version resolution
--
-- Root cause fixed here:
--   Some report write paths hard-coded form_version 1 or 2 even though
--   ward_reports.form_version is a foreign key to public.form_versions(version).
--   Generated Test Data therefore failed whenever the assumed version did not
--   exist in form_versions.
--
-- This migration makes the database the single source of truth. The form
-- version is resolved from the report date for every report write, and both the
-- normal Ward submit RPC and generated Test Data RPC use the same resolver.

begin;

create or replace function public.resolve_form_version_for_date(
  p_report_date date
)
returns integer
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_version integer;
begin
  if p_report_date is null then
    raise exception 'report_date is required to resolve form version';
  end if;

  select fv.version
    into v_version
  from public.form_versions fv
  where fv.effective_from <= p_report_date
    and (fv.effective_to is null or fv.effective_to >= p_report_date)
    and fv.status in ('published', 'retired')
  order by
    case when fv.status = 'published' then 0 else 1 end,
    fv.effective_from desc,
    fv.version desc
  limit 1;

  if v_version is null then
    raise exception 'No published/retired form version is effective on %', p_report_date
      using hint = 'Create or correct a form_versions row whose effective date range covers this report date.';
  end if;

  return v_version;
end;
$$;

-- Enforce the invariant at the table boundary as well as in RPCs.  This means
-- a stale browser/client cannot create a report that points to a non-existent
-- or date-inappropriate form version.
create or replace function public.assign_effective_form_version()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.form_version := public.resolve_form_version_for_date(new.report_date);
  return new;
end;
$$;

drop trigger if exists trg_ward_reports_form_version on public.ward_reports;
create trigger trg_ward_reports_form_version
before insert or update of report_date, form_version
on public.ward_reports
for each row
execute function public.assign_effective_form_version();

-- ward_report_drafts was introduced later than the base schema.  Install the
-- same invariant there when that table and column exist, without making this
-- migration depend on a particular draft-table deployment state.
do $$
begin
  if to_regclass('public.ward_report_drafts') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'ward_report_drafts'
         and column_name = 'form_version'
     ) then
    execute 'drop trigger if exists trg_ward_report_drafts_form_version on public.ward_report_drafts';
    execute 'create trigger trg_ward_report_drafts_form_version
      before insert or update of report_date, form_version
      on public.ward_report_drafts
      for each row
      execute function public.assign_effective_form_version()';
  end if;
end
$$;

-- Rebuild the ordinary Ward submission RPC so it no longer defaults a missing
-- form version to a magic number.  The report date determines the version.
create or replace function public.save_ward_report_session(
  p_row jsonb,
  p_window_minutes integer default 120
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_ward_id uuid := (p_row->>'ward_id')::uuid;
  v_report_date date := (p_row->>'report_date')::date;
  v_window integer := greatest(coalesce(p_window_minutes, 120), 1);
  v_existing_id uuid;
  v_form_version integer;
  v_result public.ward_reports;
begin
  if v_ward_id is null or v_report_date is null then
    raise exception 'ward_id and report_date are required';
  end if;

  v_form_version := public.resolve_form_version_for_date(v_report_date);

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
        form_version = v_form_version,
        report_item_snapshot = case
          when p_row ? 'report_item_snapshot' then p_row->'report_item_snapshot'
          else report_item_snapshot
        end,
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
      v_form_version,
      p_row->'report_item_snapshot',
      now(),
      now()
    )
    returning * into v_result;
  end if;

  return to_jsonb(v_result);
end;
$$;

-- Rebuild the generated Test Data importer.  It resolves form version per
-- generated report date; there is no hard-coded version number.
create or replace function public.import_generated_demo_batch(
  p_bundle jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
  v_form_version integer;
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
    generated_by,
    scenario,
    seed,
    description,
    source_format,
    report_count
  ) values (
    v_user_id,
    nullif(trim(v_scenario), ''),
    v_seed,
    nullif(trim(v_description), ''),
    'night-memo-generated-v2',
    0
  )
  returning id into v_batch_id;

  for v_report in
    select value from jsonb_array_elements(p_bundle->'reports')
  loop
    v_ward_name := trim(coalesce(v_report->>'ward_name', ''));
    if v_ward_name = '' then
      raise exception 'Every generated report requires ward_name';
    end if;

    select w.id
      into v_ward_id
    from public.wards w
    where lower(w.name) = lower(v_ward_name)
    limit 1;

    if v_ward_id is null then
      raise exception 'Unknown ward name: %', v_ward_name;
    end if;

    begin
      v_report_date := (v_report->>'report_date')::date;

      -- Use the database clock for rolling-window test data so Manager and the
      -- generated records share the same time source.
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

    -- Resolve this before inserting the batch row.  A missing form
    -- configuration now produces an explicit configuration error rather than a
    -- foreign-key violation mentioning an assumed version number.
    v_form_version := public.resolve_form_version_for_date(v_report_date);

    v_payload := coalesce(v_report->'payload', '{}'::jsonb);
    if jsonb_typeof(v_payload) <> 'object' then
      raise exception 'payload must be a JSON object for ward %', v_ward_name;
    end if;

    select c.bed_capacity
      into v_capacity
    from public.ward_capacity_history c
    where c.ward_id = v_ward_id
      and c.effective_from <= v_report_date
      and (c.effective_to is null or c.effective_to >= v_report_date)
    order by c.effective_from desc
    limit 1;

    v_capacity := coalesce(v_capacity, 0);

    select coalesce(
      jsonb_agg(
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
      ),
      '[]'::jsonb
    )
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
      v_form_version,
      v_snapshot,
      v_submitted_at,
      v_submitted_at,
      v_submitted_at
    )
    returning id into v_report_id;

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

revoke all on function public.resolve_form_version_for_date(date) from public;
grant execute on function public.resolve_form_version_for_date(date) to authenticated;

revoke all on function public.assign_effective_form_version() from public;
-- Trigger functions do not need direct client execution.

revoke all on function public.save_ward_report_session(jsonb, integer) from public;
grant execute on function public.save_ward_report_session(jsonb, integer) to authenticated;

revoke all on function public.import_generated_demo_batch(jsonb) from public;
grant execute on function public.import_generated_demo_batch(jsonb) to authenticated;

commit;
