-- Manager Night Memo lifecycle hardening + archive sidebar support.
--
-- Goals:
--   * manager_memos remains the one mutable recovery copy per reporting night.
--   * manager_memo_revisions remains immutable explicit Save/Print history.
--   * direct client writes and the obsolete save_manager_memo() path are retired.
--   * every SECURITY DEFINER function requires an ACTIVE manager account.
--   * destructive working-copy operations may create short safety checkpoints.
--   * the UI can load all reporting nights through one archive RPC.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tighten existing immutable History access.
-- ---------------------------------------------------------------------------

alter table public.manager_memo_revisions enable row level security;

drop policy if exists manager_memo_revisions_select_manager on public.manager_memo_revisions;
create policy manager_memo_revisions_select_manager
on public.manager_memo_revisions
for select
to authenticated
using (
  exists (
    select 1
    from public.user_access ua
    where ua.auth_user_id = auth.uid()
      and ua.role = 'manager'
      and ua.active = true
  )
);

-- ---------------------------------------------------------------------------
-- 2. Short-term safety checkpoints for destructive working-copy operations.
--    These are NOT official Draft/Final history.
-- ---------------------------------------------------------------------------

create table if not exists public.manager_memo_recovery_snapshots (
  id uuid primary key default gen_random_uuid(),
  memo_id uuid not null references public.manager_memos(id) on delete cascade,
  reporting_date date not null,
  reason text not null default 'safety_checkpoint',
  document jsonb not null,
  source_snapshot jsonb not null default '[]'::jsonb,
  working_revision integer not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_by_label text
);

create index if not exists manager_memo_recovery_snapshots_memo_created_idx
  on public.manager_memo_recovery_snapshots (memo_id, created_at desc);
create index if not exists manager_memo_recovery_snapshots_date_created_idx
  on public.manager_memo_recovery_snapshots (reporting_date desc, created_at desc);

alter table public.manager_memo_recovery_snapshots enable row level security;

drop policy if exists manager_memo_recovery_snapshots_select_manager on public.manager_memo_recovery_snapshots;
create policy manager_memo_recovery_snapshots_select_manager
on public.manager_memo_recovery_snapshots
for select
to authenticated
using (
  exists (
    select 1
    from public.user_access ua
    where ua.auth_user_id = auth.uid()
      and ua.role = 'manager'
      and ua.active = true
  )
);

-- ---------------------------------------------------------------------------
-- 3. Canonical write boundary.
--    Retire the old direct-write architecture instead of keeping compatibility.
-- ---------------------------------------------------------------------------

drop policy if exists manager_memos_insert_manager on public.manager_memos;
drop policy if exists manager_memos_update_manager on public.manager_memos;

revoke insert, update, delete on table public.manager_memos from authenticated;
grant select on table public.manager_memos to authenticated;

revoke insert, update, delete on table public.manager_memo_revisions from authenticated;
grant select on table public.manager_memo_revisions to authenticated;

revoke insert, update, delete on table public.manager_memo_recovery_snapshots from authenticated;
grant select on table public.manager_memo_recovery_snapshots to authenticated;

drop function if exists public.save_manager_memo(date, jsonb, jsonb, integer, text);

-- ---------------------------------------------------------------------------
-- 4. Recovery save: one mutable working copy, optimistic concurrency.
-- ---------------------------------------------------------------------------

create or replace function public.save_manager_memo_recovery(
  p_reporting_date date,
  p_document jsonb,
  p_source_snapshot jsonb,
  p_expected_revision integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_memo public.manager_memos%rowtype;
begin
  if v_uid is null or not exists (
    select 1 from public.user_access ua
    where ua.auth_user_id = v_uid
      and ua.role = 'manager'
      and ua.active = true
  ) then
    raise exception 'MANAGER_ACCESS_REQUIRED';
  end if;

  select * into v_memo
  from public.manager_memos
  where reporting_date = p_reporting_date
  for update;

  if not found then
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception 'MANAGER_MEMO_CONFLICT';
    end if;

    insert into public.manager_memos (
      id, reporting_date, document, source_snapshot, status, revision,
      created_by, updated_by, created_at, updated_at, finalized_at
    ) values (
      gen_random_uuid(), p_reporting_date,
      coalesce(p_document, '{}'::jsonb),
      coalesce(p_source_snapshot, '[]'::jsonb),
      'draft', 1,
      v_uid, v_uid, now(), now(), null
    ) returning * into v_memo;
  else
    if coalesce(v_memo.revision, 0) <> coalesce(p_expected_revision, 0) then
      raise exception 'MANAGER_MEMO_CONFLICT';
    end if;

    update public.manager_memos
    set document = coalesce(p_document, '{}'::jsonb),
        source_snapshot = coalesce(p_source_snapshot, '[]'::jsonb),
        status = 'draft',
        revision = coalesce(revision, 0) + 1,
        updated_by = v_uid,
        updated_at = now()
    where id = v_memo.id
    returning * into v_memo;
  end if;

  return to_jsonb(v_memo);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Explicit immutable revision save: Save = Draft, Print = Final.
-- ---------------------------------------------------------------------------

create or replace function public.save_manager_memo_revision(
  p_reporting_date date,
  p_document jsonb,
  p_source_snapshot jsonb,
  p_expected_revision integer,
  p_revision_type text,
  p_reason text default null,
  p_actor_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_memo public.manager_memos%rowtype;
  v_revision public.manager_memo_revisions%rowtype;
  v_next_number integer;
  v_type text := lower(coalesce(p_revision_type, ''));
begin
  if v_uid is null or not exists (
    select 1 from public.user_access ua
    where ua.auth_user_id = v_uid
      and ua.role = 'manager'
      and ua.active = true
  ) then
    raise exception 'MANAGER_ACCESS_REQUIRED';
  end if;

  if v_type not in ('draft', 'final') then
    raise exception 'INVALID_MANAGER_MEMO_REVISION_TYPE';
  end if;

  select * into v_memo
  from public.manager_memos
  where reporting_date = p_reporting_date
  for update;

  if not found then
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception 'MANAGER_MEMO_CONFLICT';
    end if;

    insert into public.manager_memos (
      id, reporting_date, document, source_snapshot, status, revision,
      created_by, updated_by, finalized_by, finalized_at,
      created_at, updated_at
    ) values (
      gen_random_uuid(), p_reporting_date,
      coalesce(p_document, '{}'::jsonb),
      coalesce(p_source_snapshot, '[]'::jsonb),
      'draft', 1,
      v_uid, v_uid,
      case when v_type = 'final' then v_uid else null end,
      case when v_type = 'final' then now() else null end,
      now(), now()
    ) returning * into v_memo;
  else
    if coalesce(v_memo.revision, 0) <> coalesce(p_expected_revision, 0) then
      raise exception 'MANAGER_MEMO_CONFLICT';
    end if;

    update public.manager_memos
    set document = coalesce(p_document, '{}'::jsonb),
        source_snapshot = coalesce(p_source_snapshot, '[]'::jsonb),
        status = 'draft',
        revision = coalesce(revision, 0) + 1,
        updated_by = v_uid,
        updated_at = now(),
        finalized_by = case when v_type = 'final' then v_uid else finalized_by end,
        finalized_at = case when v_type = 'final' then now() else finalized_at end
    where id = v_memo.id
    returning * into v_memo;
  end if;

  select coalesce(max(revision_number), 0) + 1
    into v_next_number
  from public.manager_memo_revisions
  where memo_id = v_memo.id;

  insert into public.manager_memo_revisions (
    memo_id, revision_number, revision_type, reason,
    document, source_snapshot, created_at, created_by, created_by_label
  ) values (
    v_memo.id,
    v_next_number,
    v_type,
    coalesce(nullif(p_reason, ''), case when v_type = 'final' then 'print' else 'save' end),
    coalesce(p_document, '{}'::jsonb),
    coalesce(p_source_snapshot, '[]'::jsonb),
    now(), v_uid, nullif(trim(coalesce(p_actor_label, '')), '')
  ) returning * into v_revision;

  return jsonb_build_object(
    'memo', to_jsonb(v_memo),
    'revision', to_jsonb(v_revision)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Official version History APIs.
-- ---------------------------------------------------------------------------

create or replace function public.list_manager_memo_revisions(p_reporting_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null or not exists (
    select 1 from public.user_access ua
    where ua.auth_user_id = v_uid
      and ua.role = 'manager'
      and ua.active = true
  ) then
    raise exception 'MANAGER_ACCESS_REQUIRED';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.revision_number desc), '[]'::jsonb)
  into v_result
  from (
    select r.*
    from public.manager_memo_revisions r
    join public.manager_memos m on m.id = r.memo_id
    where m.reporting_date = p_reporting_date
  ) x;

  return v_result;
end;
$$;

create or replace function public.get_manager_memo_revision(p_revision_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_revision public.manager_memo_revisions%rowtype;
begin
  if v_uid is null or not exists (
    select 1 from public.user_access ua
    where ua.auth_user_id = v_uid
      and ua.role = 'manager'
      and ua.active = true
  ) then
    raise exception 'MANAGER_ACCESS_REQUIRED';
  end if;

  select r.* into v_revision
  from public.manager_memo_revisions r
  join public.manager_memos m on m.id = r.memo_id
  where r.id = p_revision_id;

  if not found then return null; end if;
  return to_jsonb(v_revision);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Reporting-night archive for the permanent left History sidebar.
--    Preferred view = latest Final when one exists; otherwise latest Draft;
--    otherwise the recovery working copy is still available through manager_memos.
-- ---------------------------------------------------------------------------

create or replace function public.list_manager_memo_archive()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null or not exists (
    select 1 from public.user_access ua
    where ua.auth_user_id = v_uid
      and ua.role = 'manager'
      and ua.active = true
  ) then
    raise exception 'MANAGER_ACCESS_REQUIRED';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.reporting_date desc), '[]'::jsonb)
  into v_result
  from (
    select
      m.id as memo_id,
      m.reporting_date,
      m.updated_at as recovery_updated_at,
      m.revision as working_revision,
      (select count(*)::integer from public.manager_memo_revisions r where r.memo_id = m.id) as revision_count,
      exists(select 1 from public.manager_memo_revisions r where r.memo_id = m.id and r.revision_type = 'draft') as has_draft,
      exists(select 1 from public.manager_memo_revisions r where r.memo_id = m.id and r.revision_type = 'final') as has_final,
      latest.id as latest_revision_id,
      latest.revision_number as latest_revision_number,
      latest.revision_type as latest_revision_type,
      latest.created_at as latest_revision_created_at,
      latest.created_by_label as latest_revision_created_by_label,
      coalesce(final_rev.id, latest.id) as preferred_revision_id,
      coalesce(final_rev.revision_number, latest.revision_number) as preferred_revision_number,
      coalesce(final_rev.revision_type, latest.revision_type) as preferred_revision_type,
      coalesce(final_rev.created_at, latest.created_at) as preferred_revision_created_at
    from public.manager_memos m
    left join lateral (
      select r.*
      from public.manager_memo_revisions r
      where r.memo_id = m.id
      order by r.revision_number desc
      limit 1
    ) latest on true
    left join lateral (
      select r.*
      from public.manager_memo_revisions r
      where r.memo_id = m.id and r.revision_type = 'final'
      order by r.revision_number desc
      limit 1
    ) final_rev on true
  ) x;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Safety checkpoint APIs. Keep only the ten newest per reporting night.
-- ---------------------------------------------------------------------------

create or replace function public.checkpoint_manager_memo(
  p_reporting_date date,
  p_reason text default 'safety_checkpoint',
  p_actor_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_memo public.manager_memos%rowtype;
  v_snapshot public.manager_memo_recovery_snapshots%rowtype;
begin
  if v_uid is null or not exists (
    select 1 from public.user_access ua
    where ua.auth_user_id = v_uid
      and ua.role = 'manager'
      and ua.active = true
  ) then
    raise exception 'MANAGER_ACCESS_REQUIRED';
  end if;

  select * into v_memo
  from public.manager_memos
  where reporting_date = p_reporting_date
  for update;

  if not found then return null; end if;

  insert into public.manager_memo_recovery_snapshots (
    memo_id, reporting_date, reason, document, source_snapshot,
    working_revision, created_at, created_by, created_by_label
  ) values (
    v_memo.id,
    v_memo.reporting_date,
    coalesce(nullif(trim(p_reason), ''), 'safety_checkpoint'),
    v_memo.document,
    coalesce(v_memo.source_snapshot, '[]'::jsonb),
    coalesce(v_memo.revision, 0),
    now(), v_uid, nullif(trim(coalesce(p_actor_label, '')), '')
  ) returning * into v_snapshot;

  delete from public.manager_memo_recovery_snapshots old
  where old.memo_id = v_memo.id
    and old.id in (
      select id
      from public.manager_memo_recovery_snapshots
      where memo_id = v_memo.id
      order by created_at desc, id desc
      offset 10
    );

  return to_jsonb(v_snapshot);
end;
$$;

create or replace function public.list_manager_memo_checkpoints(p_reporting_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null or not exists (
    select 1 from public.user_access ua
    where ua.auth_user_id = v_uid
      and ua.role = 'manager'
      and ua.active = true
  ) then
    raise exception 'MANAGER_ACCESS_REQUIRED';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select s.*
    from public.manager_memo_recovery_snapshots s
    where s.reporting_date = p_reporting_date
  ) x;

  return v_result;
end;
$$;

create or replace function public.get_manager_memo_checkpoint(p_checkpoint_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_snapshot public.manager_memo_recovery_snapshots%rowtype;
begin
  if v_uid is null or not exists (
    select 1 from public.user_access ua
    where ua.auth_user_id = v_uid
      and ua.role = 'manager'
      and ua.active = true
  ) then
    raise exception 'MANAGER_ACCESS_REQUIRED';
  end if;

  select * into v_snapshot
  from public.manager_memo_recovery_snapshots
  where id = p_checkpoint_id;

  if not found then return null; end if;
  return to_jsonb(v_snapshot);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Execute permissions: canonical RPC surface only.
-- ---------------------------------------------------------------------------

revoke all on function public.save_manager_memo_recovery(date, jsonb, jsonb, integer) from public;
revoke all on function public.save_manager_memo_revision(date, jsonb, jsonb, integer, text, text, text) from public;
revoke all on function public.list_manager_memo_revisions(date) from public;
revoke all on function public.get_manager_memo_revision(uuid) from public;
revoke all on function public.list_manager_memo_archive() from public;
revoke all on function public.checkpoint_manager_memo(date, text, text) from public;
revoke all on function public.list_manager_memo_checkpoints(date) from public;
revoke all on function public.get_manager_memo_checkpoint(uuid) from public;

grant execute on function public.save_manager_memo_recovery(date, jsonb, jsonb, integer) to authenticated;
grant execute on function public.save_manager_memo_revision(date, jsonb, jsonb, integer, text, text, text) to authenticated;
grant execute on function public.list_manager_memo_revisions(date) to authenticated;
grant execute on function public.get_manager_memo_revision(uuid) to authenticated;
grant execute on function public.list_manager_memo_archive() to authenticated;
grant execute on function public.checkpoint_manager_memo(date, text, text) to authenticated;
grant execute on function public.list_manager_memo_checkpoints(date) to authenticated;
grant execute on function public.get_manager_memo_checkpoint(uuid) to authenticated;

commit;
