import { requireRole, signOut } from '../auth.js';
import { CONFIG } from '../config.js';
import {
  DB_MODE, getWardById, getWardCapacity, getWardStaff, saveWardStaff, setStaffActive,
  getRecentReports, getPreviousReport,
} from '../data/index.js';
import { qs, qsa, esc } from '../core/dom.js';
import { todayISO, toDisplayDate, fromDisplayDate, formatDateTime } from '../core/dates.js';
import { createRequestSequencer } from '../core/request-sequencer.js';
import { initWardTabs } from '../components/ward-tabs.js';
import {
  DIRECT_REPORT_KEYS, fullReportPayloadDefaults, normalizeReportPayload,
  normalizeDevice, formatDevice, formatDynamic,
} from '../domain/report-model.js';
import { wardRequiresPerBedGender } from '../domain/ward.js';
import { loadHistoricalReportContext, loadWardReportContext, loadWardSubmissionStatus, saveWardDraft, submitWardReport } from '../services/report-service.js';
import { SUBMISSION_WINDOW_MINUTES } from '../domain/report-session.js';

const $ = qs;
const $$ = qsa;
const loadRequests = createRequestSequencer();
const wardTabs = initWardTabs();
const INF_MAP = { iCRE: 'i_CRE', iVRE: 'i_VRE', iCOV: 'i_COVID', iMDR: 'i_MDRA', iCD: 'i_CD', iInf: 'i_Inf', iCA: 'i_CA' };
const DEV_MAP = { dMV: 'd_MV', dNIV: 'd_NIV', dHF: 'd_HFNC', dHD: 'd_HD', dCA: 'd_CAPD' };
const FALLBACK_WARD_PRINT_SETTINGS = Object.freeze({ topTitle: 19, topContent: 13, boxTitle: 15, boxContent: 12, lineHeader: 9, lineContent: 11, consHeader: 10, consContent: 10, intubHeader: 9, intubContent: 10, nurseTitle: 9, nurseContent: 11, sigContent: 11, infLabel: 12, infValue: 12, devLabel: 12, devValue: 12 });
const state = { access: null, ward: null, capacity: 0, items: [], allItems: [], staff: [], report: null, draft: null, submissionStatus: null, history: [], currentHist: null, operational: true, historyMode: false, staffMode: false, gdTab: null, gdPrev: null, loadedDate: null, dirty: false, saving: false, submitting: false };
let printModulePromise = null;
let nurseCounter = 0;
let pdfSettings = { ...FALLBACK_WARD_PRINT_SETTINGS };
let pdfDebounceTimer = null;

init().catch(error => { console.error(error); showStatus('error', error.message || String(error)); });

async function getPrintModule() {
  if (!printModulePromise) printModulePromise = import('../ward-print.js');
  return printModulePromise;
}

function setupSubmissionUi() {
  if (!document.querySelector('link[data-ward-submit-style]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../css/ward-draft-submit.css', import.meta.url).href;
    link.dataset.wardSubmitStyle = '1';
    document.head.append(link);
  }
  const bar = $('#normalBar');
  if (bar) {
    const saveButton = Array.from(bar.querySelectorAll('button')).find(button => /saveEntry\(\)/.test(button.getAttribute('onclick') || ''));
    if (saveButton) {
      saveButton.id = 'saveBtn';
      saveButton.textContent = 'Save';
      if (!$('#submitBtn')) {
        const submitButton = document.createElement('button');
        submitButton.className = 'pill submit-pill';
        submitButton.id = 'submitBtn';
        submitButton.type = 'button';
        submitButton.textContent = 'Submit';
        submitButton.addEventListener('click', submitEntry);
        saveButton.after(submitButton);
      }
    }
    Array.from(bar.querySelectorAll('button')).forEach(button => {
      if (/handleGen\(['"]download['"]\)/.test(button.getAttribute('onclick') || '')) button.remove();
    });
  }
  Array.from(document.querySelectorAll('#pdfSettingsModal button')).forEach(button => {
    if (/^save pdf$/i.test((button.textContent || '').trim())) button.remove();
  });
  if (!$('#submissionBanner')) {
    const banner = document.createElement('div');
    banner.id = 'submissionBanner';
    banner.className = 'submission-banner pending';
    banner.innerHTML = '<strong>Current memo cycle:</strong> Checking submission status...';
    const indicator = $('#liveIndicator');
    indicator?.insertAdjacentElement('afterend', banner);
  }
}

function isSubmissionCurrent(iso) {
  const when = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(when) && Date.now() - when <= SUBMISSION_WINDOW_MINUTES * 60_000;
}

function renderSubmissionBanner() {
  const banner = $('#submissionBanner');
  if (!banner) return;
  const last = state.submissionStatus?.last_submitted_at || null;
  const current = isSubmissionCurrent(last);
  banner.className = `submission-banner ${current ? 'submitted' : 'pending'}`;
  const draftNotice = state.draft ? ' · Draft changes pending re-submit' : '';
  if (current) {
    banner.innerHTML = `<strong>Current memo cycle: Submitted</strong><span>Last submitted ${esc(formatDateTime(last))}${draftNotice}</span>`;
  } else if (last) {
    banner.innerHTML = `<strong>Current memo cycle: Not submitted</strong><span>Last submission ${esc(formatDateTime(last))}</span>`;
  } else {
    banner.innerHTML = '<strong>Current memo cycle: Not submitted</strong><span>No previous submission found</span>';
  }
}

async function refreshSubmissionBanner() {
  try {
    state.submissionStatus = await loadWardSubmissionStatus(state.ward.id, SUBMISSION_WINDOW_MINUTES);
    renderSubmissionBanner();
  } catch (error) {
    console.error('Unable to load submission status', error);
    const banner = $('#submissionBanner');
    if (banner) {
      banner.className = 'submission-banner unknown';
      banner.innerHTML = '<strong>Submission status unavailable</strong><span>Use Submit to send the memo to Manager.</span>';
    }
  }
}

async function init() {
  state.access = await requireRole('ward');
  if (!state.access) return;
  setupSubmissionUi();
  state.ward = state.access.wards || await getWardById(state.access.ward_id);
  $('#wardFrom').textContent = state.ward.name;
  $('#wardContact').innerHTML = `Ext ${esc(state.ward.phone || '—')} &nbsp;&nbsp;&nbsp;<b>Fax:</b> Ext ${esc(state.ward.fax || '—')}`;
  $('#liveIndicator').textContent = DB_MODE === 'demo' ? 'Local demo mode' : 'Supabase live';
  $('#memoDate').value = todayISO();
  $('#memoDate').addEventListener('change', handleDateChange);
  $('#logoutBtn').addEventListener('click', signOut);
  $('#sigName').addEventListener('input', () => autofillSignature($('#sigName').value));
  $('#gdOverlay').addEventListener('click', event => { if (event.target.id === 'gdOverlay') gdClose(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { gdClose(); closePdfSettings(); } });
  document.addEventListener('click', event => { if (!event.target.closest('.bed-w')) $$('.bed-dd.show').forEach(x => x.classList.remove('show')); });
  $('#formWrap').addEventListener('input', markDirty);
  $('#formWrap').addEventListener('change', markDirty);
  document.addEventListener('ward-main-tab-selected', () => { state.historyMode = false; state.staffMode = false; });
  window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
  await loadForDate($('#memoDate').value);
  await refreshSubmissionBanner();
  setInterval(renderSubmissionBanner, 60_000);
}

function markDirty() { if (state.loadedDate) state.dirty = true; }

async function handleDateChange() {
  const next = $('#memoDate').value;
  if (state.dirty && state.loadedDate && next !== state.loadedDate && !confirm('You have unsaved changes. Discard them and load the selected date?')) {
    $('#memoDate').value = state.loadedDate;
    return;
  }
  await loadForDate(next);
}

function showStatus(type, msg) {
  const box = $('#statusBox');
  if (!box) return;
  box.className = type || 'loading';
  box.textContent = msg;
  box.style.display = 'block';
  clearTimeout(showStatus._t);
  if (type !== 'loading') showStatus._t = setTimeout(() => { box.style.display = 'none'; }, 4500);
}

function itemByKey(key) { return state.items.find(i => i.key === key); }
function optionsOf(item) { return Array.isArray(item?.options) ? item.options : []; }
function bedCeiling() { return Math.max(60, Number(state.capacity) || 0); }
function formatAppt(value) { if (!value) return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return toDisplayDate(value); return value; }
function apptToISO(value) { const s = String(value || '').trim(); if (!s) return null; if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; return fromDisplayDate(s); }

async function loadForDate(date) {
  if (!date) return;
  const requestId = loadRequests.begin();
  showStatus('loading', 'Loading ward data...');
  disableSave(true);
  try {
    const result = await loadWardReportContext(state.ward.id, date);
    if (!loadRequests.isCurrent(requestId)) return;
    Object.assign(state, result, { loadedDate: date, dirty: false });
    buildControls();
    fillPayload(result.draft?.payload || result.report?.payload || fullReportPayloadDefaults());
    renderStaffDataLists();
    if (!state.operational) showStatus('error', `${state.ward.name} is not operational on ${toDisplayDate(date)}. Saving is disabled for this date.`);
    else if (state.draft) showStatus('success', `Loaded saved draft for ${toDisplayDate(date)}. This draft has not been submitted.`);
    else if (state.report) showStatus('success', `Loaded current-cycle submitted memo for ${toDisplayDate(date)}.`);
    else showStatus('success', `Ready for ${toDisplayDate(date)}. Previous submissions are available through Get Data or History.`);
  } catch (error) {
    if (!loadRequests.isCurrent(requestId)) return;
    showStatus('error', error.message || String(error));
  } finally {
    if (loadRequests.isCurrent(requestId)) disableSave(false);
  }
}

function disableSave(on) {
  const disabled = on || state.saving || state.submitting || !state.operational;
  if ($('#saveBtn')) $('#saveBtn').disabled = disabled;
  if ($('#submitBtn')) $('#submitBtn').disabled = disabled;
}

function buildControls() {
  DIRECT_REPORT_KEYS.slice(0, 6).forEach(key => populateSelect(key, itemByKey(key)));
  Object.entries(INF_MAP).forEach(([key, id]) => makeBedWidget(id, key));
  Object.entries(DEV_MAP).forEach(([key, id]) => makeDeviceWidget(id, key));
  renderDynamicItems();
  updateEmptyBedMode();
}

function populateSelect(id, item) {
  const el = $(`#${id}`);
  if (!el) return;
  const old = el.value;
  const opts = optionsOf(item).length ? optionsOf(item) : Array.from({ length: 31 }, (_, i) => String(i));
  el.innerHTML = opts.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if (opts.includes(old)) el.value = old;
}

function makeBedWidget(containerId, key) {
  const host = document.getElementById(containerId);
  if (!host) return;
  host.innerHTML = `<div class="bed-w" data-bed-key="${esc(key)}"><div class="bed-b" data-bed-btn><span class="bc" data-bed-summary>None</span><span style="font-size:10px;color:#888">&#9660;</span></div><div class="bed-dd" data-bed-dd></div></div>`;
  const wrap = $('[data-bed-key]', host), dd = $('[data-bed-dd]', wrap), btn = $('[data-bed-btn]', wrap);
  for (let i = 1; i <= bedCeiling(); i += 1) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${i}"> ${i}`;
    dd.append(label);
    $('input', label).addEventListener('change', () => { updateBedSummary(wrap); markDirty(); });
  }
  btn.addEventListener('click', event => {
    event.stopPropagation();
    $$('.bed-dd.show').forEach(x => { if (x !== dd) x.classList.remove('show'); });
    dd.classList.toggle('show');
  });
  dd.addEventListener('click', event => event.stopPropagation());
  updateBedSummary(wrap);
}

function bedWrap(key) { return $(`[data-bed-key="${CSS.escape(key)}"]`); }
function getBeds(key) { const wrap = bedWrap(key); return wrap ? $$('input[type=checkbox]:checked', wrap).map(x => x.value) : []; }
function setBeds(key, beds = []) { const wrap = bedWrap(key); if (!wrap) return; const selected = new Set((beds || []).map(String)); $$('input[type=checkbox]', wrap).forEach(x => { x.checked = selected.has(x.value); }); updateBedSummary(wrap); }
function updateBedSummary(wrap) { const beds = $$('input[type=checkbox]:checked', wrap).map(x => x.value); const summary = $('[data-bed-summary]', wrap); summary.innerHTML = beds.length ? `${beds.map(v => `<span class="bch">${esc(v)}</span>`).join('')}<span class="bch-cnt">${beds.length}</span>` : 'None'; }

function makeDeviceWidget(containerId, key) {
  const host = document.getElementById(containerId);
  if (!host) return;
  host.innerHTML = `<div class="dev-wrap" data-dev-key="${esc(key)}"><div class="dev-tog"><button class="dev-tog-btn active" type="button" data-mode="beds">By Bed</button><button class="dev-tog-btn" type="button" data-mode="count">By Count</button></div><div data-dev-beds id="devbeds_${esc(key)}"></div><div class="dev-cnt-sec" data-dev-count-wrap style="display:none"><input type="number" min="0" placeholder="0" class="dev-cnt-inp" data-dev-count><span style="font-size:0.9rem;color:#555">patients</span></div></div>`;
  const wrap = $('[data-dev-key]', host);
  makeBedWidget(`devbeds_${key}`, `${key}__beds`);
  $$('[data-mode]', wrap).forEach(button => button.addEventListener('click', () => { setDeviceMode(key, button.dataset.mode); markDirty(); }));
}

function devWrap(key) { return $(`[data-dev-key="${CSS.escape(key)}"]`); }
function setDeviceMode(key, mode) { const wrap = devWrap(key); if (!wrap) return; const bedMode = mode !== 'count'; $$('[data-mode]', wrap).forEach(b => b.classList.toggle('active', b.dataset.mode === (bedMode ? 'beds' : 'count'))); $('[data-dev-beds]', wrap).style.display = bedMode ? '' : 'none'; $('[data-dev-count-wrap]', wrap).style.display = bedMode ? 'none' : ''; wrap.dataset.mode = bedMode ? 'beds' : 'count'; }
function getDeviceValue(key) { const wrap = devWrap(key); if (!wrap) return normalizeDevice(null); if (wrap.dataset.mode === 'count') return normalizeDevice({ mode: 'count', count: $('[data-dev-count]', wrap).value }); return normalizeDevice(getBeds(`${key}__beds`)); }
function setDeviceValue(key, value) { const wrap = devWrap(key); if (!wrap) return; const device = normalizeDevice(value); setDeviceMode(key, device.mode); if (device.mode === 'count') $('[data-dev-count]', wrap).value = device.count || 0; else setBeds(`${key}__beds`, device.beds); }

function renderDynamicItems() {
  const dynamic = state.items.filter(i => !i.builtin);
  const admission = dynamic.filter(i => i.section === 'admission' || i.section === 'bedcount');
  const infection = dynamic.filter(i => i.section === 'infection');
  const devices = dynamic.filter(i => i.section === 'devices');
  const additional = dynamic.filter(i => !['admission', 'bedcount', 'infection', 'devices'].includes(i.section));

  $('#dynamicAdmissionRows').innerHTML = admission.map(dynamicRowHtml).join('');
  $('#customInfRows').innerHTML = infection.map(dynamicRowHtml).join('');
  $('#customDevRows').innerHTML = devices.map(dynamicRowHtml).join('');
  $('#dynamicAdditionalRows').innerHTML = additional.map(dynamicRowHtml).join('');
  $('#dynamicAdditionalWrap').classList.toggle('hidden', additional.length === 0);

  dynamic.forEach(i => {
    if (i.input_type === 'bed_chooser') makeBedWidget(`dyn_host_${i.key}`, `dyn_${i.key}`);
    if (i.input_type === 'bed_or_count') makeDeviceWidget(`dyn_host_${i.key}`, `dyn_${i.key}`);
  });
}

function dynamicRowHtml(item) {
  let control = '';
  if (item.input_type === 'dropdown') control = `<select id="dyn_${esc(item.key)}">${optionsOf(item).map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select>`;
  else if (item.input_type === 'checkbox') control = `<label class="dynamic-check"><input type="checkbox" id="dyn_${esc(item.key)}"> Yes</label>`;
  else if (item.input_type === 'bed_chooser' || item.input_type === 'bed_or_count') control = `<span id="dyn_host_${esc(item.key)}"></span>`;
  else if (item.input_type === 'number') control = `<input type="number" id="dyn_${esc(item.key)}">`;
  else control = `<input type="text" id="dyn_${esc(item.key)}" class="w280">`;
  return `<div class="fr dynamic-report-row"><span class="fl">${esc(item.label)}:</span><span class="fc">${control}</span></div>`;
}

function setDynamicValue(item, value) { if (item.input_type === 'bed_chooser') setBeds(`dyn_${item.key}`, Array.isArray(value) ? value : []); else if (item.input_type === 'bed_or_count') setDeviceValue(`dyn_${item.key}`, value); else { const el = $(`#dyn_${CSS.escape(item.key)}`); if (!el) return; if (item.input_type === 'checkbox') el.checked = !!value; else el.value = value ?? ''; } }
function getDynamicValue(item) { if (item.input_type === 'bed_chooser') return getBeds(`dyn_${item.key}`); if (item.input_type === 'bed_or_count') return getDeviceValue(`dyn_${item.key}`); const el = $(`#dyn_${CSS.escape(item.key)}`); if (!el) return null; return item.input_type === 'checkbox' ? el.checked : el.value; }
function updateEmptyBedMode() { const mode = state.ward.empty_bed_gender_mode || 'male'; $('#emptyBedLabel').textContent = mode === 'female' ? 'Empty Bed F:' : mode === 'male' ? 'Empty Bed M:' : 'Empty Bed:'; $('#emptyDetailBlock').classList.toggle('hidden', !wardRequiresPerBedGender(state.ward)); calcEmpty(); }
function calcEmpty() { const total = Number($('#totalPatientM').value) || 0; const count = Math.max(0, (Number(state.capacity) || 0) - total); $('#emptyBedM').textContent = String(count); $('#emptyBedFormula').textContent = `(${state.capacity} - Total)`; return count; }
function addEmptyDetail(value = {}) { const row = document.createElement('div'); row.className = 'empty-detail-row'; const mixed = wardRequiresPerBedGender(state.ward); row.innerHTML = `<input type="text" data-empty-location style="width:120px" placeholder="Bed / location" value="${esc(value.location || '')}">${mixed ? '<select data-empty-gender><option value="">--</option><option value="M">Male</option><option value="F">Female</option></select>' : ''}<input type="text" data-empty-remark style="width:260px" placeholder="Remark" value="${esc(value.remark || '')}"><button class="btn-x" type="button">x</button>`; if (mixed && value.gender) $('[data-empty-gender]', row).value = value.gender; $('.btn-x', row).onclick = () => { row.remove(); markDirty(); }; $('#emptyDetailRows').append(row); $('#emptyDetailBlock').classList.remove('hidden'); markDirty(); }
function collectEmptyDetails() { return $$('.empty-detail-row', $('#emptyDetailRows')).map(row => ({ location: $('[data-empty-location]', row)?.value.trim() || '', gender: $('[data-empty-gender]', row)?.value || null, remark: $('[data-empty-remark]', row)?.value.trim() || '' })).filter(x => x.location || x.gender || x.remark); }
function addEB(bed = '', dest = '') { const row = document.createElement('div'); row.className = 'fr'; row.style.marginBottom = '4px'; let options = '<option value="">--</option>'; for (let i = 1; i <= bedCeiling(); i += 1) options += `<option value="${i}" ${String(bed) === String(i) ? 'selected' : ''}>${i}</option>`; row.innerHTML = `<select class="eB" style="width:70px">${options}</select><span style="padding:0 8px;font-size:1rem;font-weight:700">--&gt;</span><input type="text" class="eD" style="width:150px" placeholder="e.g. KH3A" value="${esc(dest || '')}"><button class="btn-x" type="button" style="margin-left:6px">x</button>`; $('.btn-x', row).onclick = () => { row.remove(); markDirty(); }; $('#ebRows').append(row); }
function addPt(b = '', n = '', dx = '') { addTableRow('#ptBody', [b, n, dx], ['Bed', 'Name', 'Dx/Condition']); }
function addCs(b = '', n = '', pending = '') { addTableRow('#csBody', [b, n, pending], ['Bed', 'Name', 'Pending which subspecialty consultation']); }
function addTableRow(target, values, placeholders) { const row = document.createElement('tr'); row.innerHTML = values.map((value, i) => `<td><input placeholder="${esc(placeholders[i])}" value="${esc(value || '')}"></td>`).join('') + '<td><button class="btn-x" type="button">x</button></td>'; $('.btn-x', row).onclick = () => { row.remove(); markDirty(); }; $(target).append(row); }
function addIt(cols = ['', '', '', '', '', '', '', '']) { const row = document.createElement('tr'); row.innerHTML = `<td><input placeholder="Bed" value="${esc(cols[0] || '')}"></td><td><input placeholder="Name & Hosp No" value="${esc(cols[1] || '')}"></td><td><input placeholder="Diagnosis" value="${esc(cols[2] || '')}"></td><td><input placeholder="Reason" value="${esc(cols[3] || '')}"></td><td><select><option value="">--</option><option value="Elective">Elective</option><option value="Emergency">Emergency</option></select></td><td><input placeholder="e.g. Anaes / Parent team" value="${esc(cols[5] || '')}"></td><td><input placeholder="e.g. Intubation Rm / Cubicle" value="${esc(cols[6] || '')}"></td><td><input placeholder="e.g. To ICU/G6/G10 / Stay in ward / death" value="${esc(cols[7] || '')}"></td><td><button class="btn-x" type="button">x</button></td>`; $('select', row).value = cols[4] || ''; $('.btn-x', row).onclick = () => { row.remove(); markDirty(); }; $('#itBody').append(row); }
function addNR(opts = {}) { nurseCounter += 1; const row = document.createElement('div'); row.className = 'nr'; const id = `nr_${nurseCounter}`; row.innerHTML = `<span class="nr-num">${$('#nrRows').children.length + 1}.</span><select class="nR" style="width:120px"><option>RN</option><option>EN</option><option>APN</option><option>Student Nurse</option></select><input type="text" class="nN" list="${id}_list" style="width:220px" placeholder="Name" value="${esc(opts.name || '')}"><datalist id="${id}_list"></datalist><input type="text" class="nA" style="width:90px" placeholder="Appt" value="${esc(opts.appt || '')}"><label class="ctl"><input type="checkbox" class="nRu" ${opts.runner ? 'checked' : ''}> Night Runner</label><button class="btn-x" type="button">x</button>`; $('.nR', row).value = opts.role || 'RN'; $('.nN', row).dataset.source = opts.source || 'free_text'; $('.nN', row).dataset.staffId = opts.staffId || ''; $('.btn-x', row).onclick = () => { row.remove(); renumberNurses(); markDirty(); }; $('.nR', row).onchange = () => populateNurseDatalist(row); $('.nN', row).oninput = () => autofillNurse(row); $('#nrRows').append(row); populateNurseDatalist(row); }
function renumberNurses() { $$('.nr', $('#nrRows')).forEach((row, i) => { $('.nr-num', row).textContent = `${i + 1}.`; }); }
function populateNurseDatalist(row) { const role = $('.nR', row).value; $('datalist', row).innerHTML = state.staff.filter(s => s.role === role).map(s => `<option value="${esc(s.name)}"></option>`).join(''); }
function autofillNurse(row) { const name = $('.nN', row), role = $('.nR', row).value, staff = state.staff.find(x => x.role === role && x.name.toLowerCase() === name.value.trim().toLowerCase()); if (staff) { $('.nA', row).value = formatAppt(staff.appointment_date); name.dataset.source = 'ward_staff'; name.dataset.staffId = staff.id; } else { name.dataset.source = 'free_text'; name.dataset.staffId = ''; } }
function renderStaffDataLists() { $('#signatureStaffList').innerHTML = state.staff.map(s => `<option value="${esc(s.name)}"></option>`).join(''); $$('.nr', $('#nrRows')).forEach(populateNurseDatalist); }
function autofillSignature(name) { const staff = state.staff.find(x => x.name.toLowerCase() === String(name || '').trim().toLowerCase()); if (staff) { $('#sigRank').value = staff.role; $('#sigAppt').value = formatAppt(staff.appointment_date); } }
function toggleNil() { $('#patientEntryArea').classList.toggle('disabled', $('#nilCb').checked); }
function toggleNilConsult() { $('#consultEntryArea').classList.toggle('disabled', $('#nilConsultCb').checked); }
function toggleNilIntub() { $('#intubEntryArea').classList.toggle('disabled', $('#nilIntubCb').checked); }

function fillPayload(raw) {
  const D = normalizeReportPayload(raw);
  state.dirty = false;
  DIRECT_REPORT_KEYS.forEach(key => { if ($(`#${key}`)) $(`#${key}`).value = D[key] ?? (key === 'totalPatientM' ? '' : '0'); });
  Object.keys(INF_MAP).forEach(key => setBeds(key, D.infBeds?.[key] || []));
  Object.keys(DEV_MAP).forEach(key => setDeviceValue(key, D.devBeds?.[key]));
  state.items.filter(i => !i.builtin).forEach(i => setDynamicValue(i, D.dynamicItems?.[i.key]));
  $('#emptyDetailRows').innerHTML = '';
  (D.emptyBeds?.details || []).forEach(addEmptyDetail);
  $('#ebRows').innerHTML = '';
  (D.earlyBirds || []).forEach(x => addEB(x.bed, x.dest));
  if (!D.earlyBirds.length) addEB();
  $('#nilCb').checked = !!D.nilSpecial;
  $('#ptBody').innerHTML = '';
  D.patients.forEach(r => addPt(r[0], r[1], r[2]));
  if (!D.patients.length) addPt();
  $('#nilConsultCb').checked = !!D.nilConsultation;
  $('#csBody').innerHTML = '';
  D.consultations.forEach(r => addCs(r[0], r[1], r[2]));
  if (!D.consultations.length) addCs();
  $('#nilIntubCb').checked = !!D.nilIntubation;
  $('#itBody').innerHTML = '';
  D.intubations.forEach(addIt);
  if (!D.intubations.length) addIt();
  $('#nrRows').innerHTML = '';
  D.nurses.forEach(addNR);
  if (!D.nurses.length) addNR();
  $('#staffAM').value = D.staffAM || '';
  $('#staffPM').value = D.staffPM || '';
  $('#sigRank').value = D.sigRank || 'RN';
  $('#sigName').value = D.sigName || '';
  $('#sigAppt').value = D.sigAppt || '';
  toggleNil();
  toggleNilConsult();
  toggleNilIntub();
  calcEmpty();
  state.dirty = false;
}

function collectTableRows(tbody, count) { return $$('tr', $(tbody)).map(row => $$('input,select', row).slice(0, count).map(x => x.value.trim())).filter(row => row.some(Boolean)); }

function collectPayload() {
  const D = fullReportPayloadDefaults();
  D.infBeds = {};
  D.devBeds = {};
  D.dynamicItems = {};
  DIRECT_REPORT_KEYS.forEach(key => { D[key] = $(`#${key}`)?.value ?? ''; });
  Object.keys(INF_MAP).forEach(key => { D.infBeds[key] = getBeds(key); });
  Object.keys(DEV_MAP).forEach(key => { D.devBeds[key] = getDeviceValue(key); });
  state.items.filter(i => !i.builtin).forEach(i => { D.dynamicItems[i.key] = getDynamicValue(i); });
  D.emptyBeds = { count: calcEmpty(), details: collectEmptyDetails() };
  D.earlyBirds = $$('#ebRows>.fr').map(row => ({ bed: $('.eB', row).value, dest: $('.eD', row).value.trim() })).filter(x => x.bed || x.dest);
  D.nilSpecial = $('#nilCb').checked;
  D.patients = D.nilSpecial ? [] : collectTableRows('#ptBody', 3);
  D.nilConsultation = $('#nilConsultCb').checked;
  D.consultations = D.nilConsultation ? [] : collectTableRows('#csBody', 3);
  D.nilIntubation = $('#nilIntubCb').checked;
  D.intubations = D.nilIntubation ? [] : collectTableRows('#itBody', 8);
  D.nurses = $$('.nr', $('#nrRows')).map(row => { const name = $('.nN', row); return { role: $('.nR', row).value, name: name.value.trim(), appt: $('.nA', row).value.trim(), runner: $('.nRu', row).checked, source: name.dataset.source || 'free_text', staffId: name.dataset.staffId || null }; }).filter(x => x.name);
  D.staffAM = $('#staffAM').value.trim();
  D.staffPM = $('#staffPM').value.trim();
  D.sigRank = $('#sigRank').value;
  D.sigName = $('#sigName').value.trim();
  D.sigAppt = $('#sigAppt').value.trim();
  return D;
}

async function saveEntry() {
  if (state.saving || state.submitting) return null;
  if (!state.operational) { showStatus('error', 'This ward is not operational on the selected date.'); return null; }
  const date = $('#memoDate').value;
  if (!date || date !== state.loadedDate) { showStatus('error', 'Wait for the selected date to finish loading before saving.'); return null; }
  state.saving = true;
  disableSave(true);
  showStatus('loading', 'Saving draft...');
  try {
    const { draft, warnings } = await saveWardDraft({
      wardId: state.ward.id,
      date,
      editedPayload: collectPayload(),
      existingReport: state.report,
      existingDraft: state.draft,
      capacity: state.capacity,
      items: state.items,
    });
    state.draft = draft;
    state.dirty = false;
    renderSubmissionBanner();
    showStatus(warnings.length ? 'warning' : 'success', warnings.length ? `Draft saved with warning: ${warnings.join(' ')}` : 'Draft saved. It has NOT been submitted to Manager.');
    return draft;
  } catch (error) {
    showStatus('error', error.message || String(error));
    return null;
  } finally {
    state.saving = false;
    disableSave(false);
  }
}

async function submitEntry() {
  if (state.saving || state.submitting) return null;
  if (!state.operational) { showStatus('error', 'This ward is not operational on the selected date.'); return null; }
  const date = $('#memoDate').value;
  if (!date || date !== state.loadedDate) { showStatus('error', 'Wait for the selected date to finish loading before submitting.'); return null; }
  if (!confirm('Submit this memo to Manager now? Saved drafts are not visible to Manager until you submit.')) return null;
  state.submitting = true;
  disableSave(true);
  showStatus('loading', 'Submitting memo...');
  try {
    const { report, warnings } = await submitWardReport({
      wardId: state.ward.id,
      date,
      editedPayload: collectPayload(),
      existingReport: state.report,
      existingDraft: state.draft,
      capacity: state.capacity,
      items: state.items,
    });
    state.report = report;
    state.draft = null;
    state.dirty = false;
    await Promise.all([refreshHistory(), refreshSubmissionBanner()]);
    const submittedAt = report?.submitted_at || report?.updated_at;
    const successText = submittedAt ? `Submitted successfully at ${formatDateTime(submittedAt)}.` : 'Submitted successfully.';
    showStatus(warnings.length ? 'warning' : 'success', warnings.length ? `${successText} Warning: ${warnings.join(' ')}` : successText);
    return report;
  } catch (error) {
    showStatus('error', error.message || String(error));
    return null;
  } finally {
    state.submitting = false;
    disableSave(false);
  }
}

async function refreshHistory() {
  state.history = await getRecentReports(state.ward.id, CONFIG.RECENT_HISTORY_LIMIT);
  const host = $('#histEntryList');
  if (!state.history.length) {
    host.innerHTML = '<div id="histEmpty">No saved entries yet.</div>';
    return;
  }
  host.innerHTML = '';
  state.history.forEach(report => {
    const entry = document.createElement('div');
    entry.className = 'hist-entry' + (state.currentHist?.id === report.id ? ' selected' : '');
    entry.innerHTML = `<div class="he-body"><span class="he-date">${esc(toDisplayDate(report.report_date))}</span><span class="he-sub">${esc(report.updated_at ? formatDateTime(report.updated_at) : '')}</span></div><button class="he-del" title="Historical deletion is disabled">x</button>`;
    $('.he-body', entry).onclick = () => openHistory(report);
    $('.he-del', entry).onclick = event => { event.stopPropagation(); showStatus('error', 'Historical report deletion is disabled in the Supabase version.'); };
    host.append(entry);
  });
}

async function openHistory(report) {
  state.currentHist = report;
  state.historyMode = true;
  state.staffMode = false;
  $('#formWrap').classList.add('hidden');
  $('#staffListWrap').classList.remove('open');
  $('#histIdle').classList.remove('show');
  $('#histDetailWrap').classList.add('open');
  wardTabs.setMainLocked(true);
  $('#normalBar').style.display = 'none';
  $('#staffBar').classList.remove('show');
  $('#histBar').classList.add('show');
  $('#hbReprint').disabled = false;
  $('#hbDelete').disabled = true;
  $('#histViewLabel').textContent = `Viewing: ${toDisplayDate(report.report_date)}`;
  $('#histViewSavedAt').textContent = report.updated_at ? `Saved ${formatDateTime(report.updated_at)}` : '';
  const context = await loadHistoricalReportContext(state.ward.id, report);
  renderHistorySections(report, context.items, context.capacity);
  await refreshHistory();
}

function dynamicRows(items, payload, predicate) {
  return items
    .filter(i => !i.builtin && predicate(i))
    .map(i => roFr(`${i.label}:`, formatDynamic(payload.dynamicItems?.[i.key])))
    .join('');
}

function renderHistorySections(report, items, capacity) {
  const D = normalizeReportPayload(report.payload);
  const cap = report.bed_capacity_snapshot ?? capacity ?? state.capacity;
  const empty = report.payload?.emptyBeds && typeof report.payload.emptyBeds === 'object'
    ? D.emptyBeds
    : { count: Math.max(0, cap - Number(D.totalPatientM || 0)), details: [] };

  const admissionDynamic = dynamicRows(items, D, i => i.section === 'admission' || i.section === 'bedcount');
  $('#hd0').innerHTML = `<div class="ro-wrap"><div class="ro-sec-title">Admission / Discharge / Death</div>${roFr('Admission E/C:', D.admissionEC)}${roFr('Admission C/C:', D.admissionCC)}${roFr('Discharge:', D.discharge)}${roFr('Death:', D.death)}${roFr('T/I Gen:', D.transferIn)}${roFr('T/O Gen:', D.transferOut)}${roFr('Total Patient:', D.totalPatientM)}${roFr('Empty Bed:', empty.count)}${roFr('Early Bird(s):', D.earlyBirds.map(x => `${x.bed || '?'} -> ${x.dest || '?'}`).join(' | ') || 'None')}${admissionDynamic}</div>`;

  const infBuiltin = items.filter(i => i.section === 'infection' && i.builtin).map(i => roFr(`${i.label}:`, D.infBeds?.[i.key] || [])).join('');
  const infDynamic = dynamicRows(items, D, i => i.section === 'infection');
  const devBuiltin = items.filter(i => i.section === 'devices' && i.builtin).map(i => roFr(`${i.label}:`, formatDevice(D.devBeds?.[i.key]))).join('');
  const devDynamic = dynamicRows(items, D, i => i.section === 'devices');
  const additional = dynamicRows(items, D, i => !['admission', 'bedcount', 'infection', 'devices'].includes(i.section));
  $('#hd1').innerHTML = `<div class="ro-wrap"><div class="ro-sec-title">Infection Control</div>${infBuiltin}${infDynamic}<div class="ro-sec-title">Devices</div>${devBuiltin}${devDynamic}${additional ? `<div class="ro-sec-title">Additional Report Items</div>${additional}` : ''}</div>`;

  $('#hd2').innerHTML = D.nilSpecial
    ? '<div class="ro-wrap"><div class="ro-sec-title">Patient List</div><div class="ro-nil">Nil Special</div></div>'
    : `<div class="ro-wrap"><div class="ro-sec-title">Patient List</div>${roTable(['Bed', 'Name', 'Diagnosis / Condition / Progress'], D.patients)}</div>`;

  $('#hd3').innerHTML = `<div class="ro-wrap"><div class="ro-sec-title">Subspecialty Consultation</div>${D.nilConsultation ? '<div class="ro-nil">Nil Consultation</div>' : roTable(['Bed', 'Name', 'Pending consultation'], D.consultations)}<div class="ro-sec-title">Intubation Record</div>${D.nilIntubation ? '<div class="ro-nil">Nil Intubation</div>' : roTable(['Bed', 'Name / Hosp No.', 'Diagnosis', 'Reason', 'Elective / Emergency', 'By Whom', 'Location', 'Outcome'], D.intubations)}</div>`;

  $('#hd4').innerHTML = `<div class="ro-wrap"><div class="ro-sec-title">Night Nurse</div>${D.nurses.map((n, i) => `<p style="font-size:.92rem;margin-bottom:4px;padding:3px 0;border-bottom:1px solid #E0E0D8;color:#333">${i + 1}. ${esc(n.role || '')} ${esc(n.name || '')}${n.appt ? ` (${esc(n.appt)})` : ''}${n.runner ? ' [Night Runner]' : ''}</p>`).join('') || '<p style="color:#999">No nurses recorded.</p>'}${roFr('AM Duty Staff:', D.staffAM)}${roFr('PM Duty Staff:', D.staffPM)}${roFr('Signature:', `${D.sigRank || ''} ${D.sigName || ''}`.trim())}${roFr('Appointment:', D.sigAppt)}</div>`;
}

function roFr(label, value) { const v = Array.isArray(value) ? (value.length ? value.map(x => `<span class="ro-bch">${esc(x)}</span>`).join('') : 'Nil') : esc(value ?? ''); return `<div class="ro-fr"><span class="ro-fl">${esc(label)}</span><span class="ro-fc">${v || '—'}</span></div>`; }
function roTable(headers, rows) { return `<table class="ro-tbl"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${(rows || []).map(row => `<tr>${headers.map((_, i) => `<td>${esc(row[i] || '')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length}">No entries</td></tr>`}</tbody></table>`; }
function setFormMode() {
  state.historyMode = false;
  state.staffMode = false;
  $('#histSidebar').classList.remove('open');
  $('#histDetailWrap').classList.remove('open');
  $('#histIdle').classList.remove('show');
  $('#staffListWrap').classList.remove('open');
  $('#formWrap').classList.remove('hidden');
  wardTabs.setMainLocked(false);
  $('#histBar').classList.remove('show');
  $('#staffBar').classList.remove('show');
  $('#normalBar').style.display = 'flex';
  wardTabs.focusActiveMain();
}

async function toggleHistory() {
  if (state.historyMode) return setFormMode();
  state.historyMode = true;
  state.staffMode = false;
  $('#histSidebar').classList.add('open');
  $('#formWrap').classList.add('hidden');
  $('#staffListWrap').classList.remove('open');
  $('#histDetailWrap').classList.remove('open');
  $('#histIdle').classList.add('show');
  wardTabs.setMainLocked(true);
  $('#normalBar').style.display = 'none';
  $('#staffBar').classList.remove('show');
  $('#histBar').classList.add('show');
  $('#hbReprint').disabled = true;
  $('#hbDelete').disabled = true;
  $('#historyCancelBtn')?.focus();
  await refreshHistory();
}

async function toggleStaffList() {
  if (state.staffMode) return setFormMode();
  state.staffMode = true;
  state.historyMode = false;
  $('#histSidebar').classList.remove('open');
  $('#formWrap').classList.add('hidden');
  $('#histDetailWrap').classList.remove('open');
  $('#histIdle').classList.remove('show');
  $('#staffListWrap').classList.add('open');
  wardTabs.setMainLocked(true);
  $('#normalBar').style.display = 'none';
  $('#histBar').classList.remove('show');
  $('#staffBar').classList.add('show');
  $('#staffCloseBtn')?.focus();
  await renderStaffList();
}
async function renderStaffList() { state.staff = await getWardStaff(state.ward.id, false); const body = $('#staffListBody'); body.innerHTML = ''; state.staff.forEach(appendStaffRow); renderStaffDataLists(); }
function appendStaffRow(staff = { role: 'RN', name: '', appointment_date: '', active: true }) { const row = document.createElement('tr'); row.dataset.id = staff.id || ''; row.innerHTML = `<td><select class="staffRole"><option>RN</option><option>EN</option><option>APN</option><option>Student Nurse</option></select></td><td><input class="staffName" value="${esc(staff.name || '')}"></td><td><input class="staffAppt" placeholder="dd/mm/yyyy" value="${esc(formatAppt(staff.appointment_date))}"></td><td><button class="btn-x" type="button">x</button></td>`; $('.staffRole', row).value = staff.role || 'RN'; ['.staffRole', '.staffName', '.staffAppt'].forEach(sel => $(sel, row).addEventListener('change', () => saveStaffRow(row))); $('.btn-x', row).onclick = async () => { if (!row.dataset.id) return row.remove(); await setStaffActive(row.dataset.id, false); showStatus('success', 'Staff record deactivated.'); await renderStaffList(); }; $('#staffListBody').append(row); }
function addStaffRow() { appendStaffRow(); }
async function saveStaffRow(row) { const name = $('.staffName', row).value.trim(); if (!name) return; try { const saved = await saveWardStaff({ id: row.dataset.id || undefined, ward_id: state.ward.id, role: $('.staffRole', row).value, name, appointment_date: apptToISO($('.staffAppt', row).value), active: true, display_order: 0 }); row.dataset.id = saved.id; showStatus('success', 'Staff record saved.'); state.staff = await getWardStaff(state.ward.id, false); renderStaffDataLists(); } catch (error) { showStatus('error', error.message || String(error)); } }

function dynamicItemsForInfectionDeviceTab() {
  return state.items.filter(i => !i.builtin && !['admission', 'bedcount'].includes(i.section));
}

async function getDataForTab(tab) {
  state.gdTab = tab;
  const prev = await getPreviousReport(state.ward.id, $('#memoDate').value, state.report?.id || null);
  state.gdPrev = prev;
  $('#gdOverlay').classList.add('show');
  $('#gdSectionHdr').textContent = { 1: 'Admission / Bed Count', 2: 'Infection / Devices', 3: 'Patient List', 4: 'Consultation / Intubation', 5: 'Night Nurse' }[tab] || 'Previous Data';
  const noHistory = !prev;
  $('#gdNoHistory').classList.toggle('show', noHistory);
  $('#gdTable').style.display = noHistory ? 'none' : 'table';
  $('#gdConfirmBtn').disabled = noHistory;
  if (noHistory) {
    $('#gdTbody').innerHTML = '';
    return;
  }
  const D = normalizeReportPayload(prev.payload);
  const rows = [];
  if (tab === 1) {
    rows.push(['Admission E/C', D.admissionEC], ['Admission C/C', D.admissionCC], ['Discharge', D.discharge], ['Death', D.death], ['Transfer In', D.transferIn], ['Transfer Out', D.transferOut], ['Total Patient', D.totalPatientM], ['Empty Bed', D.emptyBeds?.count ?? ''], ['Early Bird', D.earlyBirds.map(x => `${x.bed || '?'}→${x.dest || '?'}`).join(' | ') || 'None']);
    state.items.filter(i => !i.builtin && (i.section === 'admission' || i.section === 'bedcount')).forEach(i => rows.push([i.label, formatDynamic(D.dynamicItems?.[i.key])]));
  } else if (tab === 2) {
    state.items.filter(i => i.builtin && i.section === 'infection').forEach(i => rows.push([i.label, (D.infBeds?.[i.key] || []).join(', ') || 'Nil']));
    state.items.filter(i => i.builtin && i.section === 'devices').forEach(i => rows.push([i.label, formatDevice(D.devBeds?.[i.key])]));
    dynamicItemsForInfectionDeviceTab().forEach(i => rows.push([i.label, formatDynamic(D.dynamicItems?.[i.key])]));
  } else if (tab === 3) {
    rows.push(['Nil Special', D.nilSpecial ? 'Yes' : 'No'], ['Patients', D.nilSpecial ? 'Nil Special' : `${D.patients.length} row(s)`]);
  } else if (tab === 4) {
    rows.push(['Nil Consultation', D.nilConsultation ? 'Yes' : 'No'], ['Consultations', `${D.consultations.length} row(s)`], ['Nil Intubation', D.nilIntubation ? 'Yes' : 'No'], ['Intubations', `${D.intubations.length} row(s)`]);
  } else if (tab === 5) {
    rows.push(['Night Nurse', D.nurses.map(n => `${n.role} ${n.name}`).join(' | ') || 'None'], ['AM Duty Staff', D.staffAM], ['PM Duty Staff', D.staffPM], ['Signature', `${D.sigRank || ''} ${D.sigName || ''}`.trim()], ['Appointment', D.sigAppt]);
  }
  $('#gdTbody').innerHTML = rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="${b == null || b === '' ? 'gd-nil' : ''}">${esc(b ?? '')}</td></tr>`).join('');
}

function gdClose() { state.gdTab = null; state.gdPrev = null; $('#gdOverlay').classList.remove('show'); }

function gdConfirm() {
  if (!state.gdPrev || !state.gdTab) return;
  const p = normalizeReportPayload(state.gdPrev.payload), c = collectPayload();
  if (state.gdTab === 1) {
    DIRECT_REPORT_KEYS.forEach(key => { c[key] = p[key] ?? c[key]; });
    c.emptyBeds = p.emptyBeds;
    c.earlyBirds = p.earlyBirds;
    state.items.filter(i => !i.builtin && (i.section === 'admission' || i.section === 'bedcount')).forEach(i => { c.dynamicItems[i.key] = p.dynamicItems?.[i.key]; });
  } else if (state.gdTab === 2) {
    c.infBeds = p.infBeds;
    c.devBeds = p.devBeds;
    dynamicItemsForInfectionDeviceTab().forEach(i => { c.dynamicItems[i.key] = p.dynamicItems?.[i.key]; });
  } else if (state.gdTab === 3) {
    c.nilSpecial = p.nilSpecial;
    c.patients = p.patients;
  } else if (state.gdTab === 4) {
    c.nilConsultation = p.nilConsultation;
    c.consultations = p.consultations;
    c.nilIntubation = p.nilIntubation;
    c.intubations = p.intubations;
  } else if (state.gdTab === 5) {
    c.nurses = p.nurses;
    c.staffAM = p.staffAM;
    c.staffPM = p.staffPM;
    c.sigRank = p.sigRank;
    c.sigName = p.sigName;
    c.sigAppt = p.sigAppt;
  }
  fillPayload(c);
  state.dirty = true;
  showStatus('success', `Copied data from ${toDisplayDate(state.gdPrev.report_date)}.`);
  gdClose();
}

function histDeleteCurrent() { showStatus('error', 'Historical report deletion is disabled in the Supabase version.'); }
async function histReprint() { if (state.currentHist) await printReportObject(state.currentHist); }
function printContext(report, items, capacity) { return { ward: state.ward, report, capacity, items, settings: pdfSettings, logoUrl: new URL('../assets/heart-logo.png', import.meta.url).href }; }
async function getPrintContext(report) { const context = await loadHistoricalReportContext(state.ward.id, report); return printContext(report, context.items, context.capacity); }
async function handleGen() { await printCurrent(true); }
async function printCurrent(autoSaveDraft = false) { let report = { report_date: $('#memoDate').value, payload: collectPayload(), bed_capacity_snapshot: state.capacity, updated_at: new Date().toISOString(), report_item_snapshot: state.items }; if (autoSaveDraft) { const savedDraft = await saveEntry(); if (!savedDraft) return; report = savedDraft; } await printReportObject(report); }
async function printReportObject(report) { try { const context = await getPrintContext(report); const mod = await getPrintModule(); await mod.printWardMemo(context); showStatus('success', 'Print dialog opened.'); } catch (error) { showStatus('error', 'Unable to open print dialog: ' + (error.message || String(error))); console.error(error); } }
function setPrintControl(id, value) { const el = document.getElementById(id); if (el) el.value = value; }
function loadPrintControls() { const S = pdfSettings; [['topTitle', S.topTitle], ['topContent', S.topContent], ['boxTitle', S.boxTitle], ['boxContent', S.boxContent], ['infLabel', S.infLabel], ['infValue', S.infValue], ['devLabel', S.devLabel], ['devValue', S.devValue], ['lineHeader', S.lineHeader], ['lineContent', S.lineContent], ['consHeader', S.consHeader], ['consContent', S.consContent], ['intubHeader', S.intubHeader], ['intubContent', S.intubContent], ['nurseTitle', S.nurseTitle], ['nurseContent', S.nurseContent], ['sigContent', S.sigContent]].forEach(([k, v]) => setPrintControl(`pset_${k}`, v)); }
function readPrintControls() { const number = (id, fallback) => { const n = parseFloat(document.getElementById(id)?.value); return Number.isFinite(n) ? n : fallback; }; return Object.fromEntries(Object.entries(FALLBACK_WARD_PRINT_SETTINGS).map(([key, fallback]) => [key, number(`pset_${key}`, fallback)])); }
async function previewCurrentMemo() { const report = { report_date: $('#memoDate').value, payload: collectPayload(), bed_capacity_snapshot: state.capacity, updated_at: new Date().toISOString(), report_item_snapshot: state.items }; const context = printContext(report, state.items, state.capacity); const mod = await getPrintModule(); await mod.writeWardMemoToIframe($('#pdfPreviewFrame'), context); }
async function openPdfSettings() { const mod = await getPrintModule(); pdfSettings = mod.loadWardPrintSettings(); loadPrintControls(); $('#pdfSettingsModal').classList.add('show'); await previewCurrentMemo(); }
function closePdfSettings() { clearTimeout(pdfDebounceTimer); $('#pdfSettingsModal').classList.remove('show'); }
function updatePdfPreviewDebounced() { clearTimeout(pdfDebounceTimer); pdfDebounceTimer = setTimeout(updatePdfPreview, 250); }
async function updatePdfPreview() { const mod = await getPrintModule(); pdfSettings = mod.saveWardPrintSettings(readPrintControls()); await previewCurrentMemo(); }
async function resetPdfSettings() { if (!confirm('Reset all font sizes to the original Night Memo defaults?')) return; const mod = await getPrintModule(); pdfSettings = mod.resetWardPrintSettings(); loadPrintControls(); await previewCurrentMemo(); }
function printPdf() { const frame = $('#pdfPreviewFrame'); frame.contentWindow?.focus(); frame.contentWindow?.print(); }
async function applyPdfSettings() { const mod = await getPrintModule(); pdfSettings = mod.saveWardPrintSettings(readPrintControls()); showStatus('loading', 'Choose “Save as PDF” in the print dialog.'); printPdf(); }

Object.assign(window, { calcEmpty, addEmptyDetail, addEB, addPt, addCs, addIt, addNR, toggleNil, toggleNilConsult, toggleNilIntub, saveEntry, submitEntry, handleGen, openPdfSettings, closePdfSettings, printPdf, applyPdfSettings, updatePdfPreviewDebounced, resetPdfSettings, toggleHistory, toggleStaffList, addStaffRow, getDataForTab, gdClose, gdConfirm, histReprint, histDeleteCurrent });
