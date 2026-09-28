import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBMISSION_WINDOW_MINUTES,
  submissionCutoff,
  isRecentSubmission,
  reportSubmittedAt,
} from '../domain/report-session.js';

test('submission window defaults to 120 minutes', () => {
  assert.equal(SUBMISSION_WINDOW_MINUTES, 120);
  const now = new Date('2026-09-27T14:00:00.000Z');
  assert.equal(submissionCutoff(now).toISOString(), '2026-09-27T12:00:00.000Z');
});

test('submitted_at is preferred over legacy timestamps', () => {
  const report = {
    submitted_at: '2026-09-27T13:00:00.000Z',
    updated_at: '2026-09-27T12:00:00.000Z',
  };
  assert.equal(reportSubmittedAt(report), report.submitted_at);
});

test('recent submission uses rolling window rather than report date', () => {
  const now = new Date('2026-09-27T14:00:00.000Z');
  assert.equal(isRecentSubmission({ report_date: '2026-09-26', submitted_at: '2026-09-27T13:30:00.000Z' }, now), true);
  assert.equal(isRecentSubmission({ report_date: '2026-09-27', submitted_at: '2026-09-27T11:59:59.000Z' }, now), false);
});
