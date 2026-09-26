import * as db from '../data/index.js';
import { effectiveItems, mergePayloadPreservingUnknown, normalizeReportPayload, snapshotReportItems } from '../domain/report-model.js';
import { validateReportPayload } from '../domain/report-validation.js';

export async function loadWardReportContext(wardId, date) {
  const [operational, capacity, allItems, staff, report] = await Promise.all([
    db.isWardOperational(wardId, date), db.getWardCapacity(wardId, date),
    db.getReportItems(date, true), db.getWardStaff(wardId, false), db.getWardReport(wardId, date),
  ]);
  const items = report?.report_item_snapshot?.length
    ? report.report_item_snapshot.map(i => ({ ...i, __historical: true }))
    : effectiveItems(allItems, date, { includeInactiveHistorical: false });
  return { operational, capacity: Number(capacity) || 0, items, allItems, staff: staff || [], report };
}

export async function loadHistoricalReportContext(wardId, report) {
  const [allItems, capacity] = await Promise.all([
    db.getReportItems(report.report_date, true),
    report.bed_capacity_snapshot != null ? Promise.resolve(report.bed_capacity_snapshot) : db.getWardCapacity(wardId, report.report_date),
  ]);
  const items = report.report_item_snapshot?.length
    ? report.report_item_snapshot.map(i => ({ ...i, __historical: true }))
    : effectiveItems(allItems, report.report_date, { includeInactiveHistorical: true }).map(i => ({ ...i, __historical: true }));
  return { report, capacity, items };
}

export async function loadManagerNight(date, section) {
  const [allItems, wards, reports] = await Promise.all([
    db.getReportItems(date, true), db.getWardsForDate(date, section), db.getReportsForDate(date),
  ]);
  const items = effectiveItems(allItems, date, { includeInactiveHistorical: false });
  const capacities = await Promise.all(wards.map(w => db.getWardCapacity(w.id, date)));
  return {
    items,
    bundle: wards.map((ward, i) => ({ ward, capacity: capacities[i], report: reports.find(r => r.ward_id === ward.id) || null })),
  };
}

export async function loadFullWardReport(wardId, date, ward, fallbackItems = []) {
  const [report, capacity, allItems] = await Promise.all([
    db.getWardReport(wardId, date), db.getWardCapacity(wardId, date), db.getReportItems(date, true),
  ]);
  const items = report?.report_item_snapshot?.length
    ? report.report_item_snapshot.map(i => ({ ...i, __historical: true }))
    : (effectiveItems(allItems, date, { includeInactiveHistorical: true }).length ? effectiveItems(allItems, date, { includeInactiveHistorical: true }) : fallbackItems);
  return { ward, report, capacity, items };
}

export async function saveWardReport({ wardId, date, editedPayload, existingReport, capacity, items }) {
  const merged = mergePayloadPreservingUnknown(existingReport?.payload, editedPayload);
  const validation = validateReportPayload(merged, { capacity });
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const row = {
    ward_id: wardId,
    report_date: date,
    payload: { ...normalizeReportPayload(validation.payload), savedAt: new Date().toISOString() },
    bed_capacity_snapshot: capacity,
    form_version: 2,
    report_item_snapshot: snapshotReportItems(items),
  };
  // Keep compatibility with deployments that have not yet added snapshot columns.
  try {
    return { report: await db.upsertWardReport(row), warnings: validation.warnings };
  } catch (error) {
    if (/report_item_snapshot/i.test(error?.message || '')) {
      delete row.report_item_snapshot;
      return { report: await db.upsertWardReport(row), warnings: validation.warnings };
    }
    throw error;
  }
}
