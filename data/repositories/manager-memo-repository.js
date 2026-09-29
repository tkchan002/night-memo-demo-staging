import { DB_MODE, supabase } from '../client.js';
import { demoRead, demoWrite, uid } from '../demo-state.js';

function nowISO() { return new Date().toISOString(); }

function conflictError() {
  const error = new Error('This Night Memo was changed in another window. Reload before saving again.');
  error.code = 'MANAGER_MEMO_CONFLICT';
  return error;
}

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

export async function saveManagerMemoRecovery({ reportingDate, document, sourceSnapshot, expectedRevision = 0 }) {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    state.manager_memos ||= [];
    const index = state.manager_memos.findIndex(row => row.reporting_date === reportingDate);
    const current = index >= 0 ? state.manager_memos[index] : null;
    if ((current?.revision || 0) !== Number(expectedRevision || 0)) throw conflictError();
    const now = nowISO();
    const row = {
      ...current,
      id: current?.id || uid('manager-memo'),
      reporting_date: reportingDate,
      document,
      source_snapshot: sourceSnapshot || [],
      status: 'draft',
      revision: (current?.revision || 0) + 1,
      created_at: current?.created_at || now,
      updated_at: now,
    };
    if (index >= 0) state.manager_memos[index] = row;
    else state.manager_memos.push(row);
    demoWrite(state);
    return row;
  }

  const { data, error } = await supabase.rpc('save_manager_memo_recovery', {
    p_reporting_date: reportingDate,
    p_document: document,
    p_source_snapshot: sourceSnapshot || [],
    p_expected_revision: Number(expectedRevision || 0),
  });
  if (error) throw error;
  return data;
}

export async function saveManagerMemoRevision({
  reportingDate,
  document,
  sourceSnapshot,
  expectedRevision = 0,
  revisionType,
  reason,
  actorLabel = '',
}) {
  if (!['draft', 'final'].includes(revisionType)) throw new Error('Invalid Manager memo revision type.');

  if (DB_MODE === 'demo') {
    const state = demoRead();
    state.manager_memos ||= [];
    state.manager_memo_revisions ||= [];
    const index = state.manager_memos.findIndex(row => row.reporting_date === reportingDate);
    const current = index >= 0 ? state.manager_memos[index] : null;
    if ((current?.revision || 0) !== Number(expectedRevision || 0)) throw conflictError();
    const now = nowISO();
    const memo = {
      ...current,
      id: current?.id || uid('manager-memo'),
      reporting_date: reportingDate,
      document,
      source_snapshot: sourceSnapshot || [],
      status: 'draft',
      revision: (current?.revision || 0) + 1,
      created_at: current?.created_at || now,
      updated_at: now,
      finalized_at: revisionType === 'final' ? now : current?.finalized_at || null,
    };
    if (index >= 0) state.manager_memos[index] = memo;
    else state.manager_memos.push(memo);
    const nextNumber = state.manager_memo_revisions
      .filter(row => row.memo_id === memo.id)
      .reduce((max, row) => Math.max(max, Number(row.revision_number || 0)), 0) + 1;
    const revision = {
      id: uid('manager-memo-revision'),
      memo_id: memo.id,
      revision_number: nextNumber,
      revision_type: revisionType,
      reason: reason || (revisionType === 'final' ? 'print' : 'save'),
      document,
      source_snapshot: sourceSnapshot || [],
      created_at: now,
      created_by: null,
      created_by_label: actorLabel || '',
    };
    state.manager_memo_revisions.push(revision);
    demoWrite(state);
    return { memo, revision };
  }

  const { data, error } = await supabase.rpc('save_manager_memo_revision', {
    p_reporting_date: reportingDate,
    p_document: document,
    p_source_snapshot: sourceSnapshot || [],
    p_expected_revision: Number(expectedRevision || 0),
    p_revision_type: revisionType,
    p_reason: reason || (revisionType === 'final' ? 'print' : 'save'),
    p_actor_label: actorLabel || '',
  });
  if (error) throw error;
  return data;
}

export async function listManagerMemoRevisions(reportingDate) {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    const memo = (state.manager_memos || []).find(row => row.reporting_date === reportingDate);
    if (!memo) return [];
    return (state.manager_memo_revisions || [])
      .filter(row => row.memo_id === memo.id)
      .sort((a, b) => Number(b.revision_number || 0) - Number(a.revision_number || 0));
  }
  const { data, error } = await supabase.rpc('list_manager_memo_revisions', {
    p_reporting_date: reportingDate,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function getManagerMemoRevision(revisionId) {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    return (state.manager_memo_revisions || []).find(row => row.id === revisionId) || null;
  }
  const { data, error } = await supabase.rpc('get_manager_memo_revision', {
    p_revision_id: revisionId,
  });
  if (error) throw error;
  return data || null;
}

// Backwards-compatible alias for any code that still imports the old save function.
export async function saveManagerMemo(args) {
  return saveManagerMemoRecovery(args);
}
