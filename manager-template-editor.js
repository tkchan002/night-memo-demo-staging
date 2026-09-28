import { qs, qsa, esc } from './core/dom.js';
import { flash } from './core/ui.js';
import { todayISO } from './core/dates.js';
import { sanitizeTemplateCss } from './core/template-security.js';
import {
  getManagerPrintTemplates,
  saveManagerPrintTemplate,
  publishManagerPrintTemplate,
} from './manager-template-store.js';

const DEFAULT_TEMPLATE_HTML = `<div class="memo-template">
  <h1 style="text-align:center;text-decoration:underline;margin:0 0 4px">Night Memo</h1>
  <div style="text-align:center;margin-bottom:10px">{{report_date_display}}</div>
  {{ward_summary_table}}
  <h2 style="margin:16px 0 6px">Clinical Attention</h2>
  {{clinical_attention_table}}
  <h2 style="margin:16px 0 6px">Report Items — Configured Order</h2>
  {{report_items_table}}
  <h2 style="margin:16px 0 6px">Infection / Device Details</h2>
  {{infection_table}}
</div>`;

const TOKEN_LABELS = {
  report_date_display: 'Report Date',
  report_date: 'Report Date (ISO)',
  ward_summary_table: 'Ward Summary Table',
  clinical_attention_table: 'Clinical Attention Table',
  report_items_table: 'Configured Report Items Table',
  infection_table: 'Infection / Device Table',
  page_break: 'Page Break',
};

let api = null;
let bound = false;
let state = { templates: [], editingTemplate: null, templateMode: 'visual' };

export async function initManagerTemplateEditor(options) {
  api = options;
  if (!bound) bindEditor();
  try {
    await refreshTemplateList();
    setUnavailableMessage('');
    return true;
  } catch (error) {
    console.error('Manager template editor unavailable:', error);
    setUnavailableMessage(
      'The print-template editor could not connect to its Supabase table. The Night Memo and Full Ward Report tabs are still usable.'
    );
    disableTemplateActions(true);
    return false;
  }
}

function bindEditor() {
  bound = true;
  qs('#templateSelect').onchange = () => selectTemplate(qs('#templateSelect').value);
  qs('#newTemplateBtn').onclick = newTemplateDraft;
  qs('#saveTemplateBtn').onclick = saveTemplateDraft;
  qs('#publishTemplateBtn').onclick = publishTemplate;
  qs('#previewTemplateBtn').onclick = previewCurrentTemplate;

  qsa('[data-template-mode]').forEach(button => {
    button.onclick = () => setTemplateMode(button.dataset.templateMode);
  });
  qsa('#templateToolbar [data-cmd]').forEach(button => {
    button.onclick = () => runEditorCommand(button.dataset.cmd);
  });

  qs('#templateBlockFormat').onchange = event => {
    const editor = qs('#templateVisualEditor');
    editor.focus();
    document.execCommand('formatBlock', false, event.target.value);
  };
  qs('#insertTemplateToken').onchange = event => {
    if (event.target.value) insertToken(event.target.value);
    event.target.value = '';
  };
}

function setUnavailableMessage(message) {
  let el = document.getElementById('templateFrameStatus') || document.getElementById('templateEditorStatusMessage');
  if (!el) {
    el = document.createElement('div');
    el.id = 'templateEditorStatusMessage';
    el.className = 'manager-status error template-editor-status';
    const host = document.querySelector('.template-frame-main') || document.body;
    host.insertBefore(el, host.firstChild || null);
  }
  el.textContent = message || '';
  el.classList.toggle('error', Boolean(message));
  el.hidden = !message;
}

function disableTemplateActions(disabled) {
  ['#saveTemplateBtn', '#publishTemplateBtn', '#previewTemplateBtn', '#newTemplateBtn']
    .forEach(selector => {
      const el = qs(selector);
      if (el) el.disabled = disabled;
    });
}

async function refreshTemplateList(selectId = null) {
  state.templates = await getManagerPrintTemplates();
  const select = qs('#templateSelect');
  select.innerHTML = state.templates
    .map(t => `<option value="${esc(t.id)}">v${esc(t.version)} - ${esc(t.name || 'Night Memo')} - ${esc(t.status)}</option>`)
    .join('');

  const chosen = selectId
    || state.editingTemplate?.id
    || state.templates.find(t => t.status === 'draft')?.id
    || state.templates.find(t => t.status === 'published')?.id
    || '';

  if (chosen && state.templates.some(t => t.id === chosen)) {
    select.value = chosen;
    selectTemplate(chosen);
  } else {
    newTemplateDraft(false);
  }
}

function selectTemplate(id) {
  const template = state.templates.find(item => item.id === id);
  if (!template) return;
  state.editingTemplate = { ...template };
  qs('#templateName').value = template.name || 'Night Memo';
  qs('#templateEffectiveFrom').value = template.effective_from || todayISO();
  qs('#templateStatus').textContent = (template.status || 'draft').toUpperCase();
  qs('#templateHtmlEditor').value = template.html_template || DEFAULT_TEMPLATE_HTML;
  qs('#templateCssEditor').value = template.css_template || '';
  setVisualEditorFromTemplate(template.html_template || DEFAULT_TEMPLATE_HTML);
}

function newTemplateDraft(showPage = true) {
  const source = state.templates.find(t => t.status === 'published') || state.templates[0];
  state.editingTemplate = {
    id: null,
    name: `${source?.name || 'Night Memo'} Draft`,
    status: 'draft',
    effective_from: todayISO(),
    html_template: source?.html_template || DEFAULT_TEMPLATE_HTML,
    css_template: source?.css_template || '',
  };
  qs('#templateSelect').value = '';
  qs('#templateName').value = state.editingTemplate.name;
  qs('#templateEffectiveFrom').value = state.editingTemplate.effective_from;
  qs('#templateStatus').textContent = 'NEW DRAFT';
  qs('#templateHtmlEditor').value = state.editingTemplate.html_template;
  qs('#templateCssEditor').value = state.editingTemplate.css_template;
  setVisualEditorFromTemplate(state.editingTemplate.html_template);
  if (showPage && api?.showPage) api.showPage('template');
}

function setTemplateMode(mode) {
  if (mode === state.templateMode) return;
  if (mode === 'html') {
    qs('#templateHtmlEditor').value = visualEditorToTemplate();
  } else {
    setVisualEditorFromTemplate(qs('#templateHtmlEditor').value || DEFAULT_TEMPLATE_HTML);
  }
  state.templateMode = mode;
  qsa('[data-template-mode]').forEach(button => button.classList.toggle('active', button.dataset.templateMode === mode));
  qs('#visualEditorPane').classList.toggle('active', mode === 'visual');
  qs('#htmlEditorPane').classList.toggle('active', mode === 'html');
}

function templateToEditorHtml(html) {
  return String(html || '').replace(/\{\{([a-z0-9_]+)\}\}/gi, (_match, token) => (
    `<span class="template-token" data-token="${esc(token)}" contenteditable="false">${esc(TOKEN_LABELS[token] || token)}</span>`
  ));
}

function setVisualEditorFromTemplate(html) {
  qs('#templateVisualEditor').innerHTML = templateToEditorHtml(sanitizeTemplateHtml(html || DEFAULT_TEMPLATE_HTML));
}

function visualEditorToTemplate() {
  const clone = qs('#templateVisualEditor').cloneNode(true);
  clone.querySelectorAll('.template-token').forEach(node => {
    node.replaceWith(document.createTextNode(`{{${node.dataset.token}}}`));
  });
  return sanitizeTemplateHtml(clone.innerHTML);
}

function runEditorCommand(command) {
  const editor = qs('#templateVisualEditor');
  editor.focus();
  document.execCommand(command, false, null);
}

function insertToken(token) {
  const editor = qs('#templateVisualEditor');
  editor.focus();
  const element = document.createElement('span');
  element.className = token === 'page_break' ? 'template-token template-token-block' : 'template-token';
  element.dataset.token = token;
  element.contentEditable = 'false';
  element.textContent = TOKEN_LABELS[token] || token;
  insertNodeAtSelection(element);
}

function insertNodeAtSelection(node) {
  const selection = window.getSelection();
  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0);
    const editor = qs('#templateVisualEditor');
    if (editor.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
  }
  qs('#templateVisualEditor').appendChild(node);
}

export function sanitizeTemplateHtml(raw) {
  const doc = new DOMParser().parseFromString(`<div id="root">${raw || ''}</div>`, 'text/html');
  const root = doc.querySelector('#root');
  const allowedTags = new Set([
    'DIV', 'P', 'SPAN', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'HR',
    'STRONG', 'B', 'EM', 'I', 'U', 'SMALL',
    'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
    'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'COLGROUP', 'COL',
  ]);
  const dropWithContent = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM']);
  const globalAttrs = new Set(['class', 'id', 'style', 'title']);
  const tableAttrs = new Set(['colspan', 'rowspan', 'scope']);

  [...root.querySelectorAll('*')].forEach(element => {
    if (!allowedTags.has(element.tagName)) {
      if (dropWithContent.has(element.tagName)) element.remove();
      else element.replaceWith(...element.childNodes);
      return;
    }

    [...element.attributes].forEach(attribute => {
      const name = attribute.name.toLowerCase();
      const allowed = globalAttrs.has(name)
        || ((element.tagName === 'TD' || element.tagName === 'TH') && tableAttrs.has(name));
      if (!allowed || name.startsWith('on') || name === 'srcdoc' || name === 'contenteditable' || name === 'data-token') {
        element.removeAttribute(attribute.name);
      }
    });

    if (element.hasAttribute('style')) {
      const cleanStyle = sanitizeTemplateCss(element.getAttribute('style'));
      if (cleanStyle.trim()) element.setAttribute('style', cleanStyle);
      else element.removeAttribute('style');
    }
  });
  return root.innerHTML;
}

export { sanitizeTemplateCss };

function currentTemplatePayload() {
  const html = state.templateMode === 'visual'
    ? visualEditorToTemplate()
    : sanitizeTemplateHtml(qs('#templateHtmlEditor').value);
  return {
    ...(state.editingTemplate || {}),
    name: qs('#templateName').value.trim() || 'Night Memo',
    status: 'draft',
    effective_from: qs('#templateEffectiveFrom').value || todayISO(),
    html_template: html,
    css_template: sanitizeTemplateCss(qs('#templateCssEditor').value || ''),
  };
}

async function saveTemplateDraft() {
  try {
    const saved = await saveManagerPrintTemplate(currentTemplatePayload());
    state.editingTemplate = { ...saved };
    await refreshTemplateList(saved.id);
    flash('Print template draft saved.', 'success');
  } catch (error) {
    console.error(error);
    flash(error.message || String(error), 'error', 8000);
  }
}

async function publishTemplate() {
  try {
    const saved = await saveManagerPrintTemplate(currentTemplatePayload());
    const effective = qs('#templateEffectiveFrom').value || todayISO();
    await publishManagerPrintTemplate(saved.id, effective);
    state.editingTemplate = { ...saved, status: 'published', effective_from: effective };
    await refreshTemplateList(saved.id);
    flash(`Template published from ${effective}.`, 'success');
  } catch (error) {
    console.error(error);
    flash(error.message || String(error), 'error', 8000);
  }
}

function renderTemplateHtml(templateHtml) {
  const context = api?.getContext?.() || {};
  let output = sanitizeTemplateHtml(templateHtml || DEFAULT_TEMPLATE_HTML);
  const replacements = {
    report_date_display: context.reportDateDisplay || '',
    report_date: context.reportDate || '',
    section: context.section || '',
    ward_summary_table: context.wardSummaryTableHtml || '',
    clinical_attention_table: context.clinicalAttentionTableHtml || '',
    report_items_table: context.reportItemsTableHtml || '',
    infection_table: context.infectionTableHtml || '',
    page_break: '<div class="manager-page-break"></div>',
  };
  for (const [key, value] of Object.entries(replacements)) {
    output = output.split(`{{${key}}}`).join(value);
  }
  // Existing published templates may still contain the old memo-section token
  // in the heading. When the section is intentionally empty, remove the empty
  // parentheses rather than printing "Night Memo ()".
  output = output.replace(/Night Memo\s*\(\s*\)/gi, 'Night Memo');
  return output.replace(/\{\{[a-z0-9_]+\}\}/gi, '');
}

function openTemplateWindow(template, autoPrint = false, title = 'Night Memo Preview') {
  const win = window.open('', '_blank', 'width=1250,height=900');
  if (!win) {
    flash('Pop-up blocked. Allow pop-ups to preview or print.', 'error');
    return;
  }

  const shellCss = new URL('./css/legacy-shell.css', location.href).href;
  const managerCss = new URL('./css/manager.css', location.href).href;
  const printCss = new URL('./css/print.css', location.href).href;
  const extraCss = sanitizeTemplateCss(template.css_template || '');
  const bodyHtml = renderTemplateHtml(template.html_template);

  // Never interpolate editable CSS into a style tag. Create the style node and
  // assign textContent after parsing so closing-style markup cannot escape it.
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="stylesheet" href="${shellCss}"><link rel="stylesheet" href="${managerCss}"><link rel="stylesheet" href="${printCss}"><style id="template-extra-css"></style></head><body class="legacy-page manager-template-output"><main class="manager-template-page">${bodyHtml}</main></body></html>`);
  win.document.close();
  const styleNode = win.document.getElementById('template-extra-css');
  if (styleNode) styleNode.textContent = extraCss;
  if (autoPrint) win.setTimeout(() => win.print(), 600);
}

function previewCurrentTemplate() {
  openTemplateWindow(currentTemplatePayload(), false, 'Night Memo Template Preview');
}

export function getDefaultTemplate() {
  return { name: 'Night Memo', html_template: DEFAULT_TEMPLATE_HTML, css_template: '' };
}

export function previewTemplateObject(template) {
  openTemplateWindow(template || getDefaultTemplate(), false, template?.name || 'Night Memo Preview');
}

export function printTemplateObject(template) {
  openTemplateWindow(template || getDefaultTemplate(), true, template?.name || 'Night Memo');
}
