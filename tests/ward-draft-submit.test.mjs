import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../pages/ward-page.js', import.meta.url), 'utf8');
const service = await readFile(new URL('../services/report-service.js', import.meta.url), 'utf8');
const repo = await readFile(new URL('../data/repositories/report-repository.js', import.meta.url), 'utf8');
const sql = await readFile(new URL('../supabase/migrations/20260928_ward_draft_submit.sql', import.meta.url), 'utf8');

test('Save and Submit use memo-type-scoped storage rather than a rolling window', () => {
  assert.match(page, /saveWardDraft\(/);
  assert.match(page, /submitWardReport\(/);
  assert.match(service, /db\.saveWardCycleDraft\(row\)/);
  assert.match(service, /db\.submitWardCycleReport\(row\)/);
  assert.match(service, /db\.deleteWardCycleDraft\(wardId, date, memoType\)/);
  assert.doesNotMatch(service, /db\.saveWardReportSession\(/);
});

test('Ward UI exposes both memo types and their independent submission status', () => {
  assert.match(page, /submitButton\.textContent = 'Submit'/);
  assert.match(page, /\$\('#memoType'\)\.addEventListener\('change', handleMemoTypeChange\)/);
  assert.match(page, /Memo: Submitted|\$\{esc\(typeLabel\)\}: Submitted/);
  assert.match(page, /\$\{esc\(typeLabel\)\}: Not submitted/);
  assert.match(page, /Draft changes pending re-submit/);
  assert.match(page, /handleGen\\\(/);
  assert.match(page, /save pdf/i);
});

test('Draft schema is separate from ward_reports and access is ward-scoped', () => {
  assert.match(sql, /create table if not exists public\.ward_report_drafts/i);
  assert.match(sql, /ua\.role = 'ward'/i);
  assert.match(sql, /ua\.ward_id = p_ward_id/i);
  assert.match(sql, /get_ward_submission_status/i);
});

test('Live form version remains the registered version 1', () => {
  assert.match(service, /form_version:\s*1/);
  assert.doesNotMatch(service, /form_version:\s*2/);
});

test('Repository exposes draft persistence without changing Manager recent-submission query', () => {
  assert.match(repo, /export async function saveWardReportDraft/);
  assert.match(repo, /export async function getWardSubmissionStatus/);
  assert.match(repo, /\.gte\('submitted_at', cutoff\)/);
});
