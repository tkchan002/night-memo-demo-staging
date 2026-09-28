import { DB_MODE, supabase } from '../client.js';
import { demoRead, demoWrite, uid } from '../demo-state.js';
import { dateInRange, defaultReportDate } from '../range.js';
import { recordAudit } from './audit-repository.js';

export async function getReportItems(date = defaultReportDate(), includeInactive = false) {
  if (DB_MODE === 'demo') {
    return demoRead().report_items
      .filter(item => includeInactive ? true : (item.active && dateInRange(date, item.effective_from, item.effective_to)))
      .sort((a, b) => a.sort_order - b.sort_order);
  }
  let query = supabase.from('report_items').select('*').order('sort_order');
  if (!includeInactive) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) throw error;
  return includeInactive ? (data || []) : (data || []).filter(item => dateInRange(date, item.effective_from, item.effective_to));
}

export async function saveReportItem(item) {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    const index = state.report_items.findIndex(x => x.id === item.id);
    const now = new Date().toISOString();
    const row = { ...item, id: item.id || uid('item'), updated_at: now, created_at: item.created_at || now };
    if (index >= 0) state.report_items[index] = row;
    else state.report_items.push(row);
    demoWrite(state);
    return row;
  }
  const { data, error } = await supabase.from('report_items').upsert(item).select().single();
  if (error) throw error;
  await recordAudit(item.id ? 'report_item.update' : 'report_item.create', 'report_item', data.id, { key: data.key, label: data.label });
  return data;
}

export async function reorderReportItems(orderedItems) {
  const rows = (orderedItems || []).filter(x => x?.id).map((item, index) => ({
    id: item.id,
    sort_order: Number.isFinite(Number(item.sort_order)) ? Number(item.sort_order) : (index + 1) * 10,
  }));
  if (!rows.length) return [];

  if (DB_MODE === 'demo') {
    const state = demoRead();
    const order = new Map(rows.map(row => [row.id, row.sort_order]));
    state.report_items.forEach(item => {
      if (order.has(item.id)) item.sort_order = order.get(item.id);
    });
    demoWrite(state);
    return state.report_items.slice().sort((a, b) => a.sort_order - b.sort_order);
  }

  const results = await Promise.all(rows.map(async row => {
    const { data, error } = await supabase
      .from('report_items')
      .update({ sort_order: row.sort_order, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }));
  await recordAudit('report_item.reorder', 'report_item', null, { order: rows.map(r => r.id) });
  return results.sort((a, b) => a.sort_order - b.sort_order);
}
