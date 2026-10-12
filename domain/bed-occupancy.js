/**
 * Bed arithmetic is a reporting calculation, not an admission policy.
 * Negative results are valid (patients can exceed nominal bed capacity).
 * Unknown values must never be converted to zero.
 *
 * Keep this dependency-free so Ward, Manager, history, validation and printing
 * use exactly the same calculation.
 */
function wholeNumber(value, { allowNegative = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || (!allowNegative && numeric < 0)) return null;
  return numeric;
}

export function calculateEmptyBeds(capacity, totalPatients) {
  const beds = wholeNumber(capacity);
  const patients = wholeNumber(totalPatients);
  return beds === null || patients === null ? null : beds - patients;
}

/**
 * Snapshot capacity has priority over a *current* ward capacity, so old reports
 * do not silently change when Maintenance later changes the ward's beds.
 * A stored count is legacy fallback only when the arithmetic inputs are missing.
 */
export function resolveReportEmptyBeds({ report = null, capacity = null, totalPatients = undefined, recordedCount = undefined } = {}) {
  const effectiveCapacity = report?.bed_capacity_snapshot ?? capacity;
  const effectivePatients = totalPatients === undefined ? report?.payload?.totalPatientM : totalPatients;
  const calculated = calculateEmptyBeds(effectiveCapacity, effectivePatients);
  if (calculated !== null) return calculated;
  const historicalCount = recordedCount === undefined ? report?.payload?.emptyBeds?.count : recordedCount;
  return wholeNumber(historicalCount, { allowNegative: true });
}

export function displayEmptyBeds(count) {
  return count === null || count === undefined ? '—' : String(count);
}
