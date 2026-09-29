import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('Manager UI uses Save / History / Preview / Print and retires Finalize/Reopen', () => {
  const html = read('manager.html');
  assert.match(html, /id="saveMemoBtn">Save</);
  assert.match(html, /id="historyBtn">History</);
  assert.match(html, /id="previewMemoBtn">Preview</);
  assert.match(html, /id="printMemoBtn">Print</);
  assert.doesNotMatch(html, /Finalize/);
  assert.doesNotMatch(html, /Reopen Draft/);
});

test('Manager login has workspace chooser instead of automatic editor-only flow', () => {
  const html = read('manager.html');
  const js = read('pages/manager-page.js');
  assert.match(html, /id="memoWorkspacePanel"/);
  assert.match(html, /id="continueDraftBtn"/);
  assert.match(html, /id="startNewBtn"/);
  assert.match(js, /renderWorkspace\(\)/);
  assert.doesNotMatch(js, /loadOrCreateMemo\(/);
});

test('Save creates Draft revision and Print creates Final revision', () => {
  const js = read('pages/manager-page.js');
  assert.match(js, /saveOfficialRevision\('draft', 'save'\)/);
  assert.match(js, /saveOfficialRevision\('final', 'print'\)/);
  assert.match(js, /result\.revision\.document/);
});

test('autosave uses recovery path rather than history revision path', () => {
  const js = read('pages/manager-page.js');
  assert.match(js, /setTimeout\(\(\) => saveRecoveryNow\(\)/);
  assert.match(js, /saveManagerMemoRecovery/);
});

test('print renderer has no second app-level Print button', () => {
  const js = read('manager-memo-print.js');
  assert.doesNotMatch(js, /onclick="window\.print\(\)"/);
  assert.match(js, /N\.O\.\/APN,/);
  assert.match(js, /DOM\/Medical \(QEH\)/);
});

test('migration creates immutable revision table and history RPCs', () => {
  const sql = read('supabase/migrations/20260929_manager_memo_history.sql');
  assert.match(sql, /create table if not exists public\.manager_memo_revisions/i);
  assert.match(sql, /save_manager_memo_recovery/i);
  assert.match(sql, /save_manager_memo_revision/i);
  assert.match(sql, /list_manager_memo_revisions/i);
  assert.match(sql, /get_manager_memo_revision/i);
});
