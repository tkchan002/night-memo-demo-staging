import { requireRole, signOut } from '../auth.js';
import { qs, qsa, esc } from '../core/dom.js';
import { formatDateTime } from '../core/dates.js';
import { setAppHeader } from '../components/app-shell.js';
import { renderFullReport } from '../components/report-view.js';
import {
  DB_MODE,
  getManagerMemo,
  saveManagerMemoRecovery,
  saveManagerMemoRevision,
  listManagerMemoRevisions,
  getManagerMemoRevision,
} from '../data/index.js';
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
  history: [],
  editorOpen: false,
  dirty: false,
  recoverySaving: false,
  officialSaving: false,
  saveTimer: null,
  rendering: false,
  conflicted: false,
  lastOfficialType: null,
};

bootstrap().catch(showFatal);

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
  await loadWorkspace();
  renderSubmissionMonitor();
  renderWorkspace();
  clearStatus();
}

function bindStaticControls() {
  $('#logoutBtn').onclick = signOut;
  $('#refreshStatusBtn').onclick = () => refreshWardStatus();
  $('#regenerateBtn').onclick = regenerateFromWardData;

  $('#continueDraftBtn').onclick = openExistingDraft;
  $('#startNewBtn').onclick = startNewDraft;
  $('#workspaceHistoryBtn').onclick = openHistory;
  $('#backWorkspaceBtn').onclick = backToWorkspace;

  $('#saveMemoBtn').onclick = saveDraftVersion;
  $('#historyBtn').onclick = openHistory;
  $('#previewMemoBtn').onclick = previewCurrentMemo;
  $('#printMemoBtn').onclick = printFinalVersion;

  $$('[data-close-modal]').forEach(button => {
    button.onclick = () => {
      const el = document.getElementById(button.dataset.closeModal);
      if (el) el.hidden = true;
    };
  });

  $('#historyBody').addEventListener('click', async event => {
    const button = event.target.closest('[data-history-action]');
    if (!button) return;
    const revisionId = button.dataset.revisionId;
    if (button.dataset.historyAction === 'view') await viewHistoryRevision(revisionId);
    if (button.dataset.historyAction === 'use') await useHistoryRevisionAsDraft(revisionId);
  });

  $$('.formatting-tools [data-format]').forEach(button => {
    button.onclick = () => {
      document.execCommand(button.dataset.format, false, null);
      markDirty();
    };
  });

  $('#memoEditor').addEventListener('input', () => {
    if (!state.rendering) markDirty();
  });
}

async function loadWorkspace() {
  state.memo = await getManagerMemo(state.reportingDate);
  state.history = await listManagerMemoRevisions(state.reportingDate);
  state.lastOfficialType = state.history[0]?.revision_type || null;
}

async function refreshHistory() {
  state.history = await listManagerMemoRevisions(state.reportingDate);
  renderWorkspace();
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
  if (!state.memo) return false;
  return isReportNewerThanSource(currentReportForWard(wardId), memoSourceForWard(wardId));
}

function hasNewerWardData() {
  if (!state.memo) return false;
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
    let sourceLabel = state.memo ? 'Not in document' : 'No draft yet';
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
  $$('.source-view-btn', body).forEach(button => {
    button.onclick = () => openSourceReport(button.dataset.wardId);
  });
}

function actorLabel() {
  const access = state.access || {};
  return String(access.display_name || access.name || access.login_id || access.username || access.email || 'Manager');
}

function latestRevision(type) {
  return state.history.find(row => row.revision_type === type) || null;
}

function formatRevisionStamp(row) {
  return row?.created_at ? formatDateTime(row.created_at, 'en-GB') : '—';
}

function renderWorkspace() {
  const panel = $('#memoWorkspacePanel');
  if (!panel) return;
  $('#workspaceDate').textContent = `Reporting night: ${state.reportingDate || ''}`;

  const draft = latestRevision('draft');
  const final = latestRevision('final');
  const recovery = state.memo;
  const summary = $('#workspaceSummary');

  if (!recovery && !state.history.length) {
    summary.innerHTML = '<div class="workspace-state">No Night Memo has been created for this reporting night.</div><div class="workspace-empty">Start a Night Memo to generate a working document from the current ward submissions.</div>';
    $('#continueDraftBtn').hidden = true;
    $('#startNewBtn').textContent = 'Start Night Memo';
    return;
  }

  const parts = [];
  if (recovery) {
    parts.push('<div class="workspace-state">Working draft available</div>');
    parts.push(`<div class="workspace-meta">Recovery copy: ${esc(recovery.updated_at ? formatDateTime(recovery.updated_at, 'en-GB') : 'available')}</div>`);
  }
  if (draft) parts.push(`<div class="workspace-meta">Latest Save: Draft #${esc(draft.revision_number)} · ${esc(formatRevisionStamp(draft))}${draft.created_by_label ? ` · ${esc(draft.created_by_label)}` : ''}</div>`);
  if (final) parts.push(`<div class="workspace-meta">Latest Print: Final #${esc(final.revision_number)} · ${esc(formatRevisionStamp(final))}${final.created_by_label ? ` · ${esc(final.created_by_label)}` : ''}</div>`);
  if (!draft && !final) parts.push('<div class="workspace-meta">No saved Draft or Final history yet. The working copy is recovery data only.</div>');
  summary.innerHTML = parts.join('');

  $('#continueDraftBtn').hidden = !recovery;
  $('#startNewBtn').textContent = recovery ? 'Start New' : 'Start Night Memo';
}

function openExistingDraft() {
  if (!state.memo) return;
  state.editorOpen = true;
  $('#memoWorkspacePanel').hidden = true;
  $('#editorArea').hidden = false;
  renderEditor();
  renderMemoState();
}

async function startNewDraft() {
  if (state.memo) {
    const ok = confirm('Start a new working draft? Existing Save and Print history will remain, but the current recovery working copy will be replaced.');
    if (!ok) return;
  }

  const document = buildManagerMemoDocument({
    bundle: state.bundle,
    items: state.items,
    reportingDate: state.reportingDate,
  });
  const sourceSnapshot = sourceSnapshotFromBundle(state.bundle);

  state.memo = {
    ...(state.memo || {}),
    reporting_date: state.reportingDate,
    document,
    source_snapshot: sourceSnapshot,
    status: 'draft',
    revision: state.memo?.revision || 0,
  };
  state.conflicted = false;
  state.lastOfficialType = null;
  state.editorOpen = true;
  state.dirty = true;

  $('#memoWorkspacePanel').hidden = true;
  $('#editorArea').hidden = false;
  renderEditor({ keepDirty: true });
  await saveRecoveryNow({ force: true });
  renderSubmissionMonitor();
  renderMemoState();
}

async function backToWorkspace() {
  if (state.dirty && !state.conflicted) {
    try { await saveRecoveryNow({ force: true }); } catch (_) { return; }
  }
  state.editorOpen = false;
  $('#editorArea').hidden = true;
  $('#memoWorkspacePanel').hidden = false;
  await refreshHistory();
  renderWorkspace();
}

function managerFromName(header = {}) {
  if (header.fromName != null) return String(header.fromName);
  const legacy = String(header.from || '').trim();
  return legacy.replace(/^N\.?O\.?\/APN,?\s*/i, '').trim();
}

function renderEditor({ keepDirty = false } = {}) {
  if (!state.memo) return;
  state.rendering = true;
  const previousDirty = state.dirty;
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
    setEditingEnabled(true);
    state.dirty = keepDirty ? previousDirty : false;
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
  if (!state.memo || state.conflicted) return;
  state.dirty = true;
  state.lastOfficialType = null;
  renderMemoState();
  updateSaveState();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveRecoveryNow().catch(() => {}), 1800);
}

function updateSaveState(message = '') {
  const el = $('#saveState');
  if (!el) return;
  if (message) { el.textContent = message; return; }
  if (state.conflicted) el.textContent = 'Save conflict — reload required';
  else if (state.officialSaving) el.textContent = 'Saving…';
  else if (state.recoverySaving) el.textContent = 'Recovery saving…';
  else if (state.dirty) el.textContent = 'Unsaved changes';
  else if (state.memo?.updated_at) el.textContent = `Recovery saved ${formatDateTime(state.memo.updated_at, 'en-GB')}`;
  else el.textContent = 'Ready';
}

async function saveRecoveryNow({ force = false } = {}) {
  if (!state.memo || state.conflicted) return state.memo;
  if (state.recoverySaving || state.officialSaving) return state.memo;
  if (!state.dirty && !force) return state.memo;

  clearTimeout(state.saveTimer);
  state.recoverySaving = true;
  updateSaveState();
  try {
    const document = state.editorOpen ? serializeDocument() : state.memo.document;
    const saved = await saveManagerMemoRecovery({
      reportingDate: state.reportingDate,
      document,
      sourceSnapshot: state.memo.source_snapshot || [],
      expectedRevision: state.memo.revision || 0,
    });
    state.memo = saved;
    state.dirty = false;
    updateSaveState();
    renderWorkspace();
    return saved;
  } catch (error) {
    handleSaveError(error, 'recovery');
    throw error;
  } finally {
    state.recoverySaving = false;
    updateSaveState();
  }
}

async function saveOfficialRevision(revisionType, reason) {
  if (!state.memo || state.conflicted || state.officialSaving) return null;
  clearTimeout(state.saveTimer);
  state.officialSaving = true;
  updateSaveState();
  try {
    const document = serializeDocument();
    const result = await saveManagerMemoRevision({
      reportingDate: state.reportingDate,
      document,
      sourceSnapshot: state.memo.source_snapshot || [],
      expectedRevision: state.memo.revision || 0,
      revisionType,
      reason,
      actorLabel: actorLabel(),
    });
    state.memo = result.memo;
    state.dirty = false;
    state.lastOfficialType = revisionType;
    state.history = [result.revision, ...state.history.filter(row => row.id !== result.revision.id)];
    renderMemoState();
    renderWorkspace();
    updateSaveState();
    return result;
  } catch (error) {
    handleSaveError(error, revisionType);
    throw error;
  } finally {
    state.officialSaving = false;
    updateSaveState();
  }
}

function handleSaveError(error, kind) {
  const text = `${error?.message || error}`;
  if (/MANAGER_MEMO_CONFLICT|changed in another window|revision/i.test(text)) {
    state.conflicted = true;
    clearTimeout(state.saveTimer);
    setStatus('This Night Memo was changed in another window. Your current screen has not been overwritten. Reload the page before saving or printing.', 'error');
    renderMemoState();
  } else {
    setStatus(`Unable to save Night Memo ${kind}: ${text}`, 'error');
  }
  updateSaveState('Save failed');
}

async function saveDraftVersion() {
  const result = await saveOfficialRevision('draft', 'save');
  if (!result) return;
  setStatus(`Draft #${result.revision.revision_number} saved.`, 'info');
  setTimeout(clearStatus, 2200);
}

async function printFinalVersion() {
  const result = await saveOfficialRevision('final', 'print');
  if (!result) return;
  setStatus(`Final #${result.revision.revision_number} saved. Opening print dialog…`, 'info');
  await showPrintDocument(result.revision.document, {
    title: `Final #${result.revision.revision_number} · Night Memo`,
    autoPrint: true,
  });
  setTimeout(clearStatus, 2600);
}

function previewCurrentMemo() {
  if (!state.memo) return;
  showPrintDocument(serializeDocument(), { title: 'Night Memo Preview', autoPrint: false });
}

function showPrintDocument(document, { title = 'Night Memo Preview', autoPrint = false } = {}) {
  return new Promise(resolve => {
    const modal = $('#printPreviewModal');
    const frame = $('#printPreviewFrame');
    $('#printPreviewTitle').textContent = title;
    modal.hidden = false;
    frame.onload = () => {
      frame.onload = null;
      if (autoPrint) setTimeout(() => frame.contentWindow?.print(), 60);
      resolve();
    };
    frame.srcdoc = renderManagerMemoPrintHtml(document);
  });
}

async function regenerateFromWardData() {
  if (!state.memo || !state.editorOpen || state.conflicted) return;
  const ok = confirm('Replace the ward-derived tables and generated notes with the latest submitted ward data? Header, CT/06:00 values and signature will be preserved.');
  if (!ok) return;
  const currentDoc = serializeDocument();
  state.memo.document = regenerateWardDerivedSections(currentDoc, { bundle: state.bundle, items: state.items });
  state.memo.source_snapshot = sourceSnapshotFromBundle(state.bundle);
  state.dirty = true;
  renderEditor({ keepDirty: true });
  await saveRecoveryNow({ force: true });
  renderSubmissionMonitor();
  setStatus('Ward-derived sections regenerated. This is recovery data until you press Save or Print.', 'info');
  setTimeout(clearStatus, 3000);
}

function renderMemoState() {
  const badge = $('#memoStateBadge');
  if (!badge) return;
  if (state.lastOfficialType === 'final' && !state.dirty) {
    badge.textContent = 'Final saved';
    badge.className = 'memo-state-badge final';
  } else {
    badge.textContent = 'Draft';
    badge.className = 'memo-state-badge draft';
  }
  const disabled = state.conflicted || state.officialSaving;
  $('#saveMemoBtn').disabled = disabled;
  $('#printMemoBtn').disabled = disabled;
}

function setEditingEnabled(enabled) {
  const editor = $('#memoEditor');
  editor.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  $$('input', editor).forEach(input => { input.disabled = !enabled; });
  $$('[contenteditable]', editor).forEach(el => { el.contentEditable = enabled ? 'true' : 'false'; });
  $$('.formatting-tools button').forEach(button => { button.disabled = !enabled; });
}

async function openHistory() {
  await refreshHistory();
  renderHistory();
  $('#historyModal').hidden = false;
}

function renderHistory() {
  const body = $('#historyBody');
  $('#historyTitle').textContent = `Night Memo History · ${state.reportingDate}`;
  if (!state.history.length) {
    body.innerHTML = '<div class="history-empty">No saved Draft or Final versions yet.</div>';
    return;
  }

  body.innerHTML = `<table class="history-table">
    <thead><tr><th>Version</th><th>Status</th><th>Time</th><th>User</th><th></th></tr></thead>
    <tbody>${state.history.map(row => `<tr>
      <td>#${esc(row.revision_number)}</td>
      <td><span class="history-type ${row.revision_type === 'final' ? 'final' : ''}">${row.revision_type === 'final' ? 'Final' : 'Draft'}</span></td>
      <td>${esc(formatRevisionStamp(row))}</td>
      <td>${esc(row.created_by_label || '—')}</td>
      <td><div class="history-actions">
        <button type="button" class="pill" data-history-action="view" data-revision-id="${esc(row.id)}">View</button>
        <button type="button" class="pill" data-history-action="use" data-revision-id="${esc(row.id)}">Use as Draft</button>
      </div></td>
    </tr>`).join('')}</tbody>
  </table>`;
}

async function viewHistoryRevision(revisionId) {
  const revision = await getManagerMemoRevision(revisionId);
  if (!revision) return;
  await showPrintDocument(revision.document, {
    title: `${revision.revision_type === 'final' ? 'Final' : 'Draft'} #${revision.revision_number} · ${state.reportingDate}`,
    autoPrint: false,
  });
}

async function useHistoryRevisionAsDraft(revisionId) {
  const revision = await getManagerMemoRevision(revisionId);
  if (!revision) return;
  const ok = confirm(`Use ${revision.revision_type === 'final' ? 'Final' : 'Draft'} #${revision.revision_number} as the current working draft? Existing history will not be deleted.`);
  if (!ok) return;

  if (!state.memo) {
    state.memo = {
      reporting_date: state.reportingDate,
      revision: 0,
      status: 'draft',
    };
  }
  state.memo.document = revision.document;
  state.memo.source_snapshot = revision.source_snapshot || [];
  state.conflicted = false;
  state.lastOfficialType = null;
  state.editorOpen = true;
  state.dirty = true;
  $('#historyModal').hidden = true;
  $('#memoWorkspacePanel').hidden = true;
  $('#editorArea').hidden = false;
  renderEditor({ keepDirty: true });
  await saveRecoveryNow({ force: true });
  renderSubmissionMonitor();
  setStatus('Historical version loaded into the working draft. Press Save to record it as a new Draft version.', 'info');
}

async function openSourceReport(wardId) {
  const entry = state.bundle.find(item => item.ward?.id === wardId);
  if (!entry?.report) return;
  const items = entry.report.report_item_snapshot?.length
    ? entry.report.report_item_snapshot.map(item => ({ ...item, __historical: true }))
    : state.items;
  $('#sourceReportTitle').textContent = `${entry.ward.code} submitted ward memo`;
  $('#sourceReportBody').innerHTML = renderFullReport({ ward: entry.ward, report: entry.report, capacity: entry.capacity, items });
  $('#sourceReportModal').hidden = false;
}

function setStatus(message, type = 'info') {
  const el = $('#managerStatus');
  if (!el) return;
  el.hidden = false;
  el.className = `manager-status no-print ${type}`;
  el.textContent = message;
}

function clearStatus() {
  const el = $('#managerStatus');
  if (el) { el.hidden = true; el.textContent = ''; }
}

function showFatal(error) {
  console.error('Manager workspace failed:', error);
  setStatus(`Manager workspace could not initialise: ${error?.message || error}`, 'error');
}
