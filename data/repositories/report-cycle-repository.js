/** Typed report persistence; never uses rolling submission time windows. */
import { DB_MODE, supabase } from '../client.js';
import { demoRead, demoWrite, uid } from '../demo-state.js';
import { requireMemoType } from '../../domain/report-cycle.js';

function missingMigration(error) {
  return /PGRST202|42883|42703|could not find|does not exist|unknown column/i.test(`${error?.code || ''} ${error?.message || ''}`);
}
function migrationError(error) {
  if (missingMigration(error)) throw new Error('PM/Night reporting database migration is not installed. Run supabase/migrations/20261012_pm_night_cycles.sql in Supabase SQL Editor before submitting.');
  throw error;
}
export async function getWardCycleReport(wardId, date, type) {
  requireMemoType(type);
  if (DB_MODE === 'demo') return demoRead().ward_reports.find(r => r.ward_id === wardId && r.report_date === date && r.report_type === type) || null;
  const { data, error } = await supabase.from('ward_reports').select('*').eq('ward_id', wardId).eq('report_date', date).eq('report_type', type).maybeSingle();
  if (error) migrationError(error);
  return data;
}
export async function getCycleReports(date) {
  if (DB_MODE === 'demo') return demoRead().ward_reports.filter(r => r.report_date === date && ['pm','night'].includes(r.report_type));
  const { data, error } = await supabase.from('ward_reports').select('*').eq('report_date', date).in('report_type', ['pm', 'night']);
  if (error) migrationError(error);
  return data || [];
}
export async function submitWardCycleReport(row) {
  requireMemoType(row.report_type);
  if (DB_MODE === 'demo') {
    const state = demoRead();
    const index = state.ward_reports.findIndex(r => r.ward_id === row.ward_id && r.report_date === row.report_date && r.report_type === row.report_type);
    const old = index < 0 ? null : state.ward_reports[index];
    const now = new Date().toISOString();
    const report = { ...old, ...row, id: old?.id || uid('report'), submitted_at: now, updated_at: now, created_at: old?.created_at || now };
    if (index < 0) state.ward_reports.push(report); else state.ward_reports[index] = report;
    demoWrite(state); return report;
  }
  const { data, error } = await supabase.rpc('submit_ward_cycle_report', { p_row: row });
  if (error) migrationError(error);
  return data;
}
export async function getWardCycleDraft(wardId, date, type) {
  requireMemoType(type);
  if (DB_MODE === 'demo') return (demoRead().ward_report_drafts || []).find(r => r.ward_id === wardId && r.report_date === date && r.report_type === type) || null;
  const { data, error } = await supabase.rpc('get_ward_cycle_draft', { p_ward_id: wardId, p_report_date: date, p_report_type: type });
  if (error) migrationError(error);
  return data;
}
export async function saveWardCycleDraft(row) {
  requireMemoType(row.report_type);
  if (DB_MODE === 'demo') {
    const state = demoRead(); state.ward_report_drafts ||= [];
    const index = state.ward_report_drafts.findIndex(r => r.ward_id === row.ward_id && r.report_date === row.report_date && r.report_type === row.report_type);
    const now = new Date().toISOString(); const draft = { ...(index >= 0 ? state.ward_report_drafts[index] : {}), ...row, updated_at: now };
    if (index < 0) state.ward_report_drafts.push(draft); else state.ward_report_drafts[index] = draft;
    demoWrite(state); return draft;
  }
  const { data, error } = await supabase.rpc('save_ward_cycle_draft', { p_row: row });
  if (error) migrationError(error);
  return data;
}
export async function deleteWardCycleDraft(wardId, date, type) {
  requireMemoType(type);
  if (DB_MODE === 'demo') {
    const state = demoRead(); state.ward_report_drafts = (state.ward_report_drafts || []).filter(r => !(r.ward_id === wardId && r.report_date === date && r.report_type === type));
    demoWrite(state); return true;
  }
  const { data, error } = await supabase.rpc('delete_ward_cycle_draft', { p_ward_id: wardId, p_report_date: date, p_report_type: type });
  if (error) migrationError(error);
  return data;
}
