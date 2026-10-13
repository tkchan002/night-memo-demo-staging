import { esc } from '../core/dom.js';
import { availableEmptyBedDesignations } from '../domain/empty-bed-reporting.js';

/** A reusable, presentation-only row; Ward owns its state and event handlers. */
export function emptyBedEntryMarkup({ value = {}, ward = {}, numberCeiling = 60 } = {}) {
  const savedNumber = String(value.quantity ?? '');
  const savedCode = String(value.designation ?? '').trim().toUpperCase();
  const numericValue = Number(savedNumber);
  // Existing values remain selectable even if Maintenance reduces capacity.
  const maxNumber = Math.max(numberCeiling, Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : 0);
  const numberOptions = ['<option value=""></option>'];
  for (let number = 1; number <= maxNumber; number += 1) numberOptions.push(`<option value="${number}">${number}</option>`);
  const designationOptions = ['<option value=""></option>'];
  for (const code of availableEmptyBedDesignations(ward, savedCode)) {
    designationOptions.push(`<option value="${code}">${code === 'OTHER' ? 'Other' : code}</option>`);
  }
  return `<label class="empty-field empty-quantity"><span class="empty-mobile-label">Number</span><select data-empty-quantity aria-label="Empty bed number">${numberOptions.join('')}</select></label>
    <div class="empty-field empty-type"><span class="empty-mobile-label">Type</span><div class="empty-type-controls">
      <select data-empty-designation aria-label="Empty bed type">${designationOptions.join('')}</select>
      <div class="empty-other-editor" hidden>
        <input type="text" data-empty-custom aria-label="Custom type" value="${esc(value.customDesignation || '')}">
        <button class="empty-type-back" data-empty-type-list type="button" aria-label="Back to type list" title="Back to type list">List</button>
      </div>
    </div></div>
    <label class="empty-field empty-remarks"><span class="empty-mobile-label">Remarks</span><input type="text" data-empty-remark aria-label="Empty bed remarks" value="${esc(value.remark || '')}"></label>
    <button class="btn-x empty-remove" type="button" aria-label="Remove empty bed entry">x</button>`;
}

/** Swap the Type dropdown for an inline custom Type editor, without changing the entry grid. */
export function bindEmptyBedType(row, { onBack = () => {} } = {}) {
  const select = row.querySelector('[data-empty-designation]');
  const editor = row.querySelector('.empty-other-editor');
  const input = row.querySelector('[data-empty-custom]');
  const back = row.querySelector('[data-empty-type-list]');
  const sync = (focus = false) => {
    const custom = select.value === 'OTHER';
    select.hidden = custom;
    editor.hidden = !custom;
    if (custom && focus) input.focus();
  };
  select.addEventListener('change', () => sync(true));
  back.addEventListener('click', () => {
    // Preserve the draft custom text for an accidental Back, but do not
    // submit it unless OTHER is selected again.
    select.value = '';
    sync();
    select.focus();
    onBack();
  });
  sync(); // Restores already-saved OTHER rows without stealing focus.
}
