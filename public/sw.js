/*
 * Tasker service worker.
 *
 * Two jobs:
 *   1. Offline-first caching of the app shell, so Tasker opens and works with
 *      no network at all.
 *   2. Background push delivery — the `push` handler renders a notification
 *      even when the app is completely closed.
 *
 * It is intentionally dependency-free and versioned by CACHE_VERSION.
 */

const BUILD_ID = '__BUILD_ID__';
const CACHE_VERSION = `tasker-${BUILD_ID}`;
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

/** Core files that make the app bootable offline. */
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

/**
 * Reads the built `index.html` and caches every asset it references. Vite
 * hashes asset filenames, so this is the only reliable way to precache the
 * JavaScript and CSS of the current build on a first visit.
 */
async function precacheBuildAssets() {
  try {
    const response = await fetch('/index.html', { cache: 'no-store' });
    if (!response.ok) return;

    const html = await response.clone().text();
    const shell = await caches.open(SHELL_CACHE);
    await shell.put('/index.html', response.clone());

    const urls = new Set();
    const pattern = /(?:src|href)="(\/[^"?#]+)"/g;
    let match = pattern.exec(html);
    while (match) {
      urls.add(match[1]);
      match = pattern.exec(html);
    }

    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.all([...urls].map((url) => runtime.add(url).catch(() => undefined)));
  } catch {
    // Offline or a cold build — the runtime cache will fill in on the next visit.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key)),
      );
      await precacheBuildAssets();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the reminder API — it must always hit the network.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() => new Response('{}', { headers: { 'content-type': 'application/json' } })));
    return;
  }

  // Navigations: network-first so updates land, falling back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          return response;
        })
        .catch(async () => (await caches.match('/index.html', { ignoreVary: true })) ?? (await caches.match('/', { ignoreVary: true })) ?? Response.error()),
    );
    return;
  }

  // Everything else: cache-first with a background refresh.
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});

/* ── Web Push ─────────────────────────────────────────────────────────────── */

self.addEventListener('push', (event) => {
  let payload = { title: 'Tasker', body: 'You have a task coming up.', tag: undefined, url: '/' };

  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url || '/' },
      requireInteraction: false,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // Re-subscribe transparently if the browser rotates the subscription.
  event.waitUntil(
    self.registration.pushManager
      .getSubscription()
      .then((subscription) => {
        if (!subscription) return null;
        return fetch('/api/check-reminders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        });
      })
      .catch(() => null),
  );
});
