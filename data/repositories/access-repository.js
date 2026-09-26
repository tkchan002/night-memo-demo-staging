import { DB_MODE, supabase } from '../client.js';
import { demoRead } from '../demo-state.js';

export async function getCurrentAccess(authUserId = null) {
  if (DB_MODE === 'demo') {
    const session = JSON.parse(sessionStorage.getItem('nightMemoDemoSession') || 'null');
    if (!session) return null;
    const state = demoRead();
    const access = state.accounts.find(x => x.login_id.toLowerCase() === session.login_id.toLowerCase());
    if (!access) return null;
    const ward = access.ward_id ? state.wards.find(w => w.id === access.ward_id) : null;
    return { ...access, wards: ward || null };
  }
  const userId = authUserId || (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from('user_access')
    .select('*, wards(id,code,display_name,phone,fax,empty_bed_gender_mode,manager_section,display_order,active)')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
