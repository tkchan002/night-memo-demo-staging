import test from 'node:test';
import assert from 'node:assert/strict';
import { formatManagerEmptyBeds } from '../domain/manager-memo.js';
import { normalizeReportPayload } from '../domain/report-model.js';
import { validateReportPayload } from '../domain/report-validation.js';

test('Manager displays submitted counts without deriving M/F or reconciling', () => {
  const payload = normalizeReportPayload({ totalPatientM: '35', emptyBeds: {
    count: 5, details: [], reported: { male: 1, female: 0, single: 2, double: 1, singleDoubleEnabled: true },
  }});
  assert.equal(payload.emptyBeds.count, 5);
  assert.equal(formatManagerEmptyBeds({ empty_bed_gender_mode: 'male' }, { payload }, 40), '5 (1M, 2S, 1D)');
  assert.equal(validateReportPayload(payload, { capacity: 40 }).valid, true);
});

test('Different manually reported quantities never change Total Empty Bed', () => {
  const input = { totalPatientM: '35', emptyBeds: {
    count: 5, details: [], reported: { male: 9, female: 0, single: 1, double: 4, singleDoubleEnabled: true },
  }};
  assert.equal(validateReportPayload(input, { capacity: 40 }).valid, true);
  assert.equal(normalizeReportPayload(input).emptyBeds.count, 5);
});

test('Old reports without the new reporting structure retain legacy formatting', () => {
  const report = { payload: { totalPatientM: '35', emptyBeds: { count: 5, details: [] } } };
  assert.equal(formatManagerEmptyBeds({ empty_bed_gender_mode: 'male' }, report, 40), '5M');
});

test('Ward PDF source renders independently entered counts, including S/D', async () => {
  const { renderWardMemoHtml } = await import('../ward-print.js');
  const html = renderWardMemoHtml({
    ward: { name: 'C5', empty_bed_gender_mode: 'male', single_double_reporting_enabled: true },
    report: { report_date: '2026-10-09', payload: {
      totalPatientM: '35', emptyBeds: {
        count: 5, details: [], reported: { male: 1, female: 0, single: 2, double: 1, singleDoubleEnabled: true },
      },
      infBeds: {}, devBeds: {}, earlyBirds: [], patients: [], nurses: [], nilSpecial: true,
      consultations: [], nilConsultation: true, intubations: [], nilIntubation: true,
    } },
    capacity: 40,
  });
  assert.match(html, /Empty Bed:\s*5/);
  assert.match(html, /Manual M\/F\/S\/D:/);
  assert.match(html, /1M, 2S, 1D/);
});


test('ward access query includes S/D configuration for conditional controls', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../data/repositories/access-repository.js', import.meta.url), 'utf8');
  assert.match(src, /wards\(id,name,phone,fax,empty_bed_gender_mode,single_double_reporting_enabled,/);
});

test('S/D is persisted with the ward, not as a generic Report Item', async () => {
  const { readFile } = await import('node:fs/promises');
  const maint = await readFile(new URL('../pages/maintenance-page.js', import.meta.url), 'utf8');
  const ward = await readFile(new URL('../pages/ward-page.js', import.meta.url), 'utf8');
  assert.match(maint, /single_double_reporting_enabled: \$\('#mWardSingleDouble'\)\.checked/);
  assert.match(ward, /makeEmptyBedReporting/);
  assert.match(ward, /count: calcEmpty\(\)/);
});
