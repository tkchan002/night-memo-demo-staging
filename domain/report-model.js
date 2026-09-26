import { numberValue } from '../core/numbers.js';

export const DIRECT_REPORT_KEYS = Object.freeze([
  'admissionEC', 'admissionCC', 'discharge', 'death',
  'transferIn', 'transferOut', 'totalPatientM',
]);

export function fullReportPayloadDefaults() {
  return {
    admissionEC: '0', admissionCC: '0', discharge: '0', death: '0',
    transferIn: '0', transferOut: '0', totalPatientM: '0',
    emptyBeds: { count: 0, details: [] }, earlyBirds: [],
    infBeds: {}, devBeds: {}, dynamicItems: {},
    nilSpecial: true, patients: [],
    nilConsultation: true, consultations: [],
    nilIntubation: true, intubations: [],
    nurses: [], staffAM: '', staffPM: '', sigRank: 'RN', sigName: '', sigAppt: '',
  };
}

export function normalizeBeds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
}

export function normalizeDevice(value) {
  if (Array.isArray(value)) return { mode: 'beds', count: 0, beds: normalizeBeds(value) };
  if (!value || typeof value !== 'object') return { mode: 'beds', count: 0, beds: [] };
  if (value.mode === 'count') return { mode: 'count', count: Math.max(0, numberValue(value.count)), beds: [] };
  return { mode: 'beds', count: 0, beds: normalizeBeds(value.beds) };
}

export function deviceCount(value) {
  const device = normalizeDevice(value);
  return device.mode === 'count' ? device.count : device.beds.length;
}

export function formatDevice(value) {
  const device = normalizeDevice(value);
  if (device.mode === 'count') return device.count > 0 ? `Total: ${device.count}` : 'Nil';
  return device.beds.length ? device.beds.join(', ') : 'Nil';
}

export function formatDynamic(value) {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'Nil';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function normalizeReportPayload(raw = {}) {
  const defaults = fullReportPayloadDefaults();
  const out = { ...defaults, ...raw };
  out.emptyBeds = {
    count: numberValue(raw.emptyBeds?.count, numberValue(defaults.emptyBeds.count)),
    details: Array.isArray(raw.emptyBeds?.details) ? raw.emptyBeds.details.map(x => ({ ...x })) : [],
  };
  out.earlyBirds = Array.isArray(raw.earlyBirds) ? raw.earlyBirds.map(x => ({ ...x })) : [];
  out.infBeds = Object.fromEntries(Object.entries(raw.infBeds || {}).map(([k, v]) => [k, normalizeBeds(v)]));
  out.devBeds = Object.fromEntries(Object.entries(raw.devBeds || {}).map(([k, v]) => [k, normalizeDevice(v)]));
  out.dynamicItems = { ...(raw.dynamicItems || {}) };
  out.patients = Array.isArray(raw.patients) ? raw.patients.map(row => [...row]) : [];
  out.consultations = Array.isArray(raw.consultations) ? raw.consultations.map(row => [...row]) : [];
  out.intubations = Array.isArray(raw.intubations) ? raw.intubations.map(row => [...row]) : [];
  out.nurses = Array.isArray(raw.nurses) ? raw.nurses.map(n => ({ ...n })) : [];
  return out;
}

export function mergePayloadPreservingUnknown(existingRaw, editedRaw) {
  const existing = normalizeReportPayload(existingRaw);
  const edited = normalizeReportPayload(editedRaw);
  return {
    ...existing,
    ...edited,
    infBeds: { ...existing.infBeds, ...edited.infBeds },
    devBeds: { ...existing.devBeds, ...edited.devBeds },
    dynamicItems: { ...existing.dynamicItems, ...edited.dynamicItems },
  };
}

export function effectiveItems(items = [], date, { includeInactiveHistorical = true } = {}) {
  return items.filter(item => {
    const inRange = (!item.effective_from || item.effective_from <= date) && (!item.effective_to || item.effective_to >= date);
    if (!inRange) return false;
    return includeInactiveHistorical ? true : item.active !== false;
  }).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

export function snapshotReportItems(items = []) {
  return items.map(({ id, key, label, section, input_type, options, sort_order, builtin, config }) => ({
    id, key, label, section, input_type, options: Array.isArray(options) ? [...options] : [],
    sort_order, builtin: !!builtin, config: config ? { ...config } : null,
  }));
}
