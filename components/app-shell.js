import { qs } from '../core/dom.js';

export function modeBadge(mode) {
  return mode === 'demo'
    ? '<span class="mode-badge demo">Local demo mode</span>'
    : '<span class="mode-badge live">Supabase live</span>';
}

export function setAppHeader({ title, subtitle = '', access = null, mode = 'live' }) {
  const titleEl = qs('#appTitle');
  const subtitleEl = qs('#appSubtitle');
  const userEl = qs('#userBadge');
  const modeEl = qs('#modeBadge');
  if (titleEl) titleEl.textContent = title;
  if (subtitleEl) subtitleEl.textContent = subtitle;
  if (userEl && access) {
    userEl.textContent = access.role === 'ward'
      ? (access.wards?.code || access.login_id)
      : (access.display_name || access.login_id);
  }
  if (modeEl) modeEl.innerHTML = modeBadge(mode);
}
