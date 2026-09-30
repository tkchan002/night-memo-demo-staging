import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('Manager root entry keeps the core page critical and Night Operations isolated', async () => {
  const js = await readFile(new URL('manager.js', root), 'utf8');

  assert.match(
    js,
    /import\s+['"]\.\/pages\/manager-page\.js['"];?/,
    'Core Manager page must remain a static critical import.',
  );
  assert.match(
    js,
    /import\(\s*['"]\.\/pages\/manager-night-operations\.js['"]\s*\)\.catch\s*\(/,
    'Night Operations must be isolated behind a dynamic import with failure handling.',
  );
  assert.doesNotMatch(
    js,
    /import\s+['"]\.\/pages\/manager-night-operations\.js['"];?/,
    'Night Operations must not become a static import that can block Manager bootstrap.',
  );
  assert.doesNotMatch(js, /manager-ui|legacy-manager|template-editor/);
});

test('Manager HTML has no old template editor and contains the document editor', async () => {
  const html = await readFile(new URL('manager.html', root), 'utf8');
  assert.doesNotMatch(html, /templateEditorFrame|Print Template|data-manager-tab/);
  assert.match(html, /Ward Submission Status/);
  assert.match(html, /Night Memo Editor/);
  assert.match(html, /id="memoEditor"/);
});
