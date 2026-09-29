import { addDaysISO, todayISO, toDisplayDate, REPORT_TIME_ZONE } from '../core/dates.js';
import { deviceCount, formatDynamic, normalizeDevice, normalizeReportPayload } from './report-model.js';
import { reportSubmittedAt } from './report-session.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

function hktHour(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_TIME_ZONE,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  return Number(parts.find(part => part.type === 'hour')?.value || 0);
}

export function reportingNightDate(now = new Date()) {
  const date = todayISO(REPORT_TIME_ZONE, now);
  return hktHour(now) < 12 ? addDaysISO(date, -1) : date;
}

export function managerSubmissionStatus(report) {
  if (!report) return { state: 'missing', label: 'Not submitted', time: '' };
  const stamp = reportSubmittedAt(report);
  if (!stamp) return { state: 'submitted', label: 'Submitted', time: '' };
  const time = new Date(stamp).toLocaleTimeString('en-GB', {
    timeZone: REPORT_TIME_ZONE,
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return { state: 'submitted', label: `Submitted ${time}`, time };
}

function fixedGender(ward) {
  if (ward?.empty_bed_gender_mode === 'male') return 'M';
  if (ward?.empty_bed_gender_mode === 'female') return 'F';
  return '';
}

export function formatManagerEmptyBeds(ward, report, capacity = 0) {
  if (!report) return '—';
  const D = normalizeReportPayload(report.payload);
  const empty = D.emptyBeds || { count: Math.max(0, Number(capacity || 0) - Number(D.totalPatientM || 0)), details: [] };
  const count = Math.max(0, Number(empty.count || 0));
  const details = Array.isArray(empty.details) ? empty.details : [];
  const defaultGender = fixedGender(ward);
  if (!details.length) return `${count}${defaultGender}` || '0';

  const special = [];
  const ordinary = { M: 0, F: 0, U: 0 };
  for (const detail of details) {
    const gender = String(detail?.gender || defaultGender || 'U').toUpperCase();
    const g = gender === 'M' || gender === 'F' ? gender : 'U';
    const remark = String(detail?.remark || '').trim();
    if (remark) special.push(`1${g} (${remark})`);
    else ordinary[g] += 1;
  }
  const accounted = details.length;
  if (count > accounted) {
    const g = defaultGender || 'U';
    ordinary[g] = (ordinary[g] || 0) + (count - accounted);
  }
  const parts = [];
  if (ordinary.M) parts.push(`${ordinary.M}M`);
  if (ordinary.F) parts.push(`${ordinary.F}F`);
  if (ordinary.U) parts.push(`${ordinary.U}U`);
  parts.push(...special);
  return parts.length ? parts.join(', ') : String(count);
}

function bedList(value) {
  const rows = Array.isArray(value) ? value.filter(Boolean).map(String) : [];
  if (!rows.length) return '0';
  return `${rows.length} (bed ${rows.join(',')})`;
}

function deviceSummary(value) {
  const device = normalizeDevice(value);
  const count = deviceCount(device);
  if (!count) return '0';
  if (device.mode === 'count') return String(count);
  return `${count} (bed ${device.beds.join(',')})`;
}

export function sourceSnapshotFromBundle(bundle = []) {
  return bundle
    .filter(entry => entry?.report)
    .map(entry => ({
      ward_id: entry.ward?.id || entry.report?.ward_id || '',
      ward_code: entry.ward?.code || '',
      report_id: entry.report?.id || '',
      submitted_at: reportSubmittedAt(entry.report) || '',
    }))
    .sort((a, b) => String(a.ward_code).localeCompare(String(b.ward_code)));
}

export function isReportNewerThanSource(report, source) {
  if (!report) return false;
  if (!source) return true;
  const currentStamp = new Date(reportSubmittedAt(report) || 0).getTime();
  const sourceStamp = new Date(source.submitted_at || 0).getTime();
  if (!Number.isFinite(currentStamp)) return false;
  if (!Number.isFinite(sourceStamp)) return true;
  return currentStamp > sourceStamp || (currentStamp === sourceStamp && report.id !== source.report_id);
}

export function sourceSnapshotSignature(snapshot = []) {
  return [...(snapshot || [])]
    .sort((a, b) => String(a.ward_id).localeCompare(String(b.ward_id)))
    .map(row => `${row.ward_id}:${row.report_id}:${row.submitted_at}`)
    .join('|');
}

function mainRow(entry) {
  const { ward, report, capacity } = entry;
  const D = report ? normalizeReportPayload(report.payload) : {};
  return {
    ward: ward?.code || '',
    admissionEC: report ? String(D.admissionEC ?? '') : '',
    admissionCC: report ? String(D.admissionCC ?? '') : '',
    transferIn: report ? String(D.transferIn ?? '') : '',
    discharge: report ? String(D.discharge ?? '') : '',
    transferOut: report ? String(D.transferOut ?? '') : '',
    death: report ? String(D.death ?? '') : '',
    totalPatient: report ? String(D.totalPatientM ?? '') : '',
    emptyBed: report ? formatManagerEmptyBeds(ward, report, capacity) : '',
    ventilator: report ? String(deviceCount(D.devBeds?.dMV) || 0) : '',
    bipap: report ? String(deviceCount(D.devBeds?.dNIV) || 0) : '',
    hfnc: report ? String(deviceCount(D.devBeds?.dHF) || 0) : '',
    staff: report ? [D.staffAM, D.staffPM].filter(v => v !== '' && v != null).join('/') : '',
  };
}

function infectionRow(entry) {
  const { ward, report } = entry;
  const D = report ? normalizeReportPayload(report.payload) : {};
  return {
    ward: ward?.code || '',
    covid: report ? bedList(D.infBeds?.iCOV) : '',
    cre: report ? bedList(D.infBeds?.iCRE) : '',
    vre: report ? bedList(D.infBeds?.iVRE) : '',
    mdra: report ? bedList(D.infBeds?.iMDR) : '',
    cd: report ? bedList(D.infBeds?.iCD) : '',
    influenza: report ? bedList(D.infBeds?.iInf) : '',
    hdCapd: report ? `HD: ${deviceCount(D.devBeds?.dHD) || 0}  CAPD: ${deviceCount(D.devBeds?.dCA) || 0}` : '',
    remarks: '',
  };
}

function clinicalLines(bundle = []) {
  const lines = [];
  for (const { ward, report } of bundle) {
    if (!report) continue;
    const D = normalizeReportPayload(report.payload);
    const code = ward?.code || 'Ward';
    if (!D.nilSpecial) for (const row of D.patients || []) {
      if (row.some(Boolean)) lines.push(`${code}: ${[row[0] && `Bed ${row[0]}`, row[1], row[2]].filter(Boolean).join(' · ')}`);
    }
    if (!D.nilConsultation) for (const row of D.consultations || []) {
      if (row.some(Boolean)) lines.push(`${code} consultation: ${[row[0] && `Bed ${row[0]}`, row[1], row[2]].filter(Boolean).join(' · ')}`);
    }
    if (!D.nilIntubation) for (const row of D.intubations || []) {
      if (row.some(Boolean)) lines.push(`${code} intubation: ${[row[0] && `Bed ${row[0]}`, row[1], row[2] && `Dx ${row[2]}`, row[3] && `Reason ${row[3]}`].filter(Boolean).join(' · ')}`);
    }
  }
  return lines;
}

function earlyBirdLines(bundle = []) {
  const lines = [];
  for (const { ward, report } of bundle) {
    if (!report) continue;
    const D = normalizeReportPayload(report.payload);
    const rows = (D.earlyBirds || []).filter(row => row?.bed || row?.dest);
    if (rows.length) lines.push(`${ward?.code || 'Ward'}: ${rows.map(row => `${row.bed || '?'} → ${row.dest || '?'}`).join('; ')}`);
  }
  return lines;
}

function emptyBedLines(bundle = []) {
  return bundle
    .filter(entry => entry.report)
    .map(entry => `${entry.ward?.code || 'Ward'}: ${formatManagerEmptyBeds(entry.ward, entry.report, entry.capacity)}`);
}

function additionalItemLines(bundle = [], items = []) {
  const configured = [...(items || [])].filter(item => !item.builtin).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  if (!configured.length) return [];
  const lines = [];
  for (const { ward, report } of bundle) {
    if (!report) continue;
    const D = normalizeReportPayload(report.payload);
    const values = configured.map(item => {
      const value = formatDynamic(D.dynamicItems?.[item.key]);
      return value && value !== '—' && value !== 'Nil' ? `${item.label}: ${value}` : '';
    }).filter(Boolean);
    if (values.length) lines.push(`${ward?.code || 'Ward'}: ${values.join('; ')}`);
  }
  return lines;
}

const linesToHtml = lines => lines.length ? lines.map(line => `<div>${esc(line)}</div>`).join('') : '<div><br></div>';

export const MANAGER_MEMO_FROM_PREFIX = 'N.O./APN,';
export const MANAGER_MEMO_TO = 'DOM/Medical (QEH)';

export function buildManagerMemoDocument({ bundle = [], items = [], reportingDate = reportingNightDate() } = {}) {
  return {
    version: 2,
    title: 'Night Memo',
    header: {
      fromName: '',
      dectPhone: '',
      callTeam: '',
      date: toDisplayDate(reportingDate),
    },
    mainTableRows: bundle.map(mainRow),
    infectionRows: bundle.map(infectionRow),
    clinicalNotesHtml: linesToHtml(clinicalLines(bundle)),
    additionalItemsHtml: linesToHtml(additionalItemLines(bundle, items)),
    earlyBirdHtml: linesToHtml(earlyBirdLines(bundle)),
    emptyBedHtml: linesToHtml(emptyBedLines(bundle)),
    ct: {
      total: '',
      maleGeneral: '',
      maleCohort: '',
      femaleGeneral: '',
      femaleCohort: '',
    },
    signature: {
      label: 'Signature',
      name: '',
      designation: 'N.O./APN',
    },
  };
}

export function regenerateWardDerivedSections(document, { bundle = [], items = [] } = {}) {
  const generated = buildManagerMemoDocument({ bundle, items, reportingDate: '' });
  return {
    ...document,
    mainTableRows: generated.mainTableRows,
    infectionRows: generated.infectionRows,
    clinicalNotesHtml: generated.clinicalNotesHtml,
    additionalItemsHtml: generated.additionalItemsHtml,
    earlyBirdHtml: generated.earlyBirdHtml,
    emptyBedHtml: generated.emptyBedHtml,
  };
}
