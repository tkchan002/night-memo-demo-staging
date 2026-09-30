import { DB_MODE, supabase } from '../client.js';
import { demoRead, demoWrite, uid } from '../demo-state.js';
import { dateInRange, defaultReportDate } from '../range.js';
import { addDaysISO } from '../../core/dates.js';
import { validateWardName } from '../../domain/ward.js';
import { recordAudit } from './audit-repository.js';

export async function getAllWards() {
  if (DB_MODE === 'demo') return demoRead().wards.slice().sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const { data, error } = await supabase.from('wards').select('*').order('display_order').order('name');
  if (error) throw error;
  return data || [];
}

export async function getWardById(wardId) {
  if (DB_MODE === 'demo') return demoRead().wards.find(w => w.id === wardId) || null;
  const { data, error } = await supabase.from('wards').select('*').eq('id', wardId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getWardByName(name) {
  const wardName = validateWardName(name);
  if (DB_MODE === 'demo') return demoRead().wards.find(w => w.name.toLowerCase() === wardName.toLowerCase()) || null;
  const { data, error } = await supabase.from('wards').select('*').ilike('name', wardName).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getOperatingPeriods(wardId = null) {
  if (DB_MODE === 'demo') {
    return demoRead().operating_periods
      .filter(x => !wardId || x.ward_id === wardId)
      .sort((a, b) => b.start_date.localeCompare(a.start_date));
  }
  let query = supabase.from('ward_operating_periods').select('*').order('start_date', { ascending: false });
  if (wardId) query = query.eq('ward_id', wardId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getWardsForDate(date = defaultReportDate()) {
  const [wards, periods] = await Promise.all([getAllWards(), getOperatingPeriods()]);
  return wards.filter(ward => {
    const open = periods.some(period => period.ward_id === ward.id && dateInRange(date, period.start_date, period.end_date));
    return open;
  }).sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

export async function isWardOperational(wardId, date = defaultReportDate()) {
  const periods = await getOperatingPeriods(wardId);
  return periods.some(period => dateInRange(date, period.start_date, period.end_date));
}

export async function getCapacityHistory(wardId) {
  if (DB_MODE === 'demo') return demoRead().capacity_history.filter(x => x.ward_id === wardId).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const { data, error } = await supabase.from('ward_capacity_history').select('*').eq('ward_id', wardId).order('effective_from', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getWardCapacity(wardId, date = defaultReportDate()) {
  const rows = await getCapacityHistory(wardId);
  return rows.find(x => dateInRange(date, x.effective_from, x.effective_to))?.bed_capacity ?? null;
}

export async function getCapacitiesForWards(wardIds, date = defaultReportDate()) {
  const ids = [...new Set((wardIds || []).filter(Boolean))];
  if (!ids.length) return {};

  if (DB_MODE === 'demo') {
    const state = demoRead();
    const out = {};
    for (const wardId of ids) {
      const row = state.capacity_history
        .filter(x => x.ward_id === wardId && dateInRange(date, x.effective_from, x.effective_to))
        .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
      out[wardId] = row?.bed_capacity ?? null;
    }
    return out;
  }

  const { data, error } = await supabase
    .from('ward_capacity_history')
    .select('ward_id,bed_capacity,effective_from,effective_to')
    .in('ward_id', ids)
    .lte('effective_from', date)
    .order('effective_from', { ascending: false });
  if (error) throw error;

  const out = Object.fromEntries(ids.map(id => [id, null]));
  for (const row of data || []) {
    if (out[row.ward_id] == null && dateInRange(date, row.effective_from, row.effective_to)) out[row.ward_id] = row.bed_capacity;
  }
  return out;
}

function assertUniqueDemoWardName(state, wardName, exceptWardId = null) {
  if (state.wards.some(ward => ward.id !== exceptWardId && ward.name.toLowerCase() === wardName.toLowerCase())) {
    throw new Error('Ward name already exists.');
  }
}

export async function createWard(config) {
  const now = new Date().toISOString();
  const name = validateWardName(config.name);
  if (DB_MODE === 'demo') {
    const state = demoRead();
    assertUniqueDemoWardName(state, name);
    const ward = {
      id: uid('ward'),
      name,
      phone: config.phone,
      fax: config.fax,
      empty_bed_gender_mode: config.empty_bed_gender_mode || 'male',
      display_order: Math.max(0, ...state.wards.map(w => Number(w.display_order) || 0)) + 1,
      active: true,
      created_at: now,
      updated_at: now,
    };
    state.wards.push(ward);
    state.operating_periods.push({ id: uid('op'), ward_id: ward.id, start_date: config.start_date, end_date: config.end_date || null, note: config.note || 'Ward opened' });
    state.capacity_history.push({ id: uid('cap'), ward_id: ward.id, effective_from: config.start_date, effective_to: null, bed_capacity: Number(config.bed_capacity) || 0, note: 'Initial capacity' });
    state.audit_log.unshift({ id: uid('audit'), occurred_at: now, action: 'ward.create', entity_type: 'ward', entity_id: ward.id, details: { name: ward.name } });
    demoWrite(state);
    return ward;
  }
  const { data: ward, error } = await supabase.from('wards').insert({
    name,
    phone: config.phone,
    fax: config.fax,
    empty_bed_gender_mode: config.empty_bed_gender_mode,
    active: true,
  }).select().single();
  if (error) throw error;
  const { error: periodError } = await supabase.from('ward_operating_periods').insert({ ward_id: ward.id, start_date: config.start_date, end_date: config.end_date || null, note: config.note || 'Ward opened' });
  if (periodError) throw periodError;
  const { error: capacityError } = await supabase.from('ward_capacity_history').insert({ ward_id: ward.id, effective_from: config.start_date, bed_capacity: Number(config.bed_capacity), note: 'Initial capacity' });
  if (capacityError) throw capacityError;
  await recordAudit('ward.create', 'ward', ward.id, { name: ward.name });
  return ward;
}

export async function updateWard(wardId, patch) {
  const nextPatch = { ...patch };
  if (Object.hasOwn(nextPatch, 'name')) nextPatch.name = validateWardName(nextPatch.name);
  if (DB_MODE === 'demo') {
    const state = demoRead();
    const ward = state.wards.find(x => x.id === wardId);
    if (!ward) throw new Error('Ward not found.');
    if (nextPatch.name) assertUniqueDemoWardName(state, nextPatch.name, wardId);
    Object.assign(ward, nextPatch, { updated_at: new Date().toISOString() });
    demoWrite(state);
    return ward;
  }
  const { data, error } = await supabase.from('wards').update({ ...nextPatch, updated_at: new Date().toISOString() }).eq('id', wardId).select().single();
  if (error) throw error;
  await recordAudit('ward.update', 'ward', wardId, nextPatch);
  return data;
}

function orderedWardIds(orderedWards) {
  const ids = (orderedWards || []).map(entry => typeof entry === 'string' ? entry : entry?.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error('Ward order contains duplicate entries.');
  return ids;
}

export async function reorderWards(orderedWards) {
  const ids = orderedWardIds(orderedWards);
  if (!ids.length) return [];

  if (DB_MODE === 'demo') {
    const state = demoRead();
    if (ids.length !== state.wards.length || state.wards.some(ward => !ids.includes(ward.id))) throw new Error('Ward order must include every configured ward exactly once.');
    const positions = new Map(ids.map((id, index) => [id, index + 1]));
    state.wards.forEach(ward => { ward.display_order = positions.get(ward.id); });
    demoWrite(state);
    return state.wards.slice().sort((a, b) => a.display_order - b.display_order);
  }

  const { error } = await supabase.rpc('reorder_wards', { p_order: ids });
  if (error) {
    const text = `${error.code || ''} ${error.message || ''} ${error.details || ''}`;
    if (/PGRST202|42883|could not find.*function|function .* does not exist/i.test(text)) throw new Error('Ward reordering is not installed in Supabase. Run 20260930_maintenance_ordering.sql first.');
    throw error;
  }
  await recordAudit('ward.reorder', 'ward', null, { order: ids });
  return getAllWards();
}

export async function addOperatingPeriod(wardId, startDate, endDate = null, note = 'Ward reopened') {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    const row = { id: uid('op'), ward_id: wardId, start_date: startDate, end_date: endDate || null, note };
    state.operating_periods.push(row);
    demoWrite(state);
    return row;
  }
  const { data, error } = await supabase.from('ward_operating_periods').insert({ ward_id: wardId, start_date: startDate, end_date: endDate || null, note }).select().single();
  if (error) throw error;
  await recordAudit('ward.period.add', 'ward', wardId, { startDate, endDate, note });
  return data;
}

export async function closeOperatingPeriod(periodId, endDate, note = 'Ward closed') {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    const period = state.operating_periods.find(x => x.id === periodId);
    if (period) { period.end_date = endDate; period.note = note; }
    demoWrite(state);
    return period;
  }
  const { data, error } = await supabase.from('ward_operating_periods').update({ end_date: endDate, note }).eq('id', periodId).select().single();
  if (error) throw error;
  await recordAudit('ward.period.close', 'ward_period', periodId, { endDate, note });
  return data;
}

export async function addCapacity(wardId, effectiveFrom, bedCapacity, note = 'Capacity changed') {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    const current = state.capacity_history
      .filter(x => x.ward_id === wardId && x.effective_from < effectiveFrom && (!x.effective_to || x.effective_to >= effectiveFrom))
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
    if (current) current.effective_to = addDaysISO(effectiveFrom, -1);
    const row = { id: uid('cap'), ward_id: wardId, effective_from: effectiveFrom, effective_to: null, bed_capacity: Number(bedCapacity), note };
    state.capacity_history.push(row);
    demoWrite(state);
    return row;
  }
  const { error } = await supabase.rpc('add_ward_capacity', { p_ward_id: wardId, p_effective_from: effectiveFrom, p_bed_capacity: Number(bedCapacity), p_note: note });
  if (error) throw error;
  await recordAudit('ward.capacity.add', 'ward', wardId, { effectiveFrom, bedCapacity, note });
  return true;
}
