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
    <label class="empty-field empty-type"><span class="empty-mobile-label">Type</span><select data-empty-designation aria-label="Empty bed type">${designationOptions.join('')}</select></label>
    <label class="empty-field empty-remarks"><span class="empty-mobile-label">Remarks</span><input type="text" data-empty-remark aria-label="Empty bed remarks" value="${esc(value.remark || '')}"></label>
    <button class="btn-x empty-remove" type="button" aria-label="Remove empty bed entry">x</button>
    <label class="empty-field empty-custom" hidden><span>Other designation</span><input type="text" data-empty-custom aria-label="Custom designation" value="${esc(value.customDesignation || '')}"></label>`;
}
