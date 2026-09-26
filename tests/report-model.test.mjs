import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDevice,
  deviceCount,
  formatDevice,
  mergePayloadPreservingUnknown,
  effectiveItems,
} from '../domain/report-model.js';

test('legacy device arrays normalize to bed-based device values', () => {
  assert.deepEqual(normalizeDevice([11, 12, '12']), { mode: 'beds', count: 0, beds: ['11', '12'] });
  assert.equal(deviceCount([11, 12]), 2);
  assert.equal(formatDevice([11, 12]), '11, 12');
});

test('count-mode device values remain count-mode', () => {
  assert.deepEqual(normalizeDevice({ mode: 'count', count: '3' }), { mode: 'count', count: 3, beds: [] });
  assert.equal(deviceCount({ mode: 'count', count: 3 }), 3);
});

test('re-saving a report preserves dynamic and device keys not rendered by the current form', () => {
  const existing = {
    dynamicItems: { old_field: 'keep me', current_field: 'old' },
    devBeds: { old_device: [8, 9], d_MV: [1] },
  };
  const edited = {
    dynamicItems: { current_field: 'new' },
    devBeds: { d_MV: { mode: 'beds', beds: [2] } },
  };
  const merged = mergePayloadPreservingUnknown(existing, edited);
  assert.equal(merged.dynamicItems.old_field, 'keep me');
  assert.equal(merged.dynamicItems.current_field, 'new');
  assert.deepEqual(merged.devBeds.old_device.beds, ['8', '9']);
  assert.deepEqual(merged.devBeds.d_MV.beds, ['2']);
});

test('historical item lookup can retain inactive items that were effective on the report date', () => {
  const items = [
    { key: 'old', active: false, effective_from: '2026-01-01', effective_to: '2026-12-31', sort_order: 2 },
    { key: 'new', active: true, effective_from: '2027-01-01', effective_to: null, sort_order: 1 },
  ];
  assert.deepEqual(effectiveItems(items, '2026-09-26', { includeInactiveHistorical: true }).map(x => x.key), ['old']);
  assert.deepEqual(effectiveItems(items, '2026-09-26', { includeInactiveHistorical: false }).map(x => x.key), []);
});
