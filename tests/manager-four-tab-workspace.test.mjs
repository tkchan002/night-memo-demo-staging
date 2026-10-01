import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = file => readFile(path.join(root, file), 'utf8');
const html = await read('manager.html');
const page = await read('pages/manager-page.js');
const tabs = await read('components/manager-tabs.js');
const print = await read('manager-memo-print.js');
const wardPrint = await read('ward-print.js');
const ops = await read('pages/manager-night-operations.js');

test('Manager has four source-defined primary workspaces in the requested order', () => {
  const names = [...html.matchAll(/data-manager-tab="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(names.slice(0, 4), ['submission', 'ward-info', 'memo', 'staffing']);
  assert.match(html, />Submission Status</);
  assert.match(html, />Ward Information</);
  assert.match(html, />Night Memo</);
  assert.match(html, />Night Staffing</);
  assert.doesNotMatch(html, /onclick=/i);
});

test('official Night Memo editor and print contract exclude Ward clinical/additional information', () => {
  assert.doesNotMatch(html, /id="memoClinicalNotes"|id="memoAdditionalItems"/);
  assert.doesNotMatch(print, /Clinical \/ General Notes|Additional Report Items/);
  assert.match(page, /clinicalNotesHtml: _legacyClinical/);
  assert.match(page, /additionalItemsHtml: _legacyAdditional/);
});

test('Ward Information is source-owned and read-only', () => {
  assert.match(html, /id="wardInformationList"/);
  assert.match(page, /buildManagerWardInformation/);
  assert.match(page, /Clinical \/ General Information/);
  assert.match(page, /Additional Report Items/);
  const panel = html.match(/data-manager-tab-panel="ward-info"[^]*?<\/section>\s*<\/section>/)?.[0] || '';
  assert.doesNotMatch(panel, /contenteditable="true"/);
});

test('Manager reuses the Ward paper renderer instead of implementing a second Ward memo renderer', () => {
  assert.match(page, /import\('\.\.\/ward-print\.js'\)/);
  assert.match(page, /writeWardMemoToIframe/);
  assert.match(page, /printWardMemo/);
  assert.match(html, /id="wardMemoPreviewFrame"/);
  assert.match(wardPrint, /export function renderWardMemoHtml/);
  assert.match(wardPrint, /ward\?\.name\|\|ward\?\.display_name\|\|ward\?\.code/);
  assert.doesNotMatch(page, /renderFullReport/);
});

test('Night Staffing is a source-defined tab with consolidated Ward and Runner tables', () => {
  assert.match(html, /id="nightWardStaffRows"/);
  assert.match(html, /id="nightRunnerRows"/);
  assert.doesNotMatch(html, /nightWardListDisclosure|nightRunnerListDisclosure/);
  assert.match(ops, /nightWardStaffRows/);
  assert.match(ops, /nightRunnerRows/);
  assert.doesNotMatch(ops, /document\.createElement\(['"]section['"]\)|installPanel|installStyles/);
});

test('Manager tab controller owns navigation and History disables the whole workspace', () => {
  assert.match(tabs, /ArrowLeft/);
  assert.match(tabs, /aria-selected/);
  assert.match(page, /managerTabs\?\.setEnabled\(false\)/);
  assert.match(page, /managerTabsShell'\)\.hidden = true/);
  assert.match(page, /managerTabs\?\.setEnabled\(true\)/);
});
