import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatEmptyBedEntries, validateEmptyBedEntries, availableEmptyBedDesignations } from '../domain/empty-bed-reporting.js';

const html = await readFile(new URL('../ward.html', import.meta.url), 'utf8');
const ward = await readFile(new URL('../pages/ward-page.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../css/ward.css', import.meta.url), 'utf8');
const entry = await readFile(new URL('../components/empty-bed-entry.js', import.meta.url), 'utf8');

test('Ward displays three separate labelled controls without hint or placeholder text', () => {
  assert.match(html, /Optional Bed \/ Location Remarks/);
  assert.match(html, /class="empty-detail-heading"[^>]*><span>Number<\/span><span>Type<\/span><span>Remarks<\/span>/);
  assert.match(css, /\.empty-detail-heading,\.empty-detail-row\s*\{/);
  assert.match(css, /grid-template-columns:var\(--empty-entry-cols\)/);
  assert.match(css, /\.empty-mobile-label\{display:none;/);
  assert.doesNotMatch(html, /Enter 1M, 1F, 1S or 1D/);
  assert.doesNotMatch(html, /emptyBedDesignationSuggestions/);
  assert.match(entry, /<select data-empty-quantity/);
  assert.match(entry, /<select data-empty-designation/);
  assert.match(entry, /<input type="text" data-empty-remark/);
  assert.doesNotMatch(ward, /data-empty-(?:quantity|designation|remark)[^>]*placeholder=/);
  assert.doesNotMatch(ward, /parseEmptyBedLabel\(input\)/);
});

test('number select includes capacity range and preserves previously stored larger values', () => {
  assert.match(entry, /Math\.max\(numberCeiling, Number\.isSafeInteger\(numericValue\)/);
  assert.match(entry, /for \(let number = 1; number <= maxNumber; number \+= 1\)/);
  assert.match(ward, /\$\('\[data-empty-quantity\]', row\)\.value = savedNumber/);
  assert.match(ward, /quantity: number \? Number\(number\) : null/);
  assert.match(ward, /if \(!number && !designation && !remark\) return null/);
  assert.match(ward, /designation === 'OTHER' \? \$\('\[data-empty-custom\]', row\)\.value\.trim\(\) : ''/);
});

test('T and Other do not depend on the legacy S/D toggle; old S/D remains readable', () => {
  assert.deepEqual(availableEmptyBedDesignations({ single_double_reporting_enabled: false }), ['M','F','T','OTHER']);
  assert.deepEqual(availableEmptyBedDesignations({ single_double_reporting_enabled: true }), ['M','F','S','D','T','OTHER']);
  assert.deepEqual(availableEmptyBedDesignations({}), ['M','F','S','D','T','OTHER']);
  assert.deepEqual(availableEmptyBedDesignations({ single_double_reporting_enabled: false }, 'S'), ['M','F','T','OTHER','S']);
  assert.match(entry, /availableEmptyBedDesignations\(ward, savedCode\)/);
  assert.doesNotMatch(ward, /\['S','D','T','OTHER'\]\.includes/);
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

test('T and user-defined designations are preserved with independent free-text remarks', () => {
  const entries = [
    { quantity: 2, designation: 'T', remark: 'Special request' },
    { quantity: 3, designation: 'OTHER', customDesignation: 'ISO', remark: 'TB' },
  ];
  assert.deepEqual(validateEmptyBedEntries(entries), []);
  assert.equal(formatEmptyBedEntries(entries), '2T (Special request), 3ISO (TB)');
  assert.ok(validateEmptyBedEntries([{ quantity: 1, designation: 'OTHER', customDesignation: '' }]).length);
  assert.match(entry, /data-empty-custom/);
});
