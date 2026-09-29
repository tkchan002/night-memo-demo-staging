import {
  escapePrintHtml as esc,
  renderManagerPrintDocument,
} from './manager-print-theme.js';

const MANAGER_MEMO_FROM_PREFIX = 'N.O./APN,';
const MANAGER_MEMO_TO = 'DOM/Medical (QEH)';

const MAIN_KEYS = [
  ['ward','Ward'], ['admissionEC','E/C'], ['admissionCC','C/C'], ['transferIn','T/I'],
  ['discharge','Home'], ['transferOut','T/O'], ['death','Death'], ['totalPatient','Total Patient'],
  ['emptyBed','Empty Bed'], ['ventilator','Vent. Case'], ['bipap','Bipap Case'], ['hfnc','HFNC Case'], ['staff','AM/PM Staff No.'],
];
const INF_KEYS = [
  ['ward','Ward'], ['covid','COVID-19'], ['cre','CRE'], ['vre','VRE'], ['mdra','MDRA'],
  ['cd','CD'], ['influenza','Influenza'], ['hdCapd','No of HD / CAPD case'], ['remarks','Remarks'],
];

function rowsHtml(rows, keys) {
  return (rows || []).map(row => `<tr>${keys.map(([key]) => `<td>${esc(row?.[key] ?? '')}</td>`).join('')}</tr>`).join('');
}

function richSection(title, html) {
  return `<section class="manager-print-section"><h2 class="manager-print-section-title">${esc(title)}</h2><div class="manager-print-rich">${html || ''}</div></section>`;
}

export function renderManagerMemoPrintHtml(document = {}, { printedAt = new Date() } = {}) {
  const header = document.header || {};
  const ct = document.ct || {};
  const signature = document.signature || {};
  const title = document.title || 'Night Memo';

  const body = `
    <div class="manager-memo-print">
    <div class="manager-print-meta">
      <div class="manager-print-meta-row"><span class="manager-print-label">From</span><span>${esc(MANAGER_MEMO_FROM_PREFIX)} ${esc(header.fromName || '')}</span></div>
      <div class="manager-print-meta-row"><span class="manager-print-label">To</span><span>${esc(MANAGER_MEMO_TO)}</span></div>
      <div class="manager-print-meta-row"><span class="manager-print-label">DECT Phone</span><span>${esc(header.dectPhone || '')}</span></div>
      <div class="manager-print-meta-row"><span class="manager-print-label">Date</span><span>${esc(header.date || '')}</span></div>
      <div class="manager-print-meta-row"><span class="manager-print-label">Call (Team)</span><span>${esc(header.callTeam || '')}</span></div>
      <div></div>
    </div>

    <section class="manager-print-section">
      <table class="manager-print-table center dense">
        <thead><tr><th rowspan="2">Ward</th><th colspan="3">Admission</th><th colspan="3">Discharge</th><th rowspan="2">Total<br>Patient</th><th rowspan="2">Empty Bed</th><th rowspan="2">Vent.<br>Case</th><th rowspan="2">Bipap<br>Case</th><th rowspan="2">HFNC<br>Case</th><th rowspan="2">AM/PM<br>Staff No.</th></tr><tr><th>E/C</th><th>C/C</th><th>T/I</th><th>Home</th><th>T/O</th><th>Death</th></tr></thead>
        <tbody>${rowsHtml(document.mainTableRows, MAIN_KEYS)}</tbody>
      </table>
    </section>

    <section class="manager-print-section">
      <h2 class="manager-print-section-title">Infectious Case</h2>
      <table class="manager-print-table center dense"><thead><tr>${INF_KEYS.map(([,label]) => `<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${rowsHtml(document.infectionRows, INF_KEYS)}</tbody></table>
    </section>

    ${richSection('Clinical / General Notes', document.clinicalNotesHtml)}
    ${richSection('Additional Report Items', document.additionalItemsHtml)}
    ${richSection('Early Bird', document.earlyBirdHtml)}
    ${richSection('Empty Bed', document.emptyBedHtml)}

    <section class="manager-print-two-col">
      <div>
        <div style="margin-bottom:1.5mm"><strong>Total No. of CT scan done:</strong> ${esc(ct.total || '')}</div>
        <div style="margin-bottom:1mm">At 06:00</div>
        <table class="manager-print-table compact center" style="width:68mm"><thead><tr><th></th><th>General</th><th>Cohort</th></tr></thead><tbody><tr><th>Male</th><td>${esc(ct.maleGeneral || '')}</td><td>${esc(ct.maleCohort || '')}</td></tr><tr><th>Female</th><td>${esc(ct.femaleGeneral || '')}</td><td>${esc(ct.femaleCohort || '')}</td></tr></tbody></table>
      </div>
      <div class="manager-print-signature">
        <div>${esc(signature.label || 'Signature')}: <span class="manager-print-signature-line"></span></div>
        <div style="margin-top:3mm">N.O./APN: ${esc(signature.name || '')}</div>
        <div>${esc(signature.designation || '')}</div>
      </div>
    </section>
    </div>`;

  return renderManagerPrintDocument({
    title,
    body,
    footerLabel: 'Patrol Night · Night Memo',
    printedAt,
  });
}
