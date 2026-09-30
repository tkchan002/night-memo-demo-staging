import 'dotenv/config';
import fs from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const [,, jsonPath, wardName = 'C5'] = process.argv;
if (!jsonPath) throw new Error('Usage: node scripts/migrate-memo-json.mjs /path/to/memo-data.json C5');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const raw = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
const { data: ward, error: wardErr } = await db.from('wards').select('*').eq('name', wardName).single();
if (wardErr) throw wardErr;

const { data: caps, error: capErr } = await db
  .from('ward_capacity_history')
  .select('*')
  .eq('ward_id', ward.id)
  .order('effective_from', { ascending: false });
if (capErr) throw capErr;

const capFor = date => caps.find(c => c.effective_from <= date && (!c.effective_to || c.effective_to >= date))?.bed_capacity ?? null;
let reportCount = 0;
for (const old of raw.history || []) {
  const payload = {
    ...old,
    emptyBeds: old.emptyBeds || {
      count: Math.max(0, (capFor(old.date) || 0) - Number(old.totalPatientM || 0)),
      details: [],
    },
    dynamicItems: old.dynamicItems || {},
  };
  const { error } = await db.from('ward_reports').upsert({
    ward_id: ward.id,
    report_date: old.date,
    payload,
    bed_capacity_snapshot: capFor(old.date),
    form_version: 1,
  }, { onConflict: 'ward_id,report_date' });
  if (error) throw error;
  reportCount += 1;
}

let staffCount = 0;
for (const s of raw.staffDB || []) {
  const iso = /^\d{2}\/\d{2}\/\d{4}$/.test(s.appt || '')
    ? `${s.appt.slice(6)}-${s.appt.slice(3,5)}-${s.appt.slice(0,2)}`
    : null;
  const { error } = await db.from('ward_staff').insert({
    ward_id: ward.id,
    role: s.role || 'RN',
    name: s.name,
    appointment_date: iso,
    active: true,
    display_order: 0,
  });
  if (error && error.code !== '23505') throw error;
  staffCount += 1;
}

console.log(`Migrated ${reportCount} reports and ${staffCount} staff records into ${wardName}.`);
