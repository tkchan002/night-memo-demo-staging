import { DB_MODE, supabase } from '../client.js';

function requireSupabase() {
  if (DB_MODE !== 'supabase') throw new Error('Generated Demo Data is available only in Supabase mode.');
}

export async function importGeneratedDemoBatch(bundle) {
  requireSupabase();
  const { data, error } = await supabase.rpc('import_generated_demo_batch', {
    p_bundle: bundle,
  });
  if (error) throw error;
  return data;
}

export async function listGeneratedDemoBatches() {
  requireSupabase();
  const { data, error } = await supabase.rpc('list_generated_demo_batches');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function deleteGeneratedDemoBatch(batchId) {
  requireSupabase();
  const { data, error } = await supabase.rpc('delete_generated_demo_batch', {
    p_batch_id: batchId,
  });
  if (error) throw error;
  return data;
}
