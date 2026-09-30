import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../maintenance.html', import.meta.url), 'utf8');
const page = await readFile(new URL('../pages/maintenance-page.js', import.meta.url), 'utf8');
const testData = await readFile(new URL('../pages/maintenance-test-data.js', import.meta.url), 'utf8');

const requiredIds = [
  'demoReportDate', 'demoScenario', 'demoSeed', 'demoNewSeedBtn', 'demoGenerateBtn',
  'demoImportBtn', 'demoConfigurationSummary', 'demoCoverageSummary', 'demoImportPreview',
  'demoRefreshBatchesBtn', 'demoBatchRows',
];

test('Test Data is real Maintenance markup rather than a JavaScript-injected tab', () => {
  assert.match(html, /data-maint="demo"[^>]*>Test Data</);
  assert.match(html, /data-maint-page="demo"/);
  for (const id of requiredIds) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(page, /installGeneratedDemoUI/);
  assert.doesNotMatch(page, /test-tools=1|ENABLE_TEST_TOOLS/);
});

test('Maintenance page delegates Test Data behavior to its own module', () => {
  assert.match(page, /from '\.\/maintenance-test-data\.js'/);
  assert.match(page, /initMaintenanceTestData\(\)/);
  assert.match(page, /refreshGeneratedDemoBatches\(\)/);
  assert.match(testData, /readCurrentConfiguration/);
  assert.match(testData, /getCapacitiesForWards/);
  assert.match(testData, /getReportItems/);
  assert.match(testData, /getWardStaffForWards/);
  assert.doesNotMatch(testData, /getWardStaff\(/);
  assert.match(testData, /generateDemoDataBundle/);
});

test('Test Data module invalidates a preview when configuration controls change', () => {
  assert.match(testData, /function invalidatePrepared/);
  assert.match(testData, /date\.onchange = \(\) => invalidatePrepared/);
  assert.match(testData, /scenario\.onchange = \(\) => invalidatePrepared/);
  assert.match(testData, /seed\.oninput = \(\) => invalidatePrepared/);
});

test('configuration loading uses one bulk staff query instead of one request per ward', async () => {
  const staffRepo = await readFile(new URL('../data/repositories/staff-repository.js', import.meta.url), 'utf8');
  const dataIndex = await readFile(new URL('../data/index.js', import.meta.url), 'utf8');
  assert.match(staffRepo, /export async function getWardStaffForWards/);
  assert.match(staffRepo, /\.in\('ward_id', ids\)/);
  assert.match(dataIndex, /getWardStaffForWards/);
});
