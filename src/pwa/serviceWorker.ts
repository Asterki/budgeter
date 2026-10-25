/**
 * Service-worker registration.
 *
 * The worker itself lives at `public/sw.js` and owns the offline cache. It is
 * registered from the production bundle only, so it never fights Vite's HMR
 * during development.
 */

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}
