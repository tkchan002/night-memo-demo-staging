import { numberValue } from '../core/numbers.js';
import { normalizeReportPayload } from './report-model.js';
import { calculateEmptyBeds } from './bed-occupancy.js';

export function validateReportPayload(raw, { capacity = null } = {}) {
  const payload = normalizeReportPayload(raw);
  const errors = [];
  const warnings = [];
  const total = numberValue(payload.totalPatientM);
  if (total < 0) errors.push('Total patient count cannot be negative.');
  // Reconcile the stored derived field once at the validation boundary. Views
  // independently resolve it from the same domain function, never stored 0.
  const calculated = calculateEmptyBeds(capacity, payload.totalPatientM);
  if (calculated !== null) payload.emptyBeds.count = calculated;
  if (capacity != null && total > numberValue(capacity)) warnings.push('Total patient count is greater than the ward capacity snapshot.');
  for (const [key, beds] of Object.entries(payload.infBeds)) {
    if (beds.some(b => numberValue(b) <= 0)) warnings.push(`Invalid bed number stored for ${key}.`);
  }
  return { valid: errors.length === 0, errors, warnings, payload };
}
