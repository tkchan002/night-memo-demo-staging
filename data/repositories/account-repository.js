import { DB_MODE, supabase } from '../client.js';
import { demoRead, demoWrite, uid } from '../demo-state.js';

export async function getAccounts() {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    return state.accounts.map(account => ({ ...account, wards: account.ward_id ? state.wards.find(w => w.id === account.ward_id) : null })).sort((a, b) => a.login_id.localeCompare(b.login_id));
  }
  const { data, error } = await supabase.from('user_access').select('*, wards(id,code,display_name)').order('login_id');
  if (error) throw error;
  return data || [];
}

export async function adminAccount(action, payload) {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    if (action === 'create') {
      if (state.accounts.some(a => a.login_id.toLowerCase() === payload.login_id.toLowerCase())) throw new Error('Account already exists.');
      if (payload.role === 'ward' && state.accounts.some(a => a.role === 'ward' && a.ward_id === payload.ward_id)) throw new Error('This ward already has a ward login account.');
      const account = {
        auth_user_id: uid('demo-user'), login_id: payload.login_id, display_name: payload.display_name || payload.login_id,
        role: payload.role, ward_id: payload.role === 'ward' ? (payload.ward_id || null) : null,
        active: true, demo_password: payload.password || 'demo', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      state.accounts.push(account);
      demoWrite(state);
      return account;
    }
    const account = state.accounts.find(x => x.auth_user_id === payload.auth_user_id);
    if (!account) throw new Error('Account not found.');
    if (action === 'reset_password') account.demo_password = payload.password;
    if (action === 'rename_login') { account.login_id = payload.login_id; account.display_name = payload.display_name || account.display_name; }
    if (action === 'update_access') Object.assign(account, { role: payload.role, ward_id: payload.role === 'ward' ? (payload.ward_id || null) : null, active: payload.active, display_name: payload.display_name || account.display_name });
    account.updated_at = new Date().toISOString();
    demoWrite(state);
    return account;
  }
  const { data, error } = await supabase.functions.invoke('admin-users', { body: { action, ...payload } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
