import { CONFIG, isSupabaseConfigured } from '../config.js';

export const DB_MODE = isSupabaseConfigured() ? 'supabase' : 'demo';
export let supabase = null;

if (DB_MODE === 'supabase') {
  // Pin the browser dependency. package.json alone does not control this ESM URL.
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.57.4');
  supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}
