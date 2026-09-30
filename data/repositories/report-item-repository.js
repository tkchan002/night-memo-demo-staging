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
  let query = supabase.from('report_items').select('*').order('sort_order').order('key');
  if (!includeInactive) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) throw error;
  return includeInactive ? (data || []) : (data || []).filter(item => dateInRange(date, item.effective_from, item.effective_to));
}

export async function saveReportItem(item) {
  const editing = Boolean(item?.id);
  if (DB_MODE === 'demo') {
    const state = demoRead();
    const index = state.report_items.findIndex(x => x.id === item.id);
    const now = new Date().toISOString();
    if (index >= 0) {
      const existing = state.report_items[index];
      const row = { ...existing, ...item, sort_order: existing.sort_order, updated_at: now };
      state.report_items[index] = row;
      demoWrite(state);
      return row;
    }
    const nextOrder = Math.max(0, ...state.report_items.map(x => Number(x.sort_order) || 0)) + 1;
    const row = { ...item, id: uid('item'), sort_order: nextOrder, updated_at: now, created_at: now };
    state.report_items.push(row);
    demoWrite(state);
    return row;
  }

  if (editing) {
    const patch = { ...item };
    delete patch.id;
    delete patch.sort_order;
    delete patch.created_at;
    const { data, error } = await supabase.from('report_items').update(patch).eq('id', item.id).select().single();
    if (error) throw error;
    await recordAudit('report_item.update', 'report_item', data.id, { key: data.key, label: data.label });
    return data;
  }

  const row = { ...item };
  delete row.id;
  delete row.sort_order;
  delete row.created_at;
  const { data, error } = await supabase.from('report_items').insert(row).select().single();
  if (error) throw error;
  await recordAudit('report_item.create', 'report_item', data.id, { key: data.key, label: data.label });
  return data;
}

function orderedItemIds(orderedItems) {
  const ids = (orderedItems || []).map(entry => typeof entry === 'string' ? entry : entry?.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error('Report item order contains duplicate entries.');
  return ids;
}

export async function reorderReportItems(orderedItems) {
  const ids = orderedItemIds(orderedItems);
  if (!ids.length) return [];

  if (DB_MODE === 'demo') {
    const state = demoRead();
    if (ids.length !== state.report_items.length || state.report_items.some(item => !ids.includes(item.id))) {
      throw new Error('Report item order must include every configured item exactly once.');
    }
    const positions = new Map(ids.map((id, index) => [id, index + 1]));
    state.report_items.forEach(item => { item.sort_order = positions.get(item.id); });
    demoWrite(state);
    return state.report_items.slice().sort((a, b) => a.sort_order - b.sort_order);
  }

  const { error } = await supabase.rpc('reorder_report_items', { p_order: ids });
  if (error) {
    const text = `${error.code || ''} ${error.message || ''} ${error.details || ''}`;
    if (/PGRST202|42883|could not find.*function|function .* does not exist/i.test(text)) {
      throw new Error('Report Item reordering is not installed in Supabase. Run 20260930_maintenance_ordering.sql first.');
    }
    throw error;
  }
  await recordAudit('report_item.reorder', 'report_item', null, { order: ids });
  return getReportItems(defaultReportDate(), true);
}
