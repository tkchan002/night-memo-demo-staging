import { formatDynamic, normalizeReportPayload } from './report-model.js';
import { reportSubmittedAt } from './report-session.js';

function textParts(parts) {
  return parts.map(value => String(value ?? '').trim()).filter(Boolean).join(' · ');
}

function clinicalEntries(report) {
  if (!report) return [];
  const D = normalizeReportPayload(report.payload);
  const rows = [];
  if (!D.nilSpecial) {
    for (const row of D.patients || []) {
      if (!row?.some(Boolean)) continue;
      rows.push({ kind: 'Patient', text: textParts([row[0] && `Bed ${row[0]}`, row[1], row[2]]) });
    }
  }
  if (!D.nilConsultation) {
    for (const row of D.consultations || []) {
      if (!row?.some(Boolean)) continue;
      rows.push({ kind: 'Consultation', text: textParts([row[0] && `Bed ${row[0]}`, row[1], row[2]]) });
    }
  }
  if (!D.nilIntubation) {
    for (const row of D.intubations || []) {
      if (!row?.some(Boolean)) continue;
      rows.push({ kind: 'Intubation', text: textParts([
        row[0] && `Bed ${row[0]}`,
        row[1],
        row[2] && `Dx ${row[2]}`,
        row[3] && `Reason ${row[3]}`,
      ]) });
    }
  }
  return rows;
}

function additionalItems(report, items) {
  if (!report) return [];
  const D = normalizeReportPayload(report.payload);
  return [...(items || [])]
    .filter(item => !item.builtin)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map(item => ({
      key: item.key,
      label: item.label || item.key,
      value: formatDynamic(D.dynamicItems?.[item.key]),
    }));
}

export function buildManagerWardInformation({ wards = [], bundle = [], items = [] } = {}) {
  const byWard = new Map(bundle.map(entry => [entry.ward?.id, entry]));
  return wards.map(ward => {
    const entry = byWard.get(ward.id) || { ward, report: null, capacity: null };
    return {
      ward,
      report: entry.report || null,
      capacity: entry.capacity ?? null,
      submittedAt: reportSubmittedAt(entry.report) || null,
      clinical: clinicalEntries(entry.report),
      additional: additionalItems(entry.report, items),
    };
  });
}
