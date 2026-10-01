import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManagerMemoDocument,
  formatManagerEmptyBeds,
  isReportNewerThanSource,
  reportingNightDate,
  sourceSnapshotFromBundle,
} from '../domain/manager-memo.js';

test('reporting night uses previous date before noon in Hong Kong', () => {
  assert.equal(reportingNightDate(new Date('2026-09-30T02:00:00+08:00')), '2026-09-29');
  assert.equal(reportingNightDate(new Date('2026-09-29T21:00:00+08:00')), '2026-09-29');
});

test('special empty beds print as individual gendered notes', () => {
  const ward = { empty_bed_gender_mode: 'male' };
  const report = { payload: { totalPatientM: '38', emptyBeds: { count: 2, details: [{ remark: 'TB' }, { remark: 'HZ' }] } } };
  assert.equal(formatManagerEmptyBeds(ward, report, 40), '1M (TB), 1M (HZ)');
});

test('official Manager document contains only official memo fields', () => {
  const bundle = [{
    ward: { id: 'w1', name: 'C10', empty_bed_gender_mode: 'male' }, capacity: 40,
    report: { id: 'r1', ward_id: 'w1', submitted_at: '2026-09-29T13:05:00Z', payload: {
      admissionEC: '3', admissionCC: '0', transferIn: '1', discharge: '2', transferOut: '0', death: '0', totalPatientM: '38',
      emptyBeds: { count: 2, details: [{ remark: 'TB' }, { remark: 'HZ' }] },
      devBeds: { dMV: { mode: 'count', count: 2 }, dNIV: { mode: 'count', count: 1 }, dHF: { mode: 'count', count: 0 } },
      infBeds: { iCRE: ['3'] }, earlyBirds: [{ bed: '12', dest: 'KH3B' }],
      nilSpecial: false, patients: [['12','DEMO PATIENT','Increasing oxygen requirement']], dynamicItems: {}, staffAM: '5', staffPM: '4.5',
    } },
  }];
  const doc = buildManagerMemoDocument({ bundle, items: [], reportingDate: '2026-09-29' });
  assert.equal(doc.version, 3);
  assert.equal(doc.header.date, '29/09/2026');
  assert.equal(doc.mainTableRows[0].ward, 'C10');
  assert.equal(doc.mainTableRows[0].emptyBed, '1M (TB), 1M (HZ)');
  assert.equal(Object.hasOwn(doc, 'clinicalNotesHtml'), false);
  assert.equal(Object.hasOwn(doc, 'additionalItemsHtml'), false);
  assert.equal(sourceSnapshotFromBundle(bundle)[0].report_id, 'r1');
});

test('same report row with a later submission timestamp is treated as newer source data', () => {
  const source = { report_id: 'r1', submitted_at: '2026-09-29T13:00:00Z' };
  assert.equal(isReportNewerThanSource({ id: 'r1', submitted_at: '2026-09-29T13:10:00Z' }, source), true);
  assert.equal(isReportNewerThanSource({ id: 'r1', submitted_at: '2026-09-29T13:00:00Z' }, source), false);
});
