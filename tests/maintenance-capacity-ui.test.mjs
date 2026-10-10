import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('Bed Capacity is configured inside Edit Ward and uses the existing form controls', () => {
  const html = read('maintenance.html');
  const page = read('pages/maintenance-page.js');
  assert.match(html, /<label>Bed Capacity<\/label><select id="mWardCapacity" required><\/select>/);
  assert.match(html, /<button class="btn" type="submit">Save Ward<\/button>/);
  assert.doesNotMatch(html, /data-maint="capacity"|data-maint-page="capacity"|id="capacityModal"|id="capNote"|Add Capacity Change/);
  assert.match(html, /View Capacity History/);
  assert.match(page, /for \(let beds = 0; beds <= 500; beds\+\+\)/);
  assert.match(page, /saveWardConfiguration\(state\.editingWard\.id, settings, capacity/);
  assert.doesNotMatch(page, /renderCapacityHistory|saveCapacity\(|addCapacityBtn/);
});

test('UI waits for capacity loading, saves previous value for conflict detection and resists stale responses', () => {
  const page = read('pages/maintenance-page.js');
  assert.match(page, /state\.capacityAtOpen = \{ value: Number\(chosen\.row\.bed_capacity\), updatedAt:/);
  assert.match(page, /requestId !== state\.wardModalSequence/);
  assert.match(page, /expectedCapacity: state\.capacityAtOpen\.value/);
  assert.match(page, /expectedUpdatedAt: state\.capacityAtOpen\.updatedAt/);
  assert.match(page, /save\.disabled = !!w/);
});

test('one backend call atomically persists configuration, dated capacity and audit', () => {
  const repo = read('data/repositories/ward-repository.js');
  const sql = read('supabase/migrations/20261010_ward_capacity_edit.sql');
  assert.match(repo, /supabase\.rpc\('save_ward_configuration'/);
  assert.match(sql, /for update/i);
  assert.match(sql, /'Asia\/Hong_Kong'/);
  assert.match(sql, /v_current\.effective_from = v_today/);
  assert.match(sql, /ward\.capacity\.change/);
  assert.match(sql, /ward\.configuration\.update/);
  assert.match(sql, /ward_capacity_no_overlap/);
  assert.doesNotMatch(sql, /raise exception 'reason/i);
});
