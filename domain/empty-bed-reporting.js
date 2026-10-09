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
