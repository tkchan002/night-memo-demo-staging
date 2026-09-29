export const MANAGER_PRINT_CSS = `
@page{size:A4 portrait;margin:10mm 10mm 11mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:#111;background:#d8d8d8;font-size:10pt;line-height:1.28}
.manager-print-page{width:210mm;min-height:297mm;margin:10px auto;background:#fff;padding:10mm 10mm 9mm;box-shadow:0 2px 10px rgba(0,0,0,.22)}
.manager-print-title{text-align:center;font-size:17pt;font-weight:700;line-height:1.15;margin:0 0 2mm}
.manager-print-subtitle{text-align:center;font-size:9pt;margin:0 0 5mm;color:#333}
.manager-print-meta{display:grid;grid-template-columns:1fr 1fr;gap:1.5mm 9mm;margin:0 0 4mm}
.manager-print-meta-row{display:grid;grid-template-columns:27mm 1fr;gap:1.5mm;align-items:baseline}
.manager-print-label{font-weight:700}
.manager-print-section{margin:4mm 0;break-inside:auto}
.manager-print-section-title{font-size:10.5pt;font-weight:700;margin:0 0 1.5mm;padding-bottom:1mm;border-bottom:1.4px solid #222}
.manager-print-table{width:100%;border-collapse:collapse;table-layout:fixed}
.manager-print-table th,.manager-print-table td{border:1px solid #333;padding:1.55mm 1.8mm;text-align:left;vertical-align:top;overflow-wrap:anywhere}
.manager-print-table th{font-weight:700;background:#ececec}
.manager-print-table.center th,.manager-print-table.center td{text-align:center;vertical-align:middle}
.manager-print-table.compact th,.manager-print-table.compact td{padding:1.15mm 1.35mm}
.manager-print-table.dense{font-size:8.1pt}.manager-print-table.dense th,.manager-print-table.dense td{padding:.85mm 1mm}
.manager-print-ward-block{border:2px solid #222;margin:0 0 3.5mm;break-inside:avoid}
.manager-print-ward-head{display:flex;align-items:center;justify-content:space-between;gap:5mm;padding:1.8mm 2.4mm;border-bottom:2px solid #222;background:#e6e6e6;font-size:10.5pt;font-weight:700}
.manager-print-empty{padding:3mm;border:1px solid #aaa;background:#fafafa;color:#555;font-style:italic}
.manager-print-rich{min-height:5mm;overflow-wrap:anywhere}
.manager-print-rich ul,.manager-print-rich ol{margin:1mm 0;padding-left:6mm}
.manager-print-two-col{display:grid;grid-template-columns:1fr .85fr;gap:12mm;align-items:end;margin-top:5mm}
.manager-print-signature{justify-self:end;min-width:62mm}
.manager-print-signature-line{display:inline-block;width:40mm;height:4mm;border-bottom:1px solid #111;vertical-align:bottom}
.manager-memo-print{font-size:9.2pt}
.manager-memo-print .manager-print-meta{gap:1mm 8mm;margin-bottom:2.5mm}
.manager-memo-print .manager-print-section{margin:2.1mm 0}
.manager-memo-print .manager-print-section-title{font-size:9.6pt;margin-bottom:.7mm;padding-bottom:.5mm}
.manager-memo-print .manager-print-rich{min-height:2.5mm;font-size:9pt;line-height:1.18}
.manager-memo-print .manager-print-rich ul,.manager-memo-print .manager-print-rich ol{margin:.4mm 0}
.manager-memo-print .manager-print-two-col{margin-top:2.5mm}
.manager-print-footer{margin-top:6mm;padding-top:2mm;border-top:1px solid #777;font-size:8pt;color:#444;display:flex;justify-content:space-between;gap:8mm}
.manager-print-footer span:last-child{text-align:right}
@media print{
  body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .manager-print-page{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}
}
`;

export function escapePrintHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[ch]));
}

export function displayPrintDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(iso || '');
}

export function printedStamp(value = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone:'Asia/Hong_Kong', day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
  }).format(value);
}

export function renderManagerPrintFooter({ label, printedAt = new Date() } = {}) {
  const safeLabel = escapePrintHtml(label || 'Patrol Night');
  return `<footer class="manager-print-footer"><span>${safeLabel}</span><span>Printed ${escapePrintHtml(printedStamp(printedAt))} HKT</span></footer>`;
}

export function renderManagerPrintDocument({ title, subtitle = '', body = '', footerLabel = title, printedAt = new Date() } = {}) {
  const safeTitle = escapePrintHtml(title || 'Patrol Night');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>${MANAGER_PRINT_CSS}</style></head><body data-print-system="manager-v2"><article class="manager-print-page"><h1 class="manager-print-title">${safeTitle}</h1>${subtitle ? `<div class="manager-print-subtitle">${escapePrintHtml(subtitle)}</div>` : ''}${body}${renderManagerPrintFooter({ label: footerLabel, printedAt })}</article></body></html>`;
}
