import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityNumber, editableCapacity, reviseCapacityHistory } from '../domain/capacity-history.js';

const sample = [{ id: 'a', ward_id: 'C5', effective_from: '2026-01-01', effective_to: null, bed_capacity: 40, note: 'Initial' }];
test('capacity selection validates only integers within range', () => {
  for (const value of ['', '1.5', '-1', '3e2', '501', null, 'x']) assert.throws(() => capacityNumber(value));
  assert.equal(capacityNumber('0'), 0); assert.equal(capacityNumber('500'), 500);
});
test('editing today creates a bounded effective-date record and preserves yesterday', () => {
  const r = reviseCapacityHistory(sample, '2026-10-10', 38, 40, () => 'b');
  assert.deepEqual(r.rows.map(x => [x.effective_from, x.effective_to, x.bed_capacity]),
    [['2026-01-01', '2026-10-09', 40], ['2026-10-10', null, 38]]);
  assert.equal(sample[0].effective_to, null);
});
test('repeated change on same day revises the current row, not duplicate start date', () => {
  const once = reviseCapacityHistory(sample, '2026-10-10', 38, 40, () => 'b');
  const twice = reviseCapacityHistory(once.rows, '2026-10-10', 37, 38, () => 'c');
  assert.equal(twice.rows.length, 2); assert.equal(twice.rows[1].bed_capacity, 37);
});
test('unchanged capacity is a no-op; stale admin inputs are refused', () => {
  assert.equal(reviseCapacityHistory(sample, '2026-10-10', 40, 40).changed, false);
  assert.throws(() => reviseCapacityHistory(sample, '2026-10-10', 38, 39), /another administrator/);
});
test('future planned change is preserved when current capacity is edited', () => {
  const rows = [{...sample[0], effective_to:'2026-12-31'}, {id:'future',ward_id:'C5',effective_from:'2027-01-01',effective_to:null,bed_capacity:30}];
  const updated = reviseCapacityHistory(rows,'2026-10-10',38,40,()=> 'b').rows;
  assert.deepEqual(updated.map(x=>[x.effective_from,x.effective_to,x.bed_capacity]), [['2026-01-01','2026-10-09',40],['2026-10-10','2026-12-31',38],['2027-01-01',null,30]]);
});
test('future-opening ward edits its initial capacity, without creating a record for today', () => {
  const rows = [{...sample[0],effective_from:'2026-11-01'}];
  assert.equal(editableCapacity(rows,'2026-10-10').scheduled,true);
  const updated = reviseCapacityHistory(rows,'2026-10-10',38,40).rows;
  assert.equal(updated.length,1); assert.equal(updated[0].effective_from,'2026-11-01');
  assert.equal(updated[0].bed_capacity,38);
});
test('invalid pre-existing overlaps and expired history do not silently get rewritten', () => {
  assert.throws(()=>editableCapacity([...sample,{...sample[0],id:'b',effective_from:'2026-05-01'}],'2026-10-10'),/overlapping/);
  assert.throws(()=>editableCapacity([{...sample[0],effective_to:'2026-06-01'}],'2026-10-10'),/No bed capacity/);
});
test('a gap after a scheduled interval remains a gap after editing today', () => {
  const rows = [{...sample[0], effective_to:'2026-10-31'}, {id:'next',ward_id:'C5',effective_from:'2026-12-01', effective_to:null, bed_capacity:30}];
  const changed = reviseCapacityHistory(rows,'2026-10-10',38,40,()=> 'b').rows;
  assert.equal(changed[1].effective_to,'2026-10-31');
});
