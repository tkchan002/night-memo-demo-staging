import { addDaysISO, todayISO, toDisplayDate, REPORT_TIME_ZONE } from '../core/dates.js';
import { deviceCount, normalizeDevice, normalizeReportPayload } from './report-model.js';
import { reportSubmittedAt } from './report-session.js';
import { reportNightDate, combinedMovementValue, missingMemoTypes } from './report-cycle.js';
import { formatEmptyBedReporting, formatEmptyBedEntries, legacyEmptyBedEntries } from './empty-bed-reporting.js';

export function reportingNightDate(now = new Date()) { return reportNightDate(now); }

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
  if (Array.isArray(empty.entries)) {
    const manual = formatEmptyBedEntries(empty.entries);
    return String(count) + (manual ? ' (' + manual + ')' : '');
  }
  if (empty.reported) {
    const manual = formatEmptyBedEntries(legacyEmptyBedEntries(empty, ward)) || formatEmptyBedReporting(empty.reported, { includeMissing: true });
    return String(count) + (manual ? ' (' + manual + ')' : '');
  }
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
  const result = [];
  for (const entry of bundle) {
    // Previous historical bundles contain only entry.report. Preserve their
    // identity rather than rewriting old records into PM/Night categories.
    const sources = Object.hasOwn(entry, 'pmReport') || Object.hasOwn(entry, 'nightReport')
      ? [['pm', entry.pmReport], ['night', entry.nightReport]] : [['legacy', entry.report]];
    for (const [memo_type, report] of sources) {
      if (!report) continue;
      result.push({ ward_id: entry.ward?.id || report.ward_id,
        ward_name: entry.ward?.name || '', memo_type,
        report_id: report.id, submitted_at: reportSubmittedAt(report) || '' });
    }
  }
  return result.sort((a, b) => `${a.ward_id}:${a.memo_type}`.localeCompare(`${b.ward_id}:${b.memo_type}`));
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
    .sort((a, b) => `${a.ward_id}:${a.memo_type || 'legacy'}`.localeCompare(`${b.ward_id}:${b.memo_type || 'legacy'}`))
    .map(row => `${row.ward_id}:${row.memo_type || 'legacy'}:${row.report_id}:${row.submitted_at}`)
    .join('|');
}

function mainRow(entry) {
  const { ward, report, capacity, pmReport, nightReport } = entry;
  const typed = Object.hasOwn(entry, 'pmReport') || Object.hasOwn(entry, 'nightReport');
  const primary = typed ? pmReport : report;
  const secondary = typed ? nightReport : null;
  const D = report ? normalizeReportPayload(report.payload) : {};
  return {
    ward: ward?.name || '',
    admissionEC: combinedMovementValue(primary, secondary, 'admissionEC'),
    admissionCC: combinedMovementValue(primary, secondary, 'admissionCC'),
    transferIn: combinedMovementValue(primary, secondary, 'transferIn'),
    discharge: combinedMovementValue(primary, secondary, 'discharge'),
    transferOut: combinedMovementValue(primary, secondary, 'transferOut'),
    death: combinedMovementValue(primary, secondary, 'death'),
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
    ward: ward?.name || '',
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

function earlyBirdLines(bundle = []) {
  const lines = [];
  for (const { ward, report } of bundle) {
    if (!report) continue;
    const D = normalizeReportPayload(report.payload);
    const rows = (D.earlyBirds || []).filter(row => row?.bed || row?.dest);
    if (rows.length) lines.push(`${ward?.name || 'Ward'}: ${rows.map(row => `${row.bed || '?'} → ${row.dest || '?'}`).join('; ')}`);
  }
  return lines;
}

function emptyBedLines(bundle = []) {
  return bundle
    .filter(entry => entry.report)
    .map(entry => `${entry.ward?.name || 'Ward'}: ${formatManagerEmptyBeds(entry.ward, entry.report, entry.capacity)}`);
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const linesToHtml = lines => lines.length ? lines.map(line => `<div>${escapeHtml(line)}</div>`).join('') : '<div><br></div>';

export const MANAGER_MEMO_FROM_PREFIX = 'N.O./APN,';
export const MANAGER_MEMO_TO = 'DOM/Medical (QEH)';

export function buildManagerMemoDocument({ bundle = [], items = [], reportingDate = reportingNightDate() } = {}) {
  return {
    version: 3,
    title: 'Night Memo',
    header: {
      fromName: '',
      dectPhone: '',
      callTeam: '',
      date: toDisplayDate(reportingDate),
    },
    mainTableRows: bundle.map(mainRow),
    infectionRows: bundle.map(infectionRow),
    earlyBirdHtml: linesToHtml(earlyBirdLines(bundle)),
    emptyBedHtml: linesToHtml(emptyBedLines(bundle)),
    additionalReportHtml: '<div><br></div>',
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
    earlyBirdHtml: generated.earlyBirdHtml,
    emptyBedHtml: generated.emptyBedHtml,
  };
}
