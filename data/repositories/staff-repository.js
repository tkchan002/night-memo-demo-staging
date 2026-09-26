import { DB_MODE, supabase } from '../client.js';
import { demoRead, demoWrite, uid } from '../demo-state.js';

export async function getWardStaff(wardId, includeInactive = false) {
  if (DB_MODE === 'demo') return demoRead().ward_staff.filter(s => s.ward_id === wardId && (includeInactive || s.active)).sort((a, b) => (a.display_order || 0) - (b.display_order || 0) || a.name.localeCompare(b.name));
  let query = supabase.from('ward_staff').select('*').eq('ward_id', wardId).order('display_order').order('name');
  if (!includeInactive) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function saveWardStaff(staff) {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    const now = new Date().toISOString();
    const index = state.ward_staff.findIndex(x => x.id === staff.id);
    const row = { ...staff, id: staff.id || uid('staff'), updated_at: now, created_at: staff.created_at || now };
    if (index >= 0) state.ward_staff[index] = row;
    else state.ward_staff.push(row);
    demoWrite(state);
    return row;
  }
  const { data, error } = await supabase.from('ward_staff').upsert(staff).select().single();
  if (error) throw error;
  return data;
}

export async function setStaffActive(id, active) {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    const row = state.ward_staff.find(x => x.id === id);
    if (row) { row.active = active; row.updated_at = new Date().toISOString(); demoWrite(state); }
    return row;
  }
  const { data, error } = await supabase.from('ward_staff').update({ active, updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}
