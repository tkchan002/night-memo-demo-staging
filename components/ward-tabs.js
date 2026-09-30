function numericIndex(value, count) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < count ? index : -1;
}

export function initWardTabs({
  mainStrip = document.getElementById('tabStrip'),
  formWrap = document.getElementById('formWrap'),
  historyStrip = document.querySelector('.hd-tab-strip'),
} = {}) {
  if (!mainStrip || !formWrap) {
    return {
      setMainLocked() {},
      selectMain() { return false; },
      selectHistory() { return false; },
      focusActiveMain() {},
      isMainLocked() { return false; },
    };
  }

  const mainButtons = Array.from(mainStrip.querySelectorAll('.tab[data-main-tab]'));
  const mainPanels = Array.from(formWrap.querySelectorAll('.tp'));
  const historyButtons = historyStrip
    ? Array.from(historyStrip.querySelectorAll('.hd-tab[data-history-tab]'))
    : [];
  const historyPanels = Array.from(document.querySelectorAll('.hd-section'));
  let mainLocked = false;

  function setMainLocked(locked) {
    mainLocked = Boolean(locked);
    mainStrip.classList.toggle('disabled-strip', mainLocked);
    mainStrip.dataset.locked = mainLocked ? 'true' : 'false';

    mainButtons.forEach(button => {
      button.disabled = mainLocked;
      button.setAttribute('aria-disabled', String(mainLocked));
    });
  }

  function selectMain(value) {
    if (mainLocked) return false;
    const index = numericIndex(value, Math.min(mainButtons.length, mainPanels.length));
    if (index < 0) return false;

    mainButtons.forEach((button, i) => button.classList.toggle('active', i === index));
    mainPanels.forEach((panel, i) => panel.classList.toggle('active', i === index));
    document.dispatchEvent(new CustomEvent('ward-main-tab-selected', { detail: { index } }));
    return true;
  }

  function focusActiveMain() {
    mainButtons.find(button => button.classList.contains('active') && !button.disabled)?.focus();
  }

  function selectHistory(value) {
    const index = numericIndex(value, Math.min(historyButtons.length, historyPanels.length));
    if (index < 0) return false;

    historyButtons.forEach((button, i) => button.classList.toggle('active', i === index));
    historyPanels.forEach((panel, i) => panel.classList.toggle('active', i === index));
    return true;
  }

  mainStrip.addEventListener('click', event => {
    const button = event.target.closest('.tab[data-main-tab]');
    if (!button || !mainStrip.contains(button)) return;
    selectMain(button.dataset.mainTab);
  });

  historyStrip?.addEventListener('click', event => {
    const button = event.target.closest('.hd-tab[data-history-tab]');
    if (!button || !historyStrip.contains(button)) return;
    selectHistory(button.dataset.historyTab);
  });

  setMainLocked(false);

  return {
    setMainLocked,
    selectMain,
    selectHistory,
    focusActiveMain,
    isMainLocked: () => mainLocked,
  };
}
