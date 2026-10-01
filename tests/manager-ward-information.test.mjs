import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManagerWardInformation } from '../domain/manager-ward-information.js';

const ward = { id: 'ward-1', name: 'C10' };
const report = {
  id: 'report-1',
  ward_id: ward.id,
  submitted_at: '2026-10-01T01:15:00Z',
  payload: {
    nilSpecial: false,
    patients: [['12', 'CHAN Tai Man', 'Pneumonia; oxygen requirement increased']],
    nilConsultation: false,
    consultations: [['12', 'CHAN Tai Man', 'Respiratory Medicine']],
    nilIntubation: false,
    intubations: [['8', 'LEE Mei / HN123', 'Sepsis', 'Respiratory failure', 'Emergency', 'Anaes', 'Cubicle 3', 'To ICU']],
    dynamicItems: { special_observation: '2 patients' },
  },
  report_item_snapshot: [
    { key: 'special_observation', label: 'Special Observation', builtin: false, sort_order: 7 },
  ],
};

test('Ward Information preserves Patient, Consultation and Intubation as separate source structures', () => {
  const [info] = buildManagerWardInformation({
    wards: [ward],
    bundle: [{ ward, report, capacity: 40 }],
    items: [],
  });

  assert.deepEqual(info.patientList.rows, [{
    bed: '12',
    name: 'CHAN Tai Man',
    diagnosisConditionProgress: 'Pneumonia; oxygen requirement increased',
  }]);
  assert.deepEqual(info.consultation.rows, [{
    bed: '12',
    name: 'CHAN Tai Man',
    pendingConsultation: 'Respiratory Medicine',
  }]);
  assert.deepEqual(info.intubation.rows, [{
    bed: '8',
    nameHospitalNumber: 'LEE Mei / HN123',
    diagnosis: 'Sepsis',
    reason: 'Respiratory failure',
    urgency: 'Emergency',
    byWhom: 'Anaes',
    location: 'Cubicle 3',
    outcome: 'To ICU',
  }]);
  assert.equal(info.patientList.nil, false);
  assert.equal(info.consultation.nil, false);
  assert.equal(info.intubation.nil, false);
});

test('Additional Report Items use the submitted report item snapshot rather than current configuration', () => {
  const [info] = buildManagerWardInformation({
    wards: [ward],
    bundle: [{ ward, report, capacity: 40 }],
    items: [{ key: 'renamed_item', label: 'New Current Item', builtin: false, sort_order: 1 }],
  });

  assert.deepEqual(info.additionalItems, [{
    key: 'special_observation',
    label: 'Special Observation',
    value: '2 patients',
  }]);
});

test('Ward Nil semantics remain explicit and are not collapsed into generic clinical text', () => {
  const nilReport = {
    ...report,
    payload: {
      nilSpecial: true,
      patients: [['99', 'SHOULD', 'NOT RENDER']],
      nilConsultation: true,
      consultations: [['99', 'SHOULD', 'NOT RENDER']],
      nilIntubation: true,
      intubations: [['99', 'SHOULD', 'NOT RENDER']],
      dynamicItems: {},
    },
    report_item_snapshot: [],
  };
  const [info] = buildManagerWardInformation({ wards: [ward], bundle: [{ ward, report: nilReport }] });

  assert.equal(info.patientList.nil, true);
  assert.equal(info.consultation.nil, true);
  assert.equal(info.intubation.nil, true);
  assert.deepEqual(info.patientList.rows, []);
  assert.deepEqual(info.consultation.rows, []);
  assert.deepEqual(info.intubation.rows, []);
});
