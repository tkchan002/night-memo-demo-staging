import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateEmptyBeds, resolveReportEmptyBeds, displayEmptyBeds } from '../domain/bed-occupancy.js';
import { validateReportPayload } from '../domain/report-validation.js';
import { normalizeReportPayload, fullReportPayloadDefaults } from '../domain/report-model.js';
import { buildManagerMemoDocument, formatManagerEmptyBeds } from '../domain/manager-memo.js';
import { renderWardMemoHtml } from '../ward-print.js';

const ward = { id: 'w1', name: 'Ward A', empty_bed_gender_mode: 'male' };
const report = (type, capacity, census, stored = 0) => ({
  id: type, ward_id: ward.id, report_type: type, report_date: '2026-10-12',
  bed_capacity_snapshot: capacity,
  payload: { admissionEC: '1', totalPatientM: String(census), emptyBeds: { count: stored, entries: [] } },
});

test('one domain calculation preserves negative and zero-capacity occupancy', () => {
  assert.equal(calculateEmptyBeds(30, 41), -11);
  assert.equal(calculateEmptyBeds('30', '41'), -11);
  assert.equal(calculateEmptyBeds(30, 30), 0);
  assert.equal(calculateEmptyBeds(0, 2), -2);
});

test('missing inputs never silently become zero', () => {
  for (const [beds, patients] of [[null, 41], ['', 41], [30, null], [30, ''], [undefined, 0], ['n/a', 3], [-1, 3]]) {
    assert.equal(calculateEmptyBeds(beds, patients), null);
  }
  assert.equal(displayEmptyBeds(null), '—');
  assert.equal(displayEmptyBeds(-11), '-11');
});

test('report snapshot beats changed live capacity and corrupt/stale stored count', () => {
  const oldReport = report('night', 30, 41, 0);
  assert.equal(resolveReportEmptyBeds({ report: oldReport, capacity: 50 }), -11);
  assert.equal(resolveReportEmptyBeds({ report: { payload: oldReport.payload }, capacity: 30 }), -11);
});

test('historical stored counts are fallback ONLY if original inputs are unavailable', () => {
  const oldReport = { payload: { totalPatientM: '41', emptyBeds: { count: -11 } } };
  assert.equal(resolveReportEmptyBeds({ report: oldReport }), -11);
  assert.equal(resolveReportEmptyBeds({ report: { payload: { totalPatientM: '41', emptyBeds: { count: 0 } } } }), 0);
  assert.equal(resolveReportEmptyBeds({ report: { payload: { totalPatientM: '41' } } }), null);
});

test('save-boundary validation derives the same negative count before persistence', () => {
  const { valid, payload, warnings } = validateReportPayload({ totalPatientM: '41', emptyBeds: { count: 0, entries: [] } }, { capacity: 30 });
  assert.equal(valid, true);
  assert.equal(payload.emptyBeds.count, -11);
  assert.ok(warnings.some(w => w.includes('greater than')));
});

test('Manager uses newest Night census, its capacity snapshot and signed empty-bed count', () => {
  const pm = report('pm', 30, 26, 4);
  const night = report('night', 30, 41, 0);
  const bundle = [{ ward, capacity: 100, pmReport: pm, nightReport: night, report: night }];
  const document = buildManagerMemoDocument({ bundle });
  assert.equal(document.mainTableRows[0].totalPatient, '41');
  assert.equal(document.mainTableRows[0].emptyBed, '-11');
  assert.match(document.emptyBedHtml, /Ward A: -11/);
  assert.equal(formatManagerEmptyBeds(ward, night, 100), '-11');
});

test('Ward printable report shows the same signed value, without any zero clamp', () => {
  const night = report('night', 30, 41, 0);
  const html = renderWardMemoHtml({ ward, report: night, capacity: 100 });
  assert.match(html, /Empty Bed: -11/);
  assert.doesNotMatch(html, /Empty Bed: M 0/);
});

test('Ward, Manager, history and print consumers delegate to the domain calculation', async () => {
  for (const [name, marker] of [
    ['pages/ward-page.js', 'calculateEmptyBeds('],
    ['pages/ward-page.js', 'resolveReportEmptyBeds('],
    ['domain/manager-memo.js', 'resolveReportEmptyBeds('],
    ['ward-print.js', 'resolveReportEmptyBeds('],
    ['domain/report-validation.js', 'calculateEmptyBeds('],
  ]) {
    const text = await readFile(new URL(`../${name}`, import.meta.url), 'utf8');
    assert.ok(text.includes(marker), `${name} must delegate to ${marker}`);
  }
});

test('normalization does not turn an unknown stored empty-bed count into an actual zero', () => {
  assert.equal(fullReportPayloadDefaults().emptyBeds.count, null);
  assert.equal(normalizeReportPayload({ totalPatientM: '41', emptyBeds: { count: null } }).emptyBeds.count, null);
  assert.equal(normalizeReportPayload({ totalPatientM: '41' }).emptyBeds.count, null);
  assert.equal(normalizeReportPayload({ totalPatientM: '41', emptyBeds: { count: -11 } }).emptyBeds.count, -11);
});
