export const qs = (selector, parent = document) => parent.querySelector(selector);
export const qsa = (selector, parent = document) => [...parent.querySelectorAll(selector)];

export function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[ch]));
}

export function on(parent, eventName, selector, handler, options) {
  parent.addEventListener(eventName, event => {
    const target = event.target?.closest?.(selector);
    if (target && parent.contains(target)) handler(event, target);
  }, options);
}
