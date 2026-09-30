import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');

const indexHtml = read('index.html');
const loginCss = read('css/login.css');
const loginPage = read('pages/login-page.js');
const authService = read('services/auth-service.js');
const viteConfig = read('vite.config.js');

function collectRuntimeFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'tests' || entry === 'node_modules' || entry === 'dist' || entry.startsWith('.git')) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collectRuntimeFiles(full, out);
    else if (/\.(?:js|html|json|ya?ml)$/.test(entry) || entry === 'vite.config.js') out.push(full);
  }
  return out;
}

test('index.html is the only login document', () => {
  assert.equal(existsSync(path.join(root, 'login.html')), false, 'login.html must be deleted');
  assert.match(indexHtml, /class="login-role-grid"/);
  assert.equal((indexHtml.match(/class="login-option login-role-card"/g) || []).length, 3);
  assert.match(indexHtml, /data-role="ward"/);
  assert.match(indexHtml, /data-role="manager"/);
  assert.match(indexHtml, /data-role="maintenance"/);
});

test('role choices are large source-defined SVG icons', () => {
  assert.equal((indexHtml.match(/class="login-role-icon"/g) || []).length, 3);
  assert.ok((indexHtml.match(/<svg /g) || []).length >= 5, 'three role icons plus password visibility icons are expected');
  assert.doesNotMatch(indexHtml, /🏥|📋|🛠️/u);
  assert.match(loginCss, /\.login-role-icon\s*\{[^}]*width:102px/s);
  assert.doesNotMatch(loginPage, /createElement\(|insertAdjacentHTML|innerHTML\s*=.*login-role/);
});

test('password visibility control remains semantic and page-owned', () => {
  assert.match(indexHtml, /id="password" type="password"/);
  assert.match(indexHtml, /id="togglePassword"[^>]*aria-controls="password"[^>]*aria-pressed="false"[^>]*aria-label="Show password"/);
  assert.match(loginPage, /qs\('#togglePassword'\)\.onclick/);
  assert.match(loginPage, /input\.type = visible \? 'text' : 'password'/);
  assert.match(loginPage, /button\.setAttribute\('aria-pressed', String\(visible\)\)/);
  assert.doesNotMatch(indexHtml, /onclick=/);
});

test('authentication boundary always returns to index.html', () => {
  assert.match(authService, /const LOGIN_PAGE = '\.\/index\.html';/);
  assert.match(authService, /location\.replace\(LOGIN_PAGE\)/);
  assert.doesNotMatch(authService, /login\.html/);
});

test('Vite has one login entry only: index.html', () => {
  assert.match(viteConfig, /index:\s*'index\.html'/);
  assert.doesNotMatch(viteConfig, /login:\s*'login\.html'/);
  assert.doesNotMatch(viteConfig, /login\.html/);
});

test('runtime/build source contains no login.html route', () => {
  const offenders = [];
  for (const file of collectRuntimeFiles(root)) {
    if (file === fileURLToPath(import.meta.url)) continue;
    const source = readFileSync(file, 'utf8');
    if (/login\.html/.test(source)) offenders.push(path.relative(root, file));
  }
  assert.deepEqual(offenders, []);
});

test('role selection and successful authentication routes remain explicit', () => {
  assert.match(loginPage, /ward:\s*'Ward Login'/);
  assert.match(loginPage, /manager:\s*'Patrol Night Login'/);
  assert.match(loginPage, /maintenance:\s*'Night Memo Maintenance'/);
  assert.match(loginPage, /await signIn\(qs\('#loginId'\)\.value, qs\('#password'\)\.value, role\)/);
  assert.match(loginPage, /'\.\/ward\.html'/);
  assert.match(loginPage, /'\.\/manager\.html'/);
  assert.match(loginPage, /'\.\/maintenance\.html'/);
});
