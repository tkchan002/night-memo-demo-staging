import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNightOperationsModel, normalizeNightNurse } from '../domain/night-roster.js';
import { renderNightStaffPrintHtml, renderNightRunnerPrintHtml } from '../night-roster-print.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const nurse = normalizeNightNurse({ role: 'RN', name: 'Chan Tai Man', appt: '2021-09-05', runner: true });
assert.deepEqual(nurse, { role: 'RN', name: 'Chan Tai Man', appointmentDate: '05/09/2021', runner: true });

const wards = [
  { id: 'w2', name: 'E10', display_order: 2 },
  { id: 'w1', name: 'C5', display_order: 1 },
];
const snapshots = [
  { ward_id: 'w1', reporting_date: '2026-09-29', updated_at: '2026-09-29T14:00:00Z', nurses: [
    { role: 'RN', name: 'A', appt: '01/01/2020', runner: false },
    { role: 'RN', name: 'B', appt: '02/02/2021', runner: true },
  ] },
  { ward_id: 'w2', reporting_date: '2026-09-29', updated_at: '2026-09-29T14:05:00Z', nurses: [
    { role: 'APN', name: 'C', appt: '03/03/2018', runner: false },
  ] },
];
const model = buildNightOperationsModel({ wards, snapshots });
assert.equal(model.nurseCount, 3);
assert.equal(model.runnerCount, 1);
assert.equal(model.wardRosters[0].ward.name, 'C5');
assert.equal(model.runners[0].name, 'B');

const staffHtml = renderNightStaffPrintHtml({ reportingDate: '2026-09-29', wardRosters: model.wardRosters, printedAt: new Date('2026-09-29T15:00:00Z') });
assert.match(staffHtml, /Night Staff List/);
assert.match(staffHtml, /C5/);
assert.match(staffHtml, /Appointment Date/);

const runnerHtml = renderNightRunnerPrintHtml({ reportingDate: '2026-09-29', runners: model.runners, printedAt: new Date('2026-09-29T15:00:00Z') });
assert.match(runnerHtml, /Night Runner List/);
assert.match(runnerHtml, />B</);

const managerEntry = fs.readFileSync(path.join(root, 'manager.js'), 'utf8');
assert.match(managerEntry, /manager-page\.js/);
assert.match(managerEntry, /manager-night-operations\.js/);

const allNewText = [
  fs.readFileSync(path.join(root, 'pages/manager-night-operations.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'domain/night-roster.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'css/manager-night-operations.css'), 'utf8'),
].join('\n').toLowerCase();
assert.doesNotMatch(allNewText, /deployable/);

console.log('night-operations tests: 10 assertions passed');
