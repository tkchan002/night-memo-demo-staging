-- Night Memo / Maintenance: save Ward settings + bed capacity atomically.
-- Apply in Supabase SQL Editor before uploading the new Maintenance UI.
-- Existing capacity history is kept. Conflicting old history causes a clear
-- migration error rather than an automatic, potentially destructive repair.

create extension if not exists btree_gist;

do $$
begin
  if exists (
    select 1 from public.ward_capacity_history a
    join public.ward_capacity_history b
      on b.ward_id = a.ward_id and b.id > a.id
     and a.effective_from <= coalesce(b.effective_to, 'infinity'::date)
     and b.effective_from <= coalesce(a.effective_to, 'infinity'::date)
  ) then
    raise exception 'Existing ward capacity history has overlapping dates. Review duplicate/overlapping rows before applying the upgrade.';
  end if;
end $$;

-- Ensure old or future code cannot create duplicate/overlapping intervals.
create unique index if not exists ward_capacity_unique_effective_start
  on public.ward_capacity_history (ward_id, effective_from);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ward_capacity_no_overlap'
      and conrelid = 'public.ward_capacity_history'::regclass
  ) then
    alter table public.ward_capacity_history
      add constraint ward_capacity_no_overlap
      exclude using gist (
        ward_id with =,
        daterange(effective_from, effective_to + 1, '[)') with &&
      );
  end if;
end $$;

create or replace function public.save_ward_configuration(
  p_ward_id uuid,
  p_name text,
  p_phone text,
  p_fax text,
  p_gender_mode text,
  p_single_double boolean,
  p_bed_capacity integer,
  p_expected_capacity integer,
  p_expected_updated_at timestamptz,
  p_effective_date date
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_ward public.wards%rowtype;
  v_current public.ward_capacity_history%rowtype;
  v_first public.ward_capacity_history%rowtype;
  v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
  v_change_date date;
  v_scheduled boolean := false;
  v_settings_changed boolean;
begin
  if public.app_role() is distinct from 'maintenance' then
    raise exception 'Maintenance role required';
  end if;
  if p_effective_date is distinct from v_today then
    raise exception 'The reporting date has changed. Reload Edit Ward and try again.';
  end if;
  if p_bed_capacity is null or p_bed_capacity not between 0 and 500
    or p_expected_capacity is null or p_expected_capacity not between 0 and 500 then
    raise exception 'Bed capacity must be a whole number between 0 and 500.';
  end if;
  if nullif(btrim(p_name), '') is null or p_gender_mode not in ('male','female','mixed','none')
    or p_gender_mode is null or p_single_double is null
    or coalesce(p_phone,'') !~ '^[0-9]{1,4}$'
    or coalesce(p_fax,'') !~ '^[0-9]{1,4}$' then
    raise exception 'Invalid ward configuration.';
  end if;

  -- One lock serializes edits of this Ward by multiple administrators.
  select * into v_ward from public.wards where id = p_ward_id for update;
  if not found then raise exception 'Ward not found.'; end if;
  if p_expected_updated_at is not null
     and v_ward.updated_at is distinct from p_expected_updated_at then
    raise exception 'Ward settings were changed by another administrator. Reload Edit Ward.';
  end if;

  -- Protect all current/future history for this ward during this transaction.
  perform 1 from public.ward_capacity_history where ward_id = p_ward_id for update;
  select * into v_current
    from public.ward_capacity_history
   where ward_id = p_ward_id and effective_from <= v_today
     and (effective_to is null or effective_to >= v_today)
   order by effective_from desc limit 1;

  if not found then
    select * into v_first
      from public.ward_capacity_history
     where ward_id = p_ward_id order by effective_from asc limit 1;
    if v_first.id is not null and v_first.effective_from > v_today then
      v_current := v_first;
      v_scheduled := true;
    else
      raise exception 'No bed capacity is configured for today. Review this ward''s capacity history.';
    end if;
  end if;
  if v_current.bed_capacity is distinct from p_expected_capacity then
    raise exception 'Bed capacity was changed by another administrator. Reload Edit Ward.';
  end if;

  v_settings_changed := v_ward.name is distinct from btrim(p_name)
    or v_ward.phone is distinct from p_phone
    or v_ward.fax is distinct from p_fax
    or v_ward.empty_bed_gender_mode is distinct from p_gender_mode
    or v_ward.single_double_reporting_enabled is distinct from p_single_double;

  if v_settings_changed then
    update public.wards set
      name = btrim(p_name), phone = p_phone, fax = p_fax,
      empty_bed_gender_mode = p_gender_mode,
      single_double_reporting_enabled = p_single_double
    where id = p_ward_id;

    insert into public.audit_log(actor_user_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'ward.configuration.update', 'ward', p_ward_id::text,
      jsonb_build_object(
        'old_name', v_ward.name, 'new_name', btrim(p_name),
        'old_phone', v_ward.phone, 'new_phone', p_phone,
        'old_fax', v_ward.fax, 'new_fax', p_fax,
        'old_gender_mode', v_ward.empty_bed_gender_mode, 'new_gender_mode', p_gender_mode,
        'old_single_double', v_ward.single_double_reporting_enabled, 'new_single_double', p_single_double
      ));
  end if;

  if v_current.bed_capacity is distinct from p_bed_capacity then
    if v_scheduled or v_current.effective_from = v_today then
      -- Same-day revisions update the current record; never insert a duplicate.
      update public.ward_capacity_history
      set bed_capacity = p_bed_capacity, note = 'Updated in Edit Ward'
      where id = v_current.id;
      v_change_date := v_current.effective_from;
    else
      update public.ward_capacity_history
      set effective_to = v_today - 1
      where id = v_current.id;
      insert into public.ward_capacity_history
        (ward_id, effective_from, effective_to, bed_capacity, note)
      values (p_ward_id, v_today,
        v_current.effective_to,
        p_bed_capacity, 'Updated in Edit Ward');
      v_change_date := v_today;
    end if;

    insert into public.audit_log(actor_user_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'ward.capacity.change', 'ward', p_ward_id::text,
      jsonb_build_object('previous', v_current.bed_capacity,
        'new', p_bed_capacity, 'effective_from', v_change_date));
  end if;
end;
$$;

revoke all on function public.save_ward_configuration(uuid,text,text,text,text,boolean,integer,integer,timestamptz,date) from public;
grant execute on function public.save_ward_configuration(uuid,text,text,text,text,boolean,integer,integer,timestamptz,date) to authenticated;
