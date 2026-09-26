import { qs } from './dom.js';

export function flash(message, type = 'info', timeout = 3500) {
  let host = qs('#toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    host.className = 'toast-host';
    document.body.append(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  host.append(el);
  setTimeout(() => el.remove(), timeout);
}

export function showBusy(el, on, label = 'Working...') {
  if (!el) return;
  if (on) {
    el.dataset.oldText = el.textContent;
    el.disabled = true;
    el.textContent = label;
  } else {
    el.disabled = false;
    el.textContent = el.dataset.oldText || el.textContent;
  }
}
