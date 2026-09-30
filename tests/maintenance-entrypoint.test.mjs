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

test('Test Data is permanent source markup and has no query/config visibility gate', async () => {
  const html = await source('maintenance.html');
  const page = await source('pages/maintenance-page.js');
  assert.match(html, /data-maint="demo"[^>]*>Test Data</);
  assert.match(html, /data-maint-page="demo"/);
  assert.match(page, /from '\.\/maintenance-test-data\.js'/);
  assert.match(page, /initMaintenanceTestData\(\)/);
  assert.doesNotMatch(page, /installGeneratedDemoUI/);
  assert.doesNotMatch(page, /tab\.textContent\s*=\s*['"]Test Data/);
  assert.doesNotMatch(page, /testToolsEnabled|ENABLE_TEST_TOOLS|test-tools/);
});
