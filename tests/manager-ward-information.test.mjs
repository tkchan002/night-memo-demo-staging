import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const read = (file) => readFile(path.join(root, file), 'utf8');

const managerHtml = await read('manager.html');
const managerPage = await read('pages/manager-page.js');
const wardInfoDomain = await read('domain/manager-ward-information.js');

test('Manager Ward Information uses separate source sections', () => {
  assert.match(managerPage, /renderWardInfoSection\('Patient List'/);
  assert.match(managerPage, /renderWardInfoSection\('Consultation'/);
  assert.match(managerPage, /renderWardInfoSection\('Intubation'/);
  assert.match(managerPage, /renderWardInfoSection\('Additional Report Items'/);

  assert.doesNotMatch(managerHtml, /Clinical \/ General Information/);
});

test('Manager Ward Information is backed by a dedicated domain model', () => {
  assert.match(managerPage, /manager-ward-information/);

  assert.match(wardInfoDomain, /patientList/);
  assert.match(wardInfoDomain, /consultations/);
  assert.match(wardInfoDomain, /intubations/);
  assert.match(wardInfoDomain, /additionalItems/);

  assert.doesNotMatch(wardInfoDomain, /clinicalInformation/);
  assert.doesNotMatch(wardInfoDomain, /generalInformation/);
});

test('Manager page does not recreate Ward data as a combined narrative', () => {
  assert.doesNotMatch(managerPage, /Clinical \/ General Information/);
  assert.doesNotMatch(managerPage, /renderWardInfoSection\('Clinical \/ General Information'/);
  assert.match(managerPage, /additionalItemsHtml: _legacyAdditional/);
  assert.match(managerPage, /renderWardInfoSection\('Additional Report Items'/);
});

test('Ward Information remains read-only source data', () => {
  assert.doesNotMatch(managerPage, /saveWardInformation/);
  assert.doesNotMatch(managerPage, /updateWardInformation/);
});

test('Additional Report Items preserve historical report definitions', () => {
  assert.match(wardInfoDomain, /report_item_snapshot/);
});

test('only items in the additional section appear in Additional Report Items', async () => {
  const { buildManagerWardInformation } = await import('../domain/manager-ward-information.js');
  const ward = { id: 'ward-a', name: 'A' };
  const definitions = [
    { key: 'infection', label: 'Infection', section: 'infection', builtin: false },
    { key: 'devices', label: 'Device', section: 'devices', builtin: false },
    { key: 'notes', label: 'Custom notes', section: 'additional', builtin: false },
    { key: 'builtin', label: 'Built in', section: 'additional', builtin: true },
  ];
  const report = { payload: { dynamicItems: { infection: 'CRE', devices: 'MV', notes: 'Required', builtin: 'N/A' } }, report_item_snapshot: definitions };
  const [row] = buildManagerWardInformation({ wards: [ward], bundle: [{ ward, report }] });
  assert.deepEqual(row.additionalItems.map(item => item.key), ['notes']);
});
