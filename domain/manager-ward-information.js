import { formatDynamic, normalizeReportPayload } from './report-model.js';
import { reportSubmittedAt } from './report-session.js';

function hasAnyValue(row) {
  return Array.isArray(row) && row.some(value => String(value ?? '').trim() !== '');
}

function patientRows(payload) {
  return payload.nilSpecial ? [] : (payload.patients || [])
    .filter(hasAnyValue)
    .map(row => ({
      bed: row[0] || '',
      name: row[1] || '',
      diagnosisConditionProgress: row[2] || '',
    }));
}

function consultationRows(payload) {
  return payload.nilConsultation ? [] : (payload.consultations || [])
    .filter(hasAnyValue)
    .map(row => ({
      bed: row[0] || '',
      name: row[1] || '',
      pendingConsultation: row[2] || '',
    }));
}

function intubationRows(payload) {
  return payload.nilIntubation ? [] : (payload.intubations || [])
    .filter(hasAnyValue)
    .map(row => ({
      bed: row[0] || '',
      nameHospitalNumber: row[1] || '',
      diagnosis: row[2] || '',
      reason: row[3] || '',
      urgency: row[4] || '',
      byWhom: row[5] || '',
      location: row[6] || '',
      outcome: row[7] || '',
    }));
}

function additionalItems(report, fallbackItems) {
  if (!report) return [];
  const payload = normalizeReportPayload(report.payload);
  const definitions = report.report_item_snapshot?.length
    ? report.report_item_snapshot
    : (fallbackItems || []);

  return [...definitions]
    .filter(item => !item.builtin)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map(item => ({
      key: item.key,
      label: item.label || item.key,
      value: formatDynamic(payload.dynamicItems?.[item.key]),
    }));
}

export function buildManagerWardInformation({ wards = [], bundle = [], items = [] } = {}) {
  const byWard = new Map(bundle.map(entry => [entry.ward?.id, entry]));

  return wards.map(ward => {
    const entry = byWard.get(ward.id) || { ward, report: null, capacity: null };
    const report = entry.report || null;
    const payload = normalizeReportPayload(report?.payload || {});

    return {
      ward,
      report,
      capacity: entry.capacity ?? null,
      submittedAt: reportSubmittedAt(report) || null,
      patientList: {
        nil: !report || !!payload.nilSpecial,
        rows: report ? patientRows(payload) : [],
      },
      consultation: {
        nil: !report || !!payload.nilConsultation,
        rows: report ? consultationRows(payload) : [],
      },
      intubation: {
        nil: !report || !!payload.nilIntubation,
        rows: report ? intubationRows(payload) : [],
      },
      additionalItems: additionalItems(report, items),
    };
  });
}
