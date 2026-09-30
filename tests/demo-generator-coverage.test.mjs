import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoDataBundle } from '../domain/demo-generator.js';

const REPORT_DATE = '2026-09-28';
const NOW = new Date('2026-09-28T13:00:00.000Z');

const wards = [
  { id: 'w1', code: 'A1', display_name: 'Ward A1', display_order: 1, active: false, empty_bed_gender_mode: 'male' },
  { id: 'w2', code: 'B2', display_name: 'Ward B2', display_order: 2, active: true, empty_bed_gender_mode: 'dynamic' },
  { id: 'w3', code: 'C3', display_name: 'Ward C3', display_order: 3, active: true, empty_bed_gender_mode: 'female' },
];

const periods = [
  { ward_id: 'w1', start_date: '2026-01-01', end_date: '2026-09-30' },
  { ward_id: 'w2', start_date: '2026-01-01', end_date: null },
  { ward_id: 'w3', start_date: '2026-10-01', end_date: null },
];

const base = { active: true, effective_from: '2026-01-01', effective_to: null };
const items = [
  { ...base, id: 'd1', key: 'admissionEC', label: 'Admission via AED', section: 'admission', input_type: 'dropdown', options: ['0', '1', '2', '3'], sort_order: 10, builtin: true },
  { ...base, id: 'd2', key: 'admissionCC', label: 'Admission CC', section: 'admission', input_type: 'dropdown', options: ['0', '1', '2'], sort_order: 20, builtin: true },
  { ...base, id: 'd3', key: 'discharge', label: 'Discharge', section: 'admission', input_type: 'dropdown', options: ['0', '1', '2'], sort_order: 30, builtin: true },
  { ...base, id: 'd4', key: 'death', label: 'Death', section: 'admission', input_type: 'dropdown', options: ['0', '1'], sort_order: 40, builtin: true },
  { ...base, id: 'd5', key: 'transferIn', label: 'Transfer In', section: 'admission', input_type: 'dropdown', options: ['0', '1', '2'], sort_order: 50, builtin: true },
  { ...base, id: 'd6', key: 'transferOut', label: 'Transfer Out', section: 'admission', input_type: 'dropdown', options: ['0', '1', '2'], sort_order: 60, builtin: true },
  { ...base, id: 'd7', key: 'totalPatientM', label: 'Total Patient', section: 'bedcount', input_type: 'number', options: [], sort_order: 70, builtin: true },
  { ...base, id: 'i1', key: 'iCRE', label: 'CRE', section: 'infection', input_type: 'bed_chooser', options: [], sort_order: 80, builtin: true, config: { storage: 'infBeds' } },
  { ...base, id: 'v1', key: 'dMV', label: 'Mechanical Ventilation', section: 'devices', input_type: 'bed_or_count', options: [], sort_order: 90, builtin: true, config: { storage: 'devBeds' } },
  { ...base, id: 'c1', key: 'custom_dropdown', label: 'Custom dropdown', section: 'additional', input_type: 'dropdown', options: ['Nil', 'Low', 'High'], sort_order: 100, builtin: false, config: { storage: 'dynamicItems' } },
  { ...base, id: 'c2', key: 'custom_checkbox', label: 'Custom checkbox', section: 'additional', input_type: 'checkbox', options: [], sort_order: 110, builtin: false, config: { storage: 'dynamicItems' } },
  { ...base, id: 'c3', key: 'custom_number', label: 'Custom number', section: 'additional', input_type: 'number', options: [], sort_order: 120, builtin: false, config: { storage: 'dynamicItems' } },
  { ...base, id: 'c4', key: 'custom_text', label: 'Custom text', section: 'additional', input_type: 'free_text', options: [], sort_order: 130, builtin: false, config: { storage: 'dynamicItems' } },
  { ...base, id: 'c5', key: 'custom_beds', label: 'Custom beds', section: 'infection', input_type: 'bed_chooser', options: [], sort_order: 140, builtin: false, config: { storage: 'dynamicItems' } },
  { ...base, id: 'c6', key: 'custom_device', label: 'Custom device', section: 'devices', input_type: 'bed_or_count', options: [], sort_order: 150, builtin: false, config: { storage: 'dynamicItems' } },
  { ...base, id: 'inactive', key: 'inactive_item', label: 'Inactive', section: 'additional', input_type: 'free_text', options: [], sort_order: 160, builtin: false, active: false, config: { storage: 'dynamicItems' } },
  { ...base, id: 'future', key: 'future_item', label: 'Future', section: 'additional', input_type: 'free_text', options: [], sort_order: 170, builtin: false, effective_from: '2026-10-01', config: { storage: 'dynamicItems' } },
];

const capacities = { w1: 32, w2: 36, w3: 40 };
const staffByWard = {
  w1: [{ id: 'staff-1', name: 'TEST RN ALPHA', role: 'RN', appointment_date: '2024-04-01', active: true }],
  w2: [{ id: 'staff-2', name: 'TEST APN BETA', role: 'APN', appointment_date: '2022-09-15', active: true }],
};

function makeBundle(seed = 9911) {
  return generateDemoDataBundle({ wards, periods, capacities, items, staffByWard, scenario: 'busy', reportDate: REPORT_DATE, now: NOW, seed });
}

function hasMeaningful(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return value.mode === 'count' ? Number(value.count) > 0 : (value.beds || []).length > 0;
  if (typeof value === 'boolean') return value;
  return value != null && String(value).trim() !== '' && !/^(0|nil|none|no|false)$/i.test(String(value).trim());
}

test('selected-date operating periods override present-day ward active flag', () => {
  const bundle = makeBundle();
  assert.equal(bundle.meta.active_wards, 2);
  assert.deepEqual(new Set(bundle.reports.map(r => r.ward_code)), new Set(['A1', 'B2']));
});

test('comprehensive batch covers every Ward entry structure and effective configured item', () => {
  const bundle = makeBundle(44221);
  const c = bundle.coverage;

  assert.equal(c.movement_counts, true);
  assert.equal(c.total_patient, true);
  assert.equal(c.empty_bed_count, true);
  assert.equal(c.patient_list, true);
  assert.equal(c.patient_nil_state, true);
  assert.equal(c.consultation, true);
  assert.equal(c.consultation_nil_state, true);
  assert.equal(c.intubation, true);
  assert.equal(c.intubation_nil_state, true);
  assert.equal(c.early_bird, true);
  assert.equal(c.night_runner, true);
  assert.equal(c.free_text_nurse, true);
  assert.equal(c.ward_staff_nurse, true);
  assert.equal(c.mixed_empty_bed_detail, true);
  assert.equal(c.signature, true);
  assert.equal(c.staffing_counts, true);
  assert.equal(c.bed_or_count_beds_mode, true);
  assert.equal(c.bed_or_count_count_mode, true);
  assert.equal(c.configured_items.configured, 8);
  assert.equal(c.configured_items.covered, 8);
  assert.deepEqual(c.configured_items.missing, []);

  const movementKeys = ['admissionEC', 'admissionCC', 'discharge', 'death', 'transferIn', 'transferOut'];
  for (const key of movementKeys) assert.ok(bundle.reports.some(r => Number(r.payload[key]) > 0), `${key} should be exercised`);

  for (const report of bundle.reports) {
    const cap = capacities[wards.find(w => w.code === report.ward_code).id];
    assert.ok(Number(report.payload.totalPatientM) >= 0 && Number(report.payload.totalPatientM) <= cap);
    assert.equal(Number(report.payload.emptyBeds.count), cap - Number(report.payload.totalPatientM));
    assert.match(String(report.payload.staffAM), /^\d+(?:\.5)?$/);
    assert.match(String(report.payload.staffPM), /^\d+(?:\.5)?$/);
    assert.ok(report.payload.sigRank);
    assert.ok(report.payload.sigName);
    assert.ok(report.payload.sigAppt);
    assert.equal('inactive_item' in report.payload.dynamicItems, false);
    assert.equal('future_item' in report.payload.dynamicItems, false);

    const referencedBeds = [
      ...Object.values(report.payload.infBeds || {}).flat(),
      ...Object.values(report.payload.devBeds || {}).flatMap(value => value?.mode === 'beds' ? (value.beds || []) : []),
      ...Object.values(report.payload.dynamicItems || {}).flatMap(value => Array.isArray(value) ? value : (value?.mode === 'beds' ? (value.beds || []) : [])),
      ...report.payload.patients.map(row => row[0]),
      ...report.payload.consultations.map(row => row[0]),
      ...report.payload.intubations.map(row => row[0]),
      ...report.payload.earlyBirds.map(row => row.bed),
    ].filter(Boolean).map(Number).filter(Number.isFinite);
    assert.ok(referencedBeds.every(bed => bed >= 1 && bed <= Number(report.payload.totalPatientM)), `occupied-bed references must not point at an empty bed in ${report.ward_code}`);
  }

  assert.ok(bundle.reports.some(r => r.payload.emptyBeds.details.some(d => d.location && /^[MF]$/.test(d.gender) && d.remark)));
  assert.ok(bundle.reports.some(r => r.payload.earlyBirds.some(e => e.bed && e.dest)));
  assert.ok(bundle.reports.some(r => r.payload.patients.some(row => row.length === 3 && row.every(Boolean))));
  assert.ok(bundle.reports.some(r => r.payload.consultations.some(row => row.length === 3 && row.every(Boolean))));
  assert.ok(bundle.reports.some(r => r.payload.intubations.some(row => row.length === 8 && row.every(Boolean))));
  assert.ok(bundle.reports.some(r => r.payload.nurses.some(n => n.source === 'ward_staff' && n.staffId && n.name && n.role)));
  assert.ok(bundle.reports.some(r => r.payload.nurses.some(n => n.source === 'free_text' && !n.staffId && n.name && n.role)));

  for (const key of ['custom_dropdown', 'custom_checkbox', 'custom_number', 'custom_text', 'custom_beds', 'custom_device']) {
    assert.ok(bundle.reports.some(r => hasMeaningful(r.payload.dynamicItems[key])), `${key} should be meaningfully populated`);
  }
  assert.ok(bundle.reports.some(r => (r.payload.infBeds.iCRE || []).length > 0));
  assert.ok(bundle.reports.some(r => hasMeaningful(r.payload.devBeds.dMV)));
});

test('missing effective capacity is a configuration error instead of silently inventing capacity', () => {
  assert.throws(() => generateDemoDataBundle({
    wards: [wards[0]],
    periods: [periods[0]],
    capacities: {},
    items,
    staffByWard,
    scenario: 'typical',
    reportDate: REPORT_DATE,
    now: NOW,
    seed: 100,
  }), /No positive bed capacity is configured for A1/);
});

test('bed-or-count coverage is N/A when that control type is not configured', () => {
  const noDeviceItems = items.filter(item => item.input_type !== 'bed_or_count');
  const bundle = generateDemoDataBundle({ wards, periods, capacities, items: noDeviceItems, staffByWard, scenario: 'typical', reportDate: REPORT_DATE, now: NOW, seed: 8122 });
  assert.equal(bundle.coverage.bed_or_count_beds_mode, null);
  assert.equal(bundle.coverage.bed_or_count_count_mode, null);
});
