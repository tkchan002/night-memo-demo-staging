import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bindEmptyBedType, emptyBedEntryMarkup } from '../components/empty-bed-entry.js';
import { formatEmptyBedEntries, validateEmptyBedEntries } from '../domain/empty-bed-reporting.js';

function makeControl() {
  const handlers = new Map();
  return {
    hidden: false, value: '', focused: false,
    addEventListener(name, handler) { handlers.set(name, handler); },
    trigger(name) { assert.ok(handlers.has(name)); handlers.get(name)(); },
    focus() { this.focused = true; },
  };
}
function makeRow(initialType = '') {
  const select = makeControl(); select.value = initialType;
  const editor = makeControl();
  const input = makeControl();
  const back = makeControl();
  const parts = new Map([
    ['[data-empty-designation]',select],['.empty-other-editor',editor],
    ['[data-empty-custom]',input],['[data-empty-type-list]',back],
  ]);
  return { row: { querySelector(selector) { assert.ok(parts.has(selector)); return parts.get(selector); } }, select, editor, input, back };
}

test('Selecting Other replaces the dropdown in the same Type cell and immediately focuses typing', () => {
  const {row, select, editor, input} = makeRow('M');
  bindEmptyBedType(row);
  assert.equal(select.hidden,false);
  assert.equal(editor.hidden,true);
  select.value='OTHER';select.trigger('change');
  assert.equal(select.hidden,true);
  assert.equal(editor.hidden,false);
  assert.equal(input.focused,true);
});

test('Back to list returns focus, notifies dirty state and retains an unsaved custom draft in memory', () => {
  const {row, select, editor, input, back} = makeRow('OTHER');
  let dirty=0;
  input.value='Custom designation';
  bindEmptyBedType(row,{onBack:()=>dirty++});
  assert.equal(select.hidden,true);
  assert.equal(editor.hidden,false);
  assert.equal(input.focused,false); // loading saved data should not steal focus
  back.trigger('click');
  assert.equal(select.value,'');
  assert.equal(select.hidden,false);
  assert.equal(editor.hidden,true);
  assert.equal(select.focused,true);
  assert.equal(dirty,1);
  select.value='OTHER';select.trigger('change');
  assert.equal(input.value,'Custom designation');
});

test('Normal type, custom type and Remarks remain independently represented and formatted', () => {
  const entries=[
    { quantity:2,designation:'M',customDesignation:'',remark:'TB' },
    { quantity:3,designation:'OTHER',customDesignation:'SPECIAL',remark:'tpa' },
  ];
  assert.deepEqual(validateEmptyBedEntries(entries),[]);
  assert.equal(formatEmptyBedEntries(entries),'2M (TB), 3SPECIAL (tpa)');
  assert.ok(validateEmptyBedEntries([{quantity:1,designation:'OTHER',customDesignation:'',remark:'tpa'}]).length);
});

test('Markup keeps custom editor inside Type column, not in an extra grid row', () => {
  const html=emptyBedEntryMarkup({value:{designation:'OTHER',customDesignation:'<test>',remark:'the remark'}});
  const typeStart=html.indexOf('class="empty-field empty-type"');
  const remarksStart=html.indexOf('class="empty-field empty-remarks"');
  const customStart=html.indexOf('class="empty-other-editor"');
  assert.ok(typeStart>=0&&customStart>typeStart&&remarksStart>customStart);
  assert.ok(customStart<html.indexOf('</div></div>',typeStart));
  assert.match(html,/data-empty-type-list type="button"/);
  assert.match(html,/value="&lt;test&gt;"/);
  assert.doesNotMatch(html,/class="empty-field empty-custom"/);
});

test('CSS explicitly hides the inactive control and supports a narrower mobile Type column', async () => {
  const css=await readFile(new URL('../css/ward.css',import.meta.url),'utf8');
  assert.match(css,/\.empty-other-editor\[hidden\]/);
  assert.match(css,/\[data-empty-designation\]\[hidden\]/);
  assert.match(css,/\.empty-type-back:focus-visible/);
  assert.match(css,/grid-template-columns:minmax\(76px,\.7fr\) minmax\(0,1\.3fr\) 34px/);
});

test('Ward submission serializes custom text only for Other and uses shared interaction binder', async () => {
  const source=await readFile(new URL('../pages/ward-page.js',import.meta.url),'utf8');
  assert.match(source,/bindEmptyBedType\(row, \{ onBack: markDirty \}\)/);
  assert.match(source,/const customDesignation = designation === 'OTHER' \?/);
  assert.match(source,/if \(!number && !designation && !remark\) return null/);
});
