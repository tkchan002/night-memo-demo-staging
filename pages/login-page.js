import { DB_MODE } from '../data/index.js';
import { signIn } from '../auth.js';
import { qs, qsa } from '../core/dom.js';
import { flash } from '../core/ui.js';
import { modeBadge } from '../components/app-shell.js';

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

let role = null;

qs('#modeBadge').innerHTML = modeBadge(DB_MODE);
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

  const button = qs('#loginBtn');
  button.disabled = true;
  try {
    await signIn(qs('#loginId').value, qs('#password').value, role);
    location.href = role === 'ward'
      ? './ward.html'
      : role === 'manager'
        ? './manager.html'
        : './maintenance.html';
  } catch (error) {
    flash(error.message || String(error), 'error', 6000);
  } finally {
    button.disabled = false;
  }
};

function selectRole(nextRole) {
  role = nextRole;
  qs('#loginTitle').textContent = titles[nextRole];
  qs('#loginRolePrompt').textContent = `Sign in to ${titles[nextRole]}.`;
  qs('#loginId').value = DB_MODE === 'demo' ? defaults[nextRole] : '';
  qs('#password').value = DB_MODE === 'demo' ? 'demo' : '';
  setPasswordVisibility(false);

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
