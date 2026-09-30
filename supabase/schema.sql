-- Night Memo Supabase schema
-- Run this first in the Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.wards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  fax text not null,
  empty_bed_gender_mode text not null default 'male' check (empty_bed_gender_mode in ('male','female','mixed','none')),
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists wards_name_lower_uq on public.wards(lower(name));

create table if not exists public.ward_operating_periods (
  id uuid primary key default gen_random_uuid(),
  ward_id uuid not null references public.wards(id) on delete restrict,
  start_date date not null,
  end_date date,
  note text,
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists ward_operating_periods_ward_idx on public.ward_operating_periods(ward_id,start_date desc);

create table if not exists public.ward_capacity_history (
  id uuid primary key default gen_random_uuid(),
  ward_id uuid not null references public.wards(id) on delete restrict,
  effective_from date not null,
  effective_to date,
  bed_capacity integer not null check (bed_capacity >= 0),
  note text,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists ward_capacity_history_ward_idx on public.ward_capacity_history(ward_id,effective_from desc);

create table if not exists public.user_access (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  login_id text not null,
  display_name text,
  role text not null check (role in ('ward','manager','maintenance')),
  ward_id uuid references public.wards(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((role='ward' and ward_id is not null) or (role<>'ward'))
);
create unique index if not exists user_access_login_lower_uq on public.user_access(lower(login_id));
create unique index if not exists user_access_one_ward_account_uq on public.user_access(ward_id) where role='ward';

create table if not exists public.ward_staff (
  id uuid primary key default gen_random_uuid(),
  ward_id uuid not null references public.wards(id) on delete restrict,
  role text not null,
  name text not null,
  appointment_date date,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ward_staff_ward_idx on public.ward_staff(ward_id,active,display_order,name);

create table if not exists public.form_versions (
  version integer primary key,
  effective_from date not null,
  effective_to date,
  status text not null default 'published' check (status in ('draft','published','retired')),
  schema_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.report_items (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  section text not null,
  label text not null,
  input_type text not null check (input_type in ('dropdown','checkbox','bed_chooser','free_text','number','bed_or_count')),
  options jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  active boolean not null default true,
  effective_from date not null default current_date,
  effective_to date,
  builtin boolean not null default false,
  manager_slot text,
  config jsonb not null default '{"storage":"dynamicItems"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.ward_reports (
  id uuid primary key default gen_random_uuid(),
  ward_id uuid not null references public.wards(id) on delete restrict,
  report_date date not null,
  payload jsonb not null default '{}'::jsonb,
  bed_capacity_snapshot integer,
  form_version integer not null default 1 references public.form_versions(version) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(ward_id,report_date)
);
create index if not exists ward_reports_date_idx on public.ward_reports(report_date,ward_id);
create index if not exists ward_reports_ward_date_idx on public.ward_reports(ward_id,report_date desc);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_time_idx on public.audit_log(occurred_at desc);

-- Updated-at helper
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;$$;

drop trigger if exists trg_wards_touch on public.wards;
create trigger trg_wards_touch before update on public.wards for each row execute function public.touch_updated_at();
drop trigger if exists trg_user_access_touch on public.user_access;
create trigger trg_user_access_touch before update on public.user_access for each row execute function public.touch_updated_at();
drop trigger if exists trg_ward_staff_touch on public.ward_staff;
create trigger trg_ward_staff_touch before update on public.ward_staff for each row execute function public.touch_updated_at();
drop trigger if exists trg_report_items_touch on public.report_items;
create trigger trg_report_items_touch before update on public.report_items for each row execute function public.touch_updated_at();

create or replace function public.set_report_actor() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    new.created_by = coalesce(new.created_by, auth.uid());
  end if;
  new.updated_by = auth.uid();
  new.updated_at = now();
  return new;
end;$$;
drop trigger if exists trg_report_actor on public.ward_reports;
create trigger trg_report_actor before insert or update on public.ward_reports for each row execute function public.set_report_actor();

-- Access helper functions. SECURITY DEFINER lets policies check user_access without recursive RLS.
create or replace function public.app_access_active() returns boolean
language sql stable security definer set search_path=public as $$
  select coalesce((select active from public.user_access where auth_user_id=auth.uid()),false);
$$;
create or replace function public.app_role() returns text
language sql stable security definer set search_path=public as $$
  select role from public.user_access where auth_user_id=auth.uid() and active=true;
$$;
create or replace function public.app_ward_id() returns uuid
language sql stable security definer set search_path=public as $$
  select ward_id from public.user_access where auth_user_id=auth.uid() and active=true;
$$;

create or replace function public.ward_operational_on(p_ward_id uuid,p_date date) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.ward_operating_periods p
    where p.ward_id=p_ward_id and p.start_date<=p_date and (p.end_date is null or p.end_date>=p_date)
  );
$$;

-- Capacity change is effective-dated and closes the previous capacity interval.
create or replace function public.add_ward_capacity(
  p_ward_id uuid,
  p_effective_from date,
  p_bed_capacity integer,
  p_note text default null
) returns void
language plpgsql security definer set search_path=public as $$
declare
  prev_id uuid;
begin
  if public.app_role() <> 'maintenance' then
    raise exception 'maintenance role required';
  end if;
  if p_bed_capacity < 0 then raise exception 'bed capacity must be >= 0'; end if;

  select id into prev_id
  from public.ward_capacity_history
  where ward_id=p_ward_id
    and effective_from < p_effective_from
    and (effective_to is null or effective_to >= p_effective_from)
  order by effective_from desc limit 1;

  if prev_id is not null then
    update public.ward_capacity_history
      set effective_to = p_effective_from - 1
      where id=prev_id;
  end if;

  insert into public.ward_capacity_history(ward_id,effective_from,effective_to,bed_capacity,note)
  values(p_ward_id,p_effective_from,null,p_bed_capacity,p_note);
end;$$;

-- Row Level Security
alter table public.wards enable row level security;
alter table public.ward_operating_periods enable row level security;
alter table public.ward_capacity_history enable row level security;
alter table public.user_access enable row level security;
alter table public.ward_staff enable row level security;
alter table public.form_versions enable row level security;
alter table public.report_items enable row level security;
alter table public.ward_reports enable row level security;
alter table public.audit_log enable row level security;

-- Read configuration to any active Night Memo account.
drop policy if exists wards_read on public.wards;
create policy wards_read on public.wards for select to authenticated using (public.app_access_active());
drop policy if exists periods_read on public.ward_operating_periods;
create policy periods_read on public.ward_operating_periods for select to authenticated using (public.app_access_active());
drop policy if exists capacity_read on public.ward_capacity_history;
create policy capacity_read on public.ward_capacity_history for select to authenticated using (public.app_access_active());
drop policy if exists forms_read on public.form_versions;
create policy forms_read on public.form_versions for select to authenticated using (public.app_access_active());
drop policy if exists items_read on public.report_items;
create policy items_read on public.report_items for select to authenticated using (public.app_access_active());

-- Maintenance controls configuration.
drop policy if exists wards_maint_insert on public.wards;
create policy wards_maint_insert on public.wards for insert to authenticated with check (public.app_role()='maintenance');
drop policy if exists wards_maint_update on public.wards;
create policy wards_maint_update on public.wards for update to authenticated using (public.app_role()='maintenance') with check (public.app_role()='maintenance');
drop policy if exists periods_maint_all on public.ward_operating_periods;
create policy periods_maint_all on public.ward_operating_periods for all to authenticated using (public.app_role()='maintenance') with check (public.app_role()='maintenance');
drop policy if exists capacity_maint_readwrite on public.ward_capacity_history;
create policy capacity_maint_readwrite on public.ward_capacity_history for all to authenticated using (public.app_role()='maintenance') with check (public.app_role()='maintenance');
drop policy if exists forms_maint_all on public.form_versions;
create policy forms_maint_all on public.form_versions for all to authenticated using (public.app_role()='maintenance') with check (public.app_role()='maintenance');
drop policy if exists items_maint_all on public.report_items;
create policy items_maint_all on public.report_items for all to authenticated using (public.app_role()='maintenance') with check (public.app_role()='maintenance');

-- User access: self can read own mapping; maintenance can list all. Mutations are done by Edge Function/service role.
drop policy if exists access_self_or_maint_read on public.user_access;
create policy access_self_or_maint_read on public.user_access for select to authenticated using (auth_user_id=auth.uid() or public.app_role()='maintenance');

-- Ward staff: ward account sees/edits only its own colleagues. Manager and maintenance may read all; maintenance may edit all.
drop policy if exists staff_read on public.ward_staff;
create policy staff_read on public.ward_staff for select to authenticated using (ward_id=public.app_ward_id() or public.app_role() in ('manager','maintenance'));
drop policy if exists staff_insert on public.ward_staff;
create policy staff_insert on public.ward_staff for insert to authenticated with check (ward_id=public.app_ward_id() or public.app_role()='maintenance');
drop policy if exists staff_update on public.ward_staff;
create policy staff_update on public.ward_staff for update to authenticated using (ward_id=public.app_ward_id() or public.app_role()='maintenance') with check (ward_id=public.app_ward_id() or public.app_role()='maintenance');

-- Clinical reports: ward reads/writes only its own ward; manager reads all full reports. Maintenance does not get report access by default.
drop policy if exists reports_read on public.ward_reports;
create policy reports_read on public.ward_reports for select to authenticated using (ward_id=public.app_ward_id() or public.app_role()='manager');
drop policy if exists reports_insert on public.ward_reports;
create policy reports_insert on public.ward_reports for insert to authenticated with check (public.app_role()='ward' and ward_id=public.app_ward_id() and public.ward_operational_on(ward_id,report_date));
drop policy if exists reports_update on public.ward_reports;
create policy reports_update on public.ward_reports for update to authenticated using (public.app_role()='ward' and ward_id=public.app_ward_id()) with check (public.app_role()='ward' and ward_id=public.app_ward_id() and public.ward_operational_on(ward_id,report_date));

-- Audit log is visible to maintenance. Maintenance UI may write configuration audit rows; Edge Function writes account actions with service role.
drop policy if exists audit_maint_read on public.audit_log;
create policy audit_maint_read on public.audit_log for select to authenticated using (public.app_role()='maintenance');
drop policy if exists audit_maint_insert on public.audit_log;
create policy audit_maint_insert on public.audit_log for insert to authenticated with check (public.app_role()='maintenance');

-- Minimum grants for authenticated users; RLS still decides row access.
grant select on public.wards,public.ward_operating_periods,public.ward_capacity_history,public.user_access,public.ward_staff,public.form_versions,public.report_items,public.ward_reports,public.audit_log to authenticated;
grant insert,update on public.wards,public.ward_operating_periods,public.ward_capacity_history,public.ward_staff,public.form_versions,public.report_items,public.ward_reports,public.audit_log to authenticated;
grant execute on function public.add_ward_capacity(uuid,date,integer,text) to authenticated;
