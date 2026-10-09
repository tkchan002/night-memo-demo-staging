import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoDataBundle } from '../domain/demo-generator.js';
import { formatManagerEmptyBeds } from '../domain/manager-memo.js';
import { validateReportPayload } from '../domain/report-validation.js';

const ward = (name, enabled) => ({id: name, name, active: true, display_order: name==='SD'?1:2,
  empty_bed_gender_mode: 'mixed', single_double_reporting_enabled: enabled});
const wards = [ward('SD', true), ward('MF', false)];
const base = {wards, periods: wards.map(w => ({ward_id:w.id, start_date:'2026-01-01', end_date:null})),
  capacities:{SD:40,MF:40}, items:[], scenario:'typical', reportDate:'2026-10-09',
  now:new Date('2026-10-09T13:00:00Z'), seed:90410};

test('Test Data uses the real ward toggle and saves explicitly typed M/F/S/D categories', () => {
  const bundle = generateDemoDataBundle(base);
  assert.equal(bundle.generator_version, 3);
  assert.equal(bundle.meta.sd_reporting_wards, 1);
  assert.equal(bundle.coverage.manual_empty_bed_sd, true);
  for (const report of bundle.reports) {
    const manual = report.payload.emptyBeds.reported;
    assert.equal(manual.singleDoubleEnabled, report.ward_name === 'SD');
    assert.equal(report.payload.emptyBeds.count, 40 - Number(report.payload.totalPatientM));
    assert.ok(Number.isSafeInteger(manual.male));
    assert.ok(Number.isSafeInteger(manual.female));
    if (report.ward_name === 'SD') {
      assert.ok(Number.isSafeInteger(manual.single) && Number.isSafeInteger(manual.double));
      assert.match(formatManagerEmptyBeds(wards[0], report, 40), /\([0-9]+[MFSD]/);
    } else {
      assert.equal(manual.single, null);
      assert.equal(manual.double, null);
      assert.doesNotMatch(formatManagerEmptyBeds(wards[1], report, 40), /\d[SD]/);
    }
    assert.equal(validateReportPayload(report.payload, {capacity:40}).valid, true);
  }
});

test('Test Data M/F/S/D values do not feed into or reconcile with Total Empty Bed', () => {
  const bundle = generateDemoDataBundle(base);
  const report = bundle.reports.find(r => r.ward_name==='SD');
  const before = report.payload.emptyBeds.count;
  Object.assign(report.payload.emptyBeds.reported, {male:99, female:4, single:7, double:8});
  assert.equal(validateReportPayload(report.payload, {capacity:40}).valid, true);
  assert.equal(report.payload.emptyBeds.count, before);
  assert.match(formatManagerEmptyBeds(wards[0], report, 40), /99M, 4F, 7S, 8D/);
});

test('Test Data covering no enabled S/D wards reports S/D as not applicable', () => {
  const off = [{...wards[0], single_double_reporting_enabled:false}, {...wards[1]}];
  const bundle = generateDemoDataBundle({...base, wards:off});
  assert.equal(bundle.meta.sd_reporting_wards, 0);
  assert.equal(bundle.coverage.manual_empty_bed_sd, null);
  assert.ok(bundle.reports.every(r => r.payload.emptyBeds.reported.single === null
    && r.payload.emptyBeds.reported.double === null));
});

test('bundled browser demo uses the same manual reporting payload and opt-in S/D flag', async () => {
  const {DEMO_WARDS, DEMO_REPORTS} = await import('../demo-data.js');
  const enabled = DEMO_WARDS.filter(w => w.single_double_reporting_enabled === true);
  assert.equal(enabled.length, 1);
  const sample = DEMO_REPORTS.find(r => r.ward_name === enabled[0].name);
  assert.equal(sample.payload.emptyBeds.reported.singleDoubleEnabled, true);
  assert.ok(Number.isSafeInteger(sample.payload.emptyBeds.reported.single));
  assert.ok(Number.isSafeInteger(sample.payload.emptyBeds.reported.double));
  assert.equal(sample.payload.emptyBeds.count, enabled[0].capacity - Number(sample.payload.totalPatientM));
  assert.ok(DEMO_REPORTS.filter(r => r.ward_name !== enabled[0].name).every(r =>
    r.payload.emptyBeds.reported.singleDoubleEnabled === false
      && r.payload.emptyBeds.reported.single === null
      && r.payload.emptyBeds.reported.double === null));
});
