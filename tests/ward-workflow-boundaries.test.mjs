import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('ward page does not expose report-item creation controls', async () => {
  const html = await read('ward.html');
  const page = await read('pages/ward-page.js');

  assert.doesNotMatch(html, /\+ Add Infection/i);
  assert.doesNotMatch(html, /\+ Add Device/i);
  assert.doesNotMatch(html, /maintenanceManagedNotice/);
  assert.doesNotMatch(page, /maintenanceManagedNotice/);
});

test('maintenance-defined infection and device items render in their own ward sections', async () => {
  const page = await read('pages/ward-page.js');

  assert.match(page, /const infection = dynamic\.filter\(i => i\.section === 'infection'\)/);
  assert.match(page, /const devices = dynamic\.filter\(i => i\.section === 'devices'\)/);
  assert.match(page, /\$\('#customInfRows'\)\.innerHTML = infection\.map\(dynamicRowHtml\)\.join\(''\)/);
  assert.match(page, /\$\('#customDevRows'\)\.innerHTML = devices\.map\(dynamicRowHtml\)\.join\(''\)/);
});

test('stale submitted reports are not selected as the editable ward form source', async () => {
  const service = await read('services/report-service.js');

  assert.match(service, /isRecentSubmission/);
  assert.match(service, /function currentWardSubmission\(report, now = new Date\(\)\)/);
  assert.match(service, /const report = currentWardSubmission\(latestReport\)/);
  assert.match(service, /const sourceRecord = draft \|\| report/);
});

test('Get Data excludes exactly the active current-cycle report', async () => {
  const page = await read('pages/ward-page.js');
  const repository = await read('data/repositories/report-repository.js');

  assert.match(page, /getPreviousReport\(state\.ward\.id, \$\('#memoDate'\)\.value, state\.report\?\.id \|\| null\)/);
  assert.match(repository, /getPreviousReport\(wardId, beforeDate, excludeReportId = null\)/);
  assert.match(repository, /\.find\(r => !excludeReportId \|\| r\.id !== excludeReportId\) \|\| null/);
});

test('Get Data for Infection and Devices does not overwrite admission dynamic items', async () => {
  const page = await read('pages/ward-page.js');

  assert.match(page, /function dynamicItemsForInfectionDeviceTab\(\)/);
  assert.match(page, /!\['admission', 'bedcount'\]\.includes\(i\.section\)/);
  assert.match(page, /dynamicItemsForInfectionDeviceTab\(\)\.forEach\(i => \{ c\.dynamicItems\[i\.key\] = p\.dynamicItems\?\.\[i\.key\]; \}\)/);
});
