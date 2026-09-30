import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('Maintenance Ward configuration has no Manager memo section UI', () => {
  const html = read('maintenance.html');
  assert.doesNotMatch(html, /Manager memo section|Memo Section|mWardSection/);
  assert.match(html, /<th>Ward Name<\/th>/);
  assert.match(html, /<th>Empty-bed Gender<\/th>/);
});

test('Ward repository no longer models or filters by manager section', () => {
  const repo = read('data/repositories/ward-repository.js');
  assert.match(repo, /export async function getWardsForDate\(date = defaultReportDate\(\)\)/);
  assert.doesNotMatch(repo, /manager_section|section = null|ward\.manager_section/);
  assert.match(repo, /return open;/);
});

test('runtime and demo sources contain no obsolete manager_section field', () => {
  const files = [
    'maintenance.html',
    'pages/maintenance-page.js',
    'pages/maintenance-test-data.js',
    'pages/manager-page.js',
    'pages/manager-night-operations.js',
    'pages/ward-page.js',
    'data/repositories/ward-repository.js',
    'data/repositories/access-repository.js',
    'data/demo-state.js',
    'demo-data.js',
    'domain/demo-generator.js',
    'domain/manager-memo.js',
    'domain/night-roster.js',
  ];
  const combined = files.map(file => `\n// ${file}\n${read(file)}`).join('\n');
  assert.doesNotMatch(combined, /manager_section|mWardSection|Manager memo section|Memo Section/);
});

test('fresh schema and seed no longer define a Manager section', () => {
  const schema = read('supabase/schema.sql');
  const seed = read('supabase/seed.sql');
  const wardsBlock = schema.slice(schema.indexOf('create table if not exists public.wards'), schema.indexOf('create table if not exists public.ward_operating_periods'));
  assert.doesNotMatch(wardsBlock, /manager_section/);
  assert.doesNotMatch(seed, /manager_section/);
});

test('live migration drops the obsolete column instead of hiding it', () => {
  const migration = read('supabase/migrations/20260930_remove_manager_section.sql');
  assert.match(migration, /alter table public\.wards[\s\S]*drop column if exists manager_section/);
});
