import { DB_MODE, supabase } from '../client.js';
import { demoRead, demoWrite, uid } from '../demo-state.js';

function nowISO() { return new Date().toISOString(); }

function conflictError() {
  const error = new Error('This Night Memo was changed in another window. Reload before saving again.');
  error.code = 'MANAGER_MEMO_CONFLICT';
  return error;
}

function sortRevisions(rows = []) {
  return [...rows].sort((a, b) => Number(b.revision_number || 0) - Number(a.revision_number || 0));
}

function archiveRowFromDemo(memo, revisions = []) {
  const ordered = sortRevisions(revisions);
  const latest = ordered[0] || null;
  const latestFinal = ordered.find(row => row.revision_type === 'final') || null;
  const preferred = latestFinal || latest;
  return {
    memo_id: memo.id,
    reporting_date: memo.reporting_date,
    recovery_updated_at: memo.updated_at || null,
    working_revision: Number(memo.revision || 0),
    revision_count: ordered.length,
    has_draft: ordered.some(row => row.revision_type === 'draft'),
    has_final: ordered.some(row => row.revision_type === 'final'),
    latest_revision_id: latest?.id || null,
    latest_revision_number: latest?.revision_number || null,
    latest_revision_type: latest?.revision_type || null,
    latest_revision_created_at: latest?.created_at || null,
    latest_revision_created_by_label: latest?.created_by_label || null,
    preferred_revision_id: preferred?.id || null,
    preferred_revision_number: preferred?.revision_number || null,
    preferred_revision_type: preferred?.revision_type || null,
    preferred_revision_created_at: preferred?.created_at || null,
  };
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
    return sortRevisions((state.manager_memo_revisions || []).filter(row => row.memo_id === memo.id));
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

export async function listManagerMemoArchive() {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    const revisions = state.manager_memo_revisions || [];
    return (state.manager_memos || [])
      .map(memo => archiveRowFromDemo(memo, revisions.filter(row => row.memo_id === memo.id)))
      .sort((a, b) => String(b.reporting_date).localeCompare(String(a.reporting_date)));
  }
  const { data, error } = await supabase.rpc('list_manager_memo_archive');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function createManagerMemoCheckpoint({ reportingDate, reason, actorLabel = '' }) {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    state.manager_memo_recovery_snapshots ||= [];
    const memo = (state.manager_memos || []).find(row => row.reporting_date === reportingDate);
    if (!memo) return null;
    const snapshot = {
      id: uid('manager-memo-recovery'),
      memo_id: memo.id,
      reporting_date: reportingDate,
      reason: reason || 'safety_checkpoint',
      document: memo.document,
      source_snapshot: memo.source_snapshot || [],
      working_revision: Number(memo.revision || 0),
      created_at: nowISO(),
      created_by: null,
      created_by_label: actorLabel || '',
    };
    state.manager_memo_recovery_snapshots.push(snapshot);
    state.manager_memo_recovery_snapshots = state.manager_memo_recovery_snapshots
      .filter(row => row.memo_id !== memo.id)
      .concat(state.manager_memo_recovery_snapshots.filter(row => row.memo_id === memo.id)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10));
    demoWrite(state);
    return snapshot;
  }
  const { data, error } = await supabase.rpc('checkpoint_manager_memo', {
    p_reporting_date: reportingDate,
    p_reason: reason || 'safety_checkpoint',
    p_actor_label: actorLabel || '',
  });
  if (error) throw error;
  return data || null;
}

export async function listManagerMemoCheckpoints(reportingDate) {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    return (state.manager_memo_recovery_snapshots || [])
      .filter(row => row.reporting_date === reportingDate)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }
  const { data, error } = await supabase.rpc('list_manager_memo_checkpoints', {
    p_reporting_date: reportingDate,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function getManagerMemoCheckpoint(checkpointId) {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    return (state.manager_memo_recovery_snapshots || []).find(row => row.id === checkpointId) || null;
  }
  const { data, error } = await supabase.rpc('get_manager_memo_checkpoint', {
    p_checkpoint_id: checkpointId,
  });
  if (error) throw error;
  return data || null;
}
