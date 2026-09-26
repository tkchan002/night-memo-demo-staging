import test from 'node:test';
import assert from 'node:assert/strict';
import { todayISO, addDaysISO } from '../core/dates.js';
import { createRequestSequencer } from '../core/request-sequencer.js';
import { sanitizeTemplateCss, isTrustedWindowMessage } from '../core/template-security.js';

test('report date follows Hong Kong calendar day rather than UTC day', () => {
  const instant = new Date('2026-09-25T16:30:00.000Z'); // 00:30 on 26 Sep in Hong Kong
  assert.equal(todayISO('Asia/Hong_Kong', instant), '2026-09-26');
});

test('request sequencer invalidates earlier async requests', () => {
  const seq = createRequestSequencer();
  const first = seq.begin();
  const second = seq.begin();
  assert.equal(seq.isCurrent(first), false);
  assert.equal(seq.isCurrent(second), true);
});

test('template CSS cannot inject closing style markup or active URL schemes', () => {
  const css = `.x{color:red}</style><script>alert(1)</script>@import url('https://evil.invalid/x.css');.y{background:url(javascript:alert(2))}`;
  const clean = sanitizeTemplateCss(css);
  assert.equal(clean.includes('<'), false);
  assert.equal(clean.includes('>'), false);
  assert.equal(/@import/i.test(clean), false);
  assert.equal(/javascript:/i.test(clean), false);
});

test('window messages require both expected source and origin', () => {
  const source = {};
  assert.equal(isTrustedWindowMessage({ source, origin: 'https://example.test' }, source, 'https://example.test'), true);
  assert.equal(isTrustedWindowMessage({ source: {}, origin: 'https://example.test' }, source, 'https://example.test'), false);
  assert.equal(isTrustedWindowMessage({ source, origin: 'https://evil.test' }, source, 'https://example.test'), false);
});

test('ISO date arithmetic is timezone-independent', () => {
  assert.equal(addDaysISO('2026-10-01', -1), '2026-09-30');
  assert.equal(addDaysISO('2026-03-01', -1), '2026-02-28');
});
