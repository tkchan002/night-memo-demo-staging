import { DB_MODE, supabase } from '../client.js';
import { demoRead } from '../demo-state.js';

function shiftWindow(reportingDate) {
  const start = new Date(`${reportingDate}T12:00:00+08:00`);
  if (Number.isNaN(start.getTime())) throw new Error('Invalid reporting night date.');
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function newestFirst(a, b) {
  return String(b.updated_at || b.saved_at || b.submitted_at || '')
    .localeCompare(String(a.updated_at || a.saved_at || a.submitted_at || ''));
}

export async function getCurrentNightRosterSnapshots(reportingDate) {
  const { start, end } = shiftWindow(reportingDate);

  if (DB_MODE === 'demo') {
    const state = demoRead();
    const rows = [
      ...((state.ward_report_drafts || []).map(row => ({ ...row, source_kind: 'ward_report_drafts' }))),
      ...((state.ward_reports || []).map(row => ({ ...row, source_kind: 'ward_reports' }))),
    ].filter(row => {
      const stamp = new Date(row.updated_at || row.saved_at || row.submitted_at || row.created_at || 0);
      return stamp >= start && stamp < end;
    }).sort(newestFirst);

    const seen = new Set();
    return rows.filter(row => {
      if (seen.has(row.ward_id)) return false;
      seen.add(row.ward_id);
      return true;
    }).map(row => ({
      ward_id: row.ward_id,
      reporting_date: row.report_date,
      nurses: Array.isArray(row.payload?.nurses) ? row.payload.nurses : [],
      updated_at: row.updated_at || row.saved_at || row.submitted_at || row.created_at,
      source_kind: row.source_kind,
    }));
  }

  const { data, error } = await supabase
    .from('night_roster_snapshots')
    .select('ward_id,reporting_date,nurses,updated_at,source_kind')
    .gte('updated_at', start.toISOString())
    .lt('updated_at', end.toISOString())
    .order('updated_at', { ascending: false });

  if (error) {
    const text = `${error.code || ''} ${error.message || ''} ${error.details || ''}`;
    if (/night_roster_snapshots|does not exist|schema cache|PGRST205/i.test(text)) {
      throw new Error('Night Operations roster support is not installed in Supabase. Run 20260929_night_operations_roster.sql first.');
    }
    throw error;
  }

  const seen = new Set();
  return (data || []).filter(row => {
    if (seen.has(row.ward_id)) return false;
    seen.add(row.ward_id);
    return true;
  });
}
