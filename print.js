import { deletePrintJob, purgeExpiredPrintJobs, readPrintJob } from './services/print-job-service.js';

const params = new URLSearchParams(location.search);
const jobId = params.get('job');
purgeExpiredPrintJobs();
const job = readPrintJob(jobId);

if (!job) {
  renderMissingJob();
} else {
  renderJob(job);
}

function renderJob(printJob) {
  const parsed = new DOMParser().parseFromString(printJob.html, 'text/html');
  document.title = printJob.title || parsed.title || 'Printable Document';

  for (const node of Array.from(parsed.head.children)) {
    const tag = node.tagName?.toLowerCase();
    if (tag === 'style' || tag === 'link') document.head.append(node.cloneNode(true));
  }

  const originalBodyClass = parsed.body.getAttribute('class') || '';
  document.body.className = `${originalBodyClass} print-view-body`.trim();
  document.body.innerHTML = `
    <header class="print-view-toolbar" aria-label="Print controls">
      <button type="button" class="print-view-button secondary" id="printBackBtn">Back</button>
      <div class="print-view-title-wrap">
        <strong>${escapeHtml(printJob.title || 'Printable Document')}</strong>
        <span>Review the document, then use Print / PDF.</span>
      </div>
      <button type="button" class="print-view-button primary" id="printActionBtn">Print / PDF</button>
    </header>
    <main class="print-view-viewport" id="printViewport">
      <div class="print-view-stage" id="printStage">
        <div class="print-document-host" id="printDocumentHost"></div>
      </div>
    </main>
  `;

  document.getElementById('printDocumentHost').append(...Array.from(parsed.body.childNodes).map(node => node.cloneNode(true)));
  installShellOverrides();

  document.getElementById('printActionBtn').addEventListener('click', () => {
    window.print();
  });
  document.getElementById('printBackBtn').addEventListener('click', () => {
    deletePrintJob(printJob.id);
    location.assign(printJob.returnUrl || './');
  });

  fitPreview();
  window.addEventListener('resize', fitPreview, { passive: true });
  window.addEventListener('orientationchange', fitPreview, { passive: true });
  window.addEventListener('beforeprint', resetPreviewScale);
  window.addEventListener('afterprint', fitPreview);
}

function fitPreview() {
  const viewport = document.getElementById('printViewport');
  const stage = document.getElementById('printStage');
  const host = document.getElementById('printDocumentHost');
  if (!viewport || !stage || !host) return;

  host.style.transform = 'none';
  stage.style.height = 'auto';
  const available = Math.max(240, viewport.clientWidth - 20);
  const naturalWidth = Math.max(host.scrollWidth, host.getBoundingClientRect().width);
  const scale = naturalWidth > available ? Math.max(0.35, available / naturalWidth) : 1;
  host.style.transformOrigin = 'top center';
  host.style.transform = scale < 0.999 ? `scale(${scale})` : 'none';
  stage.style.height = `${Math.ceil(host.scrollHeight * scale)}px`;
  stage.dataset.scale = String(scale);
}

function resetPreviewScale() {
  const stage = document.getElementById('printStage');
  const host = document.getElementById('printDocumentHost');
  if (!stage || !host) return;
  host.style.transform = 'none';
  stage.style.height = 'auto';
}

function renderMissingJob() {
  document.title = 'Printable document unavailable';
  document.body.className = 'print-view-body';
  document.body.innerHTML = `
    <main class="print-view-message error" role="alert">
      <strong>Printable document unavailable</strong>
      <span>The temporary print job is missing or has expired. Return to Night Memo and open Print again.</span>
      <button type="button" class="print-view-button primary" id="printFallbackBack">Back</button>
    </main>
  `;
  document.getElementById('printFallbackBack').addEventListener('click', () => {
    if (document.referrer && new URL(document.referrer).origin === location.origin) history.back();
    else location.assign('./');
  });
}

function installShellOverrides() {
  const style = document.createElement('style');
  style.dataset.printViewShell = '1';
  style.textContent = `
    .print-view-toolbar{all:initial;box-sizing:border-box!important;position:fixed!important;top:0!important;left:0!important;right:0!important;z-index:2147483647!important;min-height:56px!important;padding:8px max(10px,env(safe-area-inset-right)) 8px max(10px,env(safe-area-inset-left))!important;display:flex!important;align-items:center!important;gap:10px!important;background:#f3f3ef!important;border-bottom:1px solid #9b9b94!important;font-family:Arial,sans-serif!important;color:#222!important;box-shadow:0 2px 8px rgba(0,0,0,.18)!important}
    .print-view-toolbar *{box-sizing:border-box!important;font-family:Arial,sans-serif!important}
    .print-view-title-wrap{display:flex!important;flex:1!important;min-width:0!important;flex-direction:column!important;gap:2px!important;line-height:1.2!important}
    .print-view-title-wrap strong{font-size:14px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
    .print-view-title-wrap span{font-size:11px!important;color:#60605c!important}
    .print-view-button{appearance:none!important;border:1px solid #777!important;border-radius:3px!important;min-height:40px!important;padding:7px 14px!important;font-size:14px!important;font-weight:700!important;line-height:1!important;cursor:pointer!important;white-space:nowrap!important}
    .print-view-button.primary{background:#245ea8!important;color:white!important;border-color:#16457e!important}
    .print-view-button.secondary{background:#fff!important;color:#222!important}
    .print-view-body{padding-top:58px!important}
    .print-view-viewport{overflow-x:hidden!important;min-height:calc(100dvh - 58px)!important;padding:10px 0 max(10px,env(safe-area-inset-bottom))!important}
    .print-view-stage{position:relative!important;width:100%!important;display:flex!important;justify-content:center!important;align-items:flex-start!important}
    .print-document-host{display:inline-block!important;max-width:none!important}
    @media(max-width:520px){.print-view-title-wrap span{display:none!important}.print-view-button{min-height:44px!important;padding:8px 11px!important;font-size:13px!important}}
    @media print{.print-view-toolbar{display:none!important}.print-view-body{padding-top:0!important}.print-view-viewport{padding:0!important;overflow:visible!important}.print-view-stage{height:auto!important;display:block!important}.print-document-host{transform:none!important;display:block!important}}
  `;
  document.head.append(style);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}
