import { addDaysISO } from '../core/dates.js';

export function capacityNumber(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 500) {
    throw new Error('Bed capacity must be a whole number between 0 and 500.');
  }
  return Number(raw);
}

function assertHistory(rows) {
  const ordered = [...rows].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  for (let i = 0; i < ordered.length; i++) {
    const row = ordered[i];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.effective_from)) throw new Error('Invalid capacity history date.');
    if (row.effective_to && row.effective_to < row.effective_from) throw new Error('Invalid capacity history date range.');
    if (i && (!ordered[i - 1].effective_to || ordered[i - 1].effective_to >= row.effective_from)) {
      throw new Error('Capacity history contains overlapping periods. Ask the administrator to correct them before editing.');
    }
  }
  return ordered;
}

export function editableCapacity(rows, date) {
  const ordered = assertHistory(rows);
  const current = ordered.find(r => r.effective_from <= date && (!r.effective_to || r.effective_to >= date));
  if (current) return { row: current, effectiveDate: date, scheduled: false };
  // A newly created ward can have a first operating date in the future.
  // Edit its initial capacity without backdating its capacity history.
  if (ordered.length && ordered[0].effective_from > date) {
    return { row: ordered[0], effectiveDate: ordered[0].effective_from, scheduled: true };
  }
  throw new Error('No bed capacity is configured for today. Review this ward’s capacity history.');
}

export function reviseCapacityHistory(rows, date, nextValue, expectedValue, makeId = () => crypto.randomUUID()) {
  const next = capacityNumber(nextValue);
  const expected = capacityNumber(expectedValue);
  const ordered = assertHistory(rows).map(r => ({ ...r }));
  const { row, effectiveDate, scheduled } = editableCapacity(ordered, date);
  if (Number(row.bed_capacity) !== expected) {
    throw new Error('Bed capacity was changed by another administrator. Reload Edit Ward before saving.');
  }
  if (expected === next) return { rows: ordered, changed: false, previous: expected, effectiveDate };
  const target = ordered.find(r => r.id === row.id);
  if (scheduled || target.effective_from === date) {
    target.bed_capacity = next;
    target.note = 'Updated in Edit Ward';
  } else {
    const originalEnd = target.effective_to;
    target.effective_to = addDaysISO(date, -1);
    ordered.push({ id: makeId(), ward_id: row.ward_id, effective_from: date,
      effective_to: originalEnd || null,
      bed_capacity: next, note: 'Updated in Edit Ward' });
  }
  return { rows: assertHistory(ordered), changed: true, previous: expected, effectiveDate };
}
