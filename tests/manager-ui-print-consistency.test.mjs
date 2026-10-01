import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = relative => readFile(path.join(root, relative), 'utf8');
const managerHtml = await read('manager.html');
const managerCss = await read('css/manager.css');
const operationsJs = await read('pages/manager-night-operations.js');

test('Night Staffing is source markup, not runtime-injected UI', () => {
  assert.match(managerHtml, /data-manager-tab-panel="staffing"/);
  assert.match(managerHtml, /id="nightWardStaffRows"/);
  assert.doesNotMatch(operationsJs, /installPanel|installStyles|document\.createElement\(['"]section['"]\)/);
});

test('Manager UI uses the Ward legacy workspace palette', () => {
  assert.match(managerCss, /background:var\(--legacy-workspace\)/);
  assert.match(managerCss, /border:3px solid var\(--legacy-highlight\)/);
});

test('all Manager printouts use the shared Manager print system and official memo omits Ward information', async () => {
  const memo = await import(pathToFileURL(path.join(root, 'manager-memo-print.js')).href);
  const roster = await import(pathToFileURL(path.join(root, 'night-roster-print.js')).href);
  const printedAt = new Date('2026-09-29T14:00:00Z');
  const memoHtml = memo.renderManagerMemoPrintHtml({ title: 'Night Memo', header: { date: '29/09/2026' }, mainTableRows: [], infectionRows: [], clinicalNotesHtml: 'SHOULD NOT PRINT', additionalItemsHtml: 'SHOULD NOT PRINT' }, { printedAt });
  assert.doesNotMatch(memoHtml, /SHOULD NOT PRINT|Clinical \/ General Notes|Additional Report Items/);
  const staffHtml = roster.renderNightStaffPrintHtml({ reportingDate: '2026-09-29', wardRosters: [], printedAt });
  const runnerHtml = roster.renderNightRunnerPrintHtml({ reportingDate: '2026-09-29', runners: [], printedAt });
  for (const html of [memoHtml, staffHtml, runnerHtml]) {
    assert.match(html, /data-print-system="manager-v2"/);
    assert.match(html, /class="manager-print-page"/);
    assert.match(html, /@page\{size:A4 portrait/);
  }
});
