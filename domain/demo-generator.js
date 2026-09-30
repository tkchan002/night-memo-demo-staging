import {
  DIRECT_REPORT_KEYS,
  effectiveItems,
  fullReportPayloadDefaults,
  normalizeDevice,
  normalizeReportPayload,
} from './report-model.js';
import { wardRequiresPerBedGender } from './ward.js';

export const GENERATED_DEMO_FORMAT = 'night-memo-generated-v2';

export const DEMO_SCENARIOS = Object.freeze({
  typical: Object.freeze({
    label: 'Typical night',
    occupancyMin: 0.80,
    occupancyMax: 0.96,
    currentSubmissionRate: 0.82,
    clinicalRate: 0.30,
    consultationRate: 0.14,
    intubationRate: 0.025,
    infectionRate: 0.10,
    deviceRate: 0.28,
    admissionFactor: 0.07,
  }),
  busy: Object.freeze({
    label: 'Busy night',
    occupancyMin: 0.90,
    occupancyMax: 1.00,
    currentSubmissionRate: 0.88,
    clinicalRate: 0.48,
    consultationRate: 0.24,
    intubationRate: 0.06,
    infectionRate: 0.16,
    deviceRate: 0.40,
    admissionFactor: 0.11,
  }),
  surge: Object.freeze({
    label: 'High-acuity / surge night',
    occupancyMin: 0.96,
    occupancyMax: 1.00,
    currentSubmissionRate: 0.76,
    clinicalRate: 0.68,
    consultationRate: 0.36,
    intubationRate: 0.11,
    infectionRate: 0.22,
    deviceRate: 0.52,
    admissionFactor: 0.16,
  }),
});

const CONDITION_TEXTS = [
  'Increasing oxygen requirement; medical officer informed and close observation continued.',
  'Febrile episode; cultures taken and prescribed antimicrobial treatment continued.',
  'Transient hypotension; responded to treatment and remains under close monitoring.',
  'New confusion and agitation; safety measures instituted and medical review completed.',
  'Reduced urine output; fluid balance reviewed and repeat blood tests arranged.',
  'Chest discomfort reported; ECG performed and medical officer reviewed.',
  'Hypoglycaemia corrected; oral intake encouraged and glucose monitoring continued.',
  'Persistent tachycardia; hydration status reviewed and medical team informed.',
  'Shortness of breath on exertion; oxygen therapy adjusted with clinical improvement.',
  'Poor oral intake and increasing weakness; hydration and nutritional support reviewed.',
];

const CONSULT_TEXTS = [
  'Respiratory Medicine review requested; awaiting assessment.',
  'Cardiology review requested for recurrent symptoms.',
  'Surgical team contacted for abdominal symptoms; review pending.',
  'ICU outreach review requested because of increasing oxygen requirement.',
  'Endocrinology advice requested for difficult glycaemic control.',
  'Renal team advice requested regarding deteriorating renal function.',
  'Geriatric team review requested for acute functional decline and confusion.',
];

const INTUBATION_CASES = [
  ['Severe pneumonia', 'Progressive respiratory failure', 'Emergency', 'Anaesthetics / parent team', 'Ward bedside', 'Transferred to ICU'],
  ['Acute pulmonary oedema', 'Refractory hypoxaemia', 'Emergency', 'Anaesthetics / parent team', 'Ward bedside', 'Transferred to ICU'],
  ['Aspiration pneumonia', 'Reduced conscious state with respiratory compromise', 'Emergency', 'Anaesthetics / parent team', 'Ward bedside', 'Transferred to ICU'],
  ['Sepsis with respiratory failure', 'Worsening respiratory distress', 'Emergency', 'Anaesthetics / parent team', 'Ward bedside', 'Transferred to ICU'],
];

const SURNAMES = ['CHAN', 'LEE', 'WONG', 'CHEUNG', 'LAM', 'HO', 'NG', 'LAU', 'LEUNG', 'YEUNG', 'TANG', 'YIP'];
const GIVEN_NAMES = ['TAI MAN', 'MEI LING', 'KA WAI', 'WAI MAN', 'PUI YEE', 'CHI HO', 'SZE MAN', 'HO YIN', 'WAI FONG', 'KA YAN'];

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function randomBetween(rng, min, max) { return min + (max - min) * rng(); }
function randomInt(rng, min, max) { return Math.floor(randomBetween(rng, min, max + 1)); }
function chance(rng, probability) { return rng() < probability; }
function choose(rng, values) { return values.length ? values[Math.floor(rng() * values.length)] : null; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function asNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function optionsOf(item) { return asArray(item?.options).map(String).filter(Boolean); }

export function createSeededRandom(seed = Date.now()) {
  let t = Number(seed) >>> 0;
  return function seededRandom() {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledIndexes(count, rng) {
  const out = Array.from({ length: count }, (_, i) => i);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function activeOnDate(ward, periods, date) {
  if (periods?.length) {
    return periods.some(period => period.ward_id === ward.id
      && period.start_date <= date
      && (!period.end_date || period.end_date >= date));
  }
  return ward?.active !== false;
}

function pickUniqueBeds(rng, capacity, count, excluded = new Set()) {
  const ceiling = Math.max(0, Math.floor(asNumber(capacity, 0)));
  if (ceiling < 1 || count < 1) return [];
  const pool = Array.from({ length: ceiling }, (_, index) => String(index + 1))
    .filter(bed => !excluded.has(bed));
  const result = [];
  while (result.length < count && pool.length) {
    const index = randomInt(rng, 0, pool.length - 1);
    result.push(pool.splice(index, 1)[0]);
  }
  return result;
}

function syntheticPatientName(wardName, sequence, rng) {
  const surname = choose(rng, SURNAMES);
  const given = choose(rng, GIVEN_NAMES);
  return `${surname} ${given} [DEMO ${wardName}-${String(sequence).padStart(2, '0')}]`;
}

function formatAppointment(value) {
  const text = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}

function configuredStaffForWard(staffByWard, ward) {
  if (!staffByWard) return [];
  const rows = staffByWard instanceof Map
    ? (staffByWard.get(ward.id) || staffByWard.get(ward.name) || [])
    : (staffByWard[ward.id] || staffByWard[ward.name] || []);
  return asArray(rows).filter(row => row && row.active !== false && row.name);
}

function syntheticNurses(ward, rng, capacity, staffByWard) {
  const count = clamp(Math.round(asNumber(capacity, 30) / 12), 2, 5);
  const configured = configuredStaffForWard(staffByWard, ward);
  const nurses = [];

  // Use the actual configured ward-staff reference when one exists. This tests
  // the same staffId/source path used by Ward autocomplete without inventing a
  // fake relationship to the staff database.
  for (const staff of configured.slice(0, Math.min(configured.length, Math.max(1, count - 1)))) {
    nurses.push({
      role: staff.role || 'RN',
      name: String(staff.name),
      appt: formatAppointment(staff.appointment_date),
      runner: false,
      source: 'ward_staff',
      staffId: staff.id || null,
    });
  }

  const roles = ['RN', 'RN', 'EN', 'APN', 'Student Nurse'];
  while (nurses.length < count) {
    const index = nurses.length;
    nurses.push({
      role: roles[index % roles.length],
      name: `DEMO ${ward.name} ${index === count - 1 ? 'RELIEF' : 'NURSE'} ${index + 1}`,
      appt: index === count - 1 ? '01/08/2026' : '',
      runner: false,
      source: 'free_text',
      staffId: null,
    });
  }

  if (nurses.length && chance(rng, 0.30)) nurses[nurses.length - 1].runner = true;
  return nurses;
}

function numericDropdownValue(item, rng, scenario, preferred = null) {
  const options = optionsOf(item);
  if (!options.length) return preferred == null ? '0' : String(preferred);
  const numeric = options.map(Number);
  if (numeric.every(Number.isFinite)) {
    const max = Math.max(...numeric);
    const target = preferred == null
      ? randomInt(rng, 0, Math.max(0, Math.min(max, scenario === DEMO_SCENARIOS.surge ? 6 : scenario === DEMO_SCENARIOS.busy ? 4 : 3)))
      : Number(preferred);
    const best = options.reduce((current, option) => Math.abs(Number(option) - target) < Math.abs(Number(current) - target) ? option : current, options[0]);
    return best;
  }
  if (preferred != null && options.includes(String(preferred))) return String(preferred);
  const nil = options.find(value => /^(0|nil|none|no|n\/a)$/i.test(value.trim()));
  if (nil && chance(rng, 0.55)) return nil;
  return choose(rng, options) || options[0];
}

function meaningfulDropdownValue(item) {
  const options = optionsOf(item);
  return options.find(value => !/^(0|nil|none|no|n\/a|false)$/i.test(value.trim())) || options[0] || '1';
}

function meaningfulDirectValue(item) {
  if (item?.input_type === 'dropdown') {
    const options = optionsOf(item);
    const positiveNumeric = options
      .map(value => ({ value, number: Number(value) }))
      .filter(entry => Number.isFinite(entry.number) && entry.number > 0)
      .sort((a, b) => a.number - b.number)[0];
    if (positiveNumeric) return positiveNumeric.value;
    return options.find(value => !/^(0|nil|none|no|n\/a|false)$/i.test(value.trim())) || null;
  }
  return '1';
}

function genericItemValue(item, ctx, { forceMeaningful = false, forceDeviceMode = null } = {}) {
  const { rng, capacity, scenario } = ctx;
  switch (item.input_type) {
    case 'dropdown': return forceMeaningful ? meaningfulDropdownValue(item) : numericDropdownValue(item, rng, scenario);
    case 'checkbox': return forceMeaningful ? true : chance(rng, scenario === DEMO_SCENARIOS.surge ? 0.32 : 0.16);
    case 'number': return forceMeaningful ? 1 : randomInt(rng, 0, scenario === DEMO_SCENARIOS.surge ? 5 : 3);
    case 'bed_chooser': {
      const count = forceMeaningful ? 1 : (chance(rng, scenario.deviceRate) ? randomInt(rng, 1, 2) : 0);
      return pickUniqueBeds(rng, capacity, count);
    }
    case 'bed_or_count': {
      if (!forceMeaningful && !chance(rng, scenario.deviceRate)) return normalizeDevice(null);
      const mode = forceDeviceMode || (chance(rng, 0.35) ? 'count' : 'beds');
      if (mode === 'count') return normalizeDevice({ mode: 'count', count: randomInt(rng, 1, 3) });
      return normalizeDevice(pickUniqueBeds(rng, capacity, randomInt(rng, 1, forceMeaningful ? 1 : 2)));
    }
    case 'free_text':
      return forceMeaningful || chance(rng, 0.16) ? 'Overnight review required; continue close observation and hand over to the day team.' : '';
    default:
      return forceMeaningful ? 'Demo value' : '';
  }
}

function itemStorage(item) {
  const configured = item?.config?.storage;
  if (configured) return configured;
  if (item?.builtin && item?.section === 'infection') return 'infBeds';
  if (item?.builtin && item?.section === 'devices') return 'devBeds';
  return 'dynamicItems';
}

function applyConfiguredItems(payload, items, ctx) {
  for (const item of items) {
    const key = String(item.key || '');
    if (!key || DIRECT_REPORT_KEYS.includes(key)) continue;
    const storage = itemStorage(item);
    if (storage === 'infBeds') {
      const count = chance(ctx.rng, ctx.scenario.infectionRate) ? randomInt(ctx.rng, 1, 2) : 0;
      payload.infBeds[key] = pickUniqueBeds(ctx.rng, ctx.capacity, count);
    } else if (storage === 'devBeds') {
      payload.devBeds[key] = normalizeDevice(genericItemValue({ ...item, input_type: item.input_type || 'bed_or_count' }, ctx));
    } else {
      payload.dynamicItems[key] = genericItemValue(item, ctx);
    }
  }
}

function directValue(item, preferred, rng, scenario) {
  if (item?.input_type === 'dropdown') return numericDropdownValue(item, rng, scenario, preferred);
  return String(preferred);
}

function emptyBedDetails(ward, emptyCount, rng) {
  if (!wardRequiresPerBedGender(ward) || emptyCount <= 0) return [];
  const count = Math.min(emptyCount, chance(rng, 0.35) ? 2 : 1);
  const remarks = ['D room', 'TB', 'HZ', 'Side room'];
  return Array.from({ length: count }, (_, index) => ({
    location: String(Math.max(1, asNumber(ward.capacity, 40) - index)),
    gender: index % 2 === 0 ? 'M' : 'F',
    remark: remarks[index % remarks.length],
  }));
}

function clinicalRows({ ward, capacity, rng, scenario, currentSession }) {
  const multiplier = currentSession ? 1 : 0.55;
  const patients = [];
  const consultations = [];
  const intubations = [];
  let sequence = 1;

  if (chance(rng, scenario.clinicalRate * multiplier)) {
    const count = chance(rng, scenario === DEMO_SCENARIOS.surge ? 0.45 : 0.22) ? 2 : 1;
    const beds = pickUniqueBeds(rng, capacity, count);
    for (const bed of beds) {
      patients.push([bed, syntheticPatientName(ward.name, sequence++, rng), choose(rng, CONDITION_TEXTS)]);
    }
  }

  if (chance(rng, scenario.consultationRate * multiplier)) {
    const bed = pickUniqueBeds(rng, capacity, 1)[0] || '1';
    consultations.push([bed, syntheticPatientName(ward.name, sequence++, rng), choose(rng, CONSULT_TEXTS)]);
  }

  if (chance(rng, scenario.intubationRate * multiplier)) {
    const bed = pickUniqueBeds(rng, capacity, 1)[0] || '1';
    const patient = syntheticPatientName(ward.name, sequence++, rng);
    const demoNo = `D${String(Math.floor(rng() * 999999)).padStart(6, '0')}`;
    const [diagnosis, reason, type, requestedBy, location, outcome] = choose(rng, INTUBATION_CASES);
    intubations.push([bed, `${patient} / ${demoNo}`, diagnosis, reason, type, requestedBy, location, outcome]);
  }

  return { patients, consultations, intubations };
}

function buildSessionPayload({ ward, capacity, items, staffByWard, rng, scenario, previousTotal = null, currentSession = false }) {
  const payload = fullReportPayloadDefaults();
  const cap = Math.max(1, Math.floor(asNumber(capacity, 40)));
  const maxAdmissions = Math.max(1, Math.round(cap * scenario.admissionFactor));
  const admissionEC = randomInt(rng, 0, maxAdmissions);
  const admissionCC = chance(rng, 0.28) ? randomInt(rng, 1, scenario === DEMO_SCENARIOS.surge ? 3 : 2) : 0;
  const discharge = randomInt(rng, 0, Math.max(1, Math.round(cap * 0.08)));
  const death = chance(rng, scenario === DEMO_SCENARIOS.surge ? 0.12 : 0.05) ? 1 : 0;
  const transferIn = chance(rng, 0.28) ? randomInt(rng, 1, 2) : 0;
  const transferOut = chance(rng, 0.25) ? randomInt(rng, 1, 2) : 0;

  const itemByKey = new Map(items.map(item => [String(item.key || ''), item]));
  payload.admissionEC = directValue(itemByKey.get('admissionEC'), admissionEC, rng, scenario);
  payload.admissionCC = directValue(itemByKey.get('admissionCC'), admissionCC, rng, scenario);
  payload.discharge = directValue(itemByKey.get('discharge'), discharge, rng, scenario);
  payload.death = directValue(itemByKey.get('death'), death, rng, scenario);
  payload.transferIn = directValue(itemByKey.get('transferIn'), transferIn, rng, scenario);
  payload.transferOut = directValue(itemByKey.get('transferOut'), transferOut, rng, scenario);

  let total;
  if (previousTotal == null) {
    total = Math.round(cap * randomBetween(rng, scenario.occupancyMin, scenario.occupancyMax));
  } else {
    const net = asNumber(payload.admissionEC) + asNumber(payload.admissionCC) + asNumber(payload.transferIn)
      - asNumber(payload.discharge) - asNumber(payload.death) - asNumber(payload.transferOut);
    total = previousTotal + net;
    const low = Math.floor(cap * Math.max(0.72, scenario.occupancyMin - 0.08));
    total = clamp(total, low, cap);
  }
  payload.totalPatientM = directValue(itemByKey.get('totalPatientM'), total, rng, scenario);

  // Empty-bed count follows actual capacity, not the configured dropdown value.
  // Mixed wards receive the same location/gender/remark structure entered in Ward.
  const actualTotal = clamp(asNumber(payload.totalPatientM, total), 0, cap);
  payload.totalPatientM = String(actualTotal);
  const emptyCount = Math.max(0, cap - actualTotal);
  payload.emptyBeds = {
    count: emptyCount,
    details: emptyBedDetails({ ...ward, capacity: cap }, emptyCount, rng),
  };

  const occupiedBeds = Math.max(1, actualTotal);
  const ctx = { ward, capacity: occupiedBeds, items, rng, scenario };
  applyConfiguredItems(payload, items, ctx);

  const clinical = clinicalRows({ ward, capacity: occupiedBeds, rng, scenario, currentSession });
  payload.patients = clinical.patients;
  payload.nilSpecial = clinical.patients.length === 0;
  payload.consultations = clinical.consultations;
  payload.nilConsultation = clinical.consultations.length === 0;
  payload.intubations = clinical.intubations;
  payload.nilIntubation = clinical.intubations.length === 0;

  if (chance(rng, 0.18)) {
    payload.earlyBirds = [{
      bed: pickUniqueBeds(rng, occupiedBeds, 1)[0] || '1',
      dest: choose(rng, ['CT', 'Endoscopy', 'OT', 'Dialysis', 'MRI', 'Ultrasound']),
    }];
  }

  payload.nurses = syntheticNurses(ward, rng, cap, staffByWard);

  // AM/PM duty staffing is a numeric headcount and commonly uses half-person
  // increments. It is deliberately not an RN/EN text breakdown.
  const staffingBase = clamp(Math.round((cap / 8) * 2) / 2, 2.5, 9);
  const staffingVariation = () => choose(rng, [-0.5, 0, 0, 0, 0.5]);
  const formatStaffing = value => {
    const rounded = clamp(Math.round(value * 2) / 2, 2, 10);
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };
  payload.staffAM = formatStaffing(staffingBase + staffingVariation());
  payload.staffPM = formatStaffing(staffingBase + staffingVariation());

  const signer = payload.nurses.find(nurse => nurse.source === 'ward_staff') || payload.nurses[0];
  payload.sigRank = signer?.role || 'RN';
  payload.sigName = signer?.name || `DEMO ${ward.name} NURSE 1`;
  payload.sigAppt = signer?.appt || '01/08/2026';

  return normalizeReportPayload(payload);
}

function createReport({ ward, reportDate, submittedAt, submittedMinutesAgo, payload, session, capacity }) {
  const normalized = normalizeReportPayload(payload);
  normalized.savedAt = submittedAt.toISOString();
  return {
    ward_name: String(ward.name),
    report_date: reportDate,
    // submitted_at is used for preview only. During import the server recomputes
    // submitted_at from submitted_minutes_ago so Manager and the importer share
    // the same clock and timezone reference.
    submitted_at: submittedAt.toISOString(),
    submitted_minutes_ago: Number(submittedMinutesAgo),
    payload: normalized,
    session,
    preview_capacity: Number(capacity) || 0,
  };
}

function targetCurrentReport(reports, wardName = null) {
  return reports.find(report => report.session === 'current' && (!wardName || report.ward_name === wardName))
    || reports.find(report => !wardName || report.ward_name === wardName)
    || null;
}

function occupiedBedLimit(report) {
  const cap = Math.max(1, Number(report?.preview_capacity) || 1);
  return clamp(asNumber(report?.payload?.totalPatientM, cap), 0, cap);
}

function removeBedFromPayload(payload, bed) {
  const target = String(bed);
  for (const key of Object.keys(payload.infBeds || {})) {
    payload.infBeds[key] = asArray(payload.infBeds[key]).filter(value => String(value) !== target);
  }
  for (const store of [payload.devBeds || {}, payload.dynamicItems || {}]) {
    for (const [key, value] of Object.entries(store)) {
      if (Array.isArray(value)) store[key] = value.filter(entry => String(entry) !== target);
      else if (value && typeof value === 'object' && value.mode === 'beds') {
        store[key] = { ...value, beds: asArray(value.beds).filter(entry => String(entry) !== target) };
      }
    }
  }
  for (const rows of [payload.patients, payload.consultations, payload.intubations]) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (Array.isArray(row) && String(row[0]) === target) row[0] = '1';
    }
  }
  for (const early of payload.earlyBirds || []) {
    if (String(early.bed) === target) early.bed = '1';
  }
}

function meaningfulDynamicValue(item, report, rng) {
  const ctx = {
    rng,
    capacity: occupiedBedLimit(report),
    scenario: DEMO_SCENARIOS.busy,
  };
  return genericItemValue(item, ctx, { forceMeaningful: true });
}

function valueHasContent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object') {
    if ('mode' in value) return value.mode === 'count' ? Number(value.count) > 0 : asArray(value.beds).length > 0;
    return Object.keys(value).length > 0;
  }
  return String(value ?? '').trim() !== '' && !/^(0|nil|none|no|n\/a|false)$/i.test(String(value).trim());
}

function ensureCoreCoverage(reports, activeWards, staffByWard, items, rng) {
  const current = reports.filter(report => report.session === 'current');
  if (!current.length) return;
  const primary = current[0];
  const capacity = occupiedBedLimit(primary);
  let sequence = 90;

  // Guarantee that every standard movement/count field has a realistic
  // non-zero example somewhere in the batch when the current configuration
  // allows one. Previous-session reports are used so current-session totals
  // remain derived from their own generated movement values.
  const movementTarget = reports.find(report => report.session === 'previous') || primary;
  const itemByKey = new Map(items.map(item => [String(item.key || ''), item]));
  for (const key of ['admissionEC', 'admissionCC', 'discharge', 'death', 'transferIn', 'transferOut']) {
    if (reports.some(report => Number(report.payload[key]) > 0)) continue;
    const value = meaningfulDirectValue(itemByKey.get(key));
    if (value != null) movementTarget.payload[key] = String(value);
  }

  if (!reports.some(report => Number(report.payload.emptyBeds?.count) > 0)) {
    const target = reports.find(report => report.session === 'previous') || primary;
    const cap = Math.max(1, Number(target.preview_capacity) || 1);
    target.payload.totalPatientM = String(Math.max(0, cap - 1));
    target.payload.emptyBeds = { count: 1, details: [] };
    removeBedFromPayload(target.payload, String(cap));
  }

  // Exercise both the Nil checkbox state and the populated-row state. This is
  // important because the Ward UI and print renderer have separate paths.
  if (reports.length > 1) {
    const nilTarget = reports.find(report => report.session === 'previous' && report !== movementTarget)
      || reports.find(report => report.session === 'previous')
      || reports[reports.length - 1];
    nilTarget.payload.nilSpecial = true;
    nilTarget.payload.patients = [];
    nilTarget.payload.nilConsultation = true;
    nilTarget.payload.consultations = [];
    nilTarget.payload.nilIntubation = true;
    nilTarget.payload.intubations = [];
  }

  if (!current.some(report => !report.payload.nilSpecial && report.payload.patients.length)) {
    const bed = pickUniqueBeds(rng, capacity, 1)[0] || '1';
    primary.payload.patients = [[bed, syntheticPatientName(primary.ward_name, sequence++, rng), choose(rng, CONDITION_TEXTS)]];
    primary.payload.nilSpecial = false;
  }
  if (!current.some(report => !report.payload.nilConsultation && report.payload.consultations.length)) {
    const bed = pickUniqueBeds(rng, capacity, 1)[0] || '1';
    primary.payload.consultations = [[bed, syntheticPatientName(primary.ward_name, sequence++, rng), choose(rng, CONSULT_TEXTS)]];
    primary.payload.nilConsultation = false;
  }
  if (!current.some(report => !report.payload.nilIntubation && report.payload.intubations.length)) {
    const bed = pickUniqueBeds(rng, capacity, 1)[0] || '1';
    const patient = syntheticPatientName(primary.ward_name, sequence++, rng);
    const [diagnosis, reason, type, requestedBy, location, outcome] = choose(rng, INTUBATION_CASES);
    primary.payload.intubations = [[bed, `${patient} / D000999`, diagnosis, reason, type, requestedBy, location, outcome]];
    primary.payload.nilIntubation = false;
  }
  if (!reports.some(report => report.payload.earlyBirds?.length)) {
    primary.payload.earlyBirds = [{ bed: pickUniqueBeds(rng, capacity, 1)[0] || '1', dest: 'CT' }];
  }
  if (!reports.some(report => report.payload.nurses?.some(nurse => nurse.runner))) {
    const nurse = primary.payload.nurses?.[primary.payload.nurses.length - 1];
    if (nurse) nurse.runner = true;
  }
  if (!reports.some(report => report.payload.nurses?.some(nurse => nurse.source === 'free_text'))) {
    primary.payload.nurses = [...(primary.payload.nurses || []), {
      role: 'RN', name: `DEMO ${primary.ward_name} RELIEF NURSE`, appt: '01/08/2026', runner: false, source: 'free_text', staffId: null,
    }];
  }

  const wardWithStaff = activeWards.find(ward => configuredStaffForWard(staffByWard, ward).length);
  if (wardWithStaff && !reports.some(report => report.payload.nurses?.some(nurse => nurse.source === 'ward_staff'))) {
    const target = targetCurrentReport(reports, wardWithStaff.name);
    const staff = configuredStaffForWard(staffByWard, wardWithStaff)[0];
    if (target && staff) {
      const linked = {
        role: staff.role || 'RN', name: String(staff.name), appt: formatAppointment(staff.appointment_date),
        runner: false, source: 'ward_staff', staffId: staff.id || null,
      };
      target.payload.nurses = [linked, ...(target.payload.nurses || []).filter(nurse => nurse.name !== linked.name)];
      target.payload.sigRank = linked.role;
      target.payload.sigName = linked.name;
      target.payload.sigAppt = linked.appt || '01/08/2026';
    }
  }

  const mixedWard = activeWards.find(wardRequiresPerBedGender);
  if (mixedWard) {
    const target = targetCurrentReport(reports, mixedWard.name);
    if (target && !target.payload.emptyBeds?.details?.length) {
      const cap = Math.max(1, Number(target.preview_capacity) || 1);
      let total = clamp(asNumber(target.payload.totalPatientM, cap - 1), 0, cap);
      if (total >= cap) total = Math.max(0, cap - 1);
      target.payload.totalPatientM = String(total);
      target.payload.emptyBeds = {
        count: Math.max(1, cap - total),
        details: [{ location: String(cap), gender: 'M', remark: 'D room' }],
      };
      removeBedFromPayload(target.payload, String(cap));
    }
  }
}

function ensureConfiguredItemCoverage(reports, items, rng) {
  const current = reports.filter(report => report.session === 'current');
  const fallback = current[0] || reports[0];
  if (!fallback) return;

  for (const item of items) {
    const key = String(item.key || '');
    if (!key || DIRECT_REPORT_KEYS.includes(key)) continue;
    const storage = itemStorage(item);
    const isCovered = reports.some(report => {
      if (storage === 'infBeds') return valueHasContent(report.payload.infBeds?.[key]);
      if (storage === 'devBeds') return valueHasContent(report.payload.devBeds?.[key]);
      return valueHasContent(report.payload.dynamicItems?.[key]);
    });
    if (isCovered) continue;

    const target = fallback;
    const cap = occupiedBedLimit(target);
    if (storage === 'infBeds') {
      target.payload.infBeds[key] = pickUniqueBeds(rng, cap, 1);
    } else if (storage === 'devBeds') {
      target.payload.devBeds[key] = normalizeDevice({ mode: 'beds', beds: pickUniqueBeds(rng, cap, 1) });
    } else {
      target.payload.dynamicItems[key] = meaningfulDynamicValue(item, target, rng);
    }
  }

  // Bed-or-count controls support two distinct user entry modes. If at least
  // one such item exists and both sessions are available, exercise both modes.
  const dualModeItems = items.filter(item => item.input_type === 'bed_or_count');
  const previous = reports.find(report => report.session === 'previous');
  const latest = current[0];
  if (dualModeItems.length && previous && latest) {
    const item = dualModeItems[0];
    const key = String(item.key || '');
    const storage = itemStorage(item);
    const cap = occupiedBedLimit(latest);
    const bedsValue = normalizeDevice({ mode: 'beds', beds: pickUniqueBeds(rng, cap, 1) });
    const countValue = normalizeDevice({ mode: 'count', count: 2 });
    if (storage === 'devBeds') {
      previous.payload.devBeds[key] = countValue;
      latest.payload.devBeds[key] = bedsValue;
    } else if (storage === 'dynamicItems') {
      previous.payload.dynamicItems[key] = countValue;
      latest.payload.dynamicItems[key] = bedsValue;
    }
  }
}

function configuredItemCoverage(reports, items) {
  const keys = items.filter(item => item?.key && !DIRECT_REPORT_KEYS.includes(String(item.key))).map(item => String(item.key));
  const covered = keys.filter(key => {
    const item = items.find(candidate => String(candidate.key) === key);
    const storage = itemStorage(item);
    return reports.some(report => storage === 'infBeds'
      ? valueHasContent(report.payload.infBeds?.[key])
      : storage === 'devBeds'
        ? valueHasContent(report.payload.devBeds?.[key])
        : valueHasContent(report.payload.dynamicItems?.[key]));
  });
  return { configured: keys.length, covered: covered.length, missing: keys.filter(key => !covered.includes(key)) };
}

function buildCoverageSummary(reports, items, activeWards, staffByWard) {
  const itemCoverage = configuredItemCoverage(reports, items);
  const mixedApplicable = activeWards.some(wardRequiresPerBedGender);
  const staffApplicable = activeWards.some(ward => configuredStaffForWard(staffByWard, ward).length);
  const hasBedOrCount = items.some(item => item.input_type === 'bed_or_count');
  const bedOrCountValues = reports.flatMap(report => [
    ...Object.values(report.payload.devBeds || {}),
    ...Object.values(report.payload.dynamicItems || {}).filter(value => value && typeof value === 'object' && 'mode' in value),
  ]);
  return {
    configured_items: itemCoverage,
    movement_counts: ['admissionEC', 'admissionCC', 'discharge', 'death', 'transferIn', 'transferOut']
      .every(key => reports.some(report => Number(report.payload[key]) > 0)),
    total_patient: reports.some(report => Number(report.payload.totalPatientM) > 0),
    empty_bed_count: reports.some(report => Number(report.payload.emptyBeds?.count) > 0),
    patient_list: reports.some(report => !report.payload.nilSpecial && report.payload.patients.length),
    patient_nil_state: reports.some(report => report.payload.nilSpecial && !report.payload.patients.length),
    consultation: reports.some(report => !report.payload.nilConsultation && report.payload.consultations.length),
    consultation_nil_state: reports.some(report => report.payload.nilConsultation && !report.payload.consultations.length),
    intubation: reports.some(report => !report.payload.nilIntubation && report.payload.intubations.length),
    intubation_nil_state: reports.some(report => report.payload.nilIntubation && !report.payload.intubations.length),
    early_bird: reports.some(report => report.payload.earlyBirds?.length),
    night_runner: reports.some(report => report.payload.nurses?.some(nurse => nurse.runner)),
    free_text_nurse: reports.some(report => report.payload.nurses?.some(nurse => nurse.source === 'free_text')),
    ward_staff_nurse: staffApplicable ? reports.some(report => report.payload.nurses?.some(nurse => nurse.source === 'ward_staff')) : null,
    mixed_empty_bed_detail: mixedApplicable ? reports.some(report => report.payload.emptyBeds?.details?.some(detail => detail.location && detail.gender && detail.remark)) : null,
    signature: reports.some(report => report.payload.sigRank && report.payload.sigName && report.payload.sigAppt),
    staffing_counts: reports.every(report => /^\d+(?:\.5)?$/.test(String(report.payload.staffAM)) && /^\d+(?:\.5)?$/.test(String(report.payload.staffPM))),
    bed_or_count_beds_mode: hasBedOrCount ? bedOrCountValues.some(value => value?.mode === 'beds' && asArray(value.beds).length) : null,
    bed_or_count_count_mode: hasBedOrCount ? bedOrCountValues.some(value => value?.mode === 'count' && Number(value.count) > 0) : null,
  };
}

export function generateDemoDataBundle({
  wards = [],
  periods = [],
  capacities = {},
  items = [],
  staffByWard = {},
  scenario = 'typical',
  reportDate,
  now = new Date(),
  seed = Date.now(),
} = {}) {
  const config = DEMO_SCENARIOS[scenario] || DEMO_SCENARIOS.typical;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(reportDate || ''))) throw new Error('A valid reportDate is required.');
  const activeWards = wards
    .filter(ward => activeOnDate(ward, periods, reportDate))
    .sort((a, b) => (Number(a.display_order) || 999) - (Number(b.display_order) || 999));
  if (!activeWards.length) throw new Error('No active wards are configured for the selected date.');
  if (activeWards.length > 200) throw new Error('Demo generation is limited to 200 active wards per batch.');
  const missingCapacity = activeWards.filter(ward => !(Number(capacities?.[ward.id]) > 0));
  if (missingCapacity.length) {
    throw new Error(`No positive bed capacity is configured for ${missingCapacity.map(ward => ward.name).join(', ')} on ${reportDate}.`);
  }

  const rng = createSeededRandom(seed);
  const currentCount = activeWards.length === 1
    ? 1
    : clamp(Math.round(activeWards.length * config.currentSubmissionRate), 1, activeWards.length - 1);
  const currentWardIndexes = new Set(shuffledIndexes(activeWards.length, rng).slice(0, currentCount));
  const effective = effectiveItems(items, reportDate, { includeInactiveHistorical: false });
  const reports = [];

  activeWards.forEach((ward, index) => {
    const capacity = Number(capacities[ward.id]);
    const previousPayload = buildSessionPayload({ ward, capacity, items: effective, staffByWard, rng, scenario: config, currentSession: false });
    const previousAgeMinutes = randomInt(rng, 360, 540);
    reports.push(createReport({
      ward,
      reportDate,
      submittedAt: new Date(now.getTime() - previousAgeMinutes * 60000),
      submittedMinutesAgo: previousAgeMinutes,
      payload: previousPayload,
      session: 'previous',
      capacity,
    }));

    if (currentWardIndexes.has(index)) {
      const currentPayload = buildSessionPayload({
        ward,
        capacity,
        items: effective,
        staffByWard,
        rng,
        scenario: config,
        previousTotal: Number(previousPayload.totalPatientM) || null,
        currentSession: true,
      });
      // Demo-current submissions should always be comfortably inside the
      // Manager 120-minute window. Keep them within the last 5–55 minutes.
      const currentAgeMinutes = randomInt(rng, 5, 55);
      reports.push(createReport({
        ward,
        reportDate,
        submittedAt: new Date(now.getTime() - currentAgeMinutes * 60000),
        submittedMinutesAgo: currentAgeMinutes,
        payload: currentPayload,
        session: 'current',
        capacity,
      }));
    }
  });

  ensureCoreCoverage(reports, activeWards, staffByWard, effective, rng);
  ensureConfiguredItemCoverage(reports, effective, rng);
  const coverage = buildCoverageSummary(reports, effective, activeWards, staffByWard);

  const currentReports = reports.filter(report => report.session === 'current');
  const clinicalCurrent = currentReports.filter(report => !report.payload.nilSpecial || !report.payload.nilConsultation || !report.payload.nilIntubation);
  const intubationCurrent = currentReports.filter(report => !report.payload.nilIntubation && report.payload.intubations.length);

  return {
    format: GENERATED_DEMO_FORMAT,
    scenario,
    seed: Number(seed),
    generated_at: new Date(now).toISOString(),
    generator_version: 2,
    description: `${config.label}: ${activeWards.length} active wards, ${currentReports.length} current submissions, ${activeWards.length - currentReports.length} not yet submitted in the current window.`,
    meta: {
      active_wards: activeWards.length,
      previous_session_reports: activeWards.length,
      current_submissions: currentReports.length,
      not_yet_submitted: activeWards.length - currentReports.length,
      current_clinical_attention_wards: clinicalCurrent.length,
      current_intubation_wards: intubationCurrent.length,
      configured_report_items: effective.length,
      custom_report_items: effective.filter(item => !item.builtin).length,
      configured_staff: activeWards.reduce((sum, ward) => sum + configuredStaffForWard(staffByWard, ward).length, 0),
      mixed_gender_wards: activeWards.filter(wardRequiresPerBedGender).length,
    },
    coverage,
    reports,
  };
}

export function summarizeGeneratedReport(report) {
  const payload = normalizeReportPayload(report?.payload || {});
  const clinical = [];
  if (!payload.nilSpecial && payload.patients.length) clinical.push(`${payload.patients.length} condition`);
  if (!payload.nilConsultation && payload.consultations.length) clinical.push(`${payload.consultations.length} consultation`);
  if (!payload.nilIntubation && payload.intubations.length) clinical.push(`${payload.intubations.length} intubation`);
  return {
    total: Number(payload.totalPatientM) || 0,
    empty: Number(payload.emptyBeds?.count) || 0,
    clinical: clinical.length ? clinical.join(', ') : 'No clinical-attention text',
  };
}
