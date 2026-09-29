-- Night Memo: separate Ward drafts from submitted memos.
-- Save writes only to ward_report_drafts. Submit continues to write normal
-- ward_reports records, so Manager never sees an unsubmitted draft.

begin;

-- This workflow depends on the multi-submission schema because submitted_at is
-- the source of truth for the Manager submission window.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ward_reports'
      and column_name = 'submitted_at'
  ) then
    raise exception 'Night Memo multi-submission migration must be installed before ward draft/submit support.';
  end if;
end $$;

create table if not exists public.ward_report_drafts (
  ward_id uuid not null references public.wards(id) on delete cascade,
  report_date date not null,
  payload jsonb not null default '{}'::jsonb,
  bed_capacity_snapshot integer,
  form_version integer not null default 1,
  report_item_snapshot jsonb,
  saved_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ward_id, report_date)
);

alter table public.ward_report_drafts enable row level security;

-- No direct browser table policy is intentionally created. Ward access is
-- mediated by the SECURITY DEFINER RPCs below, which bind a Ward account to its
-- own ward_id through user_access.

create or replace function public.get_ward_report_draft(
  p_ward_id uuid,
  p_report_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ward_report_drafts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.user_access ua
    where ua.auth_user_id = auth.uid()
      and ua.active = true
      and ua.role = 'ward'
      and ua.ward_id = p_ward_id
  ) then
    raise exception 'Ward access denied' using errcode = '42501';
  end if;

  select * into v_row
  from public.ward_report_drafts
  where ward_id = p_ward_id
    and report_date = p_report_date;

  if not found then return null; end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.save_ward_report_draft(p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ward_id uuid;
  v_report_date date;
  v_row public.ward_report_drafts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_ward_id := nullif(p_row->>'ward_id', '')::uuid;
  v_report_date := nullif(p_row->>'report_date', '')::date;
  if v_ward_id is null or v_report_date is null then
    raise exception 'ward_id and report_date are required';
  end if;

  if not exists (
    select 1 from public.user_access ua
    where ua.auth_user_id = auth.uid()
      and ua.active = true
      and ua.role = 'ward'
      and ua.ward_id = v_ward_id
  ) then
    raise exception 'Ward access denied' using errcode = '42501';
  end if;

  insert into public.ward_report_drafts (
    ward_id, report_date, payload, bed_capacity_snapshot, form_version,
    report_item_snapshot, saved_by, created_at, updated_at
  ) values (
    v_ward_id,
    v_report_date,
    coalesce(p_row->'payload', '{}'::jsonb),
    nullif(p_row->>'bed_capacity_snapshot', '')::integer,
    coalesce(nullif(p_row->>'form_version', '')::integer, 1),
    p_row->'report_item_snapshot',
    auth.uid(),
    now(),
    now()
  )
  on conflict (ward_id, report_date) do update set
    payload = excluded.payload,
    bed_capacity_snapshot = excluded.bed_capacity_snapshot,
    form_version = excluded.form_version,
    report_item_snapshot = excluded.report_item_snapshot,
    saved_by = auth.uid(),
    updated_at = now()
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.delete_ward_report_draft(
  p_ward_id uuid,
  p_report_date date
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.user_access ua
    where ua.auth_user_id = auth.uid()
      and ua.active = true
      and ua.role = 'ward'
      and ua.ward_id = p_ward_id
  ) then
    raise exception 'Ward access denied' using errcode = '42501';
  end if;

  delete from public.ward_report_drafts
  where ward_id = p_ward_id
    and report_date = p_report_date;

  return true;
end;
$$;

create or replace function public.get_ward_submission_status(
  p_ward_id uuid,
  p_window_minutes integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_report_date date;
  v_submitted_at timestamptz;
  v_minutes integer := greatest(1, coalesce(p_window_minutes, 120));
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.user_access ua
    where ua.auth_user_id = auth.uid()
      and ua.active = true
      and ua.role = 'ward'
      and ua.ward_id = p_ward_id
  ) then
    raise exception 'Ward access denied' using errcode = '42501';
  end if;

  select wr.id, wr.report_date, wr.submitted_at
    into v_id, v_report_date, v_submitted_at
  from public.ward_reports wr
  where wr.ward_id = p_ward_id
    and wr.submitted_at is not null
  order by wr.submitted_at desc
  limit 1;

  return jsonb_build_object(
    'last_report_id', v_id,
    'last_report_date', v_report_date,
    'last_submitted_at', v_submitted_at,
    'submitted_in_window', coalesce(v_submitted_at >= now() - make_interval(mins => v_minutes), false),
    'window_minutes', v_minutes
  );
end;
$$;

revoke all on function public.get_ward_report_draft(uuid,date) from public, anon;
revoke all on function public.save_ward_report_draft(jsonb) from public, anon;
revoke all on function public.delete_ward_report_draft(uuid,date) from public, anon;
revoke all on function public.get_ward_submission_status(uuid,integer) from public, anon;

grant execute on function public.get_ward_report_draft(uuid,date) to authenticated;
grant execute on function public.save_ward_report_draft(jsonb) to authenticated;
grant execute on function public.delete_ward_report_draft(uuid,date) to authenticated;
grant execute on function public.get_ward_submission_status(uuid,integer) to authenticated;

commit;
