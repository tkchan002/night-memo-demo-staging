import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatEmptyBedEntries, validateEmptyBedEntries } from '../domain/empty-bed-reporting.js';

const html = await readFile(new URL('../ward.html', import.meta.url), 'utf8');
const ward = await readFile(new URL('../pages/ward-page.js', import.meta.url), 'utf8');

test('Ward displays three separate labelled controls without hint or placeholder text', () => {
  assert.match(html, /Optional Bed \/ Location Remarks/);
  assert.match(html, /<span style="width:70px">Number<\/span>/);
  assert.match(html, /<span style="width:80px">M\/F\/S\/D<\/span>/);
  assert.match(html, /<span>Remarks<\/span>/);
  assert.doesNotMatch(html, /Enter 1M, 1F, 1S or 1D/);
  assert.doesNotMatch(html, /emptyBedDesignationSuggestions/);
  assert.match(ward, /<select data-empty-quantity/);
  assert.match(ward, /<select data-empty-designation/);
  assert.match(ward, /<input type="text" class="w280" data-empty-remark/);
  assert.doesNotMatch(ward, /data-empty-(?:quantity|designation|remark)[^>]*placeholder=/);
  assert.doesNotMatch(ward, /parseEmptyBedLabel\(input\)/);
});

test('number select includes capacity range and preserves previously stored larger values', () => {
  assert.match(ward, /Math\.max\(bedCeiling\(\), Number\.isSafeInteger\(numericValue\)/);
  assert.match(ward, /for \(let number = 1; number <= maxNumber; number \+= 1\)/);
  assert.match(ward, /\$\('\[data-empty-quantity\]', row\)\.value = savedNumber/);
  assert.match(ward, /quantity: number \? Number\(number\) : null/);
  assert.match(ward, /if \(!number && !designation && !remark\) return null/);
});

test('S/D options obey maintenance toggle and preserve historical selections', () => {
  assert.match(ward, /single_double_reporting_enabled === true/);
  assert.match(ward, /enabled \? \['M', 'F', 'S', 'D'\] : \['M', 'F'\]/);
  assert.match(ward, /if \(\['S', 'D'\]\.includes\(savedCode\)/);
});

test('independent entries still format with optional remarks and duplicates', () => {
  const entries = [
    { quantity: 1, designation: 'M', remark: 'TB' },
    { quantity: 1, designation: 'M', remark: 'HZV' },
    { quantity: 1, designation: 'S', remark: '' },
    { quantity: 1, designation: 'D', remark: '' },
  ];
  assert.deepEqual(validateEmptyBedEntries(entries), []);
  assert.equal(formatEmptyBedEntries(entries), '1M (TB), 1M (HZV), 1S, 1D');
  assert.ok(validateEmptyBedEntries([{ quantity: null, designation: 'M', remark: 'TB' }]).length);
});
