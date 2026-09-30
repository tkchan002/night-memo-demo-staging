import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const sql = await readFile(
  path.join(root, 'supabase/migrations/20260930_ward_report_form_version_resolution.sql'),
  'utf8',
);

test('form version is resolved from report date, not a magic version', () => {
  assert.match(sql, /create or replace function public\.resolve_form_version_for_date/);
  assert.match(sql, /fv\.effective_from <= p_report_date/);
  assert.match(sql, /fv\.effective_to is null or fv\.effective_to >= p_report_date/);
  assert.match(sql, /fv\.status in \('published', 'retired'\)/);
  assert.doesNotMatch(sql, /v_capacity\s*,\s*2\s*,/);
  assert.doesNotMatch(sql, /form_version\s*=\s*coalesce\([^\n]*,\s*2\)/);
});

test('ward_reports enforces the resolved form version at the table boundary', () => {
  assert.match(sql, /create trigger trg_ward_reports_form_version/);
  assert.match(sql, /before insert or update of report_date, form_version/);
  assert.match(sql, /new\.form_version := public\.resolve_form_version_for_date\(new\.report_date\)/);
});

test('drafts receive the same invariant when draft storage has form_version', () => {
  assert.match(sql, /to_regclass\('public\.ward_report_drafts'\)/);
  assert.match(sql, /trg_ward_report_drafts_form_version/);
});

test('normal Ward submit and generated Test Data share the resolver', () => {
  const occurrences = sql.match(/resolve_form_version_for_date\(v_report_date\)/g) || [];
  assert.ok(occurrences.length >= 2, 'both write RPCs must resolve form version by report date');
  assert.match(sql, /create or replace function public\.save_ward_report_session/);
  assert.match(sql, /create or replace function public\.import_generated_demo_batch/);
});

test('missing form configuration produces an explicit configuration error', () => {
  assert.match(sql, /No published\/retired form version is effective on/);
  assert.match(sql, /Create or correct a form_versions row/);
});
