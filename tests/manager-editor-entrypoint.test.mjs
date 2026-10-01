import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('Manager root entry keeps core page critical and Night Staffing resilient', async () => {
  const js = (await readFile(new URL('manager.js', root), 'utf8')).trim();
  assert.match(js, /^import '\.\/pages\/manager-page\.js';/);
  assert.match(js, /import\('\.\/pages\/manager-night-operations\.js'\)\.catch/);
  assert.doesNotMatch(js, /import '\.\/pages\/manager-night-operations\.js';/);
});

test('Manager HTML uses the four-workspace architecture and retains the official document editor', async () => {
  const html = await readFile(new URL('manager.html', root), 'utf8');
  assert.doesNotMatch(html, /templateEditorFrame|Print Template/);
  assert.match(html, /data-manager-tab="submission"/);
  assert.match(html, /data-manager-tab="ward-info"/);
  assert.match(html, /data-manager-tab="memo"/);
  assert.match(html, /data-manager-tab="staffing"/);
  assert.match(html, /id="memoEditor"/);
});
