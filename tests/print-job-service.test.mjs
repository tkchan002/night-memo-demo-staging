import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPrintJob,
  deletePrintJob,
  openPrintView,
  purgeExpiredPrintJobs,
  readPrintJob,
} from '../services/print-job-service.js';

class MemoryStorage {
  #map = new Map();
  get length() { return this.#map.size; }
  key(index) { return Array.from(this.#map.keys())[index] ?? null; }
  getItem(key) { return this.#map.has(key) ? this.#map.get(key) : null; }
  setItem(key, value) { this.#map.set(String(key), String(value)); }
  removeItem(key) { this.#map.delete(String(key)); }
}

const currentHref = 'https://example.test/night-memo/ward.html?ward=abc';

test('print jobs keep document data out of the URL and in session storage', () => {
  const storage = new MemoryStorage();
  const job = createPrintJob(
    { html: '<!doctype html><html><body>Patient data</body></html>', title: 'Ward Memo' },
    { storage, now: () => 1000, idFactory: () => 'job-1', currentHref },
  );
  assert.equal(job.id, 'job-1');
  assert.equal(job.returnUrl, currentHref);
  assert.equal(readPrintJob('job-1', { storage, now: () => 1001 }).html.includes('Patient data'), true);
});

test('expired jobs are removed and cannot be printed', () => {
  const storage = new MemoryStorage();
  createPrintJob(
    { html: '<html><body>x</body></html>', ttlMs: 60_000 },
    { storage, now: () => 10, idFactory: () => 'expired', currentHref },
  );
  assert.equal(readPrintJob('expired', { storage, now: () => 60_011 }), null);
  assert.equal(storage.length, 0);
});

test('external return URLs are rejected', () => {
  const storage = new MemoryStorage();
  const job = createPrintJob(
    { html: '<html><body>x</body></html>', returnUrl: 'https://evil.example/' },
    { storage, now: () => 10, idFactory: () => 'safe', currentHref },
  );
  assert.equal(job.returnUrl, currentHref);
});

test('openPrintView navigates only after the job has been stored', () => {
  const storage = new MemoryStorage();
  const calls = [];
  const locationObject = {
    href: currentHref,
    assign(value) {
      calls.push({ value, storageLength: storage.length });
    },
  };
  const id = openPrintView(
    { html: '<html><body>x</body></html>', title: 'Test' },
    { storage, locationObject, now: () => 10, idFactory: () => 'nav-job' },
  );
  assert.equal(id, 'nav-job');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].storageLength, 1);
  assert.match(calls[0].value, /print\.html\?job=nav-job$/);
});

test('purge and delete clean up temporary data', () => {
  const storage = new MemoryStorage();
  createPrintJob({ html: '<html><body>a</body></html>', ttlMs: 60_000 }, { storage, now: () => 0, idFactory: () => 'a', currentHref });
  createPrintJob({ html: '<html><body>b</body></html>' }, { storage, now: () => 100_000, idFactory: () => 'b', currentHref });
  assert.equal(purgeExpiredPrintJobs({ storage, now: () => 120_000 }), 1);
  assert.ok(readPrintJob('b', { storage, now: () => 100_001 }));
  deletePrintJob('b', { storage });
  assert.equal(storage.length, 0);
});
