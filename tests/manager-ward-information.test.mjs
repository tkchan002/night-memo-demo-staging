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

test('Manager Ward Information uses separate Ward data sections', () => {
  assert.match(managerHtml, /Patient List/);
  assert.match(managerHtml, /Consultation/);
  assert.match(managerHtml, /Intubation/);
  assert.match(managerHtml, /Additional Report Items/);

  // The old combined abstraction should not return.
  assert.doesNotMatch(managerHtml, /Clinical \/ General Information/);
});


test('Manager Ward Information domain model keeps Ward source structures separate', () => {
  assert.match(wardInfoDomain, /patientList/);
  assert.match(wardInfoDomain, /consultations/);
  assert.match(wardInfoDomain, /intubations/);
  assert.match(wardInfoDomain, /additionalItems/);

  // Prevent reintroducing a merged narrative bucket.
  assert.doesNotMatch(wardInfoDomain, /clinicalInformation/);
  assert.doesNotMatch(wardInfoDomain, /generalInformation/);
});


test('Manager page uses Ward Information model instead of building combined text', () => {
  assert.match(managerPage, /manager-ward-information/);

  assert.match(managerPage, /patientList/);
  assert.match(managerPage, /consultations/);
  assert.match(managerPage, /intubations/);
  assert.match(managerPage, /additionalItems/);

  assert.doesNotMatch(managerPage, /Clinical \/ General Information/);
});


test('Ward Information remains read-only source information', () => {
  assert.match(managerPage, /readonly|read-only|source/i);

  // Manager should not expose editing actions for Ward-originated information.
  assert.doesNotMatch(managerPage, /saveWardInformation/);
  assert.doesNotMatch(managerPage, /updateWardInformation/);
});


test('Additional Report Items preserve configured report item terminology', () => {
  assert.match(wardInfoDomain, /report_item_snapshot/);
  assert.match(wardInfoDomain, /additionalItems/);
});