import * as db from '../data/index.js';
import { todayISO } from '../core/dates.js';
import { effectiveItems, mergePayloadPreservingUnknown, normalizeReportPayload, snapshotReportItems } from '../domain/report-model.js';
import { validateReportPayload } from '../domain/report-validation.js';
import { SUBMISSION_WINDOW_MINUTES } from '../domain/report-session.js';

function itemsForReport(allItems, date, report, includeInactiveHistorical = false) {
  return report?.report_item_snapshot?.length
    ? report.report_item_snapshot.map(i => ({ ...i, __historical: true }))
    : effectiveItems(allItems || [], date, { includeInactiveHistorical });
}

export async function loadWardReportContext(wardId, date) {
  const [snapshot, draft] = await Promise.all([
    db.getWardNightSnapshot(wardId, date),
    db.getWardReportDraft(wardId, date),
  ]);
  if (snapshot) {
    const allItems = snapshot.items || [];
    const report = snapshot.report || null;
    const sourceRecord = draft || report;
    const items = itemsForReport(allItems, date, sourceRecord, false);
    return {
      operational: Boolean(snapshot.operational),
      capacity: Number(snapshot.capacity) || 0,
      items,
      allItems,
      staff: snapshot.staff || [],
      report,
      draft,
    };
  }
  const [operational, capacity, allItems, staff, report] = await Promise.all([
    db.isWardOperational(wardId, date),
    db.getWardCapacity(wardId, date),
    db.getReportItems(date, true),
    db.getWardStaff(wardId, false),
    db.getWardReport(wardId, date),
  ]);
  const sourceRecord = draft || report;
  const items = itemsForReport(allItems, date, sourceRecord, false);
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

export async function loadManagerCurrent(windowMinutes = SUBMISSION_WINDOW_MINUTES) {
  const date = todayISO();
  const snapshot = await db.getManagerRecentSnapshot(windowMinutes);
  if (snapshot) {
    const allItems = snapshot.items || [];
    const allWards = snapshot.wards || [];
    const reports = snapshot.reports || [];
    const capacities = Object.fromEntries(
      (snapshot.capacities || []).map(row => [row.ward_id, row.bed_capacity]),
    );
    const items = effectiveItems(allItems, date, { includeInactiveHistorical: false });
    return {
      date,
      windowMinutes,
      items,
      allWards,
      bundle: allWards.map(ward => ({
        ward,
        capacity: capacities[ward.id] ?? null,
        report: reports.find(r => r.ward_id === ward.id) || null,
      })),
    };
  }

  const [allItems, allWards, reports] = await Promise.all([
    db.getReportItems(date, true),
    db.getWardsForDate(date),
    db.getReportsSince(windowMinutes),
  ]);
  const capacityByWard = await db.getCapacitiesForWards(allWards.map(w => w.id), date);
  const items = effectiveItems(allItems, date, { includeInactiveHistorical: false });
  return {
    date,
    windowMinutes,
    items,
    allWards,
    bundle: allWards.map(ward => ({
      ward,
      capacity: capacityByWard[ward.id] ?? null,
      report: reports.find(r => r.ward_id === ward.id) || null,
    })),
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

function buildWardRow({ wardId, date, editedPayload, existingReport, existingDraft, capacity, items }) {
  const basePayload = existingDraft?.payload || existingReport?.payload;
  const merged = mergePayloadPreservingUnknown(basePayload, editedPayload);
  const validation = validateReportPayload(merged, { capacity });
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return {
    row: {
      ward_id: wardId,
      report_date: date,
      payload: { ...normalizeReportPayload(validation.payload), savedAt: new Date().toISOString() },
      bed_capacity_snapshot: capacity,
      // Keep the registered form version used by the live database FK.
      form_version: 1,
      report_item_snapshot: snapshotReportItems(items),
    },
    warnings: validation.warnings,
  };
}

export async function saveWardDraft({ wardId, date, editedPayload, existingReport, existingDraft, capacity, items }) {
  const { row, warnings } = buildWardRow({ wardId, date, editedPayload, existingReport, existingDraft, capacity, items });
  try {
    return { draft: await db.saveWardReportDraft(row), warnings };
  } catch (error) {
    if (/report_item_snapshot/i.test(error?.message || '')) {
      delete row.report_item_snapshot;
      return { draft: await db.saveWardReportDraft(row), warnings };
    }
    throw error;
  }
}

export async function submitWardReport({ wardId, date, editedPayload, existingReport, existingDraft, capacity, items }) {
  const { row, warnings } = buildWardRow({ wardId, date, editedPayload, existingReport, existingDraft, capacity, items });
  try {
    const report = await db.saveWardReportSession(row, SUBMISSION_WINDOW_MINUTES);
    await db.deleteWardReportDraft(wardId, date);
    return { report, warnings };
  } catch (error) {
    if (/report_item_snapshot/i.test(error?.message || '')) {
      delete row.report_item_snapshot;
      const report = await db.saveWardReportSession(row, SUBMISSION_WINDOW_MINUTES);
      await db.deleteWardReportDraft(wardId, date);
      return { report, warnings };
    }
    throw error;
  }
}

// Compatibility: older callers that used saveWardReport intended a real submission.
export const saveWardReport = submitWardReport;

export async function loadWardSubmissionStatus(wardId, windowMinutes = SUBMISSION_WINDOW_MINUTES) {
  return db.getWardSubmissionStatus(wardId, windowMinutes);
}

