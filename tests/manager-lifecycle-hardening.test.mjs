import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('autosave tracks edit generations so a later edit is not marked saved by an older request', () => {
  const js = read('pages/manager-page.js');
  assert.match(js, /state\.editGeneration \+= 1/);
  assert.match(js, /const generation = state\.editGeneration/);
  assert.match(js, /state\.savedGeneration = Math\.max\(state\.savedGeneration, generation\)/);
  assert.match(js, /state\.dirty = state\.editGeneration > state\.savedGeneration/);
  assert.match(js, /state\.saveTimer = setTimeout\(\(\) => saveRecoveryNow\(\)\.catch\(\(\) => \{\}\), 150\)/);
});

test('Save and Print serialize through one persistence queue and freeze editing', () => {
  const js = read('pages/manager-page.js');
  assert.match(js, /let persistenceTail = Promise\.resolve\(\)/);
  assert.match(js, /function enqueuePersistence\(task\)/);
  assert.match(js, /state\.officialSaving = true;\s*setEditingEnabled\(false\)/s);
  assert.match(js, /await flushRecovery\(\)/);
  assert.match(js, /enqueuePersistence\(\(\) => saveManagerMemoRevision/);
});

test('Manager warns before unload and blocks writes after reporting-night rollover', () => {
  const js = read('pages/manager-page.js');
  assert.match(js, /beforeunload/);
  assert.match(js, /function ensureReportingNightCurrent\(\)/);
  assert.match(js, /reportingNightDate\(\)/);
  assert.match(js, /New reporting night — reload required/);
});

test('database write boundary removes obsolete direct Manager writes', () => {
  const sql = read('supabase/migrations/20260930_manager_memo_lifecycle_hardening.sql');
  const repo = read('data/repositories/manager-memo-repository.js');
  const index = read('data/index.js');
  assert.match(sql, /revoke insert, update, delete on table public\.manager_memos from authenticated/i);
  assert.match(sql, /drop function if exists public\.save_manager_memo\(date, jsonb, jsonb, integer, text\)/i);
  assert.doesNotMatch(repo, /export async function saveManagerMemo\(/);
  assert.doesNotMatch(index, /\bsaveManagerMemo,\s*$/m);
});

test('every lifecycle SECURITY DEFINER path requires an active Manager', () => {
  const sql = read('supabase/migrations/20260930_manager_memo_lifecycle_hardening.sql');
  const activeChecks = sql.match(/ua\.role = 'manager'\s+and ua\.active = true/g) || [];
  assert.ok(activeChecks.length >= 8, `expected active-manager checks across lifecycle RPCs, found ${activeChecks.length}`);
});
