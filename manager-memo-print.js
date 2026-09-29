const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

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

export function renderManagerMemoPrintHtml(document = {}) {
  const header = document.header || {};
  const ct = document.ct || {};
  const signature = document.signature || {};
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(document.title || 'Night Memo')}</title>
<style>
@page{size:A4 portrait;margin:8mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#000;background:#d0d0d0;margin:0}.page{width:210mm;min-height:297mm;margin:12px auto;background:#fff;padding:7mm 8mm;font-size:10.5px;line-height:1.2}.title{text-align:center;font-size:18px;font-weight:700;text-decoration:underline;margin-bottom:10px}.header{display:grid;grid-template-columns:1fr 1fr;gap:2px 30px;margin-bottom:6px}.header div{display:grid;grid-template-columns:78px 1fr}.label{font-weight:700}.tbl{width:100%;border-collapse:collapse;table-layout:fixed}.tbl th,.tbl td{border:1px solid #111;padding:2px 3px;text-align:center;vertical-align:middle}.tbl th{font-weight:700}.main{font-size:9.4px}.infection{font-size:9px;margin-top:3px}.section{margin:6px 0}.section-title{font-weight:700}.rich{min-height:18px}.footer{display:grid;grid-template-columns:1fr .8fr;gap:30px;margin-top:12px;align-items:end}.ct{width:270px}.ct input{display:none}.signature{justify-self:end;min-width:240px}.line{display:inline-block;width:150px;border-bottom:1px solid #000;height:14px;vertical-align:bottom}.small-table{width:250px}.small-table th,.small-table td{border:1px solid #111;padding:2px;text-align:center}.actions{position:sticky;top:0;background:#eee;padding:8px;text-align:center;border-bottom:1px solid #999}.actions button{font:inherit;padding:5px 14px;margin:0 4px}@media print{body{background:#fff}.actions{display:none}.page{margin:0;width:auto;min-height:0;padding:0}}
</style></head><body>
<div class="actions"><button onclick="window.print()">Print</button></div>
<article class="page">
  <div class="title">${esc(document.title || 'Night Memo')}</div>
  <div class="header">
    <div><span class="label">From</span><span>: ${esc(header.from || '')}</span></div>
    <div><span class="label">To</span><span>: ${esc(header.to || '')}</span></div>
    <div><span class="label">DECT Phone</span><span>: ${esc(header.dectPhone || '')}</span></div>
    <div><span class="label">Date</span><span>: ${esc(header.date || '')}</span></div>
    <div><span class="label">Call (Team)</span><span>: ${esc(header.callTeam || '')}</span></div>
    <div></div>
  </div>
  <table class="tbl main"><thead><tr><th rowspan="2">Ward</th><th colspan="3">Admission</th><th colspan="3">Discharge</th><th rowspan="2">Total<br>Patient</th><th rowspan="2">Empty Bed</th><th rowspan="2">Vent.<br>Case</th><th rowspan="2">Bipap<br>Case</th><th rowspan="2">HFNC<br>Case</th><th rowspan="2">AM/PM<br>Staff No.</th></tr><tr><th>E/C</th><th>C/C</th><th>T/I</th><th>Home</th><th>T/O</th><th>Death</th></tr></thead><tbody>${rowsHtml(document.mainTableRows, MAIN_KEYS)}</tbody></table>
  <div class="section"><div class="section-title">Infectious Case:</div><table class="tbl infection"><thead><tr>${INF_KEYS.map(([,label])=>`<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${rowsHtml(document.infectionRows, INF_KEYS)}</tbody></table></div>
  <div class="section"><div class="section-title">Clinical / General Notes</div><div class="rich">${document.clinicalNotesHtml || ''}</div></div>
  <div class="section"><div class="section-title">Additional Report Items</div><div class="rich">${document.additionalItemsHtml || ''}</div></div>
  <div class="section"><div class="section-title">Early bird:</div><div class="rich">${document.earlyBirdHtml || ''}</div></div>
  <div class="section"><div class="section-title">Empty Bed:</div><div class="rich">${document.emptyBedHtml || ''}</div></div>
  <div class="footer"><div class="ct"><div><b>Total No. of CT scan done:</b> ${esc(ct.total || '')}</div><div>At 06:00</div><table class="tbl small-table"><thead><tr><th></th><th>General</th><th>Cohort</th></tr></thead><tbody><tr><th>Male</th><td>${esc(ct.maleGeneral || '')}</td><td>${esc(ct.maleCohort || '')}</td></tr><tr><th>Female</th><td>${esc(ct.femaleGeneral || '')}</td><td>${esc(ct.femaleCohort || '')}</td></tr></tbody></table></div>
  <div class="signature"><div>${esc(signature.label || 'Signature')}: <span class="line"></span></div><div>N.O./APN: ${esc(signature.name || '')}</div><div>${esc(signature.designation || '')}</div></div></div>
</article></body></html>`;
}
