import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWardMemoHtml } from '../ward-print.js';

const ward = { name: 'Male Ward', empty_bed_gender_mode: 'male' };
const print = (admissionBySex, report_type = 'night', changes = {}) => renderWardMemoHtml({
  ward,
  capacity: 40,
  report: {
    report_type, report_date: '2026-10-12',
    payload: {
      admissionEC: '4', admissionCC: '3', transferIn: '5',
      discharge: '2', transferOut: '1', death: '0', totalPatientM: '36',
      emptyBeds: { count: 4, entries: [] },
      admissionBySex,
      ...changes,
    },
  },
});

const pair = {
  admissionEC: { M: 3, F: 1 },
  admissionCC: { M: 1, F: 2 },
  transferIn: { M: 4, F: 1 },
};

test('ward print shows M/F detail under each admission total, not in the same line', () => {
  const html = print(pair);
  assert.match(html, /E\/C&nbsp; <span class="bignum">4<\/span><\/div><div class="sex-detail"><span>M: 3<\/span><span>F: 1<\/span><\/div>/);
  assert.match(html, /C\/C&nbsp; <span class="bignum">3<\/span><\/div><div class="sex-detail"><span>M: 1<\/span><span>F: 2<\/span><\/div>/);
});

test('narrow T/I column puts M/F on separate lines and does not enforce nowrap on the totals', () => {
  const html = print(pair);
  assert.match(html, /Gen&nbsp; 5<\/div><div class="sex-detail sex-detail-stacked"><span>M: 4<\/span><span>F: 1<\/span><\/div>/);
  assert.match(html, /\.transfer \.bigline\{white-space:normal;\}/);
  assert.doesNotMatch(html, /\.transfer \.bigline\{white-space:nowrap;\}/);
  assert.match(html, /\.sex-detail-stacked\{display:flex;flex-direction:column;/);
});

test('zero M/F entries do not add extra print lines', () => {
  const zero = { admissionEC: { M: 0, F: 0 }, admissionCC: { M: 0, F: 0 }, transferIn: { M: 0, F: 0 } };
  const html = print(zero, 'pm', { admissionEC: '0', admissionCC: '0', transferIn: '0' });
  assert.match(html, /<title>PM Memo<\/title>/);
  assert.doesNotMatch(html, /class="sex-detail"/);
  assert.doesNotMatch(html, /class="sex-detail sex-detail-stacked"/);
});

test('typed fixed-sex memo does not label combined admission, discharge, or census counts as male', () => {
  const html = print(pair);
  assert.match(html, /Discharge:<\/div><div class="bigline"><span class="bignum">2<\/span>/);
  assert.match(html, /Total Patient: 36/);
  assert.doesNotMatch(html, /Total Patient: M 36/);
  assert.doesNotMatch(html, /E\/C&nbsp; M /);
});

test('historical reports without M/F entries retain their earlier print format', () => {
  const html = print(null);
  assert.match(html, /Discharge:<\/div><div class="bigline">M <span class="bignum">2<\/span>/);
  assert.match(html, /Total Patient: M 36/);
  assert.doesNotMatch(html, /class="sex-detail"/);
});

test('Ward print escapes text and never injects printed HTML in admission details', () => {
  const html = print({ admissionEC: { M: '3<script>', F: 1 }, admissionCC: pair.admissionCC, transferIn: pair.transferIn });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<span>M: 0<\/span>/);
});
