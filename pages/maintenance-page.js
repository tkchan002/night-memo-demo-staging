import { requireRole, signOut } from '../auth.js';
import {
  getAllWards, getOperatingPeriods, getCapacityHistory, createWard, updateWard,
  addOperatingPeriod, closeOperatingPeriod, addCapacity, getAccounts, adminAccount,
  getWardStaff, saveWardStaff, setStaffActive, getReportItems, saveReportItem, reorderReportItems, getAuditLog, recordAudit,
  getMaintenanceWardsSnapshot, getCapacitiesForWards,
  importGeneratedDemoBatch, listGeneratedDemoBatches, deleteGeneratedDemoBatch,
} from '../data/index.js';
import { qs, qsa, esc } from '../core/dom.js';
import { todayISO, toDisplayDate, formatDateTime } from '../core/dates.js';
import { flash } from '../core/ui.js';
import { setAppHeader } from '../components/app-shell.js';
import { DB_MODE } from '../data/index.js';
import { DEMO_SCENARIOS, generateDemoDataBundle, summarizeGeneratedReport } from '../domain/demo-generator.js';

const $ = qs;
const state = {
  access: null,
  wards: [],
  periods: [],
  accounts: [],
  items: [],
  editingAccount: null,
  editingItem: null,
  editingWard: null,
  loaded: { wards: false, accounts: false, items: false },
  loading: {},
  demoPrepared: null,
};

init().catch(error => { console.error(error); flash(error.message || String(error), 'error', 8000); });

async function init() {
  state.access = await requireRole('maintenance');
  if (!state.access) return;
  setAppHeader({ title: 'Night Memo Maintenance', subtitle: 'Configuration and lifecycle console', access: state.access, mode: DB_MODE });
  installGeneratedDemoUI();
  bind();
  // Only the visible Wards tab is on the initial critical path. Accounts,
  // Report Items, Staff and Audit are fetched only when the user opens them.
  await ensureWardsLoaded();
}

function bind() {
  $('#logoutBtn').onclick = signOut;
  qsa('[data-maint]').forEach(b => { b.onclick = () => showPage(b.dataset.maint); });
  qsa('[data-close]').forEach(b => { b.onclick = () => closeModal(b.dataset.close); });
  $('#addWardBtn').onclick = () => openWardModal();
  $('#wardFormModal').onsubmit = saveWardFromModal;
  $('#capacityWard').onchange = renderCapacityHistory;
  $('#addCapacityBtn').onclick = () => openModal('#capacityModal');
  $('#capacityForm').onsubmit = saveCapacity;
  $('#addAccountBtn').onclick = () => openAccountModal();
  $('#accountForm').onsubmit = saveAccount;
  $('#passwordForm').onsubmit = savePassword;
  $('#staffWard').onchange = renderMaintStaff;
  $('#maintAddStaff').onclick = () => appendMaintStaffEditor();
  $('#addItemBtn').onclick = () => openItemModal();
  $('#itemForm').onsubmit = saveItem;
  $('#refreshAudit').onclick = renderAudit;
}

async function showPage(name) {
  qsa('[data-maint]').forEach(x => x.classList.toggle('active', x.dataset.maint === name));
  qsa('[data-maint-page]').forEach(x => x.classList.toggle('active', x.dataset.maintPage === name));
  try {
    if (name === 'wards') await ensureWardsLoaded();
    if (name === 'capacity') { await ensureWardsLoaded(); await renderCapacityHistory(); }
    if (name === 'accounts') { await ensureWardsLoaded(); await ensureAccountsLoaded(); }
    if (name === 'staff') { await ensureWardsLoaded(); await renderMaintStaff(); }
    if (name === 'items') await ensureItemsLoaded();
    if (name === 'audit') await renderAudit();
    if (name === 'demo') await renderGeneratedDemoBatches();
  } catch (error) {
    console.error(`Unable to load maintenance tab ${name}:`, error);
    flash(error.message || String(error), 'error', 7000);
  }
}

function openModal(sel) { $(sel).classList.add('show'); }
function closeModal(sel) { $(sel).classList.remove('show'); }

async function ensureWardsLoaded(force = false) {
  if (state.loaded.wards && !force) return;
  if (state.loading.wards) return state.loading.wards;
  $('#wardCards').innerHTML = '<div class="muted">Loading wards...</div>';
  state.loading.wards = (async () => {
    const snapshot = await getMaintenanceWardsSnapshot();
    if (snapshot) {
      state.wards = snapshot.wards || [];
      state.periods = snapshot.periods || [];
    } else {
      [state.wards, state.periods] = await Promise.all([getAllWards(), getOperatingPeriods()]);
    }
    state.loaded.wards = true;
    fillWardSelects();
    renderWardCards();
  })();
  try { await state.loading.wards; } finally { state.loading.wards = null; }
}

async function ensureAccountsLoaded(force = false) {
  if (state.loaded.accounts && !force) { renderAccounts(); return; }
  if (state.loading.accounts) return state.loading.accounts;
  $('#accountRows').innerHTML = '<tr><td colspan="5" class="muted">Loading accounts...</td></tr>';
  state.loading.accounts = (async () => {
    state.accounts = await getAccounts();
    state.loaded.accounts = true;
    renderAccounts();
  })();
  try { await state.loading.accounts; } finally { state.loading.accounts = null; }
}

async function ensureItemsLoaded(force = false) {
  if (state.loaded.items && !force) { renderItems(); return; }
  if (state.loading.items) return state.loading.items;
  $('#itemRows').innerHTML = '<tr><td colspan="7" class="muted">Loading report items...</td></tr>';
  state.loading.items = (async () => {
    state.items = await getReportItems(todayISO(), true);
    state.loaded.items = true;
    renderItems();
  })();
  try { await state.loading.items; } finally { state.loading.items = null; }
}

function fillWardSelects() {
  const opts = '<option value="">— None —</option>' + state.wards.map(w => `<option value="${esc(w.id)}">${esc(w.code)} — ${esc(w.display_name)}</option>`).join('');
  ['#capacityWard', '#staffWard', '#accountWard'].forEach(sel => {
    const el = $(sel), old = el.value; el.innerHTML = opts;
    if ([...el.options].some(o => o.value === old)) el.value = old;
  });
  if (!$('#capacityWard').value && state.wards[0]) $('#capacityWard').value = state.wards[0].id;
  if (!$('#staffWard').value && state.wards[0]) $('#staffWard').value = state.wards[0].id;
}

function renderWardCards() {
  const today = todayISO();
  const periods = state.periods || [];
  $('#wardCards').innerHTML = state.wards.map(w => {
    const open = periods.some(p => p.ward_id === w.id && p.start_date <= today && (!p.end_date || p.end_date >= today));
    return `<div class="ward-card"><h3>${esc(w.code)}</h3><div><span class="dot ${open ? 'active' : 'closed'}"></span>${open ? 'Currently open' : 'Closed / scheduled'}</div><div class="muted" style="margin:5px 0">${esc(w.display_name)}<br>Tel ${esc(w.phone || '—')} · Fax ${esc(w.fax || '—')}<br>Empty-bed gender: ${esc(w.empty_bed_gender_mode)}<br>Memo: ${esc(w.manager_section)}</div><div class="inline-actions"><button class="btn secondary small" data-edit-ward="${w.id}">Edit</button>${open ? `<button class="btn danger small" data-close-ward="${w.id}">Close Ward</button>` : `<button class="btn secondary small" data-reopen-ward="${w.id}">Reopen</button>`}</div></div>`;
  }).join('');
  qsa('[data-edit-ward]').forEach(b => { b.onclick = () => openWardModal(state.wards.find(w => w.id === b.dataset.editWard)); });
  qsa('[data-close-ward]').forEach(b => { b.onclick = () => closeWard(b.dataset.closeWard); });
  qsa('[data-reopen-ward]').forEach(b => { b.onclick = () => reopenWard(b.dataset.reopenWard); });
}

async function refreshWardConfiguration() {
  state.loaded.wards = false;
  await ensureWardsLoaded(true);
}

function openWardModal(w = null) {
  state.editingWard = w;
  $('#wardModalTitle').textContent = w ? 'Edit Ward' : 'Add Ward';
  $('#editWardId').value = w?.id || ''; $('#mWardCode').value = w?.code || ''; $('#mWardName').value = w?.display_name || '';
  $('#mWardPhone').value = w?.phone || ''; $('#mWardFax').value = w?.fax || ''; $('#mWardGender').value = w?.empty_bed_gender_mode || 'male';
  $('#mWardSection').value = w?.manager_section || 'Male'; $('#mWardOrder').value = w?.display_order ?? 999; $('#mWardStart').value = todayISO();
  $('#mWardEnd').value = ''; $('#mWardCapacity').value = '40'; $('#mWardNote').value = '';
  qsa('.new-ward-only').forEach(x => x.classList.toggle('hidden', !!w)); $('#mWardCode').disabled = !!w; openModal('#wardModal');
}
async function saveWardFromModal(event) {
  event.preventDefault();
  try {
    if (state.editingWard) {
      await updateWard(state.editingWard.id, { display_name: $('#mWardName').value.trim(), phone: $('#mWardPhone').value.trim(), fax: $('#mWardFax').value.trim(), empty_bed_gender_mode: $('#mWardGender').value, manager_section: $('#mWardSection').value, display_order: Number($('#mWardOrder').value) || 999 });
      flash('Ward updated.', 'success');
    } else {
      await createWard({ code: $('#mWardCode').value.trim(), display_name: $('#mWardName').value.trim(), phone: $('#mWardPhone').value.trim(), fax: $('#mWardFax').value.trim(), empty_bed_gender_mode: $('#mWardGender').value, manager_section: $('#mWardSection').value, display_order: $('#mWardOrder').value, start_date: $('#mWardStart').value, end_date: $('#mWardEnd').value || null, bed_capacity: $('#mWardCapacity').value, note: $('#mWardNote').value.trim() });
      flash('Ward created. Create its login account in Accounts.', 'success', 6000);
    }
    closeModal('#wardModal'); await refreshWardConfiguration();
  } catch (error) { flash(error.message || String(error), 'error', 7000); }
}
async function closeWard(wardId) {
  const date = prompt('Closing date (YYYY-MM-DD):', todayISO()); if (!date) return;
  const periods = await getOperatingPeriods(wardId); const open = periods.find(p => p.start_date <= date && (!p.end_date || p.end_date >= date));
  if (!open) return flash('No open operating period found for that date.', 'warning');
  await closeOperatingPeriod(open.id, date, 'Ward closed from maintenance console'); flash('Ward operating period closed.', 'success'); await refreshWardConfiguration();
}
async function reopenWard(wardId) { const date = prompt('Reopening date (YYYY-MM-DD):', todayISO()); if (!date) return; await addOperatingPeriod(wardId, date, null, 'Ward reopened from maintenance console'); flash('Ward reopened.', 'success'); await refreshWardConfiguration(); }
async function renderCapacityHistory() {
  const wardId = $('#capacityWard').value; if (!wardId) { $('#capacityHistory').innerHTML = ''; return; }
  const rows = await getCapacityHistory(wardId);
  $('#capacityHistory').innerHTML = `<table class="data-table"><thead><tr><th>Effective From</th><th>Effective To</th><th>Beds</th><th>Note</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(toDisplayDate(r.effective_from))}</td><td>${esc(r.effective_to ? toDisplayDate(r.effective_to) : 'Current')}</td><td>${esc(r.bed_capacity)}</td><td>${esc(r.note || '')}</td></tr>`).join('')}</tbody></table>`;
}
async function saveCapacity(event) { event.preventDefault(); const wardId = $('#capacityWard').value; if (!wardId) return; try { await addCapacity(wardId, $('#capFrom').value, $('#capBeds').value, $('#capNote').value.trim()); closeModal('#capacityModal'); flash('Capacity change saved with effective date.', 'success'); await renderCapacityHistory(); } catch (error) { flash(error.message || String(error), 'error'); } }
function renderAccounts() {
  $('#accountRows').innerHTML = state.accounts.map(a => `<tr><td>${esc(a.login_id)}</td><td>${esc(a.role)}</td><td>${esc(a.wards?.code || '—')}</td><td>${a.active ? '<span class="tag">Active</span>' : '<span class="tag subtle">Disabled</span>'}</td><td><div class="inline-actions"><button class="btn secondary small" data-edit-account="${esc(a.auth_user_id)}">Edit</button><button class="btn secondary small" data-password="${esc(a.auth_user_id)}">Reset Password</button></div></td></tr>`).join('');
  qsa('[data-edit-account]').forEach(b => { b.onclick = () => openAccountModal(state.accounts.find(a => a.auth_user_id === b.dataset.editAccount)); });
  qsa('[data-password]').forEach(b => { b.onclick = () => { const a = state.accounts.find(x => x.auth_user_id === b.dataset.password); $('#passwordUserId').value = a.auth_user_id; $('#newPassword').value = ''; openModal('#passwordModal'); }; });
}
function openAccountModal(a = null) {
  state.editingAccount = a; $('#accountModalTitle').textContent = a ? 'Edit Account' : 'Create Account'; $('#accountUserId').value = a?.auth_user_id || '';
  $('#accountLogin').value = a?.login_id || ''; $('#accountDisplay').value = a?.display_name || ''; $('#accountRole').value = a?.role || 'ward'; $('#accountWard').value = a?.ward_id || '';
  $('#accountActive').value = String(a?.active ?? true); $('#accountPassword').value = ''; $('#accountPasswordWrap').classList.toggle('hidden', !!a); openModal('#accountModal');
}
async function saveAccount(event) {
  event.preventDefault();
  try {
    if (!state.editingAccount) await adminAccount('create', { login_id: $('#accountLogin').value.trim(), display_name: $('#accountDisplay').value.trim(), role: $('#accountRole').value, ward_id: $('#accountRole').value === 'ward' ? ($('#accountWard').value || null) : null, password: $('#accountPassword').value });
    else {
      const a = state.editingAccount;
      if ($('#accountLogin').value.trim() !== a.login_id) await adminAccount('rename_login', { auth_user_id: a.auth_user_id, login_id: $('#accountLogin').value.trim(), display_name: $('#accountDisplay').value.trim() });
      await adminAccount('update_access', { auth_user_id: a.auth_user_id, role: $('#accountRole').value, ward_id: $('#accountRole').value === 'ward' ? ($('#accountWard').value || null) : null, active: $('#accountActive').value === 'true', display_name: $('#accountDisplay').value.trim() });
    }
    closeModal('#accountModal'); await ensureAccountsLoaded(true); flash('Account saved.', 'success');
  } catch (error) { flash(error.message || String(error), 'error', 7000); }
}
async function savePassword(event) { event.preventDefault(); try { await adminAccount('reset_password', { auth_user_id: $('#passwordUserId').value, password: $('#newPassword').value }); closeModal('#passwordModal'); flash('Password reset.', 'success'); } catch (error) { flash(error.message || String(error), 'error', 7000); } }
async function renderMaintStaff() {
  const wardId = $('#staffWard').value; if (!wardId) { $('#maintStaffTable').innerHTML = ''; return; }
  const staff = await getWardStaff(wardId, true); $('#maintStaffTable').innerHTML = '<table class="data-table"><thead><tr><th>Role</th><th>Name</th><th>Appointment</th><th>Status</th><th></th></tr></thead><tbody id="maintStaffRows"></tbody></table>'; staff.forEach(s => appendMaintStaffEditor(s));
}
function appendMaintStaffEditor(s = { role: 'RN', name: '', appointment_date: '', active: true }) {
  const wardId = $('#staffWard').value; if (!wardId) return;
  const tr = document.createElement('tr'); tr.dataset.id = s.id || '';
  tr.innerHTML = `<td><select class="control" data-role><option>RN</option><option>EN</option><option>APN</option><option>Student Nurse</option></select></td><td><input class="control" data-name value="${esc(s.name || '')}"></td><td><input class="control" type="date" data-appt value="${esc(s.appointment_date || '')}"></td><td>${s.active === false ? 'Inactive' : 'Active'}</td><td><div class="inline-actions"><button class="btn secondary small" data-save>Save</button>${s.id ? `<button class="btn danger small" data-toggle>${s.active === false ? 'Activate' : 'Deactivate'}</button>` : ''}</div></td>`;
  qs('[data-role]', tr).value = s.role || 'RN';
  qs('[data-save]', tr).onclick = async () => { await saveWardStaff({ id: tr.dataset.id || undefined, ward_id: wardId, role: qs('[data-role]', tr).value, name: qs('[data-name]', tr).value.trim(), appointment_date: qs('[data-appt]', tr).value || null, active: s.active !== false, display_order: 0 }); flash('Staff saved.', 'success'); await renderMaintStaff(); };
  const toggle = qs('[data-toggle]', tr); if (toggle) toggle.onclick = async () => { await setStaffActive(s.id, s.active === false); await renderMaintStaff(); };
  qs('#maintStaffRows').append(tr);
}
function renderItems() {
  const sorted = [...state.items].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  $('#itemRows').innerHTML = sorted.map((i, index) => `<tr>
    <td>${esc(i.sort_order)}</td>
    <td>${esc(i.section)}</td>
    <td>${esc(i.label)}${i.builtin ? ' <span class="tag subtle">Built-in</span>' : ''}</td>
    <td>${esc(i.input_type)}</td>
    <td>${esc(toDisplayDate(i.effective_from || ''))}${i.effective_to ? ` – ${esc(toDisplayDate(i.effective_to))}` : ''}</td>
    <td>${i.active ? '<span class="tag">Active</span>' : '<span class="tag subtle">Inactive</span>'}</td>
    <td><div class="inline-actions">
      <button class="btn secondary small" data-move-item="${esc(i.id)}" data-move-delta="-1" ${index === 0 ? 'disabled' : ''} title="Move up">↑</button>
      <button class="btn secondary small" data-move-item="${esc(i.id)}" data-move-delta="1" ${index === sorted.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
      <button class="btn secondary small" data-edit-item="${esc(i.id)}">Edit</button>
    </div></td>
  </tr>`).join('');
  qsa('[data-edit-item]').forEach(b => { b.onclick = () => openItemModal(state.items.find(i => i.id === b.dataset.editItem)); });
  qsa('[data-move-item]').forEach(b => { b.onclick = () => moveReportItem(b.dataset.moveItem, Number(b.dataset.moveDelta)); });
}

async function moveReportItem(itemId, delta) {
  const sorted = [...state.items].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  const index = sorted.findIndex(item => item.id === itemId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= sorted.length) return;
  [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
  const reordered = sorted.map((item, position) => ({ ...item, sort_order: (position + 1) * 10 }));
  try {
    await reorderReportItems(reordered);
    state.items = reordered;
    renderItems();
    flash('Report item order updated. Manager view uses this order immediately on refresh.', 'success');
  } catch (error) {
    flash(error.message || String(error), 'error', 7000);
    await ensureItemsLoaded(true);
  }
}
function openItemModal(i = null) {
  state.editingItem = i; $('#itemModalTitle').textContent = i ? 'Edit Report Item' : 'Add Report Item'; $('#itemId').value = i?.id || ''; $('#itemBuiltin').value = i?.builtin ? 'true' : 'false';
  $('#itemKey').value = i?.key || ''; $('#itemLabel').value = i?.label || ''; $('#itemOrder').value = i?.sort_order ?? 999; $('#itemSection').value = i?.section || 'additional'; $('#itemType').value = i?.input_type || 'free_text';
  $('#itemActive').value = String(i?.active ?? true); $('#itemOptions').value = (i?.options || []).join(', '); $('#itemFrom').value = i?.effective_from || todayISO(); $('#itemTo').value = i?.effective_to || '';
  $('#itemKey').disabled = !!i; $('#itemType').disabled = !!i?.builtin; openModal('#itemModal');
}
async function saveItem(event) {
  event.preventDefault();
  try {
    const old = state.editingItem;
    await saveReportItem({ id: old?.id || undefined, key: $('#itemKey').value.trim(), label: $('#itemLabel').value.trim(), section: $('#itemSection').value, input_type: old?.builtin ? old.input_type : $('#itemType').value, options: $('#itemOptions').value.split(',').map(x => x.trim()).filter(Boolean), sort_order: Number($('#itemOrder').value) || 999, active: $('#itemActive').value === 'true', effective_from: $('#itemFrom').value || todayISO(), effective_to: $('#itemTo').value || null, builtin: old?.builtin || false, manager_slot: old?.manager_slot || null, config: old?.config || { storage: 'dynamicItems' } });
    closeModal('#itemModal'); flash('Report item saved.', 'success'); await ensureItemsLoaded(true);
  } catch (error) { flash(error.message || String(error), 'error', 7000); }
}
async function renderAudit() { const rows = await getAuditLog(200); $('#auditRows').innerHTML = rows.length ? rows.map(r => `<div class="audit-row"><b>${esc(formatDateTime(r.occurred_at))}</b> · <code>${esc(r.action)}</code> · ${esc(r.entity_type || '')} ${esc(r.entity_id || '')}<div class="muted">${esc(JSON.stringify(r.details || {}))}</div></div>`).join('') : '<div class="muted">No audit entries yet.</div>'; }


function installGeneratedDemoUI() {
  const tabs = document.querySelector('.maintenance-tabs');
  const body = document.querySelector('.legacy-panel-body');
  if (!tabs || !body || document.querySelector('[data-maint="demo"]')) return;

  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'tab';
  tab.dataset.maint = 'demo';
  tab.textContent = 'Test Data';
  tabs.append(tab);

  const scenarioOptions = Object.entries(DEMO_SCENARIOS)
    .map(([value, config]) => `<option value="${esc(value)}">${esc(config.label)}</option>`)
    .join('');

  const section = document.createElement('section');
  section.className = 'maint-page';
  section.dataset.maintPage = 'demo';
  section.innerHTML = `
    <div class="section-title">Generated Demo Data</div>
    <p class="muted">Maintenance-only test tool. It reads the current active wards, real bed capacities and current report-item configuration, then generates synthetic Night Memo reports. No real patient data is copied. Imported reports are normal <code>ward_reports</code> rows, so Manager, Ward History and printing treat them exactly like ordinary submissions.</p>
    <div class="legacy-card" style="margin:12px 0;padding:14px">
      <div class="inline-fields" style="align-items:flex-end;gap:10px;flex-wrap:wrap">
        <div class="field" style="min-width:240px"><label>Scenario</label><select id="demoScenario">${scenarioOptions}</select></div>
        <button type="button" class="btn secondary" id="demoGenerateBtn">Generate Preview</button>
        <button type="button" class="btn" id="demoImportBtn" disabled>Import Generated Batch</button>
      </div>
      <div id="demoImportStatus" class="muted" style="margin-top:10px">Generate a preview first. Nothing is written to Supabase until you import the generated batch.</div>
      <div id="demoImportPreview" style="margin-top:12px"></div>
    </div>
    <div class="section-title" style="margin-top:20px">Generated Test Batches</div>
    <p class="muted">Each imported batch is tracked separately. Deleting a batch removes only the exact reports generated by that batch, not unrelated reports from the same ward or date.</p>
    <div id="demoBatchRows"><div class="muted">Open this tab to load generated batches.</div></div>`;
  body.append(section);

  $('#demoGenerateBtn').addEventListener('click', generateDemoPreview);
  $('#demoImportBtn').addEventListener('click', commitGeneratedDemo);
}

function setDemoStatus(message, type = 'muted') {
  const el = $('#demoImportStatus');
  if (!el) return;
  el.className = type;
  el.textContent = message;
}

async function generateDemoPreview() {
  state.demoPrepared = null;
  $('#demoImportBtn').disabled = true;
  $('#demoImportPreview').innerHTML = '';
  const button = $('#demoGenerateBtn');
  button.disabled = true;
  setDemoStatus('Reading current ward configuration and generating realistic synthetic reports...');
  try {
    await ensureWardsLoaded();
    await ensureItemsLoaded();
    const date = todayISO();
    const activeWards = state.wards.filter(ward => state.periods.some(period => period.ward_id === ward.id
      && period.start_date <= date
      && (!period.end_date || period.end_date >= date)));
    if (!activeWards.length) throw new Error('No active wards are configured for today.');
    const capacities = await getCapacitiesForWards(activeWards.map(ward => ward.id), date);
    const scenario = $('#demoScenario').value || 'typical';
    const seed = Date.now();
    const bundle = generateDemoDataBundle({
      wards: state.wards,
      periods: state.periods,
      capacities,
      items: state.items,
      scenario,
      reportDate: date,
      now: new Date(),
      seed,
    });
    state.demoPrepared = bundle;
    $('#demoImportBtn').disabled = false;
    setDemoStatus(`${bundle.meta.active_wards} active wards generated from the current configuration. Nothing has been imported yet.`);
    renderGeneratedDemoPreview(bundle);
  } catch (error) {
    setDemoStatus(error.message || String(error), 'error');
    flash(error.message || String(error), 'error', 9000);
  } finally {
    button.disabled = false;
  }
}

function renderGeneratedDemoPreview(bundle) {
  const currentByWard = new Map(bundle.reports.filter(report => report.session === 'current').map(report => [report.ward_code, report]));
  const previousByWard = new Map(bundle.reports.filter(report => report.session === 'previous').map(report => [report.ward_code, report]));
  const wardCodes = [...previousByWard.keys()];
  const rows = wardCodes.map(code => {
    const current = currentByWard.get(code);
    const previous = previousByWard.get(code);
    const summary = current ? summarizeGeneratedReport(current) : null;
    return `<tr>
      <td><b>${esc(code)}</b></td>
      <td>${current ? `<span class="tag">Submitted ${esc(formatDateTime(current.submitted_at))}</span>` : '<span class="tag subtle">Not submitted in current window</span>'}</td>
      <td>${current ? `${esc(summary.total)} / ${esc(current.preview_capacity)} patients · ${esc(summary.empty)} empty` : '—'}</td>
      <td>${current ? esc(summary.clinical) : '—'}</td>
      <td>${previous ? esc(formatDateTime(previous.submitted_at)) : '—'}</td>
    </tr>`;
  }).join('');

  $('#demoImportPreview').innerHTML = `
    <div class="legacy-card" style="margin-bottom:10px;padding:10px">
      <b>${esc(DEMO_SCENARIOS[bundle.scenario]?.label || bundle.scenario)}</b><br>
      <span class="muted">${esc(bundle.description)}</span><br>
      <span class="muted">${esc(bundle.meta.previous_session_reports)} previous-session reports · ${esc(bundle.meta.current_submissions)} current submissions · ${esc(bundle.meta.not_yet_submitted)} not yet submitted · ${esc(bundle.meta.current_clinical_attention_wards)} current clinical-attention wards · ${esc(bundle.meta.current_intubation_wards)} current intubation wards</span>
    </div>
    <div class="table-scroll"><table class="data-table"><thead><tr><th>Ward</th><th>Current window</th><th>Occupancy</th><th>Clinical attention</th><th>Previous session</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function commitGeneratedDemo() {
  if (!state.demoPrepared) return;
  const bundle = state.demoPrepared;
  const count = bundle.reports.length;
  if (!confirm(`Import ${count} generated reports into the normal ward_reports table? Manager, Ward History and printing will treat them as ordinary submissions.`)) return;
  const button = $('#demoImportBtn');
  button.disabled = true;
  setDemoStatus('Importing generated reports into Supabase...');
  try {
    const result = await importGeneratedDemoBatch(bundle);
    await recordAudit('demo_data_generate', 'demo_data_batch', result?.batch_id || null, {
      scenario: bundle.scenario,
      seed: bundle.seed,
      report_count: result?.report_count ?? count,
      active_wards: bundle.meta.active_wards,
      current_submissions: bundle.meta.current_submissions,
    });
    flash(`${result?.report_count ?? count} generated reports imported as normal Night Memo reports.`, 'success', 8000);
    setDemoStatus('Import complete. Other parts of Night Memo can now read these reports normally.');
    state.demoPrepared = null;
    $('#demoImportPreview').innerHTML = '';
    await renderGeneratedDemoBatches();
  } catch (error) {
    button.disabled = false;
    setDemoStatus(error.message || String(error), 'error');
    flash(error.message || String(error), 'error', 10000);
  }
}

async function renderGeneratedDemoBatches() {
  const host = $('#demoBatchRows');
  if (!host) return;
  host.innerHTML = '<div class="muted">Loading generated batches...</div>';
  try {
    const rows = await listGeneratedDemoBatches();
    if (!rows.length) {
      host.innerHTML = '<div class="muted">No tracked generated demo batches.</div>';
      return;
    }
    host.innerHTML = `<div class="table-scroll"><table class="data-table"><thead><tr><th>Imported</th><th>Scenario</th><th>Description</th><th>Reports</th><th></th></tr></thead><tbody>${rows.map(row => `
      <tr>
        <td>${esc(formatDateTime(row.generated_at))}</td>
        <td>${esc(DEMO_SCENARIOS[row.scenario]?.label || row.scenario || 'Generated')}</td>
        <td>${esc(row.description || '')}</td>
        <td>${esc(row.report_count ?? 0)}</td>
        <td><button type="button" class="btn danger small" data-delete-demo-batch="${esc(row.id)}">Delete Batch</button></td>
      </tr>`).join('')}</tbody></table></div>`;
    qsa('[data-delete-demo-batch]').forEach(button => {
      button.onclick = () => removeGeneratedDemoBatch(button.dataset.deleteDemoBatch);
    });
  } catch (error) {
    host.innerHTML = `<div class="error">${esc(error.message || String(error))}</div>`;
  }
}

async function removeGeneratedDemoBatch(batchId) {
  if (!confirm('Delete every report generated by this test batch? Unrelated Night Memo reports will not be touched.')) return;
  try {
    const result = await deleteGeneratedDemoBatch(batchId);
    await recordAudit('demo_data_delete', 'demo_data_batch', batchId, { report_count: result?.deleted_reports ?? null });
    flash(`${result?.deleted_reports ?? 'Demo'} generated reports deleted.`, 'success');
    await renderGeneratedDemoBatches();
  } catch (error) {
    flash(error.message || String(error), 'error', 10000);
  }
}
