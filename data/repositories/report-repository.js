import { DB_MODE, supabase } from '../client.js';
import { demoRead, demoWrite, uid } from '../demo-state.js';
import { defaultReportDate } from '../range.js';
import { SUBMISSION_WINDOW_MINUTES, isRecentSubmission, reportSubmittedAt, submissionCutoff } from '../../domain/report-session.js';

function newestFirst(a, b) {
  return String(reportSubmittedAt(b) || '').localeCompare(String(reportSubmittedAt(a) || ''));
}

function isMissingSubmittedAt(error) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return /submitted_at/i.test(text) && /column|schema|does not exist|could not find/i.test(text);
}

function latestPerWard(rows) {
  const seen = new Set();
  return [...(rows || [])].sort(newestFirst).filter(row => {
    if (seen.has(row.ward_id)) return false;
    seen.add(row.ward_id);
    return true;
  });
}

export async function getWardReport(wardId, date = defaultReportDate()) {
  if (DB_MODE === 'demo') {
    return demoRead().ward_reports
      .filter(r => r.ward_id === wardId && r.report_date === date)
      .sort(newestFirst)[0] || null;
  }
  let result = await supabase
    .from('ward_reports')
    .select('*')
    .eq('ward_id', wardId)
    .eq('report_date', date)
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error && isMissingSubmittedAt(result.error)) {
    result = await supabase.from('ward_reports').select('*').eq('ward_id', wardId).eq('report_date', date).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  }
  if (result.error) throw result.error;
  return result.data;
}

export async function getReportsForDate(date = defaultReportDate()) {
  if (DB_MODE === 'demo') {
    return latestPerWard(demoRead().ward_reports.filter(r => r.report_date === date));
  }
  let result = await supabase.from('ward_reports').select('*').eq('report_date', date).order('submitted_at', { ascending: false, nullsFirst: false }).order('updated_at', { ascending: false });
  if (result.error && isMissingSubmittedAt(result.error)) result = await supabase.from('ward_reports').select('*').eq('report_date', date).order('updated_at', { ascending: false });
  if (result.error) throw result.error;
  return latestPerWard(result.data || []);
}

export async function getReportsSince(minutes = SUBMISSION_WINDOW_MINUTES, now = new Date()) {
  if (DB_MODE === 'demo') {
    return latestPerWard(demoRead().ward_reports.filter(r => isRecentSubmission(r, now, minutes)));
  }
  const cutoff = submissionCutoff(now, minutes).toISOString();
  let result = await supabase.from('ward_reports').select('*').gte('submitted_at', cutoff).order('submitted_at', { ascending: false });
  if (result.error && isMissingSubmittedAt(result.error)) result = await supabase.from('ward_reports').select('*').gte('updated_at', cutoff).order('updated_at', { ascending: false });
  if (result.error) throw result.error;
  return latestPerWard(result.data || []);
}

export async function getRecentReports(wardId, limit = 30) {
  if (DB_MODE === 'demo') {
    return demoRead().ward_reports
      .filter(r => r.ward_id === wardId)
      .sort(newestFirst)
      .slice(0, limit);
  }
  let result = await supabase.from('ward_reports').select('*').eq('ward_id', wardId).order('submitted_at', { ascending: false, nullsFirst: false }).order('updated_at', { ascending: false }).limit(limit);
  if (result.error && isMissingSubmittedAt(result.error)) result = await supabase.from('ward_reports').select('*').eq('ward_id', wardId).order('updated_at', { ascending: false }).limit(limit);
  if (result.error) throw result.error;
  return result.data || [];
}

export async function getPreviousReport(wardId, beforeDate) {
  if (DB_MODE === 'demo') {
    const rows = demoRead().ward_reports
      .filter(r => r.ward_id === wardId && r.report_date <= beforeDate)
      .sort(newestFirst)
      .slice(0, 2);
    return rows[1] || null;
  }
  let result = await supabase.from('ward_reports').select('*').eq('ward_id', wardId).lte('report_date', beforeDate).order('submitted_at', { ascending: false, nullsFirst: false }).order('updated_at', { ascending: false }).limit(2);
  if (result.error && isMissingSubmittedAt(result.error)) result = await supabase.from('ward_reports').select('*').eq('ward_id', wardId).lte('report_date', beforeDate).order('updated_at', { ascending: false }).limit(2);
  if (result.error) throw result.error;
  return (result.data || [])[1] || null;
}

export async function saveWardReportSession(row, windowMinutes = SUBMISSION_WINDOW_MINUTES) {
  const now = new Date();
  const nowISO = now.toISOString();

  if (DB_MODE === 'demo') {
    const state = demoRead();
    const current = state.ward_reports
      .filter(r => r.ward_id === row.ward_id && isRecentSubmission(r, now, windowMinutes))
      .sort(newestFirst)[0];
    const index = current ? state.ward_reports.findIndex(r => r.id === current.id) : -1;
    const out = {
      ...current,
      ...row,
      id: current?.id || uid('report'),
      created_at: current?.created_at || nowISO,
      submitted_at: nowISO,
      updated_at: nowISO,
    };
    if (index >= 0) state.ward_reports[index] = out;
    else state.ward_reports.push(out);
    demoWrite(state);
    return out;
  }

  const { data, error } = await supabase.rpc('save_ward_report_session', {
    p_row: row,
    p_window_minutes: Math.max(1, Number(windowMinutes) || SUBMISSION_WINDOW_MINUTES),
  });
  if (!error) return data;

  // Incremental-deployment fallback: until the session migration is installed,
  // retain the old one-report-per-date behavior instead of breaking saves.
  const text = `${error.code || ''} ${error.message || ''} ${error.details || ''}`;
  if (/PGRST202|42883|could not find.*function|function .* does not exist/i.test(text)) {
    const { data: fallback, error: fallbackError } = await supabase
      .from('ward_reports')
      .upsert({ ...row, updated_at: nowISO }, { onConflict: 'ward_id,report_date' })
      .select()
      .single();
    if (fallbackError) throw fallbackError;
    return fallback;
  }
  throw error;
}

// Compatibility export for older callers.
export const upsertWardReport = saveWardReportSession;
