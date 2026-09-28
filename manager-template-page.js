import { isTrustedWindowMessage } from './core/template-security.js';
let context = {
  reportDate: '',
  reportDateDisplay: '',
  section: '',
  snapshotTime: '',
  wardSummaryTableHtml: '',
  clinicalAttentionTableHtml: '',
  reportItemsTableHtml: '',
  infectionTableHtml: '',
};

const parentOrigin = location.origin;
const status = document.getElementById('templateFrameStatus');

function setStatus(message, type = 'info') {
  if (!status) return;
  status.textContent = message;
  status.className = `manager-status ${type}`;
  status.hidden = !message;
}

function isTrustedParentMessage(event) {
  return isTrustedWindowMessage(event, parent, parentOrigin);
}

window.addEventListener('message', event => {
  if (!isTrustedParentMessage(event)) return;

  if (event.data?.type === 'manager-template-context') {
    context = event.data.context || context;
  }
  if (event.data?.type === 'manager-template-print') {
    context = event.data.context || context;
    printPublishedTemplate();
  }
});

start();

async function start() {
  try {
    const editor = await import('./manager-template-editor.js');
    window.__managerTemplateEditor = editor;
    await editor.initManagerTemplateEditor({
      showPage: () => {},
      getContext: () => context,
    });
    setStatus('', 'info');
  } catch (error) {
    console.error('Template editor frame failed:', error);
    setStatus(`Print editor unavailable: ${error.message || String(error)}. The manager Night Memo remains unaffected.`, 'error');
  } finally {
    parent.postMessage({ type: 'manager-template-ready' }, parentOrigin);
  }
}

async function printPublishedTemplate() {
  try {
    const [{ getActiveManagerPrintTemplate }, editor] = await Promise.all([
      import('./manager-template-store.js'),
      import('./manager-template-editor.js'),
    ]);
    const template = await getActiveManagerPrintTemplate(context.reportDate);
    editor.printTemplateObject(template || editor.getDefaultTemplate());
  } catch (error) {
    console.warn('Published template print failed:', error);
    parent.postMessage({ type: 'manager-template-print-fallback' }, parentOrigin);
  }
}
