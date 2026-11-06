import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Note: no <StrictMode>. Some effects send BLE commands on mount/unmount
// (entering and leaving factory mode) and must run exactly once.
const container = document.getElementById('root');
if (container) createRoot(container).render(<App />);

/**
 * The service worker is optional: Bluefy's WKWebView may not run service
 * workers at all, and the app must work without one.
 */
function registerServiceWorker(): void {
  try {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      try {
        navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(__BUILD_ID__)}`, { scope: './' }).catch(() => {
          // Not supported here (e.g. inside some WebViews): ignore.
        });
      } catch {
        // Ignore.
      }
    });
  } catch {
    // Ignore.
  }
}

registerServiceWorker();
