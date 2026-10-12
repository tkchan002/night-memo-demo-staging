-- Apply in Supabase SQL Editor BEFORE deploying the PM/Night frontend.
-- Non-destructive: earlier rolling-window ward reports remain labelled 'legacy'
-- and are not guessed into either PM or Night. Manager history remains intact.
begin;

alter table public.ward_reports add column if not exists report_type text not null default 'legacy';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ward_reports_type_valid' and conrelid = 'public.ward_reports'::regclass) then
    alter table public.ward_reports add constraint ward_reports_type_valid check (report_type in ('legacy','pm','night'));
  end if;
end $$;
create unique index if not exists ward_reports_one_typed_cycle
  on public.ward_reports (ward_id, report_date, report_type)
  where report_type in ('pm','night');

-- The separate draft table deliberately leaves legacy drafts untouched.
create table if not exists public.ward_cycle_drafts (
  ward_id uuid not null references public.wards(id) on delete cascade,
  report_date date not null,
  report_type text not null check (report_type in ('pm','night')),
  payload jsonb not null default '{}'::jsonb,
  bed_capacity_snapshot integer,
  form_version integer not null default 1,
  report_item_snapshot jsonb,
  saved_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ward_id, report_date, report_type)
);
alter table public.ward_cycle_drafts enable row level security;
revoke all on public.ward_cycle_drafts from public, anon, authenticated;

-- Revision snapshots are append-only and not exposed directly to browser accounts.
create table if not exists public.ward_cycle_revisions (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.ward_reports(id) on delete cascade,
  revision_number integer not null,
  saved_by uuid not null,
  saved_at timestamptz not null default now(),
  record jsonb not null,
  unique (report_id, revision_number)
);
alter table public.ward_cycle_revisions enable row level security;
revoke all on public.ward_cycle_revisions from public, anon, authenticated;

create or replace function public.assert_ward_cycle_access(p_ward_id uuid, p_date date, p_type text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_ward_id is null or p_date is null or p_type not in ('pm', 'night') or p_type is null then
    raise exception 'Valid ward, reporting date and PM/Night type required';
  end if;
  if auth.uid() is null or not exists (
    select 1 from public.user_access a
    where a.auth_user_id = auth.uid() and a.active and a.role = 'ward' and a.ward_id = p_ward_id
  ) then
    raise exception 'Ward access denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.ward_operating_periods op
    where op.ward_id = p_ward_id and op.start_date <= p_date
      and (op.end_date is null or op.end_date >= p_date)
  ) then
    raise exception 'Ward is not operational for the reporting date';
  end if;
end $$;
revoke all on function public.assert_ward_cycle_access(uuid,date,text) from public,anon;

create or replace function public.submit_ward_cycle_report(p_row jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ward uuid := nullif(p_row->>'ward_id','')::uuid;
  v_date date := nullif(p_row->>'report_date','')::date;
  v_type text := p_row->>'report_type';
  v_form integer;
  v_result public.ward_reports%rowtype;
  v_revision integer;
begin
  perform public.assert_ward_cycle_access(v_ward, v_date, v_type);
  perform pg_advisory_xact_lock(hashtextextended(v_ward::text || ':' || v_date::text || ':' || v_type, 0));
  v_form := public.resolve_form_version_for_date(v_date);
  insert into public.ward_reports (
    ward_id, report_date, report_type, payload, bed_capacity_snapshot,
    form_version, report_item_snapshot, submitted_at, updated_at
  ) values (
    v_ward, v_date, v_type, coalesce(p_row->'payload','{}'::jsonb),
    nullif(p_row->>'bed_capacity_snapshot','')::integer, v_form,
    p_row->'report_item_snapshot', now(), now()
  ) on conflict (ward_id, report_date, report_type) where report_type in ('pm','night')
  do update set payload = excluded.payload,
    bed_capacity_snapshot = excluded.bed_capacity_snapshot,
    form_version = excluded.form_version,
    report_item_snapshot = excluded.report_item_snapshot,
    submitted_at = now(), updated_at = now()
  returning * into v_result;
  select coalesce(max(revision_number),0)+1 into v_revision
  from public.ward_cycle_revisions where report_id = v_result.id;
  insert into public.ward_cycle_revisions(report_id, revision_number, saved_by, record)
  values (v_result.id, v_revision, auth.uid(), to_jsonb(v_result));
  return to_jsonb(v_result);
end $$;

create or replace function public.get_ward_cycle_draft(p_ward_id uuid, p_report_date date, p_report_type text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_data jsonb;
begin
  perform public.assert_ward_cycle_access(p_ward_id, p_report_date, p_report_type);
  select to_jsonb(d) into v_data from public.ward_cycle_drafts d
  where d.ward_id = p_ward_id and d.report_date = p_report_date and d.report_type = p_report_type;
  return v_data;
end $$;

create or replace function public.save_ward_cycle_draft(p_row jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ward uuid := nullif(p_row->>'ward_id','')::uuid;
  v_date date := nullif(p_row->>'report_date','')::date;
  v_type text := p_row->>'report_type';
  v_result public.ward_cycle_drafts%rowtype;
begin
  perform public.assert_ward_cycle_access(v_ward, v_date, v_type);
  insert into public.ward_cycle_drafts (
    ward_id, report_date, report_type, payload, bed_capacity_snapshot,
    form_version, report_item_snapshot, saved_by
  ) values (
    v_ward, v_date, v_type, coalesce(p_row->'payload', '{}'::jsonb),
    nullif(p_row->>'bed_capacity_snapshot','')::integer,
    public.resolve_form_version_for_date(v_date),p_row->'report_item_snapshot',auth.uid()
  ) on conflict (ward_id, report_date, report_type) do update set
    payload = excluded.payload, bed_capacity_snapshot = excluded.bed_capacity_snapshot,
    form_version = excluded.form_version, report_item_snapshot = excluded.report_item_snapshot,
    saved_by = auth.uid(),updated_at = now()
  returning * into v_result;
  return to_jsonb(v_result);
end $$;

create or replace function public.delete_ward_cycle_draft(p_ward_id uuid, p_report_date date, p_report_type text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_ward_cycle_access(p_ward_id, p_report_date, p_report_type);
  delete from public.ward_cycle_drafts where ward_id=p_ward_id and report_date=p_report_date and report_type=p_report_type;
  return true;
end $$;

revoke all on function public.submit_ward_cycle_report(jsonb) from public,anon;
revoke all on function public.get_ward_cycle_draft(uuid,date,text) from public,anon;
revoke all on function public.save_ward_cycle_draft(jsonb) from public,anon;
revoke all on function public.delete_ward_cycle_draft(uuid,date,text) from public,anon;
grant execute on function public.submit_ward_cycle_report(jsonb) to authenticated;
grant execute on function public.get_ward_cycle_draft(uuid,date,text) to authenticated;
grant execute on function public.save_ward_cycle_draft(jsonb) to authenticated;
grant execute on function public.delete_ward_cycle_draft(uuid,date,text) to authenticated;
commit;
