import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('Manager root entry delegates to the modular Manager page and Night Operations modules', async () => {
  const js = (await readFile(new URL('manager.js', root), 'utf8')).trim();
  assert.equal(js, "import './pages/manager-page.js';\nimport './pages/manager-night-operations.js';");
  assert.doesNotMatch(js, /manager-ui|legacy-manager|template-editor/);
});

test('Manager HTML has no old template editor and contains the document editor', async () => {
  const html = await readFile(new URL('manager.html', root), 'utf8');
  assert.doesNotMatch(html, /templateEditorFrame|Print Template|data-manager-tab/);
  assert.match(html, /Ward Submission Status/);
  assert.match(html, /Night Memo Editor/);
  assert.match(html, /id="memoEditor"/);
});
