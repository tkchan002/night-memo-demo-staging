const PRINT_JOB_PREFIX = 'nightMemoPrintJob:v1:';
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_HTML_BYTES = 2_500_000;

function defaultStorage() {
  if (!globalThis.sessionStorage) throw new Error('Session storage is unavailable in this browser.');
  return globalThis.sessionStorage;
}

function defaultLocation() {
  if (!globalThis.location) throw new Error('Browser location is unavailable.');
  return globalThis.location;
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function keyFor(id) {
  return `${PRINT_JOB_PREFIX}${id}`;
}

function safeSameOriginUrl(value, baseHref) {
  const base = new URL(baseHref);
  const target = new URL(value || baseHref, base);
  return target.origin === base.origin ? target.href : base.href;
}

function validateHtml(html) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('Printable document is empty.');
  const size = new TextEncoder().encode(html).byteLength;
  if (size > MAX_HTML_BYTES) throw new Error('Printable document is too large for the temporary print buffer.');
}

export function createPrintJob({
  html,
  title = 'Printable Document',
  kind = 'document',
  returnUrl,
  ttlMs = DEFAULT_TTL_MS,
} = {}, {
  storage = defaultStorage(),
  now = () => Date.now(),
  idFactory = randomId,
  currentHref = defaultLocation().href,
} = {}) {
  validateHtml(html);
  const createdAt = now();
  const id = idFactory();
  const job = {
    version: 1,
    id,
    title: String(title || 'Printable Document'),
    kind: String(kind || 'document'),
    html,
    returnUrl: safeSameOriginUrl(returnUrl || currentHref, currentHref),
    createdAt,
    expiresAt: createdAt + Math.max(60_000, Number(ttlMs) || DEFAULT_TTL_MS),
  };
  storage.setItem(keyFor(id), JSON.stringify(job));
  return job;
}

export function readPrintJob(id, {
  storage = defaultStorage(),
  now = () => Date.now(),
} = {}) {
  if (!id) return null;
  const raw = storage.getItem(keyFor(id));
  if (!raw) return null;
  try {
    const job = JSON.parse(raw);
    if (!job || job.version !== 1 || job.id !== id || typeof job.html !== 'string') {
      storage.removeItem(keyFor(id));
      return null;
    }
    if (!Number.isFinite(job.expiresAt) || job.expiresAt <= now()) {
      storage.removeItem(keyFor(id));
      return null;
    }
    return job;
  } catch {
    storage.removeItem(keyFor(id));
    return null;
  }
}

export function deletePrintJob(id, { storage = defaultStorage() } = {}) {
  if (id) storage.removeItem(keyFor(id));
}

export function purgeExpiredPrintJobs({
  storage = defaultStorage(),
  now = () => Date.now(),
} = {}) {
  const expired = [];
  for (let i = storage.length - 1; i >= 0; i -= 1) {
    const key = storage.key(i);
    if (!key?.startsWith(PRINT_JOB_PREFIX)) continue;
    try {
      const job = JSON.parse(storage.getItem(key));
      if (!job?.expiresAt || job.expiresAt <= now()) {
        storage.removeItem(key);
        expired.push(key);
      }
    } catch {
      storage.removeItem(key);
      expired.push(key);
    }
  }
  return expired.length;
}

export function openPrintView({
  html,
  title = 'Printable Document',
  kind = 'document',
  returnUrl,
} = {}, {
  storage = defaultStorage(),
  locationObject = defaultLocation(),
  now = () => Date.now(),
  idFactory = randomId,
} = {}) {
  purgeExpiredPrintJobs({ storage, now });
  const job = createPrintJob(
    { html, title, kind, returnUrl: returnUrl || locationObject.href },
    { storage, now, idFactory, currentHref: locationObject.href },
  );
  const target = new URL('./print.html', locationObject.href);
  target.searchParams.set('job', job.id);
  locationObject.assign(target.href);
  return job.id;
}

export const PRINT_JOB_TESTING = Object.freeze({
  PRINT_JOB_PREFIX,
  DEFAULT_TTL_MS,
  MAX_HTML_BYTES,
});
