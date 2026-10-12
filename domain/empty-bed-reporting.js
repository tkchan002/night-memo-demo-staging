/**
 * Empty-bed reporting V1.
 * Bed availability (capacity - patients) is independent of manual M/F/S/D.
 * M/F count individually reported bed spaces; S/D count vacant room units.
 * This module deliberately NEVER reconciles or derives one from the other.
 */
export const EMPTY_BED_CODES = Object.freeze([
  Object.freeze({ field: 'male', label: 'M', description: 'Male empty beds' }),
  Object.freeze({ field: 'female', label: 'F', description: 'Female empty beds' }),
  Object.freeze({ field: 'single', label: 'S', description: 'Vacant single-bed rooms' }),
  Object.freeze({ field: 'double', label: 'D', description: 'Vacant double-bed rooms' }),
]);

export function parseManualCount(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed; // retain invalid values for validation instead of hiding them
}

export function normalizeEmptyBedReporting(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    version: 1,
    singleDoubleEnabled: value.singleDoubleEnabled === true,
    male: parseManualCount(value.male),
    female: parseManualCount(value.female),
    single: parseManualCount(value.single),
    double: parseManualCount(value.double),
  };
}

export function validateEmptyBedReporting(value) {
  if (value == null) return [];
  const report = normalizeEmptyBedReporting(value);
  if (!report) return ['Empty bed manual reporting must be an object.'];
  const errors = [];
  for (const { field, label } of EMPTY_BED_CODES) {
    const n = report[field];
    if (n !== null && (!Number.isSafeInteger(n) || n < 0)) {
      errors.push(`Empty bed ${label} must be a non-negative whole number.`);
    }
  }
  return errors;
}

export function formatEmptyBedReporting(value, { includeMissing = false } = {}) {
  const report = normalizeEmptyBedReporting(value);
  if (!report) return '';
  const fields = EMPTY_BED_CODES.filter(({ field }) =>
    report.singleDoubleEnabled || (field !== 'single' && field !== 'double'));
  const stated = fields.filter(({ field }) => report[field] !== null);
  if (!stated.length) return includeMissing ? 'Not reported' : '';
  const nonzero = stated.filter(({ field }) => report[field] !== 0);
  // An explicitly reported zero stays distinguishable from an unreported blank.
  const visible = nonzero.length ? nonzero : stated;
  return visible.map(({ field, label }) => `${report[field]}${label}`).join(', ');
}

export function makeEmptyBedReporting({ male = null, female = null, single = null, double = null } = {}, ward = {}) {
  const singleDoubleEnabled = ward.single_double_reporting_enabled === true;
  return normalizeEmptyBedReporting({
    male, female,
    single: singleDoubleEnabled ? single : null,
    double: singleDoubleEnabled ? double : null,
    singleDoubleEnabled,
  });
}


/** V2: One ordered manual-entry list. Never reconciled with total empty beds. */
export const EMPTY_BED_ENTRY_DESIGNATIONS = Object.freeze(['M', 'F', 'S', 'D', 'T', 'OTHER']);

export function parseEmptyBedLabel(label) {
  const match = String(label ?? '').trim().toUpperCase().match(/^([1-9]\d*)([MFSDT])$/);
  if (!match || !Number.isSafeInteger(Number(match[1]))) return null;
  return { quantity: Number(match[1]), designation: match[2] };
}

export function normalizeEmptyBedEntries(entries) {
  if (!Array.isArray(entries)) return null;
  return entries.map(value => ({
    quantity: value?.quantity ?? null,
    designation: String(value?.designation ?? '').trim().toUpperCase(),
    customDesignation: String(value?.customDesignation ?? '').trim(),
    remark: String(value?.remark ?? '').trim(),
  }));
}

export function validateEmptyBedEntries(entries) {
  if (entries === undefined || entries === null) return [];
  if (!Array.isArray(entries)) return ['Empty Bed entries must be a list.'];
  const errors = [];
  entries.forEach((entry, index) => {
    const { quantity, designation, customDesignation, remark } = entry || {};
    if (quantity == null && !designation && !customDesignation && !remark) return;
    const n = typeof quantity === 'number' ? quantity : Number(String(quantity ?? '').trim());
    if (!Number.isSafeInteger(n) || n < 1) errors.push(`Empty Bed entry ${index + 1} requires a positive whole number.`);
    if (!EMPTY_BED_ENTRY_DESIGNATIONS.includes(String(designation ?? '').trim().toUpperCase())) {
      errors.push(`Empty Bed entry ${index + 1} requires a valid reporting designation.`);
    }
    if (String(designation).toUpperCase() === 'OTHER' && !String(customDesignation || '').trim()) errors.push(`Empty Bed entry ${index + 1} requires a custom designation.`);
  });
  return errors;
}

export function formatEmptyBedEntries(entries) {
  if (!Array.isArray(entries)) return '';
  return entries.filter(entry => entry && Number.isSafeInteger(Number(entry.quantity)) && Number(entry.quantity) > 0
    && EMPTY_BED_ENTRY_DESIGNATIONS.includes(String(entry.designation || '').toUpperCase()))
    .map(entry => `${Number(entry.quantity)}${String(entry.designation).toUpperCase() === 'OTHER' ? String(entry.customDesignation || '').trim() : String(entry.designation).toUpperCase()}${String(entry.remark || '').trim() ? ` (${String(entry.remark).trim()})` : ''}`)
    .join(', ');
}

/**
 * Legacy M/F/S/D quantities and optional bed/location notes were independent.
 * We do not assume they refer to the same beds or subtract one from another.
 * Keep all legacy information; unclassified legacy notes must be assigned a
 * designation by the nurse before re-saving the report in the new format.
 */
export function legacyEmptyBedEntries(emptyBeds, ward = {}) {
  if (Array.isArray(emptyBeds?.entries)) return normalizeEmptyBedEntries(emptyBeds.entries);
  const previous = normalizeEmptyBedReporting(emptyBeds?.reported);
  const result = [];
  if (previous) {
    for (const [kind, value] of [['M', previous.male], ['F', previous.female], ['S', previous.single], ['D', previous.double]]) {
      if (Number.isSafeInteger(value) && value > 0) result.push({ quantity: value, designation: kind, remark: '' });
    }
  }
  for (const detail of Array.isArray(emptyBeds?.details) ? emptyBeds.details : []) {
    const kind = String(detail?.gender || (ward?.empty_bed_gender_mode === 'male' ? 'M' : ward?.empty_bed_gender_mode === 'female' ? 'F' : '')).toUpperCase();
    const parts = [String(detail?.location || '').trim(), String(detail?.remark || '').trim()].filter(Boolean);
    if (!parts.length && !EMPTY_BED_ENTRY_DESIGNATIONS.includes(kind)) continue;
    result.push({ quantity: 1, designation: EMPTY_BED_ENTRY_DESIGNATIONS.includes(kind) ? kind : '', remark: parts.join(' - ') });
  }
  return result;
}
