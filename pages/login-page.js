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

let role = null;

// Show the mode immediately.
// This no longer waits for supabase-js to download.
qs('#modeBadge').innerHTML = modeBadge(DB_MODE);

// Load the authentication code in the background.
let authPromise = null;

function loadAuth() {
  if (!authPromise) {
    authPromise = import('../auth.js');
  }
  return authPromise;
}

// Start warming Supabase after the page has rendered.
if (DB_MODE === 'supabase') {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => loadAuth(), { timeout: 1000 });
  } else {
    setTimeout(() => loadAuth(), 0);
  }
}

qsa('.login-option').forEach(button => {
  button.onclick = () => selectRole(button.dataset.role);
});

qs('#backBtn').onclick = () => {
  role = null;
  qs('#loginBox').classList.remove('show');

  qsa('.login-option').forEach(button => {
    button.disabled = false;
    button.classList.remove('active');
  });

  qs('#loginIntro')?.classList.remove('hidden');
};

qs('#loginForm').onsubmit = async event => {
  event.preventDefault();

  if (!role) return;

  const button = qs('#loginBtn');
  button.disabled = true;

  try {
    const { signIn } = await loadAuth();

    await signIn(
      qs('#loginId').value,
      qs('#password').value,
      role
    );

    location.href =
      role === 'ward'
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

  qs('#loginId').value =
    DB_MODE === 'demo'
      ? defaults[nextRole]
      : '';

  qs('#password').value =
    DB_MODE === 'demo'
      ? 'demo'
      : '';

  qs('#demoHint').classList.toggle(
    'hidden',
    DB_MODE !== 'demo'
  );

  if (DB_MODE === 'demo') {
    qs('#demoHint').textContent =
      'Demo mode is enabled. Password: demo.';
  }

  qs('#loginBox').classList.add('show');
  qs('#loginIntro')?.classList.add('hidden');

  qsa('.login-option').forEach(button => {
    button.classList.toggle(
      'active',
      button.dataset.role === nextRole
    );
  });

  setTimeout(() => qs('#loginId').focus(), 30);
}