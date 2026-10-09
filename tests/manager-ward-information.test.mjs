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
  assert.match(managerHtml, /Patient List/);
  assert.match(managerHtml, /Consultation/);
  assert.match(managerHtml, /Intubation/);
  assert.doesNotMatch(managerHtml, /No configured Additional Report Items/);

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
  // Only legacy fields are removed from the official memo object.
  // They are not used to re-create a combined clinical narrative.
  assert.match(managerPage, /clinicalNotesHtml: _legacyClinical/);
  assert.match(managerPage, /additionalItemsHtml: _legacyAdditional/);
  assert.match(managerPage, /buildManagerWardInformation/);
});

test('Ward Information remains read-only source data', () => {
  assert.doesNotMatch(managerPage, /saveWardInformation/);
  assert.doesNotMatch(managerPage, /updateWardInformation/);
});

test('Additional Report Items preserve historical report definitions', () => {
  assert.match(wardInfoDomain, /report_item_snapshot/);
});
