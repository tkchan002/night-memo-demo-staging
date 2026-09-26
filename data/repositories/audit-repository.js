import { DB_MODE, supabase } from '../client.js';
import { demoRead, demoWrite, uid } from '../demo-state.js';

export async function getAuditLog(limit = 200) {
  if (DB_MODE === 'demo') return demoRead().audit_log.slice(0, limit);
  const { data, error } = await supabase.from('audit_log').select('*').order('occurred_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function recordAudit(action, entityType, entityId, details = {}) {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    state.audit_log.unshift({ id: uid('audit'), occurred_at: new Date().toISOString(), action, entity_type: entityType, entity_id: entityId, details });
    demoWrite(state);
    return;
  }
  const { error } = await supabase.from('audit_log').insert({ action, entity_type: entityType, entity_id: entityId, details });
  if (error) console.warn('Audit insert failed', error);
}
