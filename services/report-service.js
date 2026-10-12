import * as db from '../data/index.js';
import { todayISO } from '../core/dates.js';
import { effectiveItems, mergePayloadPreservingUnknown, normalizeReportPayload, snapshotReportItems } from '../domain/report-model.js';
import { validateReportPayload } from '../domain/report-validation.js';
import { SUBMISSION_WINDOW_MINUTES } from '../domain/report-session.js';
import { reportNightDate, requireMemoType } from '../domain/report-cycle.js';

function itemsForReport(allItems, date, report, includeInactiveHistorical = false) {
  return report?.report_item_snapshot?.length
    ? report.report_item_snapshot.map(i => ({ ...i, __historical: true }))
    : effectiveItems(allItems || [], date, { includeInactiveHistorical });
}

export async function loadWardReportContext(wardId, date, memoType = 'night') {
  requireMemoType(memoType);
  // Deliberately bypass old get_ward_night_context RPC: it has no memo type.
  const [operational, capacity, allItems, staff, report, draft] = await Promise.all([
    db.isWardOperational(wardId, date), db.getWardCapacity(wardId, date),
    db.getReportItems(date, true), db.getWardStaff(wardId, false),
    db.getWardCycleReport(wardId, date, memoType), db.getWardCycleDraft(wardId, date, memoType),
  ]);
  const items = itemsForReport(allItems, date, draft || report, false);
  return { operational, capacity: Number(capacity) || 0, items, allItems, staff: staff || [], report, draft };
}

export async function loadHistoricalReportContext(wardId, report) {
  const [allItems, capacity] = await Promise.all([
    db.getReportItems(report.report_date, true),
    report.bed_capacity_snapshot != null ? Promise.resolve(report.bed_capacity_snapshot) : db.getWardCapacity(wardId, report.report_date),
  ]);
  const items = itemsForReport(allItems, report.report_date, report, true)
    .map(i => ({ ...i, __historical: true }));
  return { report, capacity, items };
}

export async function loadManagerCurrent() {
  const date = reportNightDate();
  // A reporting cycle has two explicit, independently submitted source records.
  const [allItems, allWards, reports] = await Promise.all([
    db.getReportItems(date, true), db.getWardsForDate(date), db.getCycleReports(date),
  ]);
  const capacityByWard = await db.getCapacitiesForWards(allWards.map(w => w.id), date);
  const index = new Map(reports.map(report => [`${report.ward_id}:${report.report_type}`, report]));
  return {
    date, items: effectiveItems(allItems, date, { includeInactiveHistorical: false }), allWards,
    bundle: allWards.map(ward => {
      const pmReport = index.get(`${ward.id}:pm`) || null;
      const nightReport = index.get(`${ward.id}:night`) || null;
      return { ward, capacity: capacityByWard[ward.id] ?? null,
        pmReport, nightReport, report: nightReport || pmReport || null };
    }),
  };
}

// Historical/date-based compatibility path retained for any callers outside the
// current Manager summary.
export async function loadManagerNight(date, section) {
  const snapshot = await db.getManagerNightSnapshot(date);
  if (snapshot) {
    const allItems = snapshot.items || [];
    const allWards = snapshot.wards || [];
    const reports = snapshot.reports || [];
    const capacities = Object.fromEntries((snapshot.capacities || []).map(row => [row.ward_id, row.bed_capacity]));
    const wards = allWards.filter(ward => !section || ward.manager_section === section);
    const items = effectiveItems(allItems, date, { includeInactiveHistorical: false });
    return {
      items,
      allWards,
      bundle: wards.map(ward => ({ ward, capacity: capacities[ward.id] ?? null, report: reports.find(r => r.ward_id === ward.id) || null })),
    };
  }
  const [allItems, allWards, reports] = await Promise.all([
    db.getReportItems(date, true),
    db.getWardsForDate(date),
    db.getReportsForDate(date),
  ]);
  const capacityByWard = await db.getCapacitiesForWards(allWards.map(w => w.id), date);
  const wards = allWards.filter(ward => !section || ward.manager_section === section);
  const items = effectiveItems(allItems, date, { includeInactiveHistorical: false });
  return {
    items,
    allWards,
    bundle: wards.map(ward => ({ ward, capacity: capacityByWard[ward.id] ?? null, report: reports.find(r => r.ward_id === ward.id) || null })),
  };
}

export async function loadFullWardReport(wardId, date, ward, fallbackItems = []) {
  const [report, capacity, allItems] = await Promise.all([
    db.getWardReport(wardId, date), db.getWardCapacity(wardId, date), db.getReportItems(date, true),
  ]);
  const historical = effectiveItems(allItems, date, { includeInactiveHistorical: true });
  const items = report?.report_item_snapshot?.length
    ? report.report_item_snapshot.map(i => ({ ...i, __historical: true }))
    : (historical.length ? historical : fallbackItems);
  return { ward, report, capacity, items };
}

function buildWardRow({ wardId, date, memoType = 'night', editedPayload, existingReport, existingDraft, capacity, items }) {
  requireMemoType(memoType);
  const basePayload = existingDraft?.payload || existingReport?.payload;
  const merged = mergePayloadPreservingUnknown(basePayload, editedPayload);
  const validation = validateReportPayload(merged, { capacity });
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return {
    row: {
      ward_id: wardId,
      report_date: date,
      report_type: memoType,
      payload: { ...normalizeReportPayload(validation.payload), savedAt: new Date().toISOString() },
      bed_capacity_snapshot: capacity,
      // Keep the registered form version used by the live database FK.
      form_version: 1,
      report_item_snapshot: snapshotReportItems(items),
    },
    warnings: validation.warnings,
  };
}

export async function saveWardDraft({ wardId, date, memoType = 'night', editedPayload, existingReport, existingDraft, capacity, items }) {
  const { row, warnings } = buildWardRow({ wardId, date, memoType, editedPayload, existingReport, existingDraft, capacity, items });
  try {
    return { draft: await db.saveWardCycleDraft(row), warnings };
  } catch (error) {
    if (/report_item_snapshot/i.test(error?.message || '')) {
      delete row.report_item_snapshot;
      return { draft: await db.saveWardCycleDraft(row), warnings };
    }
    throw error;
  }
}

export async function submitWardReport({ wardId, date, memoType = 'night', editedPayload, existingReport, existingDraft, capacity, items }) {
  const { row, warnings } = buildWardRow({ wardId, date, memoType, editedPayload, existingReport, existingDraft, capacity, items });
  let report;
  try {
    report = await db.submitWardCycleReport(row);
  } catch (error) {
    if (!/report_item_snapshot/i.test(error?.message || '')) throw error;
    // Compatibility with an older report schema that lacks item snapshots.
    delete row.report_item_snapshot;
    report = await db.submitWardCycleReport(row);
  }
  // The report is already submitted at this point. A draft-cleanup failure must
  // not be presented as submission failure (or prompt an unnecessary resubmit).
  try {
    await db.deleteWardCycleDraft(wardId, date, memoType);
  } catch (error) {
    warnings.push(`Submitted, but previous draft cleanup could not complete: ${error?.message || error}`);
  }
  return { report, warnings };
}

// Compatibility: older callers that used saveWardReport intended a real submission.
export const saveWardReport = submitWardReport;

export async function loadWardSubmissionStatus(wardId, date, memoType = 'night') {
  const report = await db.getWardCycleReport(wardId, date, requireMemoType(memoType));
  return { last_submitted_at: report?.submitted_at || null,
    last_report_id: report?.id || null, submitted: !!report, memo_type: memoType, report_date: date };
}
