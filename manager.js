// Core Manager workspace is critical and must always load independently.
import './pages/manager-page.js';

// Night Operations is an enhancement. A failure in this feature must never
// prevent the Manager workspace, Ward Submission Status, or Night Memo editor
// from starting.
import('./pages/manager-night-operations.js').catch((error) => {
  console.error('Night Operations failed to load:', error);

  const host = document.querySelector('.submission-panel')?.parentElement
    || document.querySelector('.manager-main');
  if (!host || document.getElementById('nightOperationsLoadError')) return;

  const panel = document.createElement('section');
  panel.id = 'nightOperationsLoadError';
  panel.className = 'manager-status no-print';
  panel.style.display = 'block';
  panel.style.marginBottom = '12px';
  panel.textContent = 'Night Operations could not be loaded. The Manager workspace remains available. Please refresh the page or contact support.';

  const submission = document.querySelector('.submission-panel');
  if (submission) submission.insertAdjacentElement('beforebegin', panel);
  else host.prepend(panel);
});
