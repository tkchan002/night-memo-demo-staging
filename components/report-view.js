import { esc } from '../core/dom.js';
import { numberValue } from '../core/numbers.js';
import { toDisplayDate, formatDateTime } from '../core/dates.js';
import { formatDevice, formatDynamic, normalizeReportPayload } from '../domain/report-model.js';

const beds = value => Array.isArray(value) && value.length ? value.join(', ') : 'Nil';

export function renderFullReport({ ward, report, capacity, items = [] }) {
  if (!report) return '<div class="empty-state">No report submitted.</div>';
  const D = normalizeReportPayload(report.payload);
  const visible = items.filter(i => i.active !== false || i.__historical === true);
  const inf = visible.filter(i => i.section === 'infection' && i.builtin);
  const devices = visible.filter(i => i.section === 'devices' && i.builtin);
  const dynamic = visible.filter(i => !i.builtin);
  const empty = report.payload?.emptyBeds && typeof report.payload.emptyBeds === 'object'
    ? D.emptyBeds
    : { count: Math.max(0, numberValue(report.bed_capacity_snapshot ?? capacity) - numberValue(D.totalPatientM)), details: [] };
  const emptyDetails = (empty.details || []).map(x => `${esc(x.location || '')} ${x.gender ? `(${esc(x.gender)})` : ''}${x.remark ? ` – ${esc(x.remark)}` : ''}`).join('<br>') || '—';
  const patientRows = D.nilSpecial ? '<tr><td colspan="3" class="nil">Nil Special</td></tr>' : rowTable(D.patients, 3);
  const consultRows = D.nilConsultation ? '<tr><td colspan="3" class="nil">Nil Consultation</td></tr>' : rowTable(D.consultations, 3);
  const intubRows = D.nilIntubation ? '<tr><td colspan="8" class="nil">Nil Intubation</td></tr>' : rowTable(D.intubations, 8);
  const nurses = D.nurses.map(n => `<li><b>${esc(n.role || '')}</b> ${esc(n.name || '')}${n.appt ? ` <span class="muted">(${esc(n.appt)})</span>` : ''}${n.runner ? ' <span class="tag">Night Runner</span>' : ''}${n.source === 'free_text' ? ' <span class="tag subtle">Free text</span>' : ''}</li>`).join('') || '<li>None recorded</li>';
  const early = D.earlyBirds.filter(x => x.bed || x.dest).map(x => `<li>${esc(x.bed || '?')} → ${esc(x.dest || '?')}</li>`).join('') || '<li>None</li>';
  return `<article class="full-report">
    <header class="report-head"><div><h2>${esc(ward?.name || 'Ward')}</h2><div>${esc(toDisplayDate(report.report_date))}</div></div><div class="report-contact">Tel ${esc(ward?.phone || '—')} &nbsp; Fax ${esc(ward?.fax || '—')}<br>Capacity: ${esc(report.bed_capacity_snapshot ?? capacity ?? '—')}</div></header>
    <section class="report-grid three"><div><h3>Admission / Flow</h3><dl><dt>Admission E/C</dt><dd>${esc(D.admissionEC)}</dd><dt>Admission C/C</dt><dd>${esc(D.admissionCC)}</dd><dt>Discharge</dt><dd>${esc(D.discharge)}</dd><dt>Death</dt><dd>${esc(D.death)}</dd><dt>Transfer In</dt><dd>${esc(D.transferIn)}</dd><dt>Transfer Out</dt><dd>${esc(D.transferOut)}</dd></dl></div><div><h3>Bed Count</h3><dl><dt>Total Patient</dt><dd>${esc(D.totalPatientM)}</dd><dt>Empty Bed</dt><dd>${esc(String(empty.count ?? 0))}</dd><dt>Empty-bed detail</dt><dd>${emptyDetails}</dd></dl><h4>Next Day Early Bird</h4><ul>${early}</ul></div><div><h3>Staffing</h3><dl><dt>AM duty</dt><dd>${esc(D.staffAM || '—')}</dd><dt>PM duty</dt><dd>${esc(D.staffPM || '—')}</dd><dt>Signature</dt><dd>${esc(`${D.sigRank || ''} ${D.sigName || ''}`.trim() || '—')}</dd><dt>Appointment</dt><dd>${esc(D.sigAppt || '—')}</dd></dl></div></section>
    <section class="report-grid two"><div><h3>Infection Control</h3><dl>${inf.map(i => `<dt>${esc(i.label)}</dt><dd>${esc(beds(D.infBeds?.[i.key]))}</dd>`).join('')}</dl></div><div><h3>Devices</h3><dl>${devices.map(i => `<dt>${esc(i.label)}</dt><dd>${esc(formatDevice(D.devBeds?.[i.key]))}</dd>`).join('')}</dl></div></section>
    ${dynamic.length ? `<section><h3>Additional Report Items</h3><dl class="wide-dl">${dynamic.map(i => `<dt>${esc(i.label)}</dt><dd>${esc(formatDynamic(D.dynamicItems?.[i.key]))}</dd>`).join('')}</dl></section>` : ''}
    <section><h3>Patient List</h3><table class="report-table"><thead><tr><th>Bed</th><th>Name</th><th>Diagnosis / Condition / Progress</th></tr></thead><tbody>${patientRows}</tbody></table></section>
    <section><h3>Subspecialty Consultation</h3><table class="report-table"><thead><tr><th>Bed</th><th>Name</th><th>Pending consultation</th></tr></thead><tbody>${consultRows}</tbody></table></section>
    <section><h3>Intubation Record</h3><table class="report-table compact"><thead><tr><th>Bed</th><th>Name / Hosp No.</th><th>Diagnosis</th><th>Reason</th><th>Elective / Emergency</th><th>By Whom</th><th>Location</th><th>Outcome</th></tr></thead><tbody>${intubRows}</tbody></table></section>
    <section><h3>Night Nurse</h3><ul class="nurse-list">${nurses}</ul></section>
    <footer>Saved ${esc(report.updated_at ? formatDateTime(report.updated_at) : (D.savedAt ? formatDateTime(D.savedAt) : ''))}</footer>
  </article>`;
}

function rowTable(rows = [], width = 3) {
  return rows.map(row => `<tr>${Array.from({ length: width }, (_, i) => `<td>${esc(row?.[i] || '')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${width}">No entries</td></tr>`;
}
