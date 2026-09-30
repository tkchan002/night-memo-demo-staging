import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');

const auth = read('services/auth-service.js');
const login = read('pages/login-page.js');
const css = read('css/login.css');

function functionBody(source, name) {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf('\nexport async function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test('Supabase signIn authenticates credentials without duplicating the access query', () => {
  const body = functionBody(auth, 'signIn');
  assert.match(body, /supabase\.auth\.signInWithPassword/);
  const supabaseBranch = body.slice(body.indexOf('supabase.auth.signInWithPassword'));
  assert.doesNotMatch(supabaseBranch, /getCurrentAccess\(/);
  assert.match(supabaseBranch, /return data\.user/);
});

test('destination requireRole performs one authoritative access lookup using the known session user', () => {
  const body = functionBody(auth, 'requireRole');
  assert.match(body, /supabase\.auth\.getSession\(\)/);
  assert.match(body, /getCurrentAccess\(session\.user\.id\)/);
  assert.doesNotMatch(body, /auth\.getUser\(/);
  assert.match(body, /await clearSession\(\)/);
  assert.match(body, /returnToLogin\(\)/);
});

test('login keeps heavy auth loading off first paint and warms it before submit', () => {
  assert.match(login, /import \{ isSupabaseConfigured \} from '\.\.\/config\.js'/);
  assert.doesNotMatch(login, /from '\.\.\/data\/index\.js'/);
  assert.match(login, /import\('\.\.\/auth\.js'\)/);
  assert.match(login, /requestIdleCallback|setTimeout\(warmAuth, 0\)/);
});

test('login gives immediate busy feedback without an artificial authentication delay', () => {
  assert.match(login, /setLoginBusy\(true\)/);
  assert.match(login, /button\.textContent = busy \? 'Signing in…' : 'Login'/);
  assert.match(login, /button\.setAttribute\('aria-busy', String\(busy\)\)/);
  assert.match(login, /location\.replace\(destinations\[role\]\)/);
  const submitStart = login.indexOf("qs('#loginForm').onsubmit");
  const submitEnd = login.indexOf('\nfunction selectRole', submitStart);
  const submit = login.slice(submitStart, submitEnd);
  assert.doesNotMatch(submit, /setTimeout|new Promise|sleep|delay/i);
  assert.match(css, /#loginBtn\[aria-busy="true"\]/);
});
