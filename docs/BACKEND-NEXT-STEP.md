# Backend next steps that require the real Supabase definitions

The public staging repository does not contain the authoritative `ward_reports` table DDL, ward/report RLS policies, audit triggers, or all existing database function bodies. Those details define the real authorization and transaction boundary, so this refactor does not invent production SQL that could weaken RLS or conflict with existing constraints.

## 1. Optimistic concurrency for ward reports

The frontend now prevents duplicate submission in one browser, but two workstations can still edit the same ward/date concurrently while persistence remains an unconditional upsert.

Recommended contract once the schema is available:

1. Add `revision bigint not null default 1` to `ward_reports`.
2. Return `revision` on every report read.
3. Replace browser upsert with a `save_ward_report` database function accepting `expected_revision`.
4. In one transaction, update only where `revision = expected_revision`, increment the revision, and create the audit record.
5. If no row is updated, return a conflict and force reload/merge rather than overwriting another workstation's work.
6. Preserve the current RLS/authorization model inside that function; do not use a broad `security definer` function without a deliberate privilege review.

## 2. Transactional ward creation

Live ward creation currently needs a ward row, an operating period and an initial capacity record. Those writes should become one database operation so a failure cannot leave a partially configured ward.

Recommended contract:

1. Add a `create_ward_with_initial_configuration` RPC after reviewing existing constraints/RLS.
2. Insert the ward, first operating period, first capacity history row and audit record in one transaction.
3. Return the created ward to the Maintenance page.
4. Retain unique ward-code validation and enforce it at the database level.

## 3. Commit the backend source

Before implementing either RPC, add migrations for the real tables, constraints, indexes, RLS policies and existing functions/Edge Functions to version control. That makes frontend and backend changes reviewable as one system.
