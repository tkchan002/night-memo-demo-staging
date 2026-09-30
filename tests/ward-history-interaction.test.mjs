import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Ward main tabs have a single source-level controller with no inline switch handlers', async () => {
  const html = await source('ward.html');
  assert.doesNotMatch(html, /onclick=["']sT\(/, 'Main tabs must not use the retired inline sT controller.');
  assert.doesNotMatch(html, /rawSwitchMainTab|window\.sT\s*=/, 'The obsolete plain-JavaScript fallback must be removed.');
  assert.match(html, /data-main-tab="0"/);
  assert.match(html, /data-history-tab="0"/);
  assert.doesNotMatch(html, /onclick=["']hDTab\(/, 'History sub-tabs must use the shared tab controller.');
  assert.match(html, /id="historyCancelBtn"/);
});

test('Ward tab controller blocks all main-tab switching while locked', async () => {
  const js = await source('components/ward-tabs.js');
  assert.match(js, /if \(mainLocked\) return false;/, 'Programmatic main-tab switching must refuse locked mode.');
  assert.match(js, /button\.disabled = mainLocked;/, 'Locked tabs must use native disabled buttons for mouse, touch and keyboard safety.');
  assert.match(js, /aria-disabled/);
  assert.match(js, /focusActiveMain/);
  assert.match(js, /classList\.toggle\('disabled-strip', mainLocked\)/);
});

test('History and Staff own their mode until explicitly closed', async () => {
  const js = await source('pages/ward-page.js');
  assert.match(js, /import \{ initWardTabs \} from ['"]\.\.\/components\/ward-tabs\.js['"]/);
  assert.match(js, /function setFormMode\(\)[\s\S]*?wardTabs\.setMainLocked\(false\)/);
  assert.match(js, /async function toggleHistory\(\)[\s\S]*?wardTabs\.setMainLocked\(true\)/);
  assert.match(js, /historyCancelBtn/);
  assert.match(js, /async function toggleStaffList\(\)[\s\S]*?wardTabs\.setMainLocked\(true\)/);
  assert.match(js, /async function openHistory\(report\)[\s\S]*?wardTabs\.setMainLocked\(true\)/);
  assert.doesNotMatch(js, /#tabStrip'\)\.classList\.(?:add|remove)\('disabled-strip'/, 'Page workflow must not bypass the tab controller lock API.');
});
