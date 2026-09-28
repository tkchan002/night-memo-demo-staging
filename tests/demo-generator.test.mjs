import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERATED_DEMO_FORMAT,
  createSeededRandom,
  generateDemoDataBundle,
  summarizeGeneratedReport,
} from '../domain/demo-generator.js';

function wards(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `ward-${index + 1}`,
    code: `W${String(index + 1).padStart(2, '0')}`,
    display_name: `Ward ${index + 1}`,
    display_order: index + 1,
    active: true,
  }));
}

function periodsFor(list) {
  return list.map(ward => ({ ward_id: ward.id, start_date: '2026-01-01', end_date: null }));
}

const ITEMS = [
  { id: '1', key: 'admissionEC', label: 'Admission EC', input_type: 'dropdown', options: ['0', '1', '2', '3', '4'], sort_order: 10, active: true, effective_from: '2026-01-01', builtin: true },
  { id: '2', key: 'iCRE', label: 'CRE', input_type: 'bed_chooser', options: [], sort_order: 20, active: true, effective_from: '2026-01-01', builtin: true },
  { id: '3', key: 'dMV', label: 'MV', input_type: 'bed_or_count', options: [], sort_order: 30, active: true, effective_from: '2026-01-01', builtin: true },
  { id: '4', key: 'custom_alert', label: 'Custom Alert', input_type: 'checkbox', options: [], sort_order: 40, active: true, effective_from: '2026-01-01', builtin: false, config: { storage: 'dynamicItems' } },
  { id: '5', key: 'custom_level', label: 'Custom Level', input_type: 'dropdown', options: ['Nil', 'Low', 'High'], sort_order: 50, active: true, effective_from: '2026-01-01', builtin: false, config: { storage: 'dynamicItems' } },
];

test('seeded random is reproducible', () => {
  const a = createSeededRandom(1234);
  const b = createSeededRandom(1234);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('30 active wards scale automatically and create two-session data', () => {
  const list = wards(30);
  const capacities = Object.fromEntries(list.map((ward, index) => [ward.id, 28 + (index % 4) * 4]));
  const bundle = generateDemoDataBundle({
    wards: list,
    periods: periodsFor(list),
    capacities,
    items: ITEMS,
    scenario: 'typical',
    reportDate: '2026-09-28',
    now: new Date('2026-09-28T13:00:00.000Z'),
    seed: 1001,
  });

  assert.equal(bundle.format, GENERATED_DEMO_FORMAT);
  assert.equal(bundle.meta.active_wards, 30);
  assert.equal(bundle.meta.previous_session_reports, 30);
  assert.equal(bundle.meta.current_submissions, 25);
  assert.equal(bundle.meta.not_yet_submitted, 5);
  assert.equal(bundle.reports.length, 55);

  const byWard = new Map();
  for (const report of bundle.reports) {
    if (!byWard.has(report.ward_code)) byWard.set(report.ward_code, []);
    byWard.get(report.ward_code).push(report);
    assert.equal(report.report_date, '2026-09-28');
  }
  assert.equal([...byWard.values()].filter(rows => rows.length === 2).length, 25);
  assert.equal([...byWard.values()].filter(rows => rows.length === 1).length, 5);
});

test('generated values use live capacity and current item configuration', () => {
  const list = wards(3);
  const capacities = Object.fromEntries(list.map(ward => [ward.id, 32]));
  const bundle = generateDemoDataBundle({
    wards: list,
    periods: periodsFor(list),
    capacities,
    items: ITEMS,
    scenario: 'busy',
    reportDate: '2026-09-28',
    now: new Date('2026-09-28T13:00:00.000Z'),
    seed: 2202,
  });

  for (const report of bundle.reports) {
    const summary = summarizeGeneratedReport(report);
    assert.ok(summary.total <= 32);
    assert.equal(summary.empty, 32 - summary.total);
    assert.ok('custom_alert' in report.payload.dynamicItems);
    assert.ok('custom_level' in report.payload.dynamicItems);
    assert.ok(['Nil', 'Low', 'High'].includes(report.payload.dynamicItems.custom_level));
  }
});

test('synthetic clinical names are visibly marked DEMO and current scenario guarantees attention data', () => {
  const list = wards(8);
  const capacities = Object.fromEntries(list.map(ward => [ward.id, 40]));
  const bundle = generateDemoDataBundle({
    wards: list,
    periods: periodsFor(list),
    capacities,
    items: ITEMS,
    scenario: 'surge',
    reportDate: '2026-09-28',
    now: new Date('2026-09-28T13:00:00.000Z'),
    seed: 3303,
  });

  const current = bundle.reports.filter(report => report.session === 'current');
  assert.ok(current.some(report => !report.payload.nilSpecial || !report.payload.nilConsultation || !report.payload.nilIntubation));
  const names = current.flatMap(report => [
    ...report.payload.patients.map(row => row[1]),
    ...report.payload.consultations.map(row => row[1]),
    ...report.payload.intubations.map(row => row[1]),
  ]).filter(Boolean);
  assert.ok(names.length > 0);
  assert.ok(names.every(name => /DEMO/.test(name)));
});
