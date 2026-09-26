import { getWardsForDate, getWardCapacity } from './repositories/ward-repository.js';
import { getReportsForDate } from './repositories/report-repository.js';
import { defaultReportDate } from './range.js';

/** @deprecated Prefer services/report-service.js. Kept for old callers during migration. */
export async function getNightBundle(date = defaultReportDate(), section = 'Male') {
  const wards = await getWardsForDate(date, section);
  const reports = await getReportsForDate(date);
  const capacities = await Promise.all(wards.map(ward => getWardCapacity(ward.id, date)));
  return wards.map((ward, index) => ({ ward, capacity: capacities[index], report: reports.find(r => r.ward_id === ward.id) || null }));
}
