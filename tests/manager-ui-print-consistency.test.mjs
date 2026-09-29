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
const operationsCss = await read('css/manager-night-operations.css');

test('Night Operations is source markup, not runtime-injected UI', () => {
  assert.match(managerHtml, /<link rel="stylesheet" href="\.\/css\/manager-night-operations\.css">/);
  assert.match(managerHtml, /<section id="nightOperationsPanel"/);
  assert.doesNotMatch(operationsJs, /installPanel|installStyles|document\.createElement\(['"]section['"]\)/);
});

test('Ward and runner lists are collapsed by default in source', () => {
  const wardDetails = managerHtml.match(/<details id="nightWardListDisclosure"[^>]*>/)?.[0] || '';
  const runnerDetails = managerHtml.match(/<details id="nightRunnerListDisclosure"[^>]*>/)?.[0] || '';
  assert.ok(wardDetails, 'ward list disclosure must exist');
  assert.ok(runnerDetails, 'runner list disclosure must exist');
  assert.doesNotMatch(wardDetails, /\bopen\b/);
  assert.doesNotMatch(runnerDetails, /\bopen\b/);
});

test('Manager UI uses the Ward legacy workspace palette', () => {
  assert.match(managerCss, /background:var\(--legacy-workspace\)/);
  assert.match(managerCss, /border:3px solid var\(--legacy-highlight\)/);
  assert.match(operationsCss, /var\(--legacy-panel-alt\)/);
  assert.match(operationsCss, /var\(--legacy-blue\)/);
});

test('Night Operations summaries update without controlling disclosure state', () => {
  assert.match(operationsJs, /nightWardListSummary/);
  assert.match(operationsJs, /nightRunnerListSummary/);
  assert.doesNotMatch(operationsJs, /nightWardListDisclosure[^\n]*(open|hidden)|nightRunnerListDisclosure[^\n]*(open|hidden)/);
});

test('all Manager printouts use the shared print system', async () => {
  const memo = await import(pathToFileURL(path.join(root, 'manager-memo-print.js')).href);
  const roster = await import(pathToFileURL(path.join(root, 'night-roster-print.js')).href);
  const printedAt = new Date('2026-09-29T14:00:00Z');

  const memoHtml = memo.renderManagerMemoPrintHtml({
    title: 'Night Memo', header: { date: '29/09/2026' }, mainTableRows: [], infectionRows: [],
  }, { printedAt });
  const staffHtml = roster.renderNightStaffPrintHtml({ reportingDate: '2026-09-29', wardRosters: [], printedAt });
  const runnerHtml = roster.renderNightRunnerPrintHtml({ reportingDate: '2026-09-29', runners: [], printedAt });

  for (const html of [memoHtml, staffHtml, runnerHtml]) {
    assert.match(html, /data-print-system="manager-v2"/);
    assert.match(html, /class="manager-print-page"/);
    assert.match(html, /class="manager-print-footer"/);
    assert.match(html, /@page\{size:A4 portrait/);
  }
});
