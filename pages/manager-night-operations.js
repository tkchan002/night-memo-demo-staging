import { qs, esc } from '../core/dom.js';
import { formatDateTime } from '../core/dates.js';
import { getWardsForDate } from '../data/repositories/ward-repository.js';
import { getCurrentNightRosterSnapshots } from '../data/repositories/night-roster-repository.js';
import { reportingNightDate } from '../domain/manager-memo.js';
import { buildNightOperationsModel } from '../domain/night-roster.js';
import { renderNightStaffPrintHtml, renderNightRunnerPrintHtml } from '../night-roster-print.js';

const $ = qs;
const state = {
  reportingDate: reportingNightDate(),
  model: buildNightOperationsModel(),
  refreshing: false,
  loaded: false,
};

bindControls();
refreshNightOperations().catch(showError);
setInterval(() => refreshNightOperations({ quiet: true }).catch(() => {}), 60_000);

function bindControls() {
  $('#refreshNightOperationsBtn')?.addEventListener('click', () => refreshNightOperations());
  $('#refreshStatusBtn')?.addEventListener('click', () => refreshNightOperations({ quiet: true }).catch(() => {}));
  $('#printNightStaffBtn')?.addEventListener('click', printNightStaff);
  $('#printNightRunnerBtn')?.addEventListener('click', printNightRunners);
  document.addEventListener('manager-primary-tab-change', event => {
    if (event.detail?.tab === 'staffing') refreshNightOperations({ quiet: state.loaded }).catch(showError);
  });
}

async function refreshNightOperations({ quiet = false } = {}) {
  if (state.refreshing) return;
  state.refreshing = true;
  const button = $('#refreshNightOperationsBtn');
  if (button) button.disabled = true;
  if (!quiet) setLoading();

  try {
    const currentDate = reportingNightDate();
    if (currentDate !== state.reportingDate) state.reportingDate = currentDate;
    const [wards, snapshots] = await Promise.all([
      getWardsForDate(state.reportingDate),
      getCurrentNightRosterSnapshots(state.reportingDate),
    ]);
    state.model = buildNightOperationsModel({ wards, snapshots });
    state.loaded = true;
    render();
  } finally {
    state.refreshing = false;
    if (button) button.disabled = false;
  }
}

function setLoading() {
  if ($('#nightWardListSummary')) $('#nightWardListSummary').textContent = 'Refreshing…';
  if ($('#nightRunnerListSummary')) $('#nightRunnerListSummary').textContent = 'Refreshing…';
  if ($('#nightWardStaffRows')) $('#nightWardStaffRows').innerHTML = '<tr><td colspan="6">Refreshing night staff…</td></tr>';
  if ($('#nightRunnerRows')) $('#nightRunnerRows').innerHTML = '<tr><td colspan="4">Refreshing Night Runners…</td></tr>';
}

function render() {
  const model = state.model;
  $('#nightNurseCount').textContent = String(model.nurseCount);
  $('#nightRunnerCount').textContent = String(model.runnerCount);
  $('#nightRosterWardCount').textContent = `${model.wardsWithRoster} / ${model.wardCount}`;
  $('#nightOperationsDate').textContent = `Reporting night: ${displayReportingDate(state.reportingDate)}`;
  $('#nightWardListSummary').textContent = `${model.wardsWithRoster} of ${model.wardCount} wards · ${model.nurseCount} nurses`;
  $('#nightRunnerListSummary').textContent = `${model.runnerCount} runner${model.runnerCount === 1 ? '' : 's'}`;
  $('#printNightStaffBtn').disabled = model.wardCount === 0;
  $('#printNightRunnerBtn').disabled = false;

  const wardRows = [];
  for (const row of model.wardRosters) {
    const wardName = row.ward?.name || '';
    const updated = row.updatedAt ? formatDateTime(row.updatedAt, 'en-GB') : '—';
    if (!row.nurses?.length) {
      wardRows.push(`<tr class="night-staffing-empty-ward"><td><b>${esc(wardName)}</b></td><td colspan="4">No night staff saved for this shift.</td><td>${esc(updated)}</td></tr>`);
      continue;
    }
    row.nurses.forEach((nurse, index) => {
      wardRows.push(`<tr><td>${index === 0 ? `<b>${esc(wardName)}</b>` : ''}</td><td>${esc(nurse.role)}</td><td>${esc(nurse.name)}</td><td>${esc(nurse.appointmentDate)}</td><td>${nurse.runner ? '<span class="runner-yes">Yes</span>' : '—'}</td><td>${index === 0 ? esc(updated) : ''}</td></tr>`);
    });
  }
  $('#nightWardStaffRows').innerHTML = wardRows.join('') || '<tr><td colspan="6">No active wards found.</td></tr>';

  $('#nightRunnerRows').innerHTML = model.runners.length
    ? model.runners.map(nurse => `<tr><td><b>${esc(nurse.ward?.name || '')}</b></td><td>${esc(nurse.role)}</td><td>${esc(nurse.name)}</td><td>${esc(nurse.appointmentDate)}</td></tr>`).join('')
    : '<tr><td colspan="4">No Night Runner recorded for this reporting night.</td></tr>';
}

function displayReportingDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '');
}

function printNightStaff() {
  showRosterPrint(renderNightStaffPrintHtml({ reportingDate: state.reportingDate, wardRosters: state.model.wardRosters }), 'Night Staff List');
}

function printNightRunners() {
  showRosterPrint(renderNightRunnerPrintHtml({ reportingDate: state.reportingDate, runners: state.model.runners }), 'Night Runner List');
}

function showRosterPrint(html, title) {
  const modal = $('#printPreviewModal');
  const frame = $('#printPreviewFrame');
  const heading = $('#printPreviewTitle');
  if (!modal || !frame || !heading) return;
  heading.textContent = title;
  modal.hidden = false;
  frame.onload = () => {
    frame.onload = null;
    setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    }, 80);
  };
  frame.srcdoc = html;
}

function showError(error) {
  console.error('Night Staffing failed:', error);
  const message = esc(error?.message || error || 'Unable to load Night Staffing.');
  if ($('#nightWardListSummary')) $('#nightWardListSummary').textContent = 'Unavailable';
  if ($('#nightRunnerListSummary')) $('#nightRunnerListSummary').textContent = 'Unavailable';
  if ($('#nightWardStaffRows')) $('#nightWardStaffRows').innerHTML = `<tr><td colspan="6">${message}</td></tr>`;
  if ($('#nightRunnerRows')) $('#nightRunnerRows').innerHTML = `<tr><td colspan="4">${message}</td></tr>`;
}
