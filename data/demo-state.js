import { DB_MODE } from './client.js';
import { DEMO_WARDS, DEMO_REPORT_ITEMS, DEMO_STAFF, DEMO_REPORTS, DEMO_ACCOUNTS } from '../demo-data.js';

const DEMO_KEY = 'nightMemoDemoDbV5';
export const uid = (prefix = 'id') => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;

function seedDemoState() {
  const now = new Date().toISOString();
  const wards = DEMO_WARDS.map(w => ({ ...w, id: `ward-${w.name}`, active: true, created_at: now }));
  const operating_periods = wards.map(w => ({ id: uid('op'), ward_id: w.id, start_date: '2026-01-01', end_date: null, note: 'Demo operating period' }));
  const capacity_history = wards.map(w => ({ id: uid('cap'), ward_id: w.id, effective_from: '2026-01-01', effective_to: null, bed_capacity: w.capacity, note: 'Initial demo capacity' }));
  const ward_staff = DEMO_STAFF.map(staff => {
    const ward = wards.find(w => w.name === staff.ward_name);
    return { ...staff, id: uid('staff'), ward_id: ward.id, created_at: now, updated_at: now };
  });
  const report_items = DEMO_REPORT_ITEMS.map(item => ({ ...item, id: uid('item'), active: true, effective_from: '2026-01-01', effective_to: null, manager_slot: null, created_at: now, updated_at: now }));
  const ward_reports = DEMO_REPORTS.map(report => {
    const ward = wards.find(w => w.name === report.ward_name);
    return { ...report, id: uid('report'), ward_id: ward.id, created_at: now, updated_at: now };
  });
  const accounts = DEMO_ACCOUNTS.map(account => {
    const ward = wards.find(w => w.name === account.ward_name);
    return { ...account, auth_user_id: uid('demo-user'), ward_id: ward?.id || null, display_name: account.display_name || account.login_id, created_at: now, updated_at: now };
  });
  return { wards, operating_periods, capacity_history, ward_staff, report_items, ward_reports, accounts, audit_log: [] };
}

export function ensureDemoState(reset = false) {
  if (DB_MODE !== 'demo') return null;
  if (reset || !localStorage.getItem(DEMO_KEY)) localStorage.setItem(DEMO_KEY, JSON.stringify(seedDemoState()));
  return JSON.parse(localStorage.getItem(DEMO_KEY));
}

export function demoRead() {
  return ensureDemoState(false);
}

export function demoWrite(state) {
  localStorage.setItem(DEMO_KEY, JSON.stringify(state));
  return state;
}

export function resetDemoDatabase() {
  if (DB_MODE === 'demo') ensureDemoState(true);
}
