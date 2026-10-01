/**
 * Source-defined Manager primary tabs.
 * This component owns only tab selection/keyboard semantics. Page-specific
 * loading and consequences stay in the Manager page modules.
 */
export function initManagerTabs({ root = document, initialTab = 'submission', onChange } = {}) {
  const buttons = [...root.querySelectorAll('[data-manager-tab]')];
  const panels = [...root.querySelectorAll('[data-manager-tab-panel]')];
  let activeTab = initialTab;

  function select(tab, { focus = false, emit = true } = {}) {
    if (!buttons.some(button => button.dataset.managerTab === tab)) return false;
    activeTab = tab;
    buttons.forEach(button => {
      const active = button.dataset.managerTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });
    panels.forEach(panel => {
      const active = panel.dataset.managerTabPanel === tab;
      panel.hidden = !active;
    });
    if (emit) {
      onChange?.(tab);
      document.dispatchEvent(new CustomEvent('manager-primary-tab-change', { detail: { tab } }));
    }
    return true;
  }

  buttons.forEach((button, index) => {
    button.setAttribute('role', 'tab');
    button.addEventListener('click', () => {
      if (!button.disabled) select(button.dataset.managerTab);
    });
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const enabled = buttons.filter(item => !item.disabled);
      if (!enabled.length) return;
      let next = enabled.indexOf(button);
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = enabled.length - 1;
      else next = (next + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
      select(enabled[next].dataset.managerTab, { focus: true });
    });
    button.id ||= `managerPrimaryTab${index + 1}`;
  });

  panels.forEach(panel => {
    const button = buttons.find(item => item.dataset.managerTab === panel.dataset.managerTabPanel);
    if (button) {
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', button.id);
    }
  });

  function setEnabled(enabled) {
    buttons.forEach(button => { button.disabled = !enabled; });
  }

  select(initialTab, { emit: false });
  return { select, setEnabled, get activeTab() { return activeTab; } };
}
