import { isSupabaseConfigured } from '../config.js';
import { qs, qsa } from '../core/dom.js';
import { flash } from '../core/ui.js';
import { modeBadge } from '../components/app-shell.js';

const DB_MODE = isSupabaseConfigured() ? 'supabase' : 'demo';
const titles = {
  ward: 'Ward Login',
  manager: 'Patrol Night Login',
  maintenance: 'Night Memo Maintenance',
};
const defaults = {
  ward: 'c10@nightmemo.local',
  manager: 'patrolnight@nightmemo.local',
  maintenance: 'nightmaintenance@nightmemo.local',
};
const destinations = {
  ward: './ward.html',
  manager: './manager.html',
  maintenance: './maintenance.html',
};

let role = null;
let authPromise = null;

qs('#modeBadge').innerHTML = modeBadge(DB_MODE);

function loadAuth() {
  if (!authPromise) authPromise = import('../auth.js');
  return authPromise;
}

// Let the page paint first, then prepare the auth/Supabase module in the
// background so the Login click normally waits only for credential auth.
if (DB_MODE === 'supabase') {
  const warmAuth = () => { loadAuth().catch(() => {}); };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(warmAuth, { timeout: 800 });
  } else {
    setTimeout(warmAuth, 0);
  }
}

qsa('.login-option').forEach(button => {
  button.onclick = () => selectRole(button.dataset.role);
});
qs('#backBtn').onclick = returnToRoleChooser;
qs('#togglePassword').onclick = () => {
  setPasswordVisibility(qs('#password').type === 'password');
};
qs('#loginForm').onsubmit = async event => {
  event.preventDefault();
  if (!role) return;

  let navigating = false;
  setLoginBusy(true);
  try {
    const { signIn } = await loadAuth();
    await signIn(qs('#loginId').value, qs('#password').value, role);
    navigating = true;
    location.replace(destinations[role]);
  } catch (error) {
    flash(error.message || String(error), 'error', 6000);
  } finally {
    if (!navigating) setLoginBusy(false);
  }
};

function selectRole(nextRole) {
  role = nextRole;
  qs('#loginTitle').textContent = titles[nextRole];
  qs('#loginRolePrompt').textContent = `Sign in to ${titles[nextRole]}.`;
  qs('#loginId').value = DB_MODE === 'demo' ? defaults[nextRole] : '';
  qs('#password').value = DB_MODE === 'demo' ? 'demo' : '';
  setPasswordVisibility(false);
  setLoginBusy(false);

  qs('#demoHint').classList.toggle('hidden', DB_MODE !== 'demo');
  if (DB_MODE === 'demo') qs('#demoHint').textContent = 'Demo mode is enabled. Password: demo.';

  qs('#loginBox').classList.add('show');
  qs('#loginIntro').classList.add('hidden');
  qsa('.login-option').forEach(button => {
    button.classList.toggle('active', button.dataset.role === nextRole);
  });
  setTimeout(() => qs('#loginId').focus(), 30);
}

function returnToRoleChooser() {
  role = null;
  qs('#loginBox').classList.remove('show');
  qs('#loginIntro').classList.remove('hidden');
  qs('#loginId').value = '';
  qs('#password').value = '';
  setPasswordVisibility(false);
  setLoginBusy(false);
  qsa('.login-option').forEach(button => button.classList.remove('active'));
}

function setPasswordVisibility(visible) {
  const input = qs('#password');
  const button = qs('#togglePassword');
  input.type = visible ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(visible));
  button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  button.title = visible ? 'Hide password' : 'Show password';
}

function setLoginBusy(busy) {
  const button = qs('#loginBtn');
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
  button.textContent = busy ? 'Signing in…' : 'Login';

  qs('#loginId').readOnly = busy;
  qs('#password').readOnly = busy;
  qs('#backBtn').disabled = busy;
  qs('#togglePassword').disabled = busy;
}
