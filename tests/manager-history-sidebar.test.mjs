import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('Manager History is a source-defined sidebar/archive view, not the old modal', () => {
  const html = read('manager.html');
  assert.match(html, /id="managerHistorySidebar"/);
  assert.match(html, /id="managerHistoryNightList"/);
  assert.match(html, /id="managerArchiveViewer"/);
  assert.match(html, /id="archiveRevisionList"/);
  assert.match(html, /id="archiveMemoFrame"/);
  assert.doesNotMatch(html, /id="historyModal"/);
  assert.doesNotMatch(html, /id="historyBody"/);
});

test('History mode hides the live Manager workspace and returns explicitly', () => {
  const js = read('pages/manager-page.js');
  assert.match(js, /async function enterHistoryMode\(\)/);
  assert.match(js, /#managerHistorySidebar'\)\.hidden = false/);
  assert.match(js, /#editorArea'\)\.hidden = true/);
  assert.match(js, /function exitHistoryMode\(\)/);
  assert.match(js, /state\.historyReturnMode/);
});

test('archive lists every reporting night and prefers Final over Draft over recovery', () => {
  const js = read('pages/manager-page.js');
  const repo = read('data/repositories/manager-memo-repository.js');
  const sql = read('supabase/migrations/20260930_manager_memo_lifecycle_hardening.sql');
  assert.match(js, /listManagerMemoArchive\(\)/);
  assert.match(js, /revisions\.find\(row => row\.revision_type === 'final'\) \|\| revisions\[0\]/);
  assert.match(repo, /supabase\.rpc\('list_manager_memo_archive'\)/);
  assert.match(sql, /create or replace function public\.list_manager_memo_archive\(\)/i);
  assert.match(sql, /coalesce\(final_rev\.id, latest\.id\) as preferred_revision_id/i);
});

test('past reporting nights are read-only and only the current night can restore a version', () => {
  const js = read('pages/manager-page.js');
  assert.match(js, /const mayRestore = state\.archiveSelectedDate === state\.reportingDate/);
  assert.match(js, /if \(state\.archiveSelectedDate !== state\.reportingDate\) return;/);
});

test('destructive Manager operations keep safety recovery checkpoints', () => {
  const js = read('pages/manager-page.js');
  const sql = read('supabase/migrations/20260930_manager_memo_lifecycle_hardening.sql');
  assert.match(js, /checkpointCurrentWorkingCopy\('before_start_new'\)/);
  assert.match(js, /checkpointCurrentWorkingCopy\('before_regenerate_ward_sections'\)/);
  assert.match(js, /checkpointCurrentWorkingCopy\(checkpointReason\)/);
  assert.match(sql, /create table if not exists public\.manager_memo_recovery_snapshots/i);
  assert.match(sql, /offset 10/i);
});
