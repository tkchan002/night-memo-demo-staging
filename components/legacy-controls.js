import { qsa, esc } from '../core/dom.js';

export function buildBedButtons(capacity, selected = []) {
  selected = selected.map(String);
  return `<div class="bed-grid">${Array.from({ length: Math.max(0, Number(capacity) || 0) }, (_, i) => {
    const bed = String(i + 1);
    return `<label class="bed-chip ${selected.includes(bed) ? 'selected' : ''}"><input type="checkbox" value="${bed}" ${selected.includes(bed) ? 'checked' : ''}><span>${bed}</span></label>`;
  }).join('')}</div>`;
}

export function getSelectedBeds(container) {
  return qsa('input[type="checkbox"]:checked', container).map(x => x.value).sort((a, b) => Number(a) - Number(b));
}

export function renderSimpleTable(rows, headers) {
  return `<table class="data-table"><thead><tr>${headers.map(h => `<th>${esc(h.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${headers.map(h => `<td>${h.render ? h.render(r) : esc(r[h.key] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
