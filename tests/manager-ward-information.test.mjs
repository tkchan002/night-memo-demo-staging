import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = file => readFile(path.join(root, file), 'utf8');

const managerHtml = await read('manager.html');
const managerPage = await read('pages/manager-page.js');
const tabs = await read('components/manager-tabs.js');
const print = await read('manager-memo-print.js');
const wardPrint = await read('ward-print.js');
const ops = await read('pages/manager-night-operations.js');

test('Manager has four source-defined primary workspaces in the requested order', () => {
  const names = [...managerHtml.matchAll(/data-manager-tab="([^"]+)"/g)].map(match => match[1]);

  assert.deepEqual(names.slice(0, 4), [
    'submission',
    'ward-info',
    'memo',
    'staffing'
  ]);

  assert.match(managerHtml, />Submission Status</);
  assert.match(managerHtml, />Ward Information</);
  assert.match(managerHtml, />Night Memo</);
  assert.match(managerHtml, />Night Staffing</);
  assert.doesNotMatch(managerHtml, /onclick=/i);
});

test('official Night Memo editor and print contract exclude Ward clinical/additional information', () => {
  assert.doesNotMatch(
    managerHtml,
    /id="memoClinicalNotes"|id="memoAdditionalItems"/
  );

  assert.doesNotMatch(
    print,
    /Clinical \/ General Notes|Additional Report Items/
  );

  assert.match(managerPage, /clinicalNotesHtml: _legacyClinical/);
  assert.match(managerPage, /additionalItemsHtml: _legacyAdditional/);
});

test('Ward Information is source-owned and read-only', () => {
  assert.match(managerHtml, /id="wardInformationList"/);
  assert.match(managerPage, /buildManagerWardInformation/);

  // The Ward Information workspace uses separate source-owned sections.
  // The obsolete combined Clinical / General Information abstraction must not return.
  assert.doesNotMatch(managerPage, /Clinical \/ General Information/);

  assert.match(managerPage, /Patient List/);
  assert.match(managerPage, /Consultation/);
  assert.match(managerPage, /Intubation/);
  assert.match(managerPage, /Additional Report Items/);

  const panel =
    managerHtml.match(
      /data-manager-tab-panel="ward-info"[^]*?<\/section>\s*<\/section>/
    )?.[0] || '';

  assert.doesNotMatch(panel, /contenteditable="true"/);
});

test('Manager reuses the Ward paper renderer instead of implementing a second Ward memo renderer', () => {
  assert.match(managerPage, /import\('\.\.\/ward-print\.js'\)/);
  assert.match(managerPage, /writeWardMemoToIframe/);
  assert.match(managerPage, /printWardMemo/);
  assert.match(managerHtml, /id="wardMemoPreviewFrame"/);
  assert.match(wardPrint, /export function renderWardMemoHtml/);
  assert.match(
    wardPrint,
    /ward\?\.name\|\|ward\?\.display_name\|\|ward\?\.code/
  );
  assert.doesNotMatch(managerPage, /renderFullReport/);
});

test('Night Staffing is a source-defined tab with consolidated Ward and Runner tables', () => {
  assert.match(managerHtml, /id="nightWardStaffRows"/);
  assert.match(managerHtml, /id="nightRunnerRows"/);
  assert.doesNotMatch(
    managerHtml,
    /nightWardListDisclosure|nightRunnerListDisclosure/
  );

  assert.match(ops, /nightWardStaffRows/);
  assert.match(ops, /nightRunnerRows/);

  assert.doesNotMatch(
    ops,
    /document\.createElement\(['"]section['"]\)|installPanel|installStyles/
  );
});

test('Manager tab controller owns navigation and History disables the whole workspace', () => {
  assert.match(tabs, /ArrowLeft/);
  assert.match(tabs, /aria-selected/);
  assert.match(managerPage, /managerTabs\?\.setEnabled\(false\)/);
  assert.match(managerPage, /managerTabsShell'\)\.hidden = true/);
  assert.match(managerPage, /managerTabs\?\.setEnabled\(true\)/);
});