import {
  DB_MODE,
  getAllWards,
  getOperatingPeriods,
  getMaintenanceWardsSnapshot,
  getCapacitiesForWards,
  getReportItems,
  getWardStaffForWards,
  importGeneratedDemoBatch,
  listGeneratedDemoBatches,
  deleteGeneratedDemoBatch,
  recordAudit,
} from '../data/index.js';
import { qs, qsa, esc } from '../core/dom.js';
import { todayISO, formatDateTime } from '../core/dates.js';
import { flash } from '../core/ui.js';
import { DEMO_SCENARIOS, generateDemoDataBundle, summarizeGeneratedReport } from '../domain/demo-generator.js';

const $ = qs;
const state = { prepared: null, initialized: false };

function activeOnDate(ward, periods, date) {
  if (periods?.length) {
    return periods.some(period => period.ward_id === ward.id
      && period.start_date <= date
      && (!period.end_date || period.end_date >= date));
  }
  return ward?.active !== false;
}

function setStatus(message, type = 'muted') {
  const el = $('#demoImportStatus');
  if (!el) return;
  el.className = `demo-status ${type}`;
  el.textContent = message;
}

function seedValue() {
  const raw = String($('#demoSeed')?.value || '').trim();
  if (raw && Number.isFinite(Number(raw))) return Number(raw);
  const generated = Date.now();
  if ($('#demoSeed')) $('#demoSeed').value = String(generated);
  return generated;
}

async function readCurrentConfiguration(date) {
  const snapshot = await getMaintenanceWardsSnapshot();
  const wards = snapshot?.wards || await getAllWards();
  const periods = snapshot?.periods || await getOperatingPeriods();
  const activeWards = wards.filter(ward => activeOnDate(ward, periods, date));
  if (!activeWards.length) throw new Error(`No active wards are configured for ${date}.`);

  const wardIds = activeWards.map(ward => ward.id);
  const [capacities, items, staffByWard] = await Promise.all([
    getCapacitiesForWards(wardIds, date),
    getReportItems(date, true),
    getWardStaffForWards(wardIds, false),
  ]);

  return { wards, periods, activeWards, capacities, items, staffByWard };
}

function statusLabel(value) {
  if (value === null) return '<span class="demo-coverage-na">N/A</span>';
  return value
    ? '<span class="demo-coverage-ok">Covered</span>'
    : '<span class="demo-coverage-miss">Missing</span>';
}

function renderConfiguration(bundle) {
  const host = $('#demoConfigurationSummary');
  if (!host) return;
  host.innerHTML = `
    <div class="demo-summary-item"><b>${esc(bundle.meta.active_wards)}</b><span>Active wards</span></div>
    <div class="demo-summary-item"><b>${esc(bundle.meta.configured_report_items)}</b><span>Effective report items</span></div>
    <div class="demo-summary-item"><b>${esc(bundle.meta.custom_report_items)}</b><span>Custom report items</span></div>
    <div class="demo-summary-item"><b>${esc(bundle.meta.configured_staff)}</b><span>Configured staff records</span></div>
    <div class="demo-summary-item"><b>${esc(bundle.meta.mixed_gender_wards)}</b><span>Mixed-gender wards</span></div>
    <div class="demo-summary-item"><b>${esc(bundle.reports.length)}</b><span>Reports in batch</span></div>`;
}

function renderCoverage(bundle) {
  const host = $('#demoCoverageSummary');
  if (!host) return;
  const c = bundle.coverage || {};
  const item = c.configured_items || { configured: 0, covered: 0, missing: [] };
  const rows = [
    ['Admission / movement counts', c.movement_counts, 'Admissions, discharge, death and transfers all exercised'],
    ['Total patient count', c.total_patient, 'Configured capacity respected'],
    ['Empty bed count', c.empty_bed_count, 'Derived from capacity and patient count'],
    ['Configured report items', item.configured ? item.covered === item.configured : true, item.configured ? `${item.covered}/${item.configured}` : 'No configurable items'],
    ['Patient List', c.patient_list, 'Bed, name and condition/progress'],
    ['Patient List: Nil Special', c.patient_nil_state, 'Nil checkbox path also exercised'],
    ['Subspecialty Consultation', c.consultation, 'Bed, name and pending consultation'],
    ['Consultation: Nil', c.consultation_nil_state, 'Nil checkbox path also exercised'],
    ['Intubation Record', c.intubation, 'All eight columns'],
    ['Intubation: Nil', c.intubation_nil_state, 'Nil checkbox path also exercised'],
    ['Next Day Early Bird', c.early_bird, 'Bed and destination'],
    ['Night Runner', c.night_runner, 'Runner flag on Night Nurse'],
    ['Free-text / relief nurse', c.free_text_nurse, 'Tests non-database nurse entry'],
    ['Configured ward staff nurse', c.ward_staff_nurse, c.ward_staff_nurse === null ? 'No configured staff available' : 'Tests staffId / ward_staff source'],
    ['Mixed empty-bed detail', c.mixed_empty_bed_detail, c.mixed_empty_bed_detail === null ? 'No mixed-gender ward configured' : 'Location, gender and remark'],
    ['Signature', c.signature, 'Rank, name and appointment'],
    ['AM / PM staffing', c.staffing_counts, 'Numeric headcount, including 0.5 increments'],
    ['Bed-or-count: By Bed', c.bed_or_count_beds_mode, c.bed_or_count_beds_mode === null ? 'No bed-or-count item configured' : 'Bed selection mode exercised'],
    ['Bed-or-count: By Count', c.bed_or_count_count_mode, c.bed_or_count_count_mode === null ? 'No bed-or-count item configured' : 'Numeric count mode exercised'],
  ];
  host.innerHTML = `<div class="demo-coverage-grid">${rows.map(([label, value, note]) => `
    <div class="demo-coverage-row">
      <span><b>${esc(label)}</b><small>${esc(note)}</small></span>
      ${statusLabel(value)}
    </div>`).join('')}</div>${item.missing?.length ? `<div class="demo-coverage-warning">Uncovered configured item keys: ${esc(item.missing.join(', '))}</div>` : ''}`;
}

function renderPreview(bundle) {
  const currentByWard = new Map(bundle.reports.filter(report => report.session === 'current').map(report => [report.ward_name, report]));
  const previousByWard = new Map(bundle.reports.filter(report => report.session === 'previous').map(report => [report.ward_name, report]));
  const rows = [...previousByWard.keys()].map(name => {
    const current = currentByWard.get(name);
    const previous = previousByWard.get(name);
    const summary = current ? summarizeGeneratedReport(current) : null;
    return `<tr>
      <td><b>${esc(name)}</b></td>
      <td>${current ? `<span class="tag">Submitted ${esc(formatDateTime(current.submitted_at))}</span>` : '<span class="tag subtle">Not submitted in current window</span>'}</td>
      <td>${current ? `${esc(summary.total)} / ${esc(current.preview_capacity)} patients · ${esc(summary.empty)} empty` : '—'}</td>
      <td>${current ? esc(summary.clinical) : '—'}</td>
      <td>${previous ? esc(formatDateTime(previous.submitted_at)) : '—'}</td>
    </tr>`;
  }).join('');

  $('#demoImportPreview').innerHTML = `
    <div class="demo-preview-head">
      <b>${esc(DEMO_SCENARIOS[bundle.scenario]?.label || bundle.scenario)}</b>
      <span>${esc(bundle.description)}</span>
      <span>Seed ${esc(bundle.seed)} · generator v${esc(bundle.generator_version || 1)}</span>
    </div>
    <div class="table-scroll"><table class="data-table"><thead><tr><th>Ward</th><th>Current window</th><th>Occupancy</th><th>Clinical attention</th><th>Previous session</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function generatePreview() {
  state.prepared = null;
  $('#demoImportBtn').disabled = true;
  $('#demoImportPreview').innerHTML = '';
  $('#demoConfigurationSummary').innerHTML = '';
  $('#demoCoverageSummary').innerHTML = '';
  const button = $('#demoGenerateBtn');
  button.disabled = true;
  const date = $('#demoReportDate').value || todayISO();
  setStatus('Reading the selected date configuration, ward capacities, report items and ward staff...');
  try {
    const config = await readCurrentConfiguration(date);
    const bundle = generateDemoDataBundle({
      wards: config.wards,
      periods: config.periods,
      capacities: config.capacities,
      items: config.items,
      staffByWard: config.staffByWard,
      scenario: $('#demoScenario').value || 'typical',
      reportDate: date,
      now: new Date(),
      seed: seedValue(),
    });
    state.prepared = bundle;
    renderConfiguration(bundle);
    renderCoverage(bundle);
    renderPreview(bundle);
    $('#demoImportBtn').disabled = DB_MODE !== 'supabase';
    setStatus(DB_MODE === 'supabase'
      ? `${bundle.meta.active_wards} wards generated from the selected configuration. Review coverage before importing.`
      : 'Preview generated. Import is disabled because this browser is not connected to Supabase.', DB_MODE === 'supabase' ? 'success' : 'warning');
  } catch (error) {
    setStatus(error.message || String(error), 'error');
    flash(error.message || String(error), 'error', 9000);
  } finally {
    button.disabled = false;
  }
}

async function commitPreparedBatch() {
  if (!state.prepared) return;
  const bundle = state.prepared;
  const count = bundle.reports.length;
  if (!confirm(`Import ${count} generated reports into the normal ward_reports table? Manager, Ward History and printing will treat them as ordinary submissions.`)) return;
  const button = $('#demoImportBtn');
  button.disabled = true;
  setStatus('Importing generated reports into Supabase...');
  try {
    const result = await importGeneratedDemoBatch(bundle);
    await recordAudit('demo_data_generate', 'demo_data_batch', result?.batch_id || null, {
      scenario: bundle.scenario,
      seed: bundle.seed,
      report_date: bundle.reports[0]?.report_date || null,
      generator_version: bundle.generator_version || 1,
      report_count: result?.report_count ?? count,
      active_wards: bundle.meta.active_wards,
      current_submissions: bundle.meta.current_submissions,
    });
    flash(`${result?.report_count ?? count} generated Night Memo reports imported.`, 'success', 8000);
    setStatus('Import complete. Manager, Ward History and printing can now read the generated reports.', 'success');
    state.prepared = null;
    $('#demoImportPreview').innerHTML = '';
    await refreshGeneratedDemoBatches();
  } catch (error) {
    button.disabled = false;
    setStatus(error.message || String(error), 'error');
    flash(error.message || String(error), 'error', 10000);
  }
}

export async function refreshGeneratedDemoBatches() {
  const host = $('#demoBatchRows');
  if (!host) return;
  if (DB_MODE !== 'supabase') {
    host.innerHTML = '<div class="muted">Generated batch tracking is available only when connected to Supabase.</div>';
    return;
  }
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
    await refreshGeneratedDemoBatches();
  } catch (error) {
    flash(error.message || String(error), 'error', 10000);
  }
}

function invalidatePrepared(message = 'Configuration controls changed. Generate a new preview before importing.') {
  state.prepared = null;
  const importButton = $('#demoImportBtn');
  if (importButton) importButton.disabled = true;
  const preview = $('#demoImportPreview');
  const configuration = $('#demoConfigurationSummary');
  const coverage = $('#demoCoverageSummary');
  if (preview) preview.innerHTML = '<div class="muted">Preview is out of date. Generate a new preview.</div>';
  if (configuration) configuration.innerHTML = '<div class="muted">Configuration will be reread on the next preview.</div>';
  if (coverage) coverage.innerHTML = '<div class="muted">Coverage will be recalculated on the next preview.</div>';
  setStatus(message);
}

export function initMaintenanceTestData() {
  if (state.initialized) return;
  state.initialized = true;
  const date = $('#demoReportDate');
  const scenario = $('#demoScenario');
  const seed = $('#demoSeed');
  if (date) {
    date.value = todayISO();
    date.onchange = () => invalidatePrepared();
  }
  if (scenario) scenario.onchange = () => invalidatePrepared();
  if (seed) seed.oninput = () => invalidatePrepared();
  if ($('#demoGenerateBtn')) $('#demoGenerateBtn').onclick = generatePreview;
  if ($('#demoImportBtn')) $('#demoImportBtn').onclick = commitPreparedBatch;
  if ($('#demoRefreshBatchesBtn')) $('#demoRefreshBatchesBtn').onclick = refreshGeneratedDemoBatches;
  if ($('#demoNewSeedBtn')) $('#demoNewSeedBtn').onclick = () => {
    $('#demoSeed').value = String(Date.now());
    invalidatePrepared('New seed selected. Generate a new preview before importing.');
  };
}
