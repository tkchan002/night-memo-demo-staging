import { DB_MODE, supabase } from '../client.js';
import { demoRead, demoWrite, uid } from '../demo-state.js';
import { defaultReportDate } from '../range.js';

export async function getWardReport(wardId, date = defaultReportDate()) {
  if (DB_MODE === 'demo') return demoRead().ward_reports.find(r => r.ward_id === wardId && r.report_date === date) || null;
  const { data, error } = await supabase.from('ward_reports').select('*').eq('ward_id', wardId).eq('report_date', date).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getReportsForDate(date = defaultReportDate()) {
  if (DB_MODE === 'demo') return demoRead().ward_reports.filter(r => r.report_date === date);
  const { data, error } = await supabase.from('ward_reports').select('*').eq('report_date', date);
  if (error) throw error;
  return data || [];
}

export async function getRecentReports(wardId, limit = 30) {
  if (DB_MODE === 'demo') return demoRead().ward_reports.filter(r => r.ward_id === wardId).sort((a, b) => b.report_date.localeCompare(a.report_date)).slice(0, limit);
  const { data, error } = await supabase.from('ward_reports').select('*').eq('ward_id', wardId).order('report_date', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getPreviousReport(wardId, beforeDate) {
  if (DB_MODE === 'demo') return demoRead().ward_reports.filter(r => r.ward_id === wardId && r.report_date < beforeDate).sort((a, b) => b.report_date.localeCompare(a.report_date))[0] || null;
  const { data, error } = await supabase.from('ward_reports').select('*').eq('ward_id', wardId).lt('report_date', beforeDate).order('report_date', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertWardReport(row) {
  const now = new Date().toISOString();
  if (DB_MODE === 'demo') {
    const state = demoRead();
    const index = state.ward_reports.findIndex(r => r.ward_id === row.ward_id && r.report_date === row.report_date);
    const out = { ...row, id: index >= 0 ? state.ward_reports[index].id : uid('report'), created_at: index >= 0 ? state.ward_reports[index].created_at : now, updated_at: now };
    if (index >= 0) state.ward_reports[index] = out;
    else state.ward_reports.push(out);
    demoWrite(state);
    return out;
  }
  const { data, error } = await supabase.from('ward_reports').upsert({ ...row, updated_at: now }, { onConflict: 'ward_id,report_date' }).select().single();
  if (error) throw error;
  return data;
}
