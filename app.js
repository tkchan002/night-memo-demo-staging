// Compatibility facade for legacy imports. New code should import core/domain/
// component modules directly so general helpers do not initialise the database.
import { DB_MODE } from './database.js';
import { modeBadge as renderModeBadge, setAppHeader as renderAppHeader } from './components/app-shell.js';

export { qs, qsa, esc } from './core/dom.js';
export { todayISO, toDisplayDate, fromDisplayDate, formatDateTime } from './core/dates.js';
export { numberValue } from './core/numbers.js';
export { flash, showBusy } from './core/ui.js';
export { fullReportPayloadDefaults } from './domain/report-model.js';
export { buildBedButtons, getSelectedBeds, renderSimpleTable } from './components/legacy-controls.js';

export function modeBadge() {
  return renderModeBadge(DB_MODE);
}

export function setAppHeader(options) {
  return renderAppHeader({ ...options, mode: DB_MODE });
}
