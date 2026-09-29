import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('maintenance root entry point delegates to the modular page controller', async () => {
  const text = (await source('maintenance.js')).trim();
  assert.equal(text, "import './pages/maintenance-page.js';");
});

test('Test Data is permanent and has no query/config visibility gate', async () => {
  const text = await source('pages/maintenance-page.js');
  assert.match(text, /installGeneratedDemoUI\(\)/);
  assert.match(text, /tab\.textContent = 'Test Data'/);
  assert.doesNotMatch(text, /testToolsEnabled/);
  assert.doesNotMatch(text, /ENABLE_TEST_TOOLS/);
  assert.doesNotMatch(text, /test-tools/);
});
