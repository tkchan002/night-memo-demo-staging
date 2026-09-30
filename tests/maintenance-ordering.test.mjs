import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { moveOrderedItem, normalizeOrder } from '../domain/ordering.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('ordering domain moves entries and normalizes to sequential positions', () => {
  const source = [
    { id: 'a', display_order: 10 },
    { id: 'b', display_order: 20 },
    { id: 'c', display_order: 30 },
  ];
  const moved = moveOrderedItem(source, 'c', -1, 'display_order');
  assert.equal(moved.changed, true);
  assert.deepEqual(moved.items.map(x => [x.id, x.display_order]), [['a', 1], ['c', 2], ['b', 3]]);
  assert.deepEqual(normalizeOrder(source, 'display_order').map(x => x.display_order), [1, 2, 3]);
});

test('Maintenance HTML exposes only Up/Down ordering controls, never numeric order fields', () => {
  const html = read('maintenance.html');
  assert.doesNotMatch(html, /id="mWardOrder"/);
  assert.doesNotMatch(html, /id="itemOrder"/);
  assert.doesNotMatch(html, /<th>Order<\/th>/);
  assert.match(html, /Wards are shown in their actual display sequence from top to bottom/);
  assert.match(html, /<tbody id="wardRows"><\/tbody>/);
  assert.doesNotMatch(html, /id="wardCards"/);
  assert.match(html, /Use Up \/ Down to change the form sequence/);
});

test('Maintenance page treats ordering as dedicated list behavior', () => {
  const page = read('pages/maintenance-page.js');
  assert.match(page, /reorderWards/);
  assert.match(page, /function renderWardList\(\)/);
  assert.match(page, /<tr>/);
  assert.doesNotMatch(page, /renderWardCards/);
  assert.doesNotMatch(page, /ward-card/);
  assert.match(page, /moveOrderedItem\(state\.wards/);
  assert.match(page, /moveOrderedItem\(state\.items/);
  assert.doesNotMatch(page, /mWardOrder/);
  assert.doesNotMatch(page, /itemOrder/);
  assert.doesNotMatch(page, /\*\s*10/);
  assert.doesNotMatch(page, /\b999\b/);
  assert.doesNotMatch(page, /display_order:\s*Number\(/);
  assert.doesNotMatch(page, /sort_order:\s*Number\(/);
});

test('repositories append new records automatically and use reorder RPCs', () => {
  const wards = read('data/repositories/ward-repository.js');
  const items = read('data/repositories/report-item-repository.js');
  assert.doesNotMatch(wards, /\b999\b/);
  assert.match(wards, /supabase\.rpc\('reorder_wards'/);
  assert.match(wards, /Math\.max\(0, \.\.\.state\.wards/);
  assert.doesNotMatch(wards, /display_order:\s*Number\(config\.display_order\)/);
  assert.match(items, /supabase\.rpc\('reorder_report_items'/);
  assert.match(items, /sort_order:\s*existing\.sort_order/);
  assert.match(items, /const nextOrder = Math\.max/);
  assert.doesNotMatch(items, /\(index \+ 1\) \* 10/);
});

test('SQL migration owns sequential ordering and atomic reorder operations', () => {
  const sql = read('supabase/migrations/20260930_maintenance_ordering.sql');
  assert.match(sql, /row_number\(\) over/);
  assert.match(sql, /alter column display_order set default 0/);
  assert.match(sql, /alter column sort_order set default 0/);
  assert.match(sql, /create or replace function public\.reorder_wards/);
  assert.match(sql, /create or replace function public\.reorder_report_items/);
  assert.match(sql, /with ordinality/);
  assert.match(sql, /maintenance role required/);
});
