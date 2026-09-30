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
};

bindControls();
refreshNightOperations().catch(showError);
setInterval(() => refreshNightOperations({ quiet: true }).catch(() => {}), 60_000);

function bindControls() {
  $('#refreshNightOperationsBtn')?.addEventListener('click', () => refreshNightOperations());
  $('#refreshStatusBtn')?.addEventListener('click', () => refreshNightOperations({ quiet: true }).catch(() => {}));
  $('#printNightStaffBtn')?.addEventListener('click', printNightStaff);
  $('#printNightRunnerBtn')?.addEventListener('click', printNightRunners);
}

async function refreshNightOperations({ quiet = false } = {}) {
  if (state.refreshing) return;
  state.refreshing = true;
  const button = $('#refreshNightOperationsBtn');
  if (button) button.disabled = true;
  if (!quiet) setLoading();

  try {
    const [wards, snapshots] = await Promise.all([
      getWardsForDate(state.reportingDate),
      getCurrentNightRosterSnapshots(state.reportingDate),
    ]);
    state.model = buildNightOperationsModel({ wards, snapshots });
    render();
  } finally {
    state.refreshing = false;
    if (button) button.disabled = false;
  }
}

function setLoading() {
  const wardSummary = $('#nightWardListSummary');
  const runnerSummary = $('#nightRunnerListSummary');
  if (wardSummary) wardSummary.textContent = 'Refreshing…';
  if (runnerSummary) runnerSummary.textContent = 'Refreshing…';
  if ($('#nightWardRosterGrid')) $('#nightWardRosterGrid').innerHTML = '<div class="night-ops-loading">Refreshing night staff…</div>';
  if ($('#nightRunnerList')) $('#nightRunnerList').innerHTML = '<div class="night-ops-loading">Refreshing Night Runners…</div>';
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

  $('#nightWardRosterGrid').innerHTML = model.wardRosters.map(renderWardCard).join('') || '<div class="night-roster-empty">No active wards found.</div>';
  $('#nightRunnerList').innerHTML = model.runners.length
    ? `<table class="night-runner-table"><thead><tr><th>Ward</th><th>Rank</th><th>Name</th><th>Appointment Date</th></tr></thead><tbody>${model.runners.map(nurse => `<tr><td><b>${esc(nurse.ward?.name || '')}</b></td><td>${esc(nurse.role)}</td><td>${esc(nurse.name)}</td><td>${esc(nurse.appointmentDate)}</td></tr>`).join('')}</tbody></table>`
    : '<div class="night-roster-empty">No Night Runner recorded for this reporting night.</div>';
}

function renderWardCard(row) {
  const nurses = row.nurses || [];
  const updated = row.updatedAt ? `Updated ${formatDateTime(row.updatedAt, 'en-GB')}` : 'No ward staff list saved this shift';
  return `<article class="night-ward-card">
    <div class="night-ward-card-head"><span class="night-ward-code">${esc(row.ward?.name || '')}</span><span class="night-ward-count">${nurses.length} staff</span></div>
    ${nurses.length ? `<table class="night-ward-table"><thead><tr><th>Rank</th><th>Name</th><th>Appointment Date</th></tr></thead><tbody>${nurses.map(nurse => `<tr><td>${esc(nurse.role)}</td><td>${esc(nurse.name)}</td><td>${esc(nurse.appointmentDate)}</td></tr>`).join('')}</tbody></table>` : '<div class="night-roster-empty">No night staff saved for this shift.</div>'}
    <div class="night-roster-updated">${esc(updated)}</div>
  </article>`;
}

function displayReportingDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '');
}

function printNightStaff() {
  showRosterPrint(renderNightStaffPrintHtml({
    reportingDate: state.reportingDate,
    wardRosters: state.model.wardRosters,
  }), 'Night Staff List');
}

function printNightRunners() {
  showRosterPrint(renderNightRunnerPrintHtml({
    reportingDate: state.reportingDate,
    runners: state.model.runners,
  }), 'Night Runner List');
}

function showRosterPrint(html, title) {
  const modal = $('#printPreviewModal');
  const frame = $('#printPreviewFrame');
  const heading = $('#printPreviewTitle');
  if (!modal || !frame || !heading) {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.addEventListener('load', () => win.print(), { once: true });
    return;
  }

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
  console.error('Night Operations failed:', error);
  const message = esc(error?.message || error || 'Unable to load Night Operations.');
  if ($('#nightWardListSummary')) $('#nightWardListSummary').textContent = 'Unavailable';
  if ($('#nightRunnerListSummary')) $('#nightRunnerListSummary').textContent = 'Unavailable';
  if ($('#nightWardRosterGrid')) $('#nightWardRosterGrid').innerHTML = `<div class="night-ops-error">${message}</div>`;
  if ($('#nightRunnerList')) $('#nightRunnerList').innerHTML = `<div class="night-ops-error">${message}</div>`;
}
