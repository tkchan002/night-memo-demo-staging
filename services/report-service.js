import * as db from '../data/index.js';
import { effectiveItems, mergePayloadPreservingUnknown, normalizeReportPayload, snapshotReportItems } from '../domain/report-model.js';
import { validateReportPayload } from '../domain/report-validation.js';

function itemsForReport(allItems, date, report, includeInactiveHistorical = false) {
  return report?.report_item_snapshot?.length
    ? report.report_item_snapshot.map(i => ({ ...i, __historical: true }))
    : effectiveItems(allItems || [], date, { includeInactiveHistorical });
}

export async function loadWardReportContext(wardId, date) {
  // Preferred path: a single Postgres round trip. The repository returns null
  // until the optional performance migration is installed, so deployments can
  // be upgraded incrementally.
  const snapshot = await db.getWardNightSnapshot(wardId, date);
  if (snapshot) {
    const allItems = snapshot.items || [];
    const report = snapshot.report || null;
    const items = itemsForReport(allItems, date, report, false);
    return {
      operational: Boolean(snapshot.operational),
      capacity: Number(snapshot.capacity) || 0,
      items,
      allItems,
      staff: snapshot.staff || [],
      report,
    };
  }

  const [operational, capacity, allItems, staff, report] = await Promise.all([
    db.isWardOperational(wardId, date),
    db.getWardCapacity(wardId, date),
    db.getReportItems(date, true),
    db.getWardStaff(wardId, false),
    db.getWardReport(wardId, date),
  ]);
  const items = itemsForReport(allItems, date, report, false);
  return { operational, capacity: Number(capacity) || 0, items, allItems, staff: staff || [], report };
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

export async function loadManagerNight(date, section) {
  // Preferred path: wards, reports, capacities and item definitions arrive in
  // one RPC response. Filtering into Male/Female/Other remains a domain/UI rule.
  const snapshot = await db.getManagerNightSnapshot(date);
  if (snapshot) {
    const allItems = snapshot.items || [];
    const allWards = snapshot.wards || [];
    const reports = snapshot.reports || [];
    const capacities = Object.fromEntries(
      (snapshot.capacities || []).map(row => [row.ward_id, row.bed_capacity]),
    );
    const wards = allWards.filter(ward => !section || ward.manager_section === section);
    const items = effectiveItems(allItems, date, { includeInactiveHistorical: false });
    return {
      items,
      allWards,
      bundle: wards.map(ward => ({
        ward,
        capacity: capacities[ward.id] ?? null,
        report: reports.find(r => r.ward_id === ward.id) || null,
      })),
    };
  }

  // Fallback path: still avoid the old N+1 capacity pattern. Capacities for all
  // open wards are fetched with one query rather than one query per ward.
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
    bundle: wards.map(ward => ({
      ward,
      capacity: capacityByWard[ward.id] ?? null,
      report: reports.find(r => r.ward_id === ward.id) || null,
    })),
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
