import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('Manager root entry loads the modular editor page', async () => {
  const js = await readFile(new URL('manager.js', root), 'utf8');
  assert.match(js, /import\s+['"]\.\/pages\/manager-page\.js['"]/);
});

test('Manager HTML has no old template editor and contains the document editor', async () => {
  const html = await readFile(new URL('manager.html', root), 'utf8');
  assert.doesNotMatch(html, /templateEditorFrame|Print Template|data-manager-tab/);
  assert.match(html, /Ward Submission Status/);
  assert.match(html, /Night Memo Editor/);
  assert.match(html, /id="memoEditor"/);
});
