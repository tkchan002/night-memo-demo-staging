-- Manager Night Memo lifecycle upgrade
-- User-facing rules:
--   Save  = immutable Draft revision
--   Print = immutable Final revision, then print that exact snapshot
-- Autosave updates only the working recovery copy in manager_memos.

create table if not exists public.manager_memo_revisions (
  id uuid primary key default gen_random_uuid(),
  memo_id uuid not null references public.manager_memos(id) on delete cascade,
  revision_number integer not null,
  revision_type text not null check (revision_type in ('draft', 'final')),
  reason text not null default 'save',
  document jsonb not null,
  source_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_by_label text,
  constraint manager_memo_revisions_number_unique unique (memo_id, revision_number)
);

create index if not exists manager_memo_revisions_memo_created_idx
  on public.manager_memo_revisions (memo_id, created_at desc);

alter table public.manager_memo_revisions enable row level security;

drop policy if exists manager_memo_revisions_select_manager on public.manager_memo_revisions;
create policy manager_memo_revisions_select_manager
on public.manager_memo_revisions
for select
to authenticated
using (
  exists (
    select 1 from public.user_access ua
    where ua.auth_user_id = auth.uid()
      and ua.role = 'manager'
  )
);

-- Preserve the document already in manager_memos when this migration is applied.
-- This gives an existing installation a starting point in History instead of losing context.
insert into public.manager_memo_revisions (
  memo_id,
  revision_number,
  revision_type,
  reason,
  document,
  source_snapshot,
  created_at,
  created_by,
  created_by_label
)
select
  m.id,
  1,
  case when m.status = 'finalized' then 'final' else 'draft' end,
  'migration_snapshot',
  m.document,
  coalesce(m.source_snapshot, '[]'::jsonb),
  coalesce(m.updated_at, m.created_at, now()),
  null,
  'Existing Night Memo'
from public.manager_memos m
where not exists (
  select 1 from public.manager_memo_revisions r where r.memo_id = m.id
);

create or replace function public.save_manager_memo_recovery(
  p_reporting_date date,
  p_document jsonb,
  p_source_snapshot jsonb,
  p_expected_revision integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_memo public.manager_memos%rowtype;
begin
  if v_uid is null or not exists (
    select 1 from public.user_access ua
    where ua.auth_user_id = v_uid and ua.role = 'manager'
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
      created_at, updated_at, finalized_at
    ) values (
      gen_random_uuid(), p_reporting_date, p_document,
      coalesce(p_source_snapshot, '[]'::jsonb), 'draft', 1,
      now(), now(), null
    ) returning * into v_memo;
  else
    if coalesce(v_memo.revision, 0) <> coalesce(p_expected_revision, 0) then
      raise exception 'MANAGER_MEMO_CONFLICT';
    end if;

    update public.manager_memos
    set document = p_document,
        source_snapshot = coalesce(p_source_snapshot, '[]'::jsonb),
        status = 'draft',
        revision = coalesce(revision, 0) + 1,
        updated_at = now()
    where id = v_memo.id
    returning * into v_memo;
  end if;

  return to_jsonb(v_memo);
end;
$$;

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
set search_path = public
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
    where ua.auth_user_id = v_uid and ua.role = 'manager'
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
      created_at, updated_at, finalized_at
    ) values (
      gen_random_uuid(), p_reporting_date, p_document,
      coalesce(p_source_snapshot, '[]'::jsonb), 'draft', 1,
      now(), now(), case when v_type = 'final' then now() else null end
    ) returning * into v_memo;
  else
    if coalesce(v_memo.revision, 0) <> coalesce(p_expected_revision, 0) then
      raise exception 'MANAGER_MEMO_CONFLICT';
    end if;

    update public.manager_memos
    set document = p_document,
        source_snapshot = coalesce(p_source_snapshot, '[]'::jsonb),
        -- The working copy remains editable even after Print.
        status = 'draft',
        revision = coalesce(revision, 0) + 1,
        updated_at = now(),
        finalized_at = case when v_type = 'final' then now() else finalized_at end
    where id = v_memo.id
    returning * into v_memo;
  end if;

  select coalesce(max(revision_number), 0) + 1
    into v_next_number
  from public.manager_memo_revisions
  where memo_id = v_memo.id;

  insert into public.manager_memo_revisions (
    memo_id,
    revision_number,
    revision_type,
    reason,
    document,
    source_snapshot,
    created_at,
    created_by,
    created_by_label
  ) values (
    v_memo.id,
    v_next_number,
    v_type,
    coalesce(nullif(p_reason, ''), case when v_type = 'final' then 'print' else 'save' end),
    p_document,
    coalesce(p_source_snapshot, '[]'::jsonb),
    now(),
    v_uid,
    nullif(trim(coalesce(p_actor_label, '')), '')
  ) returning * into v_revision;

  return jsonb_build_object(
    'memo', to_jsonb(v_memo),
    'revision', to_jsonb(v_revision)
  );
end;
$$;

create or replace function public.list_manager_memo_revisions(
  p_reporting_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null or not exists (
    select 1 from public.user_access ua
    where ua.auth_user_id = v_uid and ua.role = 'manager'
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

create or replace function public.get_manager_memo_revision(
  p_revision_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_revision public.manager_memo_revisions%rowtype;
begin
  if v_uid is null or not exists (
    select 1 from public.user_access ua
    where ua.auth_user_id = v_uid and ua.role = 'manager'
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

revoke all on function public.save_manager_memo_recovery(date, jsonb, jsonb, integer) from public;
revoke all on function public.save_manager_memo_revision(date, jsonb, jsonb, integer, text, text, text) from public;
revoke all on function public.list_manager_memo_revisions(date) from public;
revoke all on function public.get_manager_memo_revision(uuid) from public;

grant execute on function public.save_manager_memo_recovery(date, jsonb, jsonb, integer) to authenticated;
grant execute on function public.save_manager_memo_revision(date, jsonb, jsonb, integer, text, text, text) to authenticated;
grant execute on function public.list_manager_memo_revisions(date) to authenticated;
grant execute on function public.get_manager_memo_revision(uuid) to authenticated;
