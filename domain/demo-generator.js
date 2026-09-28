import {
  DIRECT_REPORT_KEYS,
  effectiveItems,
  fullReportPayloadDefaults,
  normalizeDevice,
  normalizeReportPayload,
} from './report-model.js';

export const GENERATED_DEMO_FORMAT = 'night-memo-generated-v1';

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
  if (ward?.active === false) return false;
  if (!periods?.length) return true;
  return periods.some(period => period.ward_id === ward.id
    && period.start_date <= date
    && (!period.end_date || period.end_date >= date));
}

function pickUniqueBeds(rng, capacity, count, excluded = new Set()) {
  const ceiling = Math.max(1, Math.floor(asNumber(capacity, 1)));
  const pool = Array.from({ length: ceiling }, (_, index) => String(index + 1))
    .filter(bed => !excluded.has(bed));
  const result = [];
  while (result.length < count && pool.length) {
    const index = randomInt(rng, 0, pool.length - 1);
    result.push(pool.splice(index, 1)[0]);
  }
  return result;
}

function syntheticPatientName(wardCode, sequence, rng) {
  const surname = choose(rng, SURNAMES);
  const given = choose(rng, GIVEN_NAMES);
  return `${surname} ${given} [DEMO ${wardCode}-${String(sequence).padStart(2, '0')}]`;
}

function syntheticNurses(wardCode, rng, capacity) {
  const count = clamp(Math.round(asNumber(capacity, 30) / 12), 2, 5);
  return Array.from({ length: count }, (_, index) => ({
    role: index === 0 && chance(rng, 0.18) ? 'APN' : (chance(rng, 0.15) ? 'EN' : 'RN'),
    name: `DEMO ${wardCode} NURSE ${index + 1}`,
    appt: '',
    runner: index === count - 1 && chance(rng, 0.25),
    source: 'free_text',
    staffId: null,
  }));
}

function numericDropdownValue(item, rng, scenario) {
  const options = optionsOf(item);
  if (!options.length) return '0';
  const numeric = options.map(Number);
  if (numeric.every(Number.isFinite)) {
    const max = Math.max(...numeric);
    const ceiling = Math.min(max, scenario === DEMO_SCENARIOS.surge ? 6 : scenario === DEMO_SCENARIOS.busy ? 4 : 3);
    const target = randomInt(rng, 0, Math.max(0, ceiling));
    const best = options.reduce((current, option) => Math.abs(Number(option) - target) < Math.abs(Number(current) - target) ? option : current, options[0]);
    return best;
  }
  const nil = options.find(value => /^(0|nil|none|no|n\/a)$/i.test(value.trim()));
  if (nil && chance(rng, 0.68)) return nil;
  return choose(rng, options) || options[0];
}

function genericItemValue(item, ctx) {
  const { rng, capacity, scenario } = ctx;
  switch (item.input_type) {
    case 'dropdown': return numericDropdownValue(item, rng, scenario);
    case 'checkbox': return chance(rng, scenario === DEMO_SCENARIOS.surge ? 0.28 : 0.14);
    case 'number': return randomInt(rng, 0, scenario === DEMO_SCENARIOS.surge ? 5 : 3);
    case 'bed_chooser': {
      const count = chance(rng, scenario.deviceRate) ? randomInt(rng, 1, 2) : 0;
      return pickUniqueBeds(rng, capacity, count);
    }
    case 'bed_or_count': {
      if (!chance(rng, scenario.deviceRate)) return normalizeDevice(null);
      if (chance(rng, 0.35)) return normalizeDevice({ mode: 'count', count: randomInt(rng, 1, 3) });
      return normalizeDevice(pickUniqueBeds(rng, capacity, randomInt(rng, 1, 2)));
    }
    case 'free_text':
      return chance(rng, 0.12) ? 'Demo note: additional monitoring required overnight.' : '';
    default:
      return '';
  }
}

function applyConfiguredItems(payload, items, ctx) {
  for (const item of items) {
    const key = String(item.key || '');
    if (!key || DIRECT_REPORT_KEYS.includes(key)) continue;
    const storage = item?.config?.storage;
    if (/^i[A-Z]/.test(key) || storage === 'infBeds') {
      const count = chance(ctx.rng, ctx.scenario.infectionRate) ? randomInt(ctx.rng, 1, 2) : 0;
      payload.infBeds[key] = pickUniqueBeds(ctx.rng, ctx.capacity, count);
      continue;
    }
    if (/^d[A-Z]/.test(key) || storage === 'devBeds') {
      const value = genericItemValue({ ...item, input_type: item.input_type || 'bed_or_count' }, ctx);
      payload.devBeds[key] = normalizeDevice(value);
      continue;
    }
    payload.dynamicItems[key] = genericItemValue(item, ctx);
  }
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
      patients.push([bed, syntheticPatientName(ward.code, sequence++, rng), choose(rng, CONDITION_TEXTS)]);
    }
  }

  if (chance(rng, scenario.consultationRate * multiplier)) {
    const bed = pickUniqueBeds(rng, capacity, 1)[0] || '1';
    consultations.push([bed, syntheticPatientName(ward.code, sequence++, rng), choose(rng, CONSULT_TEXTS)]);
  }

  if (chance(rng, scenario.intubationRate * multiplier)) {
    const bed = pickUniqueBeds(rng, capacity, 1)[0] || '1';
    const patient = syntheticPatientName(ward.code, sequence++, rng);
    const demoNo = `D${String(Math.floor(rng() * 999999)).padStart(6, '0')}`;
    const [diagnosis, reason, type, requestedBy, location, outcome] = choose(rng, INTUBATION_CASES);
    intubations.push([bed, `${patient} / ${demoNo}`, diagnosis, reason, type, requestedBy, location, outcome]);
  }

  return { patients, consultations, intubations };
}

function buildSessionPayload({ ward, capacity, items, rng, scenario, previousTotal = null, currentSession = false }) {
  const payload = fullReportPayloadDefaults();
  const cap = Math.max(1, Math.floor(asNumber(capacity, 40)));
  const maxAdmissions = Math.max(1, Math.round(cap * scenario.admissionFactor));
  const admissionEC = randomInt(rng, 0, maxAdmissions);
  const admissionCC = chance(rng, 0.28) ? randomInt(rng, 1, scenario === DEMO_SCENARIOS.surge ? 3 : 2) : 0;
  const discharge = randomInt(rng, 0, Math.max(1, Math.round(cap * 0.08)));
  const death = chance(rng, scenario === DEMO_SCENARIOS.surge ? 0.12 : 0.05) ? 1 : 0;
  const transferIn = chance(rng, 0.28) ? randomInt(rng, 1, 2) : 0;
  const transferOut = chance(rng, 0.25) ? randomInt(rng, 1, 2) : 0;

  let total;
  if (previousTotal == null) {
    total = Math.round(cap * randomBetween(rng, scenario.occupancyMin, scenario.occupancyMax));
  } else {
    const net = admissionEC + admissionCC + transferIn - discharge - death - transferOut;
    total = previousTotal + net;
    const low = Math.floor(cap * Math.max(0.72, scenario.occupancyMin - 0.08));
    total = clamp(total, low, cap);
  }

  payload.admissionEC = String(admissionEC);
  payload.admissionCC = String(admissionCC);
  payload.discharge = String(discharge);
  payload.death = String(death);
  payload.transferIn = String(transferIn);
  payload.transferOut = String(transferOut);
  payload.totalPatientM = String(total);
  payload.emptyBeds = { count: Math.max(0, cap - total), details: [] };

  const ctx = { ward, capacity: cap, items, rng, scenario };
  applyConfiguredItems(payload, items, ctx);

  const clinical = clinicalRows({ ward, capacity: cap, rng, scenario, currentSession });
  payload.patients = clinical.patients;
  payload.nilSpecial = clinical.patients.length === 0;
  payload.consultations = clinical.consultations;
  payload.nilConsultation = clinical.consultations.length === 0;
  payload.intubations = clinical.intubations;
  payload.nilIntubation = clinical.intubations.length === 0;

  if (chance(rng, 0.14)) {
    payload.earlyBirds = [{
      bed: pickUniqueBeds(rng, cap, 1)[0] || '1',
      dest: choose(rng, ['CT', 'Endoscopy', 'OT', 'Dialysis', 'MRI']),
    }];
  }

  payload.nurses = syntheticNurses(ward.code, rng, cap);
  payload.staffAM = `${randomInt(rng, 3, 6)} RN / ${randomInt(rng, 0, 2)} EN`;
  payload.staffPM = `${randomInt(rng, 3, 6)} RN / ${randomInt(rng, 0, 2)} EN`;
  payload.sigRank = payload.nurses[0]?.role || 'RN';
  payload.sigName = payload.nurses[0]?.name || `DEMO ${ward.code} NURSE 1`;
  payload.sigAppt = '';

  return normalizeReportPayload(payload);
}

function createReport({ ward, reportDate, submittedAt, submittedMinutesAgo, payload, session, capacity }) {
  const normalized = normalizeReportPayload(payload);
  normalized.savedAt = submittedAt.toISOString();
  return {
    ward_code: String(ward.code),
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

function addGuaranteedClinicalCurrent(reports, rng) {
  const current = reports.filter(report => report.session === 'current');
  if (!current.length) return;
  const already = current.some(report => !report.payload.nilSpecial || !report.payload.nilConsultation || !report.payload.nilIntubation);
  if (already) return;
  const report = current[0];
  const capacity = Math.max(1, Number(report.preview_capacity) || 1);
  const bed = pickUniqueBeds(rng, capacity, 1)[0] || '1';
  report.payload.patients = [[bed, syntheticPatientName(report.ward_code, 1, rng), choose(rng, CONDITION_TEXTS)]];
  report.payload.nilSpecial = false;
}

export function generateDemoDataBundle({
  wards = [],
  periods = [],
  capacities = {},
  items = [],
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

  const rng = createSeededRandom(seed);
  const currentCount = activeWards.length === 1
    ? 1
    : clamp(Math.round(activeWards.length * config.currentSubmissionRate), 1, activeWards.length - 1);
  const currentWardIndexes = new Set(shuffledIndexes(activeWards.length, rng).slice(0, currentCount));
  const effective = effectiveItems(items, reportDate, { includeInactiveHistorical: false });
  const reports = [];

  activeWards.forEach((ward, index) => {
    const capacity = Math.max(1, Number(capacities?.[ward.id]) || Number(ward.capacity) || 40);
    const previousPayload = buildSessionPayload({ ward, capacity, items: effective, rng, scenario: config, currentSession: false });
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

  addGuaranteedClinicalCurrent(reports, rng);

  const currentReports = reports.filter(report => report.session === 'current');
  const clinicalCurrent = currentReports.filter(report => !report.payload.nilSpecial || !report.payload.nilConsultation || !report.payload.nilIntubation);
  const intubationCurrent = currentReports.filter(report => !report.payload.nilIntubation && report.payload.intubations.length);

  return {
    format: GENERATED_DEMO_FORMAT,
    scenario,
    seed: Number(seed),
    generated_at: new Date(now).toISOString(),
    description: `${config.label}: ${activeWards.length} active wards, ${currentReports.length} current submissions, ${activeWards.length - currentReports.length} not yet submitted in the current window.`,
    meta: {
      active_wards: activeWards.length,
      previous_session_reports: activeWards.length,
      current_submissions: currentReports.length,
      not_yet_submitted: activeWards.length - currentReports.length,
      current_clinical_attention_wards: clinicalCurrent.length,
      current_intubation_wards: intubationCurrent.length,
    },
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
