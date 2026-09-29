import { DB_MODE, supabase } from '../client.js';
import { demoRead, demoWrite, uid } from '../demo-state.js';

function nowISO() { return new Date().toISOString(); }

export async function getManagerMemo(reportingDate) {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    return (state.manager_memos || []).find(row => row.reporting_date === reportingDate) || null;
  }
  const { data, error } = await supabase
    .from('manager_memos')
    .select('*')
    .eq('reporting_date', reportingDate)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveManagerMemo({ reportingDate, document, sourceSnapshot, expectedRevision = 0, status = 'draft' }) {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    state.manager_memos ||= [];
    const index = state.manager_memos.findIndex(row => row.reporting_date === reportingDate);
    const current = index >= 0 ? state.manager_memos[index] : null;
    if ((current?.revision || 0) !== Number(expectedRevision || 0)) {
      const error = new Error('This Night Memo was changed in another window. Reload before saving again.');
      error.code = 'MANAGER_MEMO_CONFLICT';
      throw error;
    }
    const now = nowISO();
    const row = {
      ...current,
      id: current?.id || uid('manager-memo'),
      reporting_date: reportingDate,
      document,
      source_snapshot: sourceSnapshot || [],
      status,
      revision: (current?.revision || 0) + 1,
      created_at: current?.created_at || now,
      updated_at: now,
      finalized_at: status === 'finalized' ? (current?.finalized_at || now) : null,
    };
    if (index >= 0) state.manager_memos[index] = row;
    else state.manager_memos.push(row);
    demoWrite(state);
    return row;
  }

  const { data, error } = await supabase.rpc('save_manager_memo', {
    p_reporting_date: reportingDate,
    p_document: document,
    p_source_snapshot: sourceSnapshot || [],
    p_expected_revision: Number(expectedRevision || 0),
    p_status: status,
  });
  if (error) throw error;
  return data;
}
