function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function displayDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(iso || '');
}

function printedStamp(value = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(value);
}

function pageShell({ title, reportingDate, content, printedAt }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page{size:A4 portrait;margin:12mm 11mm 13mm}
    *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:10.5pt;line-height:1.25}
    h1{text-align:center;font-size:16pt;margin:0 0 2mm;text-decoration:underline}.meta{text-align:center;font-size:9.5pt;margin-bottom:5mm}
    .ward-block{border:2.2px solid #111;margin:0 0 4mm;break-inside:avoid}.ward-head{display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:11.5pt;padding:2.2mm 3mm;border-bottom:2.2px solid #111;background:#f1f1f1}
    table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #333;padding:1.8mm 2.2mm;text-align:left;vertical-align:top}th{font-weight:800;background:#f5f5f5}.rank{width:20%}.appt{width:29%}.ward-col{width:16%}
    .empty{padding:3mm;color:#555;font-style:italic}.footer{margin-top:5mm;border-top:1px solid #777;padding-top:2mm;font-size:8.5pt;color:#444;text-align:right}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body><h1>${esc(title)}</h1><div class="meta">Reporting Night: ${esc(displayDate(reportingDate))}</div>${content}<div class="footer">Printed: ${esc(printedStamp(printedAt))} HKT</div></body></html>`;
}

export function renderNightStaffPrintHtml({ reportingDate, wardRosters = [], printedAt = new Date() } = {}) {
  const content = wardRosters.map(row => {
    const nurses = row.nurses || [];
    return `<section class="ward-block"><div class="ward-head"><span>${esc(row.ward?.code || row.ward?.displayName || '')}</span><span>${nurses.length} staff</span></div>${nurses.length ? `<table><thead><tr><th class="rank">Rank</th><th>Name</th><th class="appt">Appointment Date</th></tr></thead><tbody>${nurses.map(nurse => `<tr><td>${esc(nurse.role)}</td><td>${esc(nurse.name)}</td><td>${esc(nurse.appointmentDate)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No night staff saved for this shift.</div>'}</section>`;
  }).join('') || '<div class="empty">No ward roster data available.</div>';
  return pageShell({ title: 'Night Staff List', reportingDate, content, printedAt });
}

export function renderNightRunnerPrintHtml({ reportingDate, runners = [], printedAt = new Date() } = {}) {
  const content = runners.length
    ? `<table><thead><tr><th class="ward-col">Ward</th><th class="rank">Rank</th><th>Name</th><th class="appt">Appointment Date</th></tr></thead><tbody>${runners.map(nurse => `<tr><td><b>${esc(nurse.ward?.code || nurse.ward?.displayName || '')}</b></td><td>${esc(nurse.role)}</td><td>${esc(nurse.name)}</td><td>${esc(nurse.appointmentDate)}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">No Night Runner recorded for this reporting night.</div>';
  return pageShell({ title: 'Night Runner List', reportingDate, content, printedAt });
}
