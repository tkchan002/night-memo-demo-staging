import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMPTY_BED_GENDER_MODES,
  emptyBedGenderLabel,
  wardRequiresPerBedGender,
} from '../domain/ward.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('ward domain has one canonical mixed empty-bed mode', () => {
  assert.equal(EMPTY_BED_GENDER_MODES.mixed.value, 'mixed');
  assert.equal(emptyBedGenderLabel('mixed'), 'Mixed');
  assert.equal(wardRequiresPerBedGender({ empty_bed_gender_mode: 'mixed' }), true);
  assert.equal(Object.hasOwn(EMPTY_BED_GENDER_MODES, 'dynamic'), false);
});

test('Maintenance owns Ward Name and Mixed directly in source markup', () => {
  const html = read('maintenance.html');
  assert.match(html, /<label>Ward Name<\/label><input id="mWardName" required>/);
  assert.match(html, /<option value="mixed">Mixed<\/option>/);
  assert.doesNotMatch(html, /mWardCode|Ward Code|Display Name \/ Contact|value="dynamic"/);
});

test('Maintenance controller has no terminology or duplicate-name synchronization patch', () => {
  const page = read('pages/maintenance-page.js');
  assert.doesNotMatch(page, /installUiTerminology|option\[value=["']dynamic["']\]/);
  assert.doesNotMatch(page, /mWardCode|ward\.code|display_name:\s*wardName/);
  assert.match(page, /validateWardName/);
  assert.match(page, /createWard\(\{ name: wardName/);
  assert.match(page, /updateWard\(state\.editingWard\.id, \{ name: wardName/);
});

test('ward repository uses name as the only ward identity field', () => {
  const repo = read('data/repositories/ward-repository.js');
  assert.match(repo, /getWardByName/);
  assert.match(repo, /\.order\('name'/);
  assert.match(repo, /const name = validateWardName\(config\.name\)/);
  assert.doesNotMatch(repo, /getWardByCode|\.eq\(['"]code['"]|\bcode\s*:|display_name/);
});

test('runtime sources contain no legacy ward_code, ward.code, or dynamic gender mode', () => {
  const runtimeFiles = [
    'maintenance.html',
    'pages/maintenance-page.js',
    'pages/maintenance-test-data.js',
    'pages/ward-page.js',
    'pages/manager-page.js',
    'pages/manager-night-operations.js',
    'components/app-shell.js',
    'components/report-view.js',
    'domain/demo-generator.js',
    'domain/manager-memo.js',
    'domain/night-roster.js',
    'data/repositories/ward-repository.js',
    'data/repositories/access-repository.js',
    'data/repositories/account-repository.js',
    'data/demo-state.js',
    'demo-data.js',
    'night-roster-print.js',
    'scripts/migrate-memo-json.mjs',
    'scripts/create-demo-users.mjs',
  ];
  const combined = runtimeFiles.map(file => `\n// ${file}\n${read(file)}`).join('\n');
  assert.doesNotMatch(combined, /\bward_code\b|ward\??\.code|\bw\.code\b|mWardCode|manager_section|mWardSection|value="dynamic"|empty_bed_gender_mode\s*===\s*['"]dynamic['"]/);
});

test('schema and live migration own the canonical Ward model', () => {
  const schema = read('supabase/schema.sql');
  assert.match(schema, /create table if not exists public\.wards[\s\S]*name text not null/);
  assert.match(schema, /empty_bed_gender_mode in \('male','female','mixed','none'\)/);
  const wardsBlock = schema.slice(schema.indexOf('create table if not exists public.wards'), schema.indexOf('create table if not exists public.ward_operating_periods'));
  assert.doesNotMatch(wardsBlock, /\bcode\b|display_name|dynamic/);

  const migration = read('supabase/migrations/20260930_ward_identity_and_gender_model.sql');
  assert.match(migration, /rename column code to name/);
  assert.match(migration, /drop column if exists display_name/);
  assert.match(migration, /set empty_bed_gender_mode = 'mixed'/);
  assert.match(migration, /ward_code'[\s\S]*ward_name/);
  assert.match(migration, /night-memo-generated-v2/);
});
