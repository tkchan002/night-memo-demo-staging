import './pages/manager-page.js';

import('./pages/manager-night-operations.js').catch((error) => {
  console.error('Night Operations unavailable:', error);
});
