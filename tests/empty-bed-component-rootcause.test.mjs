import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emptyBedEntryMarkup } from '../components/empty-bed-entry.js';

test('component has three labelled controls with stable grid classes and separate Other', () => {
  const html = emptyBedEntryMarkup({ value: { quantity: 3, designation: 'OTHER', customDesignation: 'Isolation', remark: 'tpa' }, numberCeiling: 30 });
  assert.match(html, /class="empty-field empty-quantity"/);
  assert.match(html, /class="empty-field empty-type"/);
  assert.match(html, /class="empty-field empty-remarks"/);
  assert.match(html, /class="empty-field empty-custom" hidden/);
  assert.match(html, /value="Isolation"/);
  assert.match(html, /value="tpa"/);
  assert.match(html, /<option value="OTHER">Other<\/option>/);
});

test('component keeps records larger than current capacity and escapes unsafe remarks', () => {
  const html = emptyBedEntryMarkup({ value: { quantity: 70, remark: '<script>alert(1)</script>' }, numberCeiling: 30 });
  assert.match(html, /<option value="70">70<\/option>/);
  assert.doesNotMatch(html, /<script>/);
});

test('S and D visibility respects Maintenance; T and Other are independent', () => {
  const noSd = emptyBedEntryMarkup({ ward: { single_double_reporting_enabled: false } });
  const yesSd = emptyBedEntryMarkup({ ward: { single_double_reporting_enabled: true } });
  const currentWard = emptyBedEntryMarkup({ ward: { empty_bed_gender_mode: 'male' } });
  assert.match(noSd, /<option value="T">T<\/option>/);
  assert.match(noSd, /<option value="OTHER">Other<\/option>/);
  assert.doesNotMatch(noSd, /<option value="S">S<\/option>/);
  assert.match(yesSd, /<option value="S">S<\/option>/);
  assert.match(yesSd, /<option value="D">D<\/option>/);
  assert.match(currentWard, /<option value="S">S<\/option>/);
  assert.match(currentWard, /<option value="D">D<\/option>/);
});

test('mobile form has separate input labels and media-query breakpoints', async () => {
  const css = await readFile(new URL('../css/ward.css', import.meta.url), 'utf8');
  assert.match(css, /\.empty-detail-heading,\.empty-detail-row\{/);
  assert.match(css, /@media\(max-width:540px\)/);
  assert.match(css, /\.empty-detail-row \.empty-remarks\{grid-column:1 \/ -1;grid-row:2;/);
});

test('disabling S/D does not erase an existing S/D selection on subsequent edits', () => {
  const html = emptyBedEntryMarkup({ value: { quantity: 2, designation: 'D', remark: 'Previous record' }, ward: { single_double_reporting_enabled: false } });
  assert.match(html, /<option value="D">D<\/option>/);
});
