import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function read(file) {
  return fs.readFile(
    path.resolve(__dirname, '..', file),
    'utf8'
  );
}

test('Manager page uses source-owned Ward Information builder', async () => {
  const page = await read('pages/manager-page.js');

  // Manager page should use the new Ward Information renderer
  assert.match(
    page,
    /buildManagerWardInformation/
  );

  // Old placeholder based rendering should be removed
  assert.doesNotMatch(
    page,
    /clinicalNotesHtml/
  );

  assert.doesNotMatch(
    page,
    /_legacyClinical/
  );

  assert.doesNotMatch(
    page,
    /_legacyAdditional/
  );
});


test('Manager page contains the four-tab workspace structure', async () => {
  const page = await read('pages/manager-page.js');

  assert.match(
    page,
    /Patient List/
  );

  assert.match(
    page,
    /Consultation/
  );

  assert.match(
    page,
    /Intubation/
  );

  assert.match(
    page,
    /Additional Report Items/
  );
});


test('Manager page keeps Ward Information read-only', async () => {
  const page = await read('pages/manager-page.js');

  // Ward Information should be generated from the source data,
  // not manually injected through legacy HTML placeholders.
  assert.match(
    page,
    /buildManagerWardInformation/
  );

  assert.doesNotMatch(
    page,
    /clinicalNotesHtml/
  );

  assert.doesNotMatch(
    page,
    /additionalItemsHtml/
  );
});