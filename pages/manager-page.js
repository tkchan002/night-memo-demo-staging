import { requireRole, signOut } from '../auth.js';
import { qs, qsa, esc } from '../core/dom.js';
import { formatDateTime, toDisplayDate } from '../core/dates.js';
import { setAppHeader } from '../components/app-shell.js';
import { initManagerTabs } from '../components/manager-tabs.js';
import {
  DB_MODE,
  getManagerMemo,
  saveManagerMemoRecovery,
  saveManagerMemoRevision,
  listManagerMemoRevisions,
  getManagerMemoRevision,
  listManagerMemoArchive,
  createManagerMemoCheckpoint,
  listManagerMemoCheckpoints,
  getManagerMemoCheckpoint,
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
import { buildManagerWardInformation } from '../domain/manager-ward-information.js';

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
  archive: [],
  archiveSelectedDate: null,
  archiveMemo: null,
  archiveRevisions: [],
  archiveRequestId: 0,
  archiveCheckpoints: [],
  archiveSelectedKind: null,
  archiveSelectedId: null,
  historyMode: false,
  historyReturnMode: 'workspace',
  editorOpen: false,
  dirty: false,
  recoverySaving: false,
  officialSaving: false,
  saveTimer: null,
  recoveryTask: null,
  rendering: false,
  conflicted: false,
  boundaryExpired: false,
  lastOfficialType: null,
  editGeneration: 0,
  savedGeneration: 0,
  activeTab: 'submission',
  historyReturnTab: 'submission',
  wardPreviewContext: null,
};

let persistenceTail = Promise.resolve();
let managerTabs = null;
let wardPrintModulePromise = null;

bootstrap().catch(showFatal);

async function bootstrap() {
  managerTabs = initManagerTabs({
    initialTab: 'submission',
    onChange: tab => { state.activeTab = tab; },
  });
  bindStaticControls();
  setStatus('Loading Manager workspace…', 'info');
  state.access = await requireRole('manager');
  if (!state.access) return;

  setAppHeader({
    title: 'Patrol Night',
    subtitle: 'Night operations and Night Memo workspace',
    access: state.access,
    mode: DB_MODE,
  });

  state.reportingDate = reportingNightDate();
  await refreshWardStatus({ initial: true });
  await loadWorkspace();
  renderSubmissionMonitor();
  renderWardInformation();
  renderWorkspace();
  clearStatus();
}

function bindStaticControls() {
  $('#logoutBtn').onclick = signOut;
  $('#managerGlobalHistoryBtn').onclick = enterHistoryMode;
  $('#refreshStatusBtn').onclick = () => refreshWardStatus();
  $('#refreshWardInformationBtn').onclick = () => refreshWardStatus();
  $('#regenerateBtn').onclick = regenerateFromWardData;

  $('#continueDraftBtn').onclick = openExistingDraft;
  $('#startNewBtn').onclick = startNewDraft;
  $('#workspaceHistoryBtn').onclick = enterHistoryMode;
  $('#backWorkspaceBtn').onclick = backToWorkspace;

  $('#saveMemoBtn').onclick = saveDraftVersion;
  $('#historyBtn').onclick = enterHistoryMode;
  $('#previewMemoBtn').onclick = previewCurrentMemo;
  $('#printMemoBtn').onclick = printFinalVersion;

  $('#closeManagerHistoryBtn').onclick = exitHistoryMode;
  $('#archiveUseAsDraftBtn').onclick = restoreSelectedArchiveAsDraft;
  $('#printWardMemoBtn').onclick = printOpenWardMemo;

  $('#managerHistoryNightList').addEventListener('click', async event => {
    const button = event.target.closest('[data-archive-date]');
    if (!button) return;
    await selectArchiveNight(button.dataset.archiveDate);
  });

  $('#archiveRevisionList').addEventListener('click', async event => {
    const button = event.target.closest('[data-archive-revision-id], [data-archive-recovery]');
    if (!button) return;
    if (button.dataset.archiveRecovery != null) selectArchiveRecovery();
    else await selectArchiveRevision(button.dataset.archiveRevisionId);
  });

  $('#archiveCheckpointList').addEventListener('click', async event => {
    const button = event.target.closest('[data-checkpoint-action]');
    if (!button) return;
    const checkpointId = button.dataset.checkpointId;
    if (button.dataset.checkpointAction === 'view') await selectArchiveCheckpoint(checkpointId);
    if (button.dataset.checkpointAction === 'restore') await useCheckpointAsDraft(checkpointId);
  });

  $$('[data-close-modal]').forEach(button => {
    button.onclick = () => {
      const el = document.getElementById(button.dataset.closeModal);
      if (el) el.hidden = true;
    };
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

  window.addEventListener('beforeunload', event => {
    if (!state.dirty && !state.recoverySaving && !state.officialSaving) return;
    event.preventDefault();
    event.returnValue = '';
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
    renderWardInformation();
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
      <td><b>${esc(ward.name)}</b></td>
      <td>${esc(status.label)}</td>
      <td>${esc(submittedAt)}</td>
      <td>${esc(sourceLabel)}</td>
      <td>${report ? `<button type="button" class="pill ward-memo-view-btn" data-ward-id="${esc(ward.id)}">View Memo</button>` : ''}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5">No active wards found.</td></tr>';
  $$('.ward-memo-view-btn', body).forEach(button => {
    button.onclick = () => openWardMemoPreview(button.dataset.wardId);
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
  if (!ensureReportingNightCurrent()) return;
  if (state.memo) {
    const ok = confirm('Start a new working draft? Existing Draft/Final history will remain. A safety checkpoint of the current working copy will be kept before it is replaced.');
    if (!ok) return;
    try {
      await flushRecovery();
      await checkpointCurrentWorkingCopy('before_start_new');
    } catch (_) { return; }
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
  state.dirty = false;
  state.editGeneration = state.savedGeneration;
  markDirty({ schedule: false });

  $('#memoWorkspacePanel').hidden = true;
  $('#editorArea').hidden = false;
  renderEditor({ keepDirty: true });
  await saveRecoveryNow({ force: true });
  renderSubmissionMonitor();
  renderMemoState();
}

async function backToWorkspace() {
  if (!state.conflicted && !state.boundaryExpired) {
    try { await flushRecovery(); } catch (_) { return; }
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
    setEditingEnabled(!state.conflicted && !state.boundaryExpired && !state.officialSaving && !state.historyMode);
    state.dirty = keepDirty ? previousDirty : false;
    if (!keepDirty) {
      state.editGeneration = 0;
      state.savedGeneration = 0;
    }
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
  const { clinicalNotesHtml: _legacyClinical, additionalItemsHtml: _legacyAdditional, ...official } = current;
  return {
    ...official,
    version: 3,
    title: $('#memoTitle').textContent.trim() || 'Night Memo',
    header: {
      fromName: $('#memoFromName').value,
      dectPhone: $('#memoDectPhone').value,
      date: $('#memoDateText').value,
      callTeam: $('#memoCallTeam').value,
    },
    mainTableRows: readRows($('#memoMainRows'), current.mainTableRows, MAIN_KEYS),
    infectionRows: readRows($('#memoInfectionRows'), current.infectionRows, INF_KEYS),
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

function ensureReportingNightCurrent() {
  const current = reportingNightDate();
  if (current === state.reportingDate) return true;
  state.boundaryExpired = true;
  clearTimeout(state.saveTimer);
  setEditingEnabled(false);
  setStatus(`A new reporting night (${current}) has started. This page is still attached to ${state.reportingDate}. Reload Manager before saving or printing.`, 'error');
  renderMemoState();
  updateSaveState();
  return false;
}

function enqueuePersistence(task) {
  const run = persistenceTail.then(task, task);
  persistenceTail = run.catch(() => {});
  return run;
}

function markDirty({ schedule = true } = {}) {
  if (!state.memo || state.conflicted || state.boundaryExpired || state.historyMode) return;
  state.editGeneration += 1;
  state.dirty = true;
  state.lastOfficialType = null;
  renderMemoState();
  updateSaveState();
  clearTimeout(state.saveTimer);
  if (schedule) state.saveTimer = setTimeout(() => saveRecoveryNow().catch(() => {}), 1800);
}

function updateSaveState(message = '') {
  const el = $('#saveState');
  if (!el) return;
  if (message) { el.textContent = message; return; }
  if (state.boundaryExpired) el.textContent = 'New reporting night — reload required';
  else if (state.conflicted) el.textContent = 'Save conflict — reload required';
  else if (state.officialSaving) el.textContent = 'Saving version…';
  else if (state.recoverySaving) el.textContent = 'Recovery saving…';
  else if (state.dirty) el.textContent = 'Unsaved changes';
  else if (state.memo?.updated_at) el.textContent = `Recovery saved ${formatDateTime(state.memo.updated_at, 'en-GB')}`;
  else el.textContent = 'Ready';
}

async function saveRecoveryNow({ force = false } = {}) {
  if (!state.memo) return state.memo;
  if (state.conflicted) throw new Error('MANAGER_MEMO_CONFLICT');
  if (state.boundaryExpired) throw new Error('REPORTING_NIGHT_CHANGED');
  if (!ensureReportingNightCurrent()) throw new Error('REPORTING_NIGHT_CHANGED');
  if (!state.dirty && !force) return state.memo;
  if (state.recoveryTask) return state.recoveryTask;

  clearTimeout(state.saveTimer);
  const task = enqueuePersistence(async () => {
    if (!state.memo || state.conflicted || state.boundaryExpired) return state.memo;
    if (!state.dirty && !force) return state.memo;
    if (!ensureReportingNightCurrent()) throw new Error('REPORTING_NIGHT_CHANGED');

    const generation = state.editGeneration;
    const document = state.editorOpen ? serializeDocument() : state.memo.document;
    state.recoverySaving = true;
    updateSaveState();
    try {
      const saved = await saveManagerMemoRecovery({
        reportingDate: state.reportingDate,
        document,
        sourceSnapshot: state.memo.source_snapshot || [],
        expectedRevision: state.memo.revision || 0,
      });
      state.memo = saved;
      state.savedGeneration = Math.max(state.savedGeneration, generation);
      state.dirty = state.editGeneration > state.savedGeneration;
      renderWorkspace();
      renderMemoState();
      return saved;
    } catch (error) {
      handleSaveError(error, 'recovery');
      throw error;
    } finally {
      state.recoverySaving = false;
      updateSaveState();
    }
  });

  state.recoveryTask = task;
  try {
    return await task;
  } finally {
    if (state.recoveryTask === task) state.recoveryTask = null;
    if (state.dirty && !state.officialSaving && !state.conflicted && !state.boundaryExpired) {
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(() => saveRecoveryNow().catch(() => {}), 150);
    }
  }
}

async function flushRecovery() {
  clearTimeout(state.saveTimer);
  while (true) {
    if (state.conflicted) throw new Error('MANAGER_MEMO_CONFLICT');
    if (state.boundaryExpired || !ensureReportingNightCurrent()) throw new Error('REPORTING_NIGHT_CHANGED');
    if (state.recoveryTask) await state.recoveryTask;
    if (!state.dirty) return state.memo;
    await saveRecoveryNow({ force: true });
  }
}

async function checkpointCurrentWorkingCopy(reason) {
  if (!state.memo?.id) return null;
  return createManagerMemoCheckpoint({
    reportingDate: state.reportingDate,
    reason,
    actorLabel: actorLabel(),
  });
}

async function saveOfficialRevision(revisionType, reason) {
  if (!state.memo || state.conflicted || state.boundaryExpired || state.officialSaving) return null;
  if (!ensureReportingNightCurrent()) return null;

  clearTimeout(state.saveTimer);
  state.officialSaving = true;
  setEditingEnabled(false);
  updateSaveState();
  renderMemoState();
  try {
    await flushRecovery();
    const generation = state.editGeneration;
    const document = serializeDocument();
    const result = await enqueuePersistence(() => saveManagerMemoRevision({
      reportingDate: state.reportingDate,
      document,
      sourceSnapshot: state.memo.source_snapshot || [],
      expectedRevision: state.memo.revision || 0,
      revisionType,
      reason,
      actorLabel: actorLabel(),
    }));
    state.memo = result.memo;
    state.savedGeneration = Math.max(state.savedGeneration, generation);
    state.dirty = state.editGeneration > state.savedGeneration;
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
    if (state.editorOpen && !state.historyMode && !state.conflicted && !state.boundaryExpired) setEditingEnabled(true);
    renderMemoState();
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
  if (!state.memo || !state.editorOpen || state.conflicted || state.boundaryExpired || state.historyMode) return;
  if (!ensureReportingNightCurrent()) return;
  const ok = confirm('Replace the ward-derived tables and generated notes with the latest submitted ward data? Header, CT/06:00 values and signature will be preserved. A safety checkpoint will be kept first.');
  if (!ok) return;
  try {
    await flushRecovery();
    await checkpointCurrentWorkingCopy('before_regenerate_ward_sections');
  } catch (_) { return; }

  const currentDoc = serializeDocument();
  state.memo.document = regenerateWardDerivedSections(currentDoc, { bundle: state.bundle, items: state.items });
  state.memo.source_snapshot = sourceSnapshotFromBundle(state.bundle);
  markDirty({ schedule: false });
  renderEditor({ keepDirty: true });
  await saveRecoveryNow({ force: true });
  renderSubmissionMonitor();
  setStatus('Ward-derived sections regenerated. The previous working copy is available as a safety checkpoint. Press Save or Print to create official History.', 'info');
  setTimeout(clearStatus, 3600);
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
  const disabled = state.conflicted || state.boundaryExpired || state.officialSaving || state.historyMode;
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

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function archiveReasonLabel(reason) {
  const labels = {
    before_start_new: 'Before Start New',
    before_regenerate_ward_sections: 'Before Regenerate Ward Sections',
    before_restore_history: 'Before restoring History',
    before_restore_checkpoint: 'Before restoring recovery',
  };
  return labels[reason] || String(reason || 'Safety checkpoint').replaceAll('_', ' ');
}

async function enterHistoryMode() {
  if (state.historyMode) return;
  if (state.editorOpen && (state.dirty || state.recoverySaving)) {
    try { await flushRecovery(); } catch (_) { return; }
  }

  state.historyReturnMode = state.editorOpen ? 'editor' : 'workspace';
  state.historyReturnTab = state.activeTab;
  state.historyMode = true;
  setEditingEnabled(false);
  managerTabs?.setEnabled(false);
  $('#managerHistorySidebar').hidden = false;
  $('#managerArchiveViewer').hidden = false;
  $('#managerTabsShell').hidden = true;
  renderMemoState();

  try {
    state.archive = await listManagerMemoArchive();
    renderArchiveSidebar();
    const currentExists = state.archive.some(row => row.reporting_date === state.reportingDate);
    const initialDate = currentExists ? state.reportingDate : state.archive[0]?.reporting_date;
    if (initialDate) await selectArchiveNight(initialDate);
    else renderEmptyArchive();
    $('#closeManagerHistoryBtn').focus();
  } catch (error) {
    setStatus(`Unable to load Manager History: ${error.message || error}`, 'error');
  }
}

function exitHistoryMode() {
  if (!state.historyMode) return;
  state.historyMode = false;
  $('#managerHistorySidebar').hidden = true;
  $('#managerArchiveViewer').hidden = true;
  $('#managerTabsShell').hidden = false;
  managerTabs?.setEnabled(true);
  managerTabs?.select(state.historyReturnTab || 'submission', { emit: true });

  if (state.historyReturnMode === 'editor' && state.memo) {
    state.editorOpen = true;
    $('#memoWorkspacePanel').hidden = true;
    $('#editorArea').hidden = false;
    if (!state.conflicted && !state.boundaryExpired && !state.officialSaving) setEditingEnabled(true);
  } else if (state.activeTab === 'memo') {
    state.editorOpen = false;
    $('#editorArea').hidden = true;
    $('#memoWorkspacePanel').hidden = false;
  }
  document.querySelector(`[data-manager-tab="${state.activeTab}"]`)?.focus();
  renderMemoState();
}

function renderArchiveSidebar() {
  const host = $('#managerHistoryNightList');
  if (!state.archive.length) {
    host.innerHTML = '<div class="manager-history-empty">No Manager Night Memos have been created yet.</div>';
    return;
  }

  host.innerHTML = state.archive.map(row => {
    const current = row.reporting_date === state.reportingDate;
    const selected = row.reporting_date === state.archiveSelectedDate;
    let status = 'Recovery only';
    if (row.preferred_revision_type === 'final') status = `Final #${row.preferred_revision_number}`;
    else if (row.preferred_revision_type === 'draft') status = `Draft #${row.preferred_revision_number}`;
    const count = Number(row.revision_count || 0);
    return `<button type="button" class="manager-history-night${selected ? ' active' : ''}" data-archive-date="${esc(row.reporting_date)}">
      <span class="manager-history-night-date">${esc(toDisplayDate(row.reporting_date))}${current ? '<span class="manager-history-current-tag">Current</span>' : ''}</span>
      <span class="manager-history-night-meta">${esc(status)} · ${count} saved version${count === 1 ? '' : 's'}</span>
    </button>`;
  }).join('');
}

function renderEmptyArchive() {
  state.archiveSelectedDate = null;
  state.archiveMemo = null;
  state.archiveRevisions = [];
  state.archiveCheckpoints = [];
  $('#archiveMemoTitle').textContent = 'Night Memo History';
  $('#archiveMemoMeta').textContent = 'No historical memo selected.';
  $('#archiveRevisionList').innerHTML = '<span class="manager-history-empty">No saved Night Memos.</span>';
  $('#archiveMemoFrame').srcdoc = '<!doctype html><html><body style="font-family:Arial,sans-serif;padding:24px;color:#666">No historical Night Memo is available.</body></html>';
  $('#archiveUseAsDraftBtn').hidden = true;
  $('#archiveRecoveryDetails').hidden = true;
}

async function selectArchiveNight(reportingDate) {
  const requestId = ++state.archiveRequestId;
  state.archiveSelectedDate = reportingDate;
  renderArchiveSidebar();
  $('#archiveMemoTitle').textContent = `Night Memo · ${toDisplayDate(reportingDate)}`;
  $('#archiveMemoMeta').textContent = 'Loading saved versions…';
  $('#archiveRevisionList').innerHTML = '<span class="manager-history-empty">Loading…</span>';
  $('#archiveUseAsDraftBtn').hidden = true;

  const [memo, revisions, checkpoints] = await Promise.all([
    getManagerMemo(reportingDate),
    listManagerMemoRevisions(reportingDate),
    listManagerMemoCheckpoints(reportingDate),
  ]);
  if (requestId !== state.archiveRequestId) return;

  state.archiveMemo = memo;
  state.archiveRevisions = revisions;
  state.archiveCheckpoints = checkpoints;
  renderArchiveSidebar();
  renderArchiveRevisionList();
  renderArchiveCheckpoints();

  const preferred = revisions.find(row => row.revision_type === 'final') || revisions[0] || null;
  if (preferred) await selectArchiveRevision(preferred.id);
  else if (memo) selectArchiveRecovery();
  else renderEmptyArchive();
}

function renderArchiveRevisionList() {
  const host = $('#archiveRevisionList');
  const buttons = state.archiveRevisions.map(row => {
    const active = state.archiveSelectedKind === 'revision' && state.archiveSelectedId === row.id;
    const type = row.revision_type === 'final' ? 'Final' : 'Draft';
    return `<button type="button" class="manager-archive-revision ${row.revision_type === 'final' ? 'final' : ''}${active ? ' active' : ''}" data-archive-revision-id="${esc(row.id)}">${type} #${esc(row.revision_number)} · ${esc(formatRevisionStamp(row))}</button>`;
  });
  if (state.archiveMemo) {
    const active = state.archiveSelectedKind === 'recovery';
    buttons.push(`<button type="button" class="manager-archive-revision${active ? ' active' : ''}" data-archive-recovery="1">Recovery copy</button>`);
  }
  host.innerHTML = buttons.join('') || '<span class="manager-history-empty">No saved versions for this night.</span>';
}

function renderArchiveDocument(document, meta) {
  $('#archiveMemoMeta').textContent = meta;
  $('#archiveMemoFrame').srcdoc = renderManagerMemoPrintHtml(document || {});
}

async function selectArchiveRevision(revisionId) {
  let revision = state.archiveRevisions.find(row => row.id === revisionId) || null;
  if (!revision) revision = await getManagerMemoRevision(revisionId);
  if (!revision) return;
  state.archiveSelectedKind = 'revision';
  state.archiveSelectedId = revision.id;
  renderArchiveRevisionList();
  const type = revision.revision_type === 'final' ? 'Final' : 'Draft';
  const user = revision.created_by_label ? ` · ${revision.created_by_label}` : '';
  renderArchiveDocument(revision.document, `${type} #${revision.revision_number} · ${formatRevisionStamp(revision)}${user}`);
  const mayRestore = state.archiveSelectedDate === state.reportingDate;
  $('#archiveUseAsDraftBtn').hidden = !mayRestore;
  $('#archiveUseAsDraftBtn').textContent = `Use ${type} #${revision.revision_number} as Current Draft`;
}

function selectArchiveRecovery() {
  if (!state.archiveMemo) return;
  state.archiveSelectedKind = 'recovery';
  state.archiveSelectedId = state.archiveMemo.id;
  renderArchiveRevisionList();
  const stamp = state.archiveMemo.updated_at ? formatDateTime(state.archiveMemo.updated_at, 'en-GB') : '—';
  renderArchiveDocument(state.archiveMemo.document, `Recovery working copy · ${stamp}`);
  $('#archiveUseAsDraftBtn').hidden = true;
}

function renderArchiveCheckpoints() {
  const details = $('#archiveRecoveryDetails');
  const host = $('#archiveCheckpointList');
  if (!state.archiveCheckpoints.length) {
    details.hidden = true;
    host.innerHTML = '';
    return;
  }
  details.hidden = false;
  host.innerHTML = state.archiveCheckpoints.map(row => {
    const canRestore = state.archiveSelectedDate === state.reportingDate;
    return `<div class="manager-checkpoint">
      <div class="manager-checkpoint-meta"><strong>${esc(archiveReasonLabel(row.reason))}</strong><small>${esc(row.created_at ? formatDateTime(row.created_at, 'en-GB') : '—')}${row.created_by_label ? ` · ${esc(row.created_by_label)}` : ''}</small></div>
      <div class="history-actions"><button type="button" class="pill" data-checkpoint-action="view" data-checkpoint-id="${esc(row.id)}">View</button>${canRestore ? `<button type="button" class="pill" data-checkpoint-action="restore" data-checkpoint-id="${esc(row.id)}">Restore</button>` : ''}</div>
    </div>`;
  }).join('');
}

async function selectArchiveCheckpoint(checkpointId) {
  let checkpoint = state.archiveCheckpoints.find(row => row.id === checkpointId) || null;
  if (!checkpoint) checkpoint = await getManagerMemoCheckpoint(checkpointId);
  if (!checkpoint) return;
  state.archiveSelectedKind = 'checkpoint';
  state.archiveSelectedId = checkpoint.id;
  renderArchiveRevisionList();
  renderArchiveDocument(checkpoint.document, `Safety recovery · ${archiveReasonLabel(checkpoint.reason)} · ${checkpoint.created_at ? formatDateTime(checkpoint.created_at, 'en-GB') : '—'}`);
  const mayRestore = state.archiveSelectedDate === state.reportingDate;
  $('#archiveUseAsDraftBtn').hidden = !mayRestore;
  $('#archiveUseAsDraftBtn').textContent = 'Restore this Safety Recovery';
}

async function restoreSelectedArchiveAsDraft() {
  if (state.archiveSelectedDate !== state.reportingDate) return;
  if (state.archiveSelectedKind === 'revision') {
    const revision = state.archiveRevisions.find(row => row.id === state.archiveSelectedId) || await getManagerMemoRevision(state.archiveSelectedId);
    if (revision) await replaceCurrentDraftFromHistory(revision.document, revision.source_snapshot || [], `${revision.revision_type === 'final' ? 'Final' : 'Draft'} #${revision.revision_number}`, 'before_restore_history');
  } else if (state.archiveSelectedKind === 'checkpoint') {
    const checkpoint = state.archiveCheckpoints.find(row => row.id === state.archiveSelectedId) || await getManagerMemoCheckpoint(state.archiveSelectedId);
    if (checkpoint) await replaceCurrentDraftFromHistory(checkpoint.document, checkpoint.source_snapshot || [], 'safety recovery', 'before_restore_checkpoint');
  }
}

async function useCheckpointAsDraft(checkpointId) {
  if (state.archiveSelectedDate !== state.reportingDate) return;
  const checkpoint = state.archiveCheckpoints.find(row => row.id === checkpointId) || await getManagerMemoCheckpoint(checkpointId);
  if (!checkpoint) return;
  await replaceCurrentDraftFromHistory(checkpoint.document, checkpoint.source_snapshot || [], 'safety recovery', 'before_restore_checkpoint');
}

async function replaceCurrentDraftFromHistory(document, sourceSnapshot, label, checkpointReason) {
  if (!ensureReportingNightCurrent()) return;
  const ok = confirm(`Use this ${label} as the current working draft? Official Draft/Final history will remain unchanged, and the current working copy will be kept as a safety checkpoint.`);
  if (!ok) return;

  try {
    await flushRecovery();
    await checkpointCurrentWorkingCopy(checkpointReason);
  } catch (_) { return; }

  if (!state.memo) {
    state.memo = { reporting_date: state.reportingDate, revision: 0, status: 'draft' };
  }
  state.memo.document = cloneJson(document) || {};
  state.memo.source_snapshot = cloneJson(sourceSnapshot) || [];
  state.conflicted = false;
  state.lastOfficialType = null;
  state.editorOpen = true;
  state.dirty = false;
  state.editGeneration = state.savedGeneration;
  markDirty({ schedule: false });

  state.historyReturnMode = 'editor';
  exitHistoryMode();
  $('#memoWorkspacePanel').hidden = true;
  $('#editorArea').hidden = false;
  renderEditor({ keepDirty: true });
  await saveRecoveryNow({ force: true });
  renderSubmissionMonitor();
  setStatus(`Historical ${label} loaded into the working draft. Press Save to create a new Draft version.`, 'info');
}
function renderWardInfoTable(columns, rows, { className = '' } = {}) {
  if (!rows?.length) return '';
  return `<div class="ward-info-table-wrap ${esc(className)}"><table class="ward-source-table"><thead><tr>${columns.map(column => `<th>${esc(column.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(column => `<td>${esc(row[column.key] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function renderWardInfoSection(title, content, { wide = false } = {}) {
  return `<section class="ward-source-section${wide ? ' ward-info-wide' : ''}"><h2>${esc(title)}</h2>${content}</section>`;
}

function renderWardInformation() {
  const host = $('#wardInformationList');
  if (!host) return;
  const rows = buildManagerWardInformation({ wards: state.allWards, bundle: state.bundle, items: state.items });
  if (!rows.length) {
    host.innerHTML = '<div class="manager-empty-state">No active wards found.</div>';
    return;
  }

  host.innerHTML = rows.map(row => {
    const wardName = row.ward?.name || 'Ward';
    const submitted = row.submittedAt ? formatDateTime(row.submittedAt, 'en-GB') : 'Not submitted in current cycle';
    const noSubmission = !row.report;
    const unavailable = '<div class="ward-info-nil">No current Ward submission.</div>';

    const patientList = noSubmission
      ? unavailable
      : row.patientList.nil
        ? '<div class="ward-info-nil">Nil Special</div>'
        : renderWardInfoTable([
          { key: 'bed', label: 'Bed' },
          { key: 'name', label: 'Name' },
          { key: 'diagnosisConditionProgress', label: 'Diagnosis / Condition / Progress' },
        ], row.patientList.rows) || '<div class="ward-info-nil">No patient rows recorded.</div>';

    const consultation = noSubmission
      ? unavailable
      : row.consultation.nil
        ? '<div class="ward-info-nil">Nil Consultation</div>'
        : renderWardInfoTable([
          { key: 'bed', label: 'Bed' },
          { key: 'name', label: 'Name' },
          { key: 'pendingConsultation', label: 'Pending which subspecialty consultation' },
        ], row.consultation.rows) || '<div class="ward-info-nil">No consultation rows recorded.</div>';

    const intubation = noSubmission
      ? unavailable
      : row.intubation.nil
        ? '<div class="ward-info-nil">Nil Intubation</div>'
        : renderWardInfoTable([
          { key: 'bed', label: 'Bed' },
          { key: 'nameHospitalNumber', label: 'Name / Hospital No.' },
          { key: 'diagnosis', label: 'Diagnosis' },
          { key: 'reason', label: 'Reason' },
          { key: 'urgency', label: 'Elective / Emergency' },
          { key: 'byWhom', label: 'By Whom' },
          { key: 'location', label: 'Location' },
          { key: 'outcome', label: 'Patient Outcome' },
        ], row.intubation.rows, { className: 'intubation-table-wrap' }) || '<div class="ward-info-nil">No intubation rows recorded.</div>';

    const additional = noSubmission
      ? unavailable
      : row.additionalItems.length
        ? `<table class="ward-additional-table"><tbody>${row.additionalItems.map(item => `<tr><th>${esc(item.label)}</th><td>${esc(item.value || '—')}</td></tr>`).join('')}</tbody></table>`
        : '<div class="ward-info-nil">No configured Additional Report Items.</div>';

    return `<article class="ward-information-card${row.report ? '' : ' missing'}">
      <header class="ward-information-card-head">
        <div><strong>${esc(wardName)}</strong><span>${esc(submitted)}</span></div>
        ${row.report ? `<button type="button" class="pill ward-info-view-memo" data-ward-id="${esc(row.ward.id)}">View Ward Memo</button>` : ''}
      </header>
      <div class="ward-information-sections">
        ${renderWardInfoSection('Patient List', patientList)}
        ${renderWardInfoSection('Consultation', consultation)}
        ${renderWardInfoSection('Intubation', intubation, { wide: true })}
        ${renderWardInfoSection('Additional Report Items', additional, { wide: true })}
      </div>
    </article>`;
  }).join('');

  $$('.ward-info-view-memo', host).forEach(button => {
    button.onclick = () => openWardMemoPreview(button.dataset.wardId);
  });
}

async function getWardPrintModule() {
  if (!wardPrintModulePromise) wardPrintModulePromise = import('../ward-print.js');
  return wardPrintModulePromise;
}

async function openWardMemoPreview(wardId) {
  const entry = state.bundle.find(item => item.ward?.id === wardId);
  if (!entry?.report) return;
  const items = entry.report.report_item_snapshot?.length
    ? entry.report.report_item_snapshot.map(item => ({ ...item, __historical: true }))
    : state.items;
  const mod = await getWardPrintModule();
  const context = {
    ward: entry.ward,
    report: entry.report,
    capacity: entry.report.bed_capacity_snapshot ?? entry.capacity,
    items,
    settings: mod.loadWardPrintSettings(),
    logoUrl: new URL('../assets/heart-logo.png', import.meta.url).href,
  };
  state.wardPreviewContext = context;
  const submitted = reportSubmittedAt(entry.report);
  $('#wardMemoPreviewTitle').textContent = `${entry.ward.name} Ward Night Memo`;
  $('#wardMemoPreviewMeta').textContent = submitted ? `Submitted ${formatDateTime(submitted, 'en-GB')}` : 'Submitted Ward memo';
  $('#wardMemoPreviewModal').hidden = false;
  await mod.writeWardMemoToIframe($('#wardMemoPreviewFrame'), context);
}

async function printOpenWardMemo() {
  if (!state.wardPreviewContext) return;
  const mod = await getWardPrintModule();
  await mod.printWardMemo(state.wardPreviewContext);
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
