import { DB_MODE } from '../data/index.js';
import { signIn } from '../auth.js';
import { qs, qsa } from '../core/dom.js';
import { flash } from '../core/ui.js';
import { modeBadge } from '../components/app-shell.js';

const titles = { ward: 'Ward Login', manager: 'Patrol Night Login', maintenance: 'Night Memo Maintenance' };
const defaults = { ward: 'c10@nightmemo.local', manager: 'patrolnight@nightmemo.local', maintenance: 'nightmaintenance@nightmemo.local' };
let role = null;
qs('#modeBadge').innerHTML = modeBadge(DB_MODE);
qsa('.login-option').forEach(b => { b.onclick = () => selectRole(b.dataset.role); });
qs('#backBtn').onclick = () => {
  role = null;
  qs('#loginBox').classList.remove('show');
  qsa('.login-option').forEach(b => { b.disabled = false; b.classList.remove('active'); });
  qs('#loginIntro')?.classList.remove('hidden');
};
qs('#loginForm').onsubmit = async event => {
  event.preventDefault();
  if (!role) return;
  const btn = qs('#loginBtn');
  btn.disabled = true;
  try {
    await signIn(qs('#loginId').value, qs('#password').value, role);
    location.href = role === 'ward' ? './ward.html' : role === 'manager' ? './manager.html' : './maintenance.html';
  } catch (error) {
    flash(error.message || String(error), 'error', 6000);
  } finally { btn.disabled = false; }
};
function selectRole(nextRole) {
  role = nextRole;
  qs('#loginTitle').textContent = titles[nextRole];
  qs('#loginId').value = DB_MODE === 'demo' ? defaults[nextRole] : '';
  qs('#password').value = DB_MODE === 'demo' ? 'demo' : '';
  qs('#demoHint').classList.toggle('hidden', DB_MODE !== 'demo');
  if (DB_MODE === 'demo') qs('#demoHint').textContent = 'Demo mode is enabled. Password: demo.';
  qs('#loginBox').classList.add('show');
  qs('#loginIntro')?.classList.add('hidden');
  qsa('.login-option').forEach(b => b.classList.toggle('active', b.dataset.role === nextRole));
  setTimeout(() => qs('#loginId').focus(), 30);
}
