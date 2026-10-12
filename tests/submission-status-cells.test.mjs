import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { wardSubmissionStates, managerSubmissionStatus } from '../domain/submission-status.js';

const pm = { id: 'pm', submitted_at: '2026-10-12T15:40:00Z' };
const night = { id: 'night', submitted_at: '2026-10-12T20:02:00Z' };

test('one ward can simultaneously have green PM status and red Night status', () => {
  const status = wardSubmissionStates({ pmReport: pm });
  assert.equal(status.pm.state, 'submitted');
  assert.equal(status.pm.label, 'Submitted 23:40');
  assert.equal(status.night.state, 'missing');
  assert.equal(status.night.label, 'Not submitted');
  assert.deepEqual(status.missingTypes, ['night']);
  assert.equal(status.completeness, 'partial');
});

test('complete and wholly missing wards are distinct; status uses source not time window', () => {
  assert.equal(wardSubmissionStates({ pmReport: pm, nightReport: night }).completeness, 'complete');
  assert.equal(wardSubmissionStates({}).completeness, 'missing');
  assert.deepEqual(wardSubmissionStates({}).missingTypes, ['pm','night']);
  assert.equal(managerSubmissionStatus(pm).state, 'submitted');
});

test('Manager renders independent status classes and no row-wide warning colours', async () => {
  const css = await readFile(new URL('../css/manager.css', import.meta.url), 'utf8');
  const page = await readFile(new URL('../pages/manager-page.js', import.meta.url), 'utf8');
  assert.match(page, /wardSubmissionStates\(entry\)/);
  assert.match(page, /statusCell\(status\.pm, 'PM'\)/);
  assert.match(page, /statusCell\(status\.night, 'Night'\)/);
  assert.match(page, /memo-status--\$\{status\.state\}/);
  assert.doesNotMatch(page, /<tr class="\$\{newer \? 'newer'/);
  assert.match(css, /\.memo-status--submitted\{color:#126b35;/);
  assert.match(css, /\.memo-status--missing\{color:#b02222;/);
  assert.match(css, /\.submission-table tbody tr:nth-child\(even\) td/);
  assert.doesNotMatch(css, /\.submission-table tr\.(?:submitted|missing|newer) td/);
});
