import { CONFIG } from '../../config.js';
import { DB_MODE, supabase } from '../client.js';
import { demoRead, demoWrite, uid } from '../demo-state.js';

async function invokeAdminUsers(action, payload = {}) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  const session = sessionData?.session;
  if (!session?.access_token) {
    throw new Error('Your Supabase session has expired. Please sign out and sign in again.');
  }

  const response = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/admin-users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: CONFIG.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text || `HTTP ${response.status}` };
  }

  if (!response.ok) {
    throw new Error(body?.error || body?.message || `admin-users failed with HTTP ${response.status}.`);
  }
  if (body?.error) throw new Error(body.error);
  return body;
}

export async function getAccounts() {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    return state.accounts
      .map(account => ({
        ...account,
        wards: account.ward_id ? state.wards.find(w => w.id === account.ward_id) : null,
      }))
      .sort((a, b) => a.login_id.localeCompare(b.login_id));
  }

  const result = await invokeAdminUsers('list');
  return result?.accounts || [];
}

export async function adminAccount(action, payload) {
  if (DB_MODE === 'demo') {
    const state = demoRead();
    if (action === 'create') {
      if (state.accounts.some(a => a.login_id.toLowerCase() === payload.login_id.toLowerCase())) {
        throw new Error('Account already exists.');
      }
      if (
        payload.role === 'ward' &&
        state.accounts.some(a => a.role === 'ward' && a.ward_id === payload.ward_id)
      ) {
        throw new Error('This ward already has a ward login account.');
      }
      const account = {
        auth_user_id: uid('demo-user'),
        login_id: payload.login_id,
        display_name: payload.display_name || payload.login_id,
        role: payload.role,
        ward_id: payload.role === 'ward' ? payload.ward_id || null : null,
        active: true,
        demo_password: payload.password || 'demo',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.accounts.push(account);
      demoWrite(state);
      return account;
    }

    const account = state.accounts.find(x => x.auth_user_id === payload.auth_user_id);
    if (!account) throw new Error('Account not found.');
    if (action === 'reset_password') account.demo_password = payload.password;
    if (action === 'rename_login') {
      account.login_id = payload.login_id;
      account.display_name = payload.display_name || account.display_name;
    }
    if (action === 'update_access') {
      Object.assign(account, {
        role: payload.role,
        ward_id: payload.role === 'ward' ? payload.ward_id || null : null,
        active: payload.active,
        display_name: payload.display_name || account.display_name,
      });
    }
    account.updated_at = new Date().toISOString();
    demoWrite(state);
    return account;
  }

  return invokeAdminUsers(action, payload);
}
