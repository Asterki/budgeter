import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { BudgetProvider } from './state/store';
import { registerServiceWorker } from './pwa/serviceWorker';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root was not found.');

createRoot(container).render(
  <StrictMode>
    <BudgetProvider>
      <App />
    </BudgetProvider>
  </StrictMode>,
);

// The service worker powers offline use. It is only registered in production
// builds so it never fights Vite's HMR.
if (import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void registerServiceWorker();
  });
}
