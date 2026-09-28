import { requireRole, signOut } from '../auth.js';
import { qs, qsa, esc } from '../core/dom.js';
import { todayISO, formatDateTime } from '../core/dates.js';
import { numberValue } from '../core/numbers.js';
import { setAppHeader } from '../components/app-shell.js';
import { DB_MODE } from '../data/index.js';
import { createRequestSequencer } from '../core/request-sequencer.js';
import { deviceCount, normalizeDevice, normalizeReportPayload, formatDynamic } from '../domain/report-model.js';
import { reportSubmittedAt, SUBMISSION_WINDOW_MINUTES } from '../domain/report-session.js';
import { loadFullWardReport, loadManagerCurrent } from '../services/report-service.js';
import { renderFullReport } from '../components/report-view.js';

const $ = qs;
const $$ = qsa;
const refreshRequests = createRequestSequencer();
const fullRequests = createRequestSequencer();

const state = {
  access: null,
  bundle: [],
  items: [],
  selected: null,
  allWards: [],
  windowMinutes: SUBMISSION_WINDOW_MINUTES,
  refreshedAt: null,
};

bootstrap().catch(error => {
  console.error('Manager bootstrap failed:', error);
  showFatal(error);
});

async function bootstrap() {
  setStatus('Loading current submissions...', 'info');
  bindCoreControls();
  state.access = await requireRole('manager');
  if (!state.access) return;
  setAppHeader({ title: 'Patrol Night', subtitle: 'Current ward submissions and complete ward reports', access: state.access, mode: DB_MODE });
  $('#fullReportDate').value = todayISO();
  await refresh();
  clearStatus();
}

function bindCoreControls() {
  $('#logoutBtn').onclick = signOut;
  $('#refreshBtn').onclick = refresh;
  $('#printBtn').onclick = printNightMemo;
  $('#fullWardSelect').onchange = loadFullWardReportView;
  $('#fullReportDate').onchange = () => {
    state.selected = null;
    $('#fullReportBody').innerHTML = '<div class="manager-empty-state">Select a ward or press Load to read its complete report.</div>';
  };
  $('#loadFullReportBtn').onclick = loadFullWardReportView;
  $('#fullReportPrintBtn').onclick = printSelectedFullReport;
  window.addEventListener('manager-tab-change', event => {
    if (event.detail?.name === 'template') sendTemplateContext();
  });
  window.addEventListener('message', event => {
    const frame = $('#templateEditorFrame');
    if (!frame?.contentWindow || event.source !== frame.contentWindow || event.origin !== location.origin) return;
    if (event.data?.type === 'manager-template-ready') sendTemplateContext();
    if (event.data?.type === 'manager-template-print-fallback') window.print();
  });
}

async function refresh() {
  const requestId = refreshRequests.begin();
  setStatus('Refreshing current submissions...', 'info');
  $('#summaryRows').innerHTML = '<tr><td colspan="14">Loading...</td></tr>';
  $('#infectionRows').innerHTML = '<tr><td colspan="10">Loading...</td></tr>';
  $('#configuredItemsHost').innerHTML = '<div class="manager-empty-state">Loading report items...</div>';
  $('#clinicalRows').innerHTML = '<tr><td colspan="3">Loading...</td></tr>';

  try {
    const { items, bundle, allWards, windowMinutes } = await loadManagerCurrent(SUBMISSION_WINDOW_MINUTES);
    if (!refreshRequests.isCurrent(requestId)) return;
    state.items = items || [];
    state.bundle = bundle || [];
    state.allWards = allWards?.length ? allWards : state.bundle.map(x => x.ward);
    state.windowMinutes = windowMinutes || SUBMISSION_WINDOW_MINUTES;
    state.refreshedAt = new Date();
    $('#printDateLabel').textContent = currentWindowLabel();
    fillFullWardSelect();
    renderSummary();
    clearStatus();
    sendTemplateContext();
  } catch (error) {
    if (!refreshRequests.isCurrent(requestId)) return;
    console.error('Manager refresh failed:', error);
    $('#summaryRows').innerHTML = `<tr><td colspan="14">Unable to load Night Memo data: ${esc(error.message || String(error))}</td></tr>`;
    $('#infectionRows').innerHTML = '<tr><td colspan="10">Data load failed. See the message above.</td></tr>';
    $('#configuredItemsHost').innerHTML = '<div class="manager-empty-state">Unable to load configured report items.</div>';
    $('#clinicalRows').innerHTML = '<tr><td colspan="3">Unable to load clinical attention data.</td></tr>';
    setStatus(`Unable to load report data: ${error.message || String(error)}`, 'error');
  }
}

function currentWindowLabel() {
  const end = state.refreshedAt || new Date();
  const start = new Date(end.getTime() - state.windowMinutes * 60 * 1000);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `Submitted in past ${state.windowMinutes} minutes · ${fmt.format(start)} – ${fmt.format(end)} HKT`;
}

function fillFullWardSelect() {
  const old = $('#fullWardSelect').value;
  $('#fullWardSelect').innerHTML = '<option value="">-- Select ward --</option>' + state.allWards
    .map(w => `<option value="${esc(w.id)}">${esc(w.code)} - ${esc(w.display_name || w.code)}</option>`).join('');
  if (state.allWards.some(w => w.id === old)) $('#fullWardSelect').value = old;
}

function bedText(value) {
  return Array.isArray(value) && value.length ? value.join(', ') : '--';
}

function devText(value) {
  const device = normalizeDevice(value);
  const n = deviceCount(device);
  if (!n) return '--';
  return device.mode === 'count' ? String(n) : `${n} (${device.beds.join(', ')})`;
}

function emptyCell(ward, report, capacity) {
  if (!report) return '--';
  const D = report.payload || {};
  const empty = D.emptyBeds || { count: Math.max(0, numberValue(capacity) - numberValue(D.totalPatientM)), details: [] };
  if (ward.empty_bed_gender_mode !== 'dynamic') return String(empty.count ?? 0);
  const details = empty.details || [];
  if (!details.length) return String(empty.count ?? 0);
  const m = details.filter(x => x.gender === 'M').length;
  const f = details.filter(x => x.gender === 'F').length;
  const other = details.length - m - f;
  const parts = [];
  if (m) parts.push(`${m}M`);
  if (f) parts.push(`${f}F`);
  if (other) parts.push(`${other}U`);
  const remarks = details.filter(x => x.remark).map(x => `${x.gender || ''}${x.location ? ` bed ${x.location}` : ''}: ${x.remark}`);
  return `${parts.join(' / ')}${remarks.length ? ` - ${remarks.join('; ')}` : ''}`;
}

function submissionStatus(report) {
  if (!report) return 'Not submitted';
  const stamp = reportSubmittedAt(report);
  if (!stamp) return 'Submitted';
  const time = new Date(stamp).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `Submitted ${time}`;
}

function buildSummaryRows(includeStatus = true) {
  return state.bundle.map(({ ward, capacity, report }) => {
    const D = report?.payload || {};
    const statusCell = includeStatus ? `<td class="screen-only-col">${esc(submissionStatus(report))}</td>` : '';
    return `<tr class="${report ? 'submitted' : 'missing'}">
      <td class="ward-link" data-ward="${esc(ward.id)}">${esc(ward.code)}</td>
      <td>${esc(D.admissionEC ?? '--')}</td><td>${esc(D.admissionCC ?? '--')}</td><td>${esc(D.transferIn ?? '--')}</td>
      <td>${esc(D.discharge ?? '--')}</td><td>${esc(D.transferOut ?? '--')}</td><td>${esc(D.death ?? '--')}</td>
      <td>${esc(D.totalPatientM ?? '--')}</td><td>${esc(emptyCell(ward, report, capacity))}</td>
      <td>${deviceCount(D.devBeds?.dMV) || '--'}</td><td>${deviceCount(D.devBeds?.dNIV) || '--'}</td><td>${deviceCount(D.devBeds?.dHF) || '--'}</td>
      <td>${report ? `${esc(D.staffAM || '--')} / ${esc(D.staffPM || '--')}` : '--'}</td>${statusCell}
    </tr>`;
  }).join('');
}

function buildInfectionRows() {
  return state.bundle.map(({ ward, report }) => {
    const D = report?.payload || {};
    const early = (D.earlyBirds || []).map(x => `${x.bed || '?'} -> ${x.dest || '?'}`).join('; ') || '--';
    return `<tr><td class="ward-link" data-ward="${esc(ward.id)}">${esc(ward.code)}</td>
      <td>${esc(bedText(D.infBeds?.iCOV))}</td><td>${esc(bedText(D.infBeds?.iCRE))}</td><td>${esc(bedText(D.infBeds?.iVRE))}</td>
      <td>${esc(bedText(D.infBeds?.iMDR))}</td><td>${esc(bedText(D.infBeds?.iCD))}</td><td>${esc(bedText(D.infBeds?.iInf))}</td>
      <td>${esc(devText(D.devBeds?.dHD))}</td><td>${esc(devText(D.devBeds?.dCA))}</td><td>${esc(early)}</td></tr>`;
  }).join('');
}

function valueForItem(item, rawPayload) {
  if (!rawPayload) return '--';
  const D = normalizeReportPayload(rawPayload);
  if (item.key in D && !['infBeds', 'devBeds', 'dynamicItems'].includes(item.key)) {
    const value = D[item.key];
    return Array.isArray(value) ? (value.length ? value.join(', ') : '--') : (value ?? '--');
  }
  if (item.section === 'infection') return bedText(D.infBeds?.[item.key]);
  if (item.section === 'devices') return devText(D.devBeds?.[item.key]);
  const dynamic = D.dynamicItems?.[item.key];
  const formatted = formatDynamic(dynamic);
  return formatted || '--';
}

function configuredItemsTableHtml() {
  const items = [...state.items].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  if (!items.length) return '<div class="manager-empty-state">No active report items are configured.</div>';
  const head = items.map(item => `<th>${esc(item.label)}</th>`).join('');
  const body = state.bundle.map(({ ward, report }) => `<tr>
    <td class="ward-link" data-ward="${esc(ward.id)}">${esc(ward.code)}</td>
    ${items.map(item => `<td>${esc(valueForItem(item, report?.payload))}</td>`).join('')}
  </tr>`).join('');
  return `<div class="table-scroll print-table-scroll"><table class="data-table manager-summary configured-report-items"><thead><tr><th>Ward</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function clinicalAttentionEntries() {
  const entries = [];
  for (const { ward, report } of state.bundle) {
    if (!report) continue;
    const D = normalizeReportPayload(report.payload);
    if (!D.nilSpecial) {
      for (const row of D.patients || []) {
        if (!row.some(Boolean)) continue;
        entries.push({ ward, type: 'Patient condition', text: [row[0] && `Bed ${row[0]}`, row[1], row[2]].filter(Boolean).join(' · ') });
      }
    }
    if (!D.nilConsultation) {
      for (const row of D.consultations || []) {
        if (!row.some(Boolean)) continue;
        entries.push({ ward, type: 'Consultation', text: [row[0] && `Bed ${row[0]}`, row[1], row[2]].filter(Boolean).join(' · ') });
      }
    }
    if (!D.nilIntubation) {
      for (const row of D.intubations || []) {
        if (!row.some(Boolean)) continue;
        const text = [
          row[0] && `Bed ${row[0]}`,
          row[1],
          row[2] && `Dx: ${row[2]}`,
          row[3] && `Reason: ${row[3]}`,
          row[4],
          row[5] && `By: ${row[5]}`,
          row[6] && `Location: ${row[6]}`,
          row[7] && `Outcome: ${row[7]}`,
        ].filter(Boolean).join(' · ');
        entries.push({ ward, type: 'Intubation', text });
      }
    }
  }
  return entries;
}

function clinicalAttentionRowsHtml() {
  const entries = clinicalAttentionEntries();
  if (!entries.length) return '<tr><td colspan="3">No patient-condition, consultation or intubation text was submitted in the current window.</td></tr>';
  return entries.map(entry => `<tr><td class="ward-link" data-ward="${esc(entry.ward.id)}">${esc(entry.ward.code)}</td><td>${esc(entry.type)}</td><td>${esc(entry.text || '--')}</td></tr>`).join('');
}

function clinicalAttentionTableHtml() {
  return `<div class="table-scroll print-table-scroll"><table class="data-table manager-summary"><thead><tr><th>Ward</th><th>Type</th><th>Details</th></tr></thead><tbody>${clinicalAttentionRowsHtml()}</tbody></table></div>`;
}

function renderSummary() {
  $('#summaryRows').innerHTML = buildSummaryRows(true) || '<tr><td colspan="14">No wards are currently configured.</td></tr>';
  $('#infectionRows').innerHTML = buildInfectionRows() || '<tr><td colspan="10">No wards configured.</td></tr>';
  $('#configuredItemsHost').innerHTML = configuredItemsTableHtml();
  $('#clinicalRows').innerHTML = clinicalAttentionRowsHtml();
  $$('.ward-link').forEach(el => { el.onclick = () => openWard(el.dataset.ward); });
}

async function openWard(wardId) {
  $('#fullWardSelect').value = wardId;
  const entry = state.bundle.find(x => x.ward.id === wardId);
  window.showManagerPage?.('full');
  if (entry?.report) {
    const items = entry.report.report_item_snapshot?.length
      ? entry.report.report_item_snapshot.map(item => ({ ...item, __historical: true }))
      : state.items;
    state.selected = { ward: entry.ward, report: entry.report, capacity: entry.capacity, items };
    $('#fullReportDate').value = entry.report.report_date || todayISO();
    $('#fullReportBody').innerHTML = renderFullReport(state.selected);
    return;
  }
  await loadFullWardReportView();
}

async function loadFullWardReportView() {
  const requestId = fullRequests.begin();
  const wardId = $('#fullWardSelect').value;
  if (!wardId) {
    state.selected = null;
    $('#fullReportBody').innerHTML = '<div class="manager-empty-state">Select a ward to read its complete report.</div>';
    return;
  }
  const date = $('#fullReportDate').value || todayISO();
  const ward = state.allWards.find(w => w.id === wardId);
  if (!ward) return;
  setStatus(`Loading ${ward.code}...`, 'info');
  try {
    const selected = await loadFullWardReport(wardId, date, ward, state.items);
    if (!fullRequests.isCurrent(requestId)) return;
    state.selected = selected;
    $('#fullReportBody').innerHTML = renderFullReport(selected);
    clearStatus();
  } catch (error) {
    if (!fullRequests.isCurrent(requestId)) return;
    $('#fullReportBody').innerHTML = `<div class="manager-empty-state">Unable to load full report: ${esc(error.message || String(error))}</div>`;
    setStatus(`Unable to load full report: ${error.message || String(error)}`, 'error');
  }
}

async function printSelectedFullReport() {
  if (!state.selected) return setStatus('Select a ward first.', 'warning');
  const html = renderFullReport(state.selected);
  const win = window.open('', '_blank', 'width=1200,height=850');
  if (!win) return setStatus('Pop-up blocked. Allow pop-ups to print.', 'error');
  const shellCss = new URL('../css/legacy-shell.css', import.meta.url).href;
  const managerCss = new URL('../css/manager.css', import.meta.url).href;
  const printCss = new URL('../css/print.css', import.meta.url).href;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(state.selected.ward.code)} ${esc($('#fullReportDate').value)}</title><link rel="stylesheet" href="${shellCss}"><link rel="stylesheet" href="${managerCss}"><link rel="stylesheet" href="${printCss}"></head><body class="legacy-page"><main class="legacy-shell"><div class="legacy-panel-body">${html}</div></main><script>setTimeout(()=>window.print(),500)<\/script></body></html>`);
  win.document.close();
}

function printNightMemo() {
  window.showManagerPage?.('summary');
  const frame = $('#templateEditorFrame');
  if (frame?.src && frame.contentWindow) {
    frame.contentWindow.postMessage({ type: 'manager-template-print', context: templateContext() }, location.origin);
    return;
  }
  window.print();
}

function templateContext() {
  return {
    reportDate: todayISO(),
    reportDateDisplay: currentWindowLabel(),
    section: '',
    snapshotTime: state.refreshedAt ? formatDateTime(state.refreshedAt) : '',
    wardSummaryTableHtml: managerSummaryTableHtml(),
    infectionTableHtml: infectionTableHtml(),
    reportItemsTableHtml: configuredItemsTableHtml(),
    clinicalAttentionTableHtml: clinicalAttentionTableHtml(),
  };
}

function sendTemplateContext() {
  const frame = $('#templateEditorFrame');
  if (!frame?.src || !frame.contentWindow) return;
  frame.contentWindow.postMessage({ type: 'manager-template-context', context: templateContext() }, location.origin);
}

function managerSummaryTableHtml() {
  return `<div class="table-scroll print-table-scroll"><table class="data-table manager-summary template-summary-table"><thead><tr><th rowspan="2">Ward</th><th colspan="3">Admission</th><th colspan="3">Discharge</th><th rowspan="2">Total Patient</th><th rowspan="2">Empty Bed</th><th rowspan="2">Vent Case</th><th rowspan="2">BiPAP Case</th><th rowspan="2">HFNC Case</th><th rowspan="2">Staff<br>AM/PM</th></tr><tr><th>E/C</th><th>C/C</th><th>T/I</th><th>Home</th><th>T/O</th><th>Death</th></tr></thead><tbody>${buildSummaryRows(false)}</tbody></table></div>`;
}

function infectionTableHtml() {
  return `<div class="table-scroll print-table-scroll"><table class="data-table manager-summary template-infection-table"><thead><tr><th>Ward</th><th>COVID-19</th><th>CRE</th><th>VRE</th><th>MDRA</th><th>CD</th><th>Influenza</th><th>HD</th><th>CAPD</th><th>Early Bird</th></tr></thead><tbody>${buildInfectionRows()}</tbody></table></div>`;
}

function setStatus(message, type = 'info') {
  const el = $('#managerStatus');
  if (!el) return;
  el.hidden = false;
  el.className = `manager-status no-print ${type}`;
  el.textContent = message;
}
function clearStatus() { const el = $('#managerStatus'); if (el) { el.hidden = true; el.textContent = ''; } }
function showFatal(error) {
  const message = error?.message || String(error);
  setStatus(`Manager page could not initialise: ${message}`, 'error');
  const summary = $('#summaryRows'); if (summary) summary.innerHTML = `<tr><td colspan="14">Manager page could not initialise: ${esc(message)}</td></tr>`;
}
