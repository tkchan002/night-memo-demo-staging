export const EMPTY_BED_GENDER_MODES = Object.freeze({
  male: Object.freeze({ value: 'male', label: 'Male', requiresPerBedGender: false }),
  female: Object.freeze({ value: 'female', label: 'Female', requiresPerBedGender: false }),
  mixed: Object.freeze({ value: 'mixed', label: 'Mixed', requiresPerBedGender: true }),
  none: Object.freeze({ value: 'none', label: 'Not applicable', requiresPerBedGender: false }),
});

export function normalizeWardName(value) {
  return String(value ?? '').trim();
}

export function validateWardName(value) {
  const name = normalizeWardName(value);
  if (!name) throw new Error('Ward name is required.');
  return name;
}

export function emptyBedGenderMode(value) {
  return EMPTY_BED_GENDER_MODES[value] || EMPTY_BED_GENDER_MODES.none;
}

export function emptyBedGenderLabel(value) {
  return emptyBedGenderMode(value).label;
}

export function wardRequiresPerBedGender(ward) {
  return emptyBedGenderMode(ward?.empty_bed_gender_mode).requiresPerBedGender;
}
