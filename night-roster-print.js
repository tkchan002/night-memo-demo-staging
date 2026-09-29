import {
  displayPrintDate,
  escapePrintHtml as esc,
  renderManagerPrintDocument,
} from './manager-print-theme.js';

export function renderNightStaffPrintHtml({ reportingDate, wardRosters = [], printedAt = new Date() } = {}) {
  const content = wardRosters.map(row => {
    const nurses = row.nurses || [];
    const wardName = row.ward?.code || row.ward?.displayName || '';
    return `<section class="manager-print-ward-block">
      <div class="manager-print-ward-head"><span>${esc(wardName)}</span><span>${nurses.length} staff</span></div>
      ${nurses.length
        ? `<table class="manager-print-table compact"><thead><tr><th style="width:20%">Rank</th><th>Name</th><th style="width:29%">Appointment Date</th></tr></thead><tbody>${nurses.map(nurse => `<tr><td>${esc(nurse.role)}</td><td>${esc(nurse.name)}</td><td>${esc(nurse.appointmentDate)}</td></tr>`).join('')}</tbody></table>`
        : '<div class="manager-print-empty" style="border:0">No night staff saved for this shift.</div>'}
    </section>`;
  }).join('') || '<div class="manager-print-empty">No ward roster data available.</div>';

  return renderManagerPrintDocument({
    title: 'Night Staff List',
    subtitle: `Reporting Night: ${displayPrintDate(reportingDate)}`,
    body: content,
    footerLabel: 'Patrol Night · Night Staff List',
    printedAt,
  });
}

export function renderNightRunnerPrintHtml({ reportingDate, runners = [], printedAt = new Date() } = {}) {
  const content = runners.length
    ? `<table class="manager-print-table compact"><thead><tr><th style="width:16%">Ward</th><th style="width:20%">Rank</th><th>Name</th><th style="width:29%">Appointment Date</th></tr></thead><tbody>${runners.map(nurse => `<tr><td><strong>${esc(nurse.ward?.code || nurse.ward?.displayName || '')}</strong></td><td>${esc(nurse.role)}</td><td>${esc(nurse.name)}</td><td>${esc(nurse.appointmentDate)}</td></tr>`).join('')}</tbody></table>`
    : '<div class="manager-print-empty">No Night Runner recorded for this reporting night.</div>';

  return renderManagerPrintDocument({
    title: 'Night Runner List',
    subtitle: `Reporting Night: ${displayPrintDate(reportingDate)}`,
    body: content,
    footerLabel: 'Patrol Night · Night Runner List',
    printedAt,
  });
}
