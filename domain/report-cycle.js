/** Operational cycle identifiers, not clinical policy or submission deadlines. */
import { todayISO, addDaysISO, REPORT_TIME_ZONE } from '../core/dates.js';

export const MEMO_TYPES = Object.freeze(['pm', 'night']);
export const MEMO_LABELS = Object.freeze({ pm: 'PM Memo', night: 'Night Memo' });
export const REPORTING_CONFIG = Object.freeze({
  timeZone: REPORT_TIME_ZONE,
  expectedTimes: Object.freeze({ pm: '21:00', night: '04:00' }),
  // Different memo types share the same reporting-night date.
  defaultNightTypeBeforeHour: 12,
});
export const MOVEMENT_FIELDS = Object.freeze(['admissionEC', 'admissionCC', 'transferIn', 'discharge', 'transferOut', 'death']);
export const ADMISSION_SEX_FIELDS = Object.freeze(['admissionEC', 'admissionCC', 'transferIn']);

export function reportNightDate(now = new Date()) {
  const iso = todayISO(REPORTING_CONFIG.timeZone, now);
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: REPORTING_CONFIG.timeZone, hour: '2-digit', hour12: false }).format(now));
  return h < REPORTING_CONFIG.defaultNightTypeBeforeHour ? addDaysISO(iso, -1) : iso;
}
export function defaultMemoType(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: REPORTING_CONFIG.timeZone, hour: '2-digit', hour12: false }).format(now));
  return h < REPORTING_CONFIG.defaultNightTypeBeforeHour ? 'night' : 'pm';
}
export function requireMemoType(value) {
  if (!MEMO_TYPES.includes(value)) throw new Error('Select PM Memo or Night Memo.');
  return value;
}
export function combinedMovementValue(pm, night, key) {
  const number = x => { const n = Number(x?.payload?.[key]); return Number.isFinite(n) && n >= 0 ? n : 0; };
  if (!pm && !night) return '';
  // Missing source is never silently treated as a completed 0-report: callers show warning.
  return String(number(pm) + number(night));
}
export function selectLatestCensus(pm, night) { return night || pm || null; }
export function missingMemoTypes(pm, night) { return ['pm', 'night'].filter(type => !(type === 'pm' ? pm : night)); }
