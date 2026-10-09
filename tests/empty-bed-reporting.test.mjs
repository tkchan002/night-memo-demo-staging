import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmptyBedReporting, validateEmptyBedReporting, formatEmptyBedReporting, makeEmptyBedReporting } from '../domain/empty-bed-reporting.js';

test('S/D are room units and manual values do not calculate any total', () => {
  const report = makeEmptyBedReporting({ male: '1', female: '0', single: '2', double: '1' }, { single_double_reporting_enabled: true });
  assert.deepEqual(report, { version: 1, singleDoubleEnabled: true, male: 1, female: 0, single: 2, double: 1 });
  assert.equal(formatEmptyBedReporting(report), '1M, 2S, 1D');
  assert.equal('total' in report, false);
  assert.deepEqual(validateEmptyBedReporting(report), []);
});

test('manual entries remain optional; zero is different from blank', () => {
  const r = normalizeEmptyBedReporting({ male: 0, female: '', singleDoubleEnabled: false });
  assert.equal(r.male, 0);
  assert.equal(r.female, null);
  assert.equal(formatEmptyBedReporting(r), '0M');
  assert.equal(formatEmptyBedReporting({ male: '', female: '', singleDoubleEnabled: false }, { includeMissing: true }), 'Not reported');
});

test('S/D are disabled for wards without the toggle', () => {
  const report = makeEmptyBedReporting({ male: 1, single: 2, double: 3 }, { single_double_reporting_enabled: false });
  assert.equal(report.single, null);
  assert.equal(report.double, null);
  assert.equal(formatEmptyBedReporting(report), '1M');
});

test('invalid counts are not silently coerced, and no reconciliation is enforced', () => {
  assert.deepEqual(validateEmptyBedReporting({ male: -1, female: 'bad', singleDoubleEnabled: true, single: 1.5, double: 4 }).length, 3);
  assert.deepEqual(validateEmptyBedReporting({ male: 19, female: 0, single: 6, double: 9, singleDoubleEnabled: true }), []);
});
