import { createClient } from '@supabase/supabase-js';
import { CONFIG, isSupabaseConfigured } from '../config.js';

export const DB_MODE = isSupabaseConfigured() ? 'supabase' : 'demo';

export let supabase = null;

if (DB_MODE === 'supabase') {
  supabase = createClient(
    CONFIG.SUPABASE_URL,
    CONFIG.SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    }
  );
}
