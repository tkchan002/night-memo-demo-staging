import { requireRole, signOut } from '../auth.js';
import { qs, qsa, esc } from '../core/dom.js';
import { todayISO, toDisplayDate } from '../core/dates.js';
import { numberValue } from '../core/numbers.js';
import { setAppHeader } from '../components/app-shell.js';
import { DB_MODE } from '../data/index.js';
import { createRequestSequencer } from '../core/request-sequencer.js';
import { deviceCount, normalizeDevice } from '../domain/report-model.js';
import { loadFullWardReport, loadManagerNight } from '../services/report-service.js';
import { renderFullReport } from '../components/report-view.js';
import { getWardsForDate } from '../data/index.js';

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
};

bootstrap().catch(error => {
  console.error('Manager bootstrap failed:', error);
  showFatal(error);
});

async function bootstrap() {
  setStatus('Loading manager data...', 'info');
  bindCoreControls();
  state.access = await requireRole('manager');
  if (!state.access) return;
  setAppHeader({ title: 'Patrol Night', subtitle: 'Nightly summary and complete ward reports', access: state.access, mode: DB_MODE });
  const today = todayISO();
  $('#reportDate').value = today;
  $('#fullReportDate').value = today;
  await refresh();
  clearStatus();
}

function bindCoreControls() {
  $('#logoutBtn').onclick = signOut;
  $('#refreshBtn').onclick = refresh;
  $('#printBtn').onclick = printNightMemo;
  $('#reportDate').onchange = async () => {
    $('#fullReportDate').value = $('#reportDate').value;
    state.selected = null;
    $('#fullReportBody').innerHTML = '<div class="manager-empty-state">Select a ward to read its complete report.</div>';
    await refresh();
  };
  $('#memoSection').onchange = refresh;
  $('#fullWardSelect').onchange = loadFullWardReportView;
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
  const date = $('#reportDate').value || todayISO();
  const section = $('#memoSection').value || 'Male';
  setStatus('Refreshing...', 'info');
  $('#summaryRows').innerHTML = '<tr><td colspan="14">Loading...</td></tr>';
  $('#infectionRows').innerHTML = '<tr><td colspan="10">Loading...</td></tr>';
  try {
    const [{ items, bundle }, wards] = await Promise.all([
      loadManagerNight(date, section),
      getWardsForDate(date).catch(() => []),
    ]);
    if (!refreshRequests.isCurrent(requestId)) return;
    state.items = items || [];
    state.bundle = bundle || [];
    state.allWards = wards?.length ? wards : state.bundle.map(x => x.ward);
    $('#sectionTitle').textContent = section;
    $('#printDateLabel').textContent = toDisplayDate(date);
    $('#fullReportDate').value = date;
    fillFullWardSelect();
    renderSummary();
    clearStatus();
    sendTemplateContext();
  } catch (error) {
    if (!refreshRequests.isCurrent(requestId)) return;
    console.error('Manager refresh failed:', error);
    $('#summaryRows').innerHTML = `<tr><td colspan="14">Unable to load Night Memo data: ${esc(error.message || String(error))}</td></tr>`;
    $('#infectionRows').innerHTML = '<tr><td colspan="10">Data load failed. See the message above.</td></tr>';
    setStatus(`Unable to load report data: ${error.message || String(error)}`, 'error');
  }
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

function buildSummaryRows(includeStatus = true) {
  return state.bundle.map(({ ward, capacity, report }) => {
    const D = report?.payload || {};
    const statusCell = includeStatus ? `<td class="screen-only-col">${report ? 'Submitted' : 'Not submitted'}</td>` : '';
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

function renderSummary() {
  $('#summaryRows').innerHTML = buildSummaryRows(true) || '<tr><td colspan="14">No wards configured for this section/date.</td></tr>';
  $('#infectionRows').innerHTML = buildInfectionRows() || '<tr><td colspan="10">No wards configured.</td></tr>';
  $$('.ward-link').forEach(el => { el.onclick = () => openWard(el.dataset.ward); });
}

async function openWard(wardId) {
  $('#fullWardSelect').value = wardId;
  window.showManagerPage?.('full');
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
  const date = $('#reportDate').value;
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
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(state.selected.ward.code)} ${esc($('#reportDate').value)}</title><link rel="stylesheet" href="${shellCss}"><link rel="stylesheet" href="${managerCss}"><link rel="stylesheet" href="${printCss}"></head><body class="legacy-page"><main class="legacy-shell"><div class="legacy-panel-body">${html}</div></main><script>setTimeout(()=>window.print(),500)<\/script></body></html>`);
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
  const date = $('#reportDate')?.value || '';
  return {
    reportDate: date,
    reportDateDisplay: toDisplayDate(date),
    section: $('#memoSection')?.value || '',
    wardSummaryTableHtml: managerSummaryTableHtml(),
    infectionTableHtml: infectionTableHtml(),
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
