import { requireRole, signOut } from '../auth.js';
import { qs, qsa, esc } from '../core/dom.js';
import { formatDateTime } from '../core/dates.js';
import { setAppHeader } from '../components/app-shell.js';
import { renderFullReport } from '../components/report-view.js';
import { DB_MODE, getManagerMemo, saveManagerMemo } from '../data/index.js';
import { SUBMISSION_WINDOW_MINUTES, reportSubmittedAt } from '../domain/report-session.js';
import {
  buildManagerMemoDocument,
  isReportNewerThanSource,
  managerSubmissionStatus,
  regenerateWardDerivedSections,
  reportingNightDate,
  sourceSnapshotFromBundle,
} from '../domain/manager-memo.js';
import { loadManagerCurrent } from '../services/report-service.js';
import { renderManagerMemoPrintHtml } from '../manager-memo-print.js';

const $ = qs;
const $$ = qsa;
const MAIN_KEYS = ['ward','admissionEC','admissionCC','transferIn','discharge','transferOut','death','totalPatient','emptyBed','ventilator','bipap','hfnc','staff'];
const INF_KEYS = ['ward','covid','cre','vre','mdra','cd','influenza','hdCapd','remarks'];

const state = {
  access: null,
  bundle: [],
  items: [],
  allWards: [],
  windowMinutes: SUBMISSION_WINDOW_MINUTES,
  refreshedAt: null,
  reportingDate: null,
  memo: null,
  dirty: false,
  saving: false,
  saveTimer: null,
  rendering: false,
};

bootstrap().catch(error => showFatal(error));

async function bootstrap() {
  bindStaticControls();
  setStatus('Loading Manager workspace…', 'info');
  state.access = await requireRole('manager');
  if (!state.access) return;
  setAppHeader({
    title: 'Patrol Night',
    subtitle: 'Ward submission status and Night Memo editor',
    access: state.access,
    mode: DB_MODE,
  });
  state.reportingDate = reportingNightDate();
  await refreshWardStatus({ initial: true });
  await loadOrCreateMemo();
  renderAll();
  clearStatus();
}

function bindStaticControls() {
  $('#logoutBtn').onclick = signOut;
  $('#refreshStatusBtn').onclick = () => refreshWardStatus();
  $('#regenerateBtn').onclick = regenerateFromWardData;
  $('#saveMemoBtn').onclick = () => saveNow();
  $('#printMemoBtn').onclick = openPrintPreview;
  $('#finalizeMemoBtn').onclick = finalizeMemo;
  $('#reopenMemoBtn').onclick = reopenMemo;
  $('#printPreviewBtn').onclick = () => $('#printPreviewFrame')?.contentWindow?.print();

  $$('[data-close-modal]').forEach(button => {
    button.onclick = () => { const el = document.getElementById(button.dataset.closeModal); if (el) el.hidden = true; };
  });
  $$('.formatting-tools [data-format]').forEach(button => {
    button.onclick = () => {
      if (state.memo?.status === 'finalized') return;
      document.execCommand(button.dataset.format, false, null);
      markDirty();
    };
  });

  $('#memoEditor').addEventListener('input', () => {
    if (!state.rendering && state.memo?.status !== 'finalized') markDirty();
  });
}

async function refreshWardStatus({ initial = false } = {}) {
  if (!initial) setStatus('Refreshing ward submission status…', 'info');
  try {
    const current = await loadManagerCurrent(SUBMISSION_WINDOW_MINUTES);
    state.bundle = current.bundle || [];
    state.items = current.items || [];
    state.allWards = current.allWards || state.bundle.map(entry => entry.ward);
    state.windowMinutes = current.windowMinutes || SUBMISSION_WINDOW_MINUTES;
    state.refreshedAt = new Date();
    renderSubmissionMonitor();
    if (!initial) clearStatus();
  } catch (error) {
    setStatus(`Unable to refresh ward status: ${error.message || error}`, 'error');
    throw error;
  }
}

async function loadOrCreateMemo() {
  let memo = await getManagerMemo(state.reportingDate);
  if (!memo) {
    const document = buildManagerMemoDocument({
      bundle: state.bundle,
      items: state.items,
      reportingDate: state.reportingDate,
    });
    memo = await saveManagerMemo({
      reportingDate: state.reportingDate,
      document,
      sourceSnapshot: sourceSnapshotFromBundle(state.bundle),
      expectedRevision: 0,
      status: 'draft',
    });
  }
  state.memo = memo;
}

function renderAll() {
  renderSubmissionMonitor();
  renderEditor();
  renderMemoState();
}

function submissionWindowLabel() {
  const end = state.refreshedAt || new Date();
  const start = new Date(end.getTime() - state.windowMinutes * 60 * 1000);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `Current memo cycle · submissions in past ${state.windowMinutes} minutes · ${fmt.format(start)} – ${fmt.format(end)} HKT`;
}

function memoSourceForWard(wardId) {
  return (state.memo?.source_snapshot || []).find(row => row.ward_id === wardId) || null;
}

function currentReportForWard(wardId) {
  return state.bundle.find(entry => entry.ward?.id === wardId)?.report || null;
}

function isNewerThanDocument(wardId) {
  return isReportNewerThanSource(currentReportForWard(wardId), memoSourceForWard(wardId));
}

function hasNewerWardData() {
  return state.allWards.some(ward => isNewerThanDocument(ward.id));
}

function renderSubmissionMonitor() {
  const label = $('#submissionWindowLabel');
  if (label) label.textContent = submissionWindowLabel();
  const submittedCount = state.bundle.filter(entry => entry.report).length;
  const total = state.allWards.length || state.bundle.length;
  if ($('#submissionCount')) $('#submissionCount').textContent = `${submittedCount} / ${total} submitted`;

  const sourceChange = hasNewerWardData();
  if ($('#sourceChangeNotice')) $('#sourceChangeNotice').hidden = !sourceChange;

  const body = $('#submissionRows');
  if (!body) return;
  body.innerHTML = state.allWards.map(ward => {
    const entry = state.bundle.find(item => item.ward?.id === ward.id) || { ward, report: null };
    const report = entry.report;
    const status = managerSubmissionStatus(report);
    const stamp = reportSubmittedAt(report);
    const submittedAt = stamp ? formatDateTime(stamp, 'en-GB') : '—';
    const source = memoSourceForWard(ward.id);
    const newer = isNewerThanDocument(ward.id);
    let sourceLabel = 'Not in document';
    if (newer) sourceLabel = 'Newer submission available';
    else if (source && report) sourceLabel = 'Synced';
    else if (source) sourceLabel = 'Earlier submission in document';
    return `<tr class="${newer ? 'newer' : status.state}">
      <td><b>${esc(ward.code)}</b></td>
      <td>${esc(status.label)}</td>
      <td>${esc(submittedAt)}</td>
      <td>${esc(sourceLabel)}</td>
      <td>${report ? `<button type="button" class="pill source-view-btn" data-ward-id="${esc(ward.id)}">View source</button>` : ''}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5">No active wards found.</td></tr>';

  $$('.source-view-btn', body).forEach(button => { button.onclick = () => openSourceReport(button.dataset.wardId); });
}

function managerFromName(header = {}) {
  if (header.fromName != null) return String(header.fromName);
  const legacy = String(header.from || '').trim();
  return legacy.replace(/^N\.?O\.?\/APN,?\s*/i, '').trim();
}

function renderEditor() {
  if (!state.memo) return;
  state.rendering = true;
  try {
    const doc = state.memo.document || {};
    $('#memoTitle').textContent = doc.title || 'Night Memo';
    $('#memoFromName').value = managerFromName(doc.header);
    $('#memoDectPhone').value = doc.header?.dectPhone || '';
    $('#memoDateText').value = doc.header?.date || '';
    $('#memoCallTeam').value = doc.header?.callTeam || '';
    renderEditableRows($('#memoMainRows'), doc.mainTableRows || [], MAIN_KEYS);
    renderEditableRows($('#memoInfectionRows'), doc.infectionRows || [], INF_KEYS);
    $('#memoClinicalNotes').innerHTML = sanitizeRichHtml(doc.clinicalNotesHtml || '<div><br></div>');
    $('#memoAdditionalItems').innerHTML = sanitizeRichHtml(doc.additionalItemsHtml || '<div><br></div>');
    $('#memoEarlyBird').innerHTML = sanitizeRichHtml(doc.earlyBirdHtml || '<div><br></div>');
    $('#memoEmptyBed').innerHTML = sanitizeRichHtml(doc.emptyBedHtml || '<div><br></div>');
    $('#ctTotal').value = doc.ct?.total || '';
    $('#ctMaleGeneral').value = doc.ct?.maleGeneral || '';
    $('#ctMaleCohort').value = doc.ct?.maleCohort || '';
    $('#ctFemaleGeneral').value = doc.ct?.femaleGeneral || '';
    $('#ctFemaleCohort').value = doc.ct?.femaleCohort || '';
    $('#signatureLabel').textContent = doc.signature?.label || 'Signature';
    $('#signatureName').value = doc.signature?.name || '';
    $('#signatureDesignation').value = doc.signature?.designation || 'N.O./APN';
    setEditingEnabled(state.memo.status !== 'finalized');
    state.dirty = false;
    updateSaveState();
  } finally {
    state.rendering = false;
  }
}

function renderEditableRows(host, rows, keys) {
  host.innerHTML = rows.map((row, index) => `<tr data-row-index="${index}">${keys.map(key => `<td contenteditable="true" data-key="${key}">${esc(row?.[key] ?? '')}</td>`).join('')}</tr>`).join('');
}

function readRows(host, existingRows, keys) {
  return $$('tr[data-row-index]', host).map((tr, index) => {
    const base = { ...(existingRows?.[index] || {}) };
    for (const key of keys) base[key] = tr.querySelector(`[data-key="${key}"]`)?.textContent?.trim() || '';
    return base;
  });
}

function serializeDocument() {
  const current = state.memo?.document || {};
  return {
    ...current,
    version: 2,
    title: $('#memoTitle').textContent.trim() || 'Night Memo',
    header: {
      fromName: $('#memoFromName').value,
      dectPhone: $('#memoDectPhone').value,
      date: $('#memoDateText').value,
      callTeam: $('#memoCallTeam').value,
    },
    mainTableRows: readRows($('#memoMainRows'), current.mainTableRows, MAIN_KEYS),
    infectionRows: readRows($('#memoInfectionRows'), current.infectionRows, INF_KEYS),
    clinicalNotesHtml: sanitizeRichHtml($('#memoClinicalNotes').innerHTML),
    additionalItemsHtml: sanitizeRichHtml($('#memoAdditionalItems').innerHTML),
    earlyBirdHtml: sanitizeRichHtml($('#memoEarlyBird').innerHTML),
    emptyBedHtml: sanitizeRichHtml($('#memoEmptyBed').innerHTML),
    ct: {
      total: $('#ctTotal').value,
      maleGeneral: $('#ctMaleGeneral').value,
      maleCohort: $('#ctMaleCohort').value,
      femaleGeneral: $('#ctFemaleGeneral').value,
      femaleCohort: $('#ctFemaleCohort').value,
    },
    signature: {
      label: $('#signatureLabel').textContent.trim() || 'Signature',
      name: $('#signatureName').value,
      designation: $('#signatureDesignation').value,
    },
  };
}

function sanitizeRichHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  const allowed = new Set(['DIV','P','BR','B','STRONG','I','EM','U','UL','OL','LI']);
  const walk = node => {
    for (const child of [...node.children]) {
      if (!allowed.has(child.tagName)) {
        child.replaceWith(document.createTextNode(child.textContent || ''));
        continue;
      }
      [...child.attributes].forEach(attr => child.removeAttribute(attr.name));
      walk(child);
    }
  };
  walk(template.content);
  return template.innerHTML;
}

function markDirty() {
  if (state.memo?.status === 'finalized') return;
  state.dirty = true;
  updateSaveState();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveNow().catch(() => {}), 1800);
}

function updateSaveState(message = '') {
  const el = $('#saveState');
  if (!el) return;
  if (message) { el.textContent = message; return; }
  if (state.saving) el.textContent = 'Saving…';
  else if (state.dirty) el.textContent = 'Unsaved changes';
  else if (state.memo?.updated_at) el.textContent = `Saved ${formatDateTime(state.memo.updated_at, 'en-GB')}`;
  else el.textContent = 'Saved';
}

async function saveNow(statusOverride = null) {
  if (!state.memo || state.saving) return state.memo;
  clearTimeout(state.saveTimer);
  const nextStatus = statusOverride || state.memo.status || 'draft';
  if (!state.dirty && !statusOverride) return state.memo;
  state.saving = true;
  updateSaveState();
  try {
    const document = serializeDocument();
    const saved = await saveManagerMemo({
      reportingDate: state.reportingDate,
      document,
      sourceSnapshot: state.memo.source_snapshot || [],
      expectedRevision: state.memo.revision || 0,
      status: nextStatus,
    });
    state.memo = saved;
    state.dirty = false;
    renderMemoState();
    updateSaveState();
    return saved;
  } catch (error) {
    const text = `${error?.message || error}`;
    updateSaveState('Save failed');
    if (/MANAGER_MEMO_CONFLICT|changed in another window|revision/i.test(text)) {
      setStatus('This Night Memo was changed in another window. Reload this page before making further edits.', 'error');
    } else {
      setStatus(`Unable to save Night Memo: ${text}`, 'error');
    }
    throw error;
  } finally {
    state.saving = false;
  }
}

async function regenerateFromWardData() {
  if (!state.memo || state.memo.status === 'finalized') return;
  const ok = confirm('Replace the ward-derived tables and generated notes with the latest submitted ward data? Header, CT/06:00 values and signature will be preserved.');
  if (!ok) return;
  const currentDoc = serializeDocument();
  state.memo.document = regenerateWardDerivedSections(currentDoc, { bundle: state.bundle, items: state.items });
  state.memo.source_snapshot = sourceSnapshotFromBundle(state.bundle);
  renderEditor();
  state.dirty = true;
  await saveNow();
  renderSubmissionMonitor();
  setStatus('Ward-derived sections regenerated from the latest submissions.', 'info');
  setTimeout(clearStatus, 2500);
}

async function finalizeMemo() {
  if (!state.memo || state.memo.status === 'finalized') return;
  if (!confirm('Finalize this Night Memo? Editing will be locked until it is reopened.')) return;
  state.dirty = true;
  await saveNow('finalized');
  setEditingEnabled(false);
  renderMemoState();
}

async function reopenMemo() {
  if (!state.memo || state.memo.status !== 'finalized') return;
  if (!confirm('Reopen this finalized Night Memo for editing?')) return;
  state.dirty = true;
  await saveNow('draft');
  setEditingEnabled(true);
  renderMemoState();
}

function renderMemoState() {
  if (!state.memo) return;
  const finalized = state.memo.status === 'finalized';
  const badge = $('#memoStateBadge');
  badge.textContent = finalized ? 'Finalized' : 'Draft';
  badge.className = `memo-state-badge ${finalized ? 'finalized' : 'draft'}`;
  $('#finalizeMemoBtn').hidden = finalized;
  $('#reopenMemoBtn').hidden = !finalized;
  $('#saveMemoBtn').disabled = finalized;
  $$('.formatting-tools button').forEach(button => { button.disabled = finalized; });
}

function setEditingEnabled(enabled) {
  const editor = $('#memoEditor');
  editor.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  $$('input', editor).forEach(input => { input.disabled = !enabled; });
  $$('[contenteditable]', editor).forEach(el => { el.contentEditable = enabled ? 'true' : 'false'; });
}

async function openSourceReport(wardId) {
  const entry = state.bundle.find(item => item.ward?.id === wardId);
  if (!entry?.report) return;
  const items = entry.report.report_item_snapshot?.length ? entry.report.report_item_snapshot.map(item => ({ ...item, __historical: true })) : state.items;
  $('#sourceReportTitle').textContent = `${entry.ward.code} submitted ward memo`;
  $('#sourceReportBody').innerHTML = renderFullReport({ ward: entry.ward, report: entry.report, capacity: entry.capacity, items });
  $('#sourceReportModal').hidden = false;
}

function openPrintPreview() {
  const document = serializeDocument();
  $('#printPreviewFrame').srcdoc = renderManagerMemoPrintHtml(document);
  $('#printPreviewModal').hidden = false;
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
  console.error('Manager workspace failed:', error);
  setStatus(`Manager workspace could not initialise: ${error?.message || error}`, 'error');
}
