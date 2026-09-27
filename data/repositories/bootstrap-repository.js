import { DB_MODE, supabase } from '../client.js';

function isMissingRpc(error) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return /PGRST202|42883|could not find.*function|function .* does not exist/i.test(text);
}

async function callOptionalRpc(name, args) {
  if (DB_MODE !== 'supabase') return null;
  const { data, error } = await supabase.rpc(name, args);
  if (!error) return data || null;
  // The performance RPCs are additive. Until the SQL migration is installed,
  // fall back to the existing repository queries instead of breaking the page.
  if (isMissingRpc(error)) return null;
  throw error;
}

export function getWardNightSnapshot(wardId, date) {
  return callOptionalRpc('get_ward_night_context', {
    p_ward_id: wardId,
    p_date: date,
  });
}

export function getManagerNightSnapshot(date) {
  return callOptionalRpc('get_manager_night_snapshot', {
    p_date: date,
  });
}

export function getMaintenanceWardsSnapshot() {
  return callOptionalRpc('get_maintenance_wards_snapshot', {});
}
