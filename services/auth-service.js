import { DB_MODE, supabase } from '../data/client.js';
import { ensureDemoState } from '../data/demo-state.js';
import { getCurrentAccess } from '../data/repositories/access-repository.js';

export async function signIn(account, password, expectedRole = null) {
  account = String(account || '').trim();
  if (!account || !password) throw new Error('Enter account and password.');

  if (DB_MODE === 'demo') {
    const demoState = ensureDemoState(false);
    const demoAccount = demoState.accounts.find(
      row => row.login_id.toLowerCase() === account.toLowerCase(),
    );
    const expectedPassword = demoAccount?.demo_password || 'demo';
    if (!demoAccount || password !== expectedPassword) {
      throw new Error('Invalid account or password.');
    }

    sessionStorage.setItem(
      'nightMemoDemoSession',
      JSON.stringify({ login_id: account }),
    );

    const access = await getCurrentAccess();
    if (!access || !access.active) throw new Error('Account is not active.');
    if (expectedRole && access.role !== expectedRole) {
      sessionStorage.removeItem('nightMemoDemoSession');
      throw new Error('This account does not have access to that login option.');
    }
    return access;
  }

  // Authenticate only. The destination page owns authorization and checks
  // user_access once, avoiding a duplicate database round-trip.
  const { data, error } = await supabase.auth.signInWithPassword({
    email: account,
    password,
  });
  if (error) throw error;
  if (!data?.user || !data?.session) {
    throw new Error('Login succeeded but no session was returned.');
  }
  return data.user;
}

function goToLogin() {
  // index.html is now the canonical login page.
  // replace() also prevents Back from reopening an authenticated page after logout.
  location.replace('./');
}

export async function signOut() {
  if (DB_MODE === 'demo') {
    sessionStorage.removeItem('nightMemoDemoSession');
  } else {
    await supabase.auth.signOut();
  }
  goToLogin();
}

export async function requireRole(roles) {
  roles = Array.isArray(roles) ? roles : [roles];
  let access;

  if (DB_MODE === 'supabase') {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
      goToLogin();
      return null;
    }

    // Reuse the ID already present in the local session. This avoids an
    // extra auth.getUser() request inside getCurrentAccess().
    access = await getCurrentAccess(session.user.id);
  } else {
    access = await getCurrentAccess();
  }

  if (!access || !access.active || !roles.includes(access.role)) {
    if (DB_MODE === 'supabase') await supabase.auth.signOut();
    goToLogin();
    return null;
  }

  return access;
}
