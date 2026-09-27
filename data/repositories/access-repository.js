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
  const {
  data: { session },
  error: sessionError,
} = await supabase.auth.getSession();

if (sessionError) throw sessionError;

if (!session?.access_token) {
  throw new Error(
    'Supabase session has expired. Please log out and sign in again.'
  );
}

const { data, error } = await supabase.functions.invoke(
  'admin-users',
  {
    body: { action, ...payload },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  }
);

if (error) {
  console.error('admin-users Edge Function error:', error);
  throw error;
}

if (data?.error) {
  throw new Error(data.error);
}

return data;
}
