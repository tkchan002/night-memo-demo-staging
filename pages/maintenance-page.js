import { requireRole, signOut } from '../auth.js';
import {
  getAllWards, getOperatingPeriods, getCapacityHistory, createWard, updateWard, reorderWards,
  addOperatingPeriod, closeOperatingPeriod, addCapacity, getAccounts, adminAccount,
  getWardStaff, saveWardStaff, setStaffActive, getReportItems, saveReportItem, reorderReportItems, getAuditLog,
  getMaintenanceWardsSnapshot, DB_MODE,
} from '../data/index.js';
import { qs, qsa, esc } from '../core/dom.js';
import { todayISO, toDisplayDate, formatDateTime } from '../core/dates.js';
import { flash } from '../core/ui.js';
import { setAppHeader } from '../components/app-shell.js';
import { initMaintenanceTestData, refreshGeneratedDemoBatches } from './maintenance-test-data.js';
import { moveOrderedItem, sortByOrder } from '../domain/ordering.js';

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
};

const EMPTY_BED_GENDER_LABELS = Object.freeze({
  male: 'Male',
  female: 'Female',
  dynamic: 'Mixed',
  none: 'Not applicable',
});

function emptyBedGenderLabel(value) {
  return EMPTY_BED_GENDER_LABELS[value] || value || 'Not applicable';
}

function installUiTerminology() {
  // Keep the stored value `dynamic` for backward compatibility, but never
  // expose that implementation term to Maintenance users.
  const mixedOption = $('#mWardGender option[value="dynamic"]');
  if (mixedOption) mixedOption.textContent = 'Mixed';
}

init().catch(error => { console.error(error); flash(error.message || String(error), 'error', 8000); });

async function init() {
  state.access = await requireRole('maintenance');
  if (!state.access) return;
  setAppHeader({ title: 'Night Memo Maintenance', subtitle: 'Configuration and lifecycle console', access: state.access, mode: DB_MODE });
  installUiTerminology();
  initMaintenanceTestData();
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
    if (name === 'demo') await refreshGeneratedDemoBatches();
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
  $('#wardRows').innerHTML = '<tr><td colspan="7" class="muted">Loading wards...</td></tr>';
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
    renderWardList();
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
  $('#itemRows').innerHTML = '<tr><td colspan="6" class="muted">Loading report items...</td></tr>';
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

function renderWardList() {
  const today = todayISO();
  const periods = state.periods || [];
  const orderedWards = sortByOrder(state.wards, 'display_order');
  state.wards = orderedWards;

  const host = $('#wardRows');
  if (!orderedWards.length) {
    host.innerHTML = '<tr><td colspan="7" class="muted">No wards configured.</td></tr>';
    return;
  }

  host.innerHTML = orderedWards.map((w, index) => {
    const open = periods.some(p => p.ward_id === w.id && p.start_date <= today && (!p.end_date || p.end_date >= today));
    const status = open ? 'Currently open' : 'Closed / scheduled';
    const moveButtons = `<div class="ward-move-controls">
      <button class="btn secondary small" data-move-ward="${esc(w.id)}" data-move-delta="-1" ${index === 0 ? 'disabled' : ''} title="Move ${esc(w.code)} up one position">↑ Up</button>
      <button class="btn secondary small" data-move-ward="${esc(w.id)}" data-move-delta="1" ${index === orderedWards.length - 1 ? 'disabled' : ''} title="Move ${esc(w.code)} down one position">↓ Down</button>
    </div>`;
    const lifecycleButton = open
      ? `<button class="btn danger small" data-close-ward="${esc(w.id)}">Close Ward</button>`
      : `<button class="btn secondary small" data-reopen-ward="${esc(w.id)}">Reopen</button>`;

    return `<tr>
      <td class="ward-list-code"><strong>${esc(w.code)}</strong></td>
      <td><strong>${esc(w.display_name)}</strong><div class="ward-list-subtext">Tel ${esc(w.phone || '—')} · Fax ${esc(w.fax || '—')}</div></td>
      <td><span class="ward-status"><span class="dot ${open ? 'active' : 'closed'}"></span>${esc(status)}</span></td>
      <td>${esc(emptyBedGenderLabel(w.empty_bed_gender_mode))}</td>
      <td>${esc(w.manager_section || '—')}</td>
      <td>${moveButtons}</td>
      <td><div class="ward-row-actions"><button class="btn secondary small" data-edit-ward="${esc(w.id)}">Edit</button>${lifecycleButton}</div></td>
    </tr>`;
  }).join('');

  qsa('[data-move-ward]').forEach(b => { b.onclick = () => moveWard(b.dataset.moveWard, Number(b.dataset.moveDelta)); });
  qsa('[data-edit-ward]').forEach(b => { b.onclick = () => openWardModal(state.wards.find(w => w.id === b.dataset.editWard)); });
  qsa('[data-close-ward]').forEach(b => { b.onclick = () => closeWard(b.dataset.closeWard); });
  qsa('[data-reopen-ward]').forEach(b => { b.onclick = () => reopenWard(b.dataset.reopenWard); });
}

async function moveWard(wardId, delta) {
  const result = moveOrderedItem(state.wards, wardId, delta, 'display_order');
  if (!result.changed) return;
  try {
    await reorderWards(result.items.map(ward => ward.id));
    state.wards = result.items;
    fillWardSelects();
    renderWardList();
    flash('Ward display order updated.', 'success');
  } catch (error) {
    flash(error.message || String(error), 'error', 7000);
    await refreshWardConfiguration();
  }
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
  $('#mWardSection').value = w?.manager_section || 'Male'; $('#mWardStart').value = todayISO();
  $('#mWardEnd').value = ''; $('#mWardCapacity').value = '40'; $('#mWardNote').value = '';
  qsa('.new-ward-only').forEach(x => x.classList.toggle('hidden', !!w)); $('#mWardCode').disabled = !!w; openModal('#wardModal');
}
async function saveWardFromModal(event) {
  event.preventDefault();
  try {
    if (state.editingWard) {
      await updateWard(state.editingWard.id, { display_name: $('#mWardName').value.trim(), phone: $('#mWardPhone').value.trim(), fax: $('#mWardFax').value.trim(), empty_bed_gender_mode: $('#mWardGender').value, manager_section: $('#mWardSection').value });
      flash('Ward updated.', 'success');
    } else {
      await createWard({ code: $('#mWardCode').value.trim(), display_name: $('#mWardName').value.trim(), phone: $('#mWardPhone').value.trim(), fax: $('#mWardFax').value.trim(), empty_bed_gender_mode: $('#mWardGender').value, manager_section: $('#mWardSection').value, start_date: $('#mWardStart').value, end_date: $('#mWardEnd').value || null, bed_capacity: $('#mWardCapacity').value, note: $('#mWardNote').value.trim() });
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
  const sorted = sortByOrder(state.items, 'sort_order');
  state.items = sorted;
  $('#itemRows').innerHTML = sorted.map((i, index) => `<tr>
    <td>${esc(i.section)}</td>
    <td>${esc(i.label)}${i.builtin ? ' <span class="tag subtle">Built-in</span>' : ''}</td>
    <td>${esc(i.input_type)}</td>
    <td>${esc(toDisplayDate(i.effective_from || ''))}${i.effective_to ? ` – ${esc(toDisplayDate(i.effective_to))}` : ''}</td>
    <td>${i.active ? '<span class="tag">Active</span>' : '<span class="tag subtle">Inactive</span>'}</td>
    <td><div class="inline-actions">
      <button class="btn secondary small" data-move-item="${esc(i.id)}" data-move-delta="-1" ${index === 0 ? 'disabled' : ''} title="Move report item up">↑ Up</button>
      <button class="btn secondary small" data-move-item="${esc(i.id)}" data-move-delta="1" ${index === sorted.length - 1 ? 'disabled' : ''} title="Move report item down">↓ Down</button>
      <button class="btn secondary small" data-edit-item="${esc(i.id)}">Edit</button>
    </div></td>
  </tr>`).join('');
  qsa('[data-edit-item]').forEach(b => { b.onclick = () => openItemModal(state.items.find(i => i.id === b.dataset.editItem)); });
  qsa('[data-move-item]').forEach(b => { b.onclick = () => moveReportItem(b.dataset.moveItem, Number(b.dataset.moveDelta)); });
}

async function moveReportItem(itemId, delta) {
  const result = moveOrderedItem(state.items, itemId, delta, 'sort_order');
  if (!result.changed) return;
  try {
    await reorderReportItems(result.items.map(item => item.id));
    state.items = result.items;
    renderItems();
    flash('Report item order updated.', 'success');
  } catch (error) {
    flash(error.message || String(error), 'error', 7000);
    await ensureItemsLoaded(true);
  }
}

function openItemModal(i = null) {
  state.editingItem = i; $('#itemModalTitle').textContent = i ? 'Edit Report Item' : 'Add Report Item'; $('#itemId').value = i?.id || ''; $('#itemBuiltin').value = i?.builtin ? 'true' : 'false';
  $('#itemKey').value = i?.key || ''; $('#itemLabel').value = i?.label || ''; $('#itemSection').value = i?.section || 'additional'; $('#itemType').value = i?.input_type || 'free_text';
  $('#itemActive').value = String(i?.active ?? true); $('#itemOptions').value = (i?.options || []).join(', '); $('#itemFrom').value = i?.effective_from || todayISO(); $('#itemTo').value = i?.effective_to || '';
  $('#itemKey').disabled = !!i; $('#itemType').disabled = !!i?.builtin; openModal('#itemModal');
}
async function saveItem(event) {
  event.preventDefault();
  try {
    const old = state.editingItem;
    await saveReportItem({ id: old?.id || undefined, key: $('#itemKey').value.trim(), label: $('#itemLabel').value.trim(), section: $('#itemSection').value, input_type: old?.builtin ? old.input_type : $('#itemType').value, options: $('#itemOptions').value.split(',').map(x => x.trim()).filter(Boolean), active: $('#itemActive').value === 'true', effective_from: $('#itemFrom').value || todayISO(), effective_to: $('#itemTo').value || null, builtin: old?.builtin || false, manager_slot: old?.manager_slot || null, config: old?.config || { storage: 'dynamicItems' } });
    closeModal('#itemModal'); flash('Report item saved.', 'success'); await ensureItemsLoaded(true);
  } catch (error) { flash(error.message || String(error), 'error', 7000); }
}
async function renderAudit() { const rows = await getAuditLog(200); $('#auditRows').innerHTML = rows.length ? rows.map(r => `<div class="audit-row"><b>${esc(formatDateTime(r.occurred_at))}</b> · <code>${esc(r.action)}</code> · ${esc(r.entity_type || '')} ${esc(r.entity_id || '')}<div class="muted">${esc(JSON.stringify(r.details || {}))}</div></div>`).join('') : '<div class="muted">No audit entries yet.</div>'; }
