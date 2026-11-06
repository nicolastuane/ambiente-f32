/*
 * Ambiente F32 service worker (optional: the app works without it).
 * - Registered as sw.js?v=<build id>: each deploy installs a new worker.
 * - Pre-caches the app shell (index, manifest, icons and the hashed bundle
 *   files listed in precache.json, generated at build time).
 * - Navigations: network first (3 s limit), cached index.html when offline
 *   or slow; only successful same-origin pages are cached.
 * - Other same-origin GET requests: cache first, then network.
 * - Old caches of this app are deleted on activation.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const PREFIX = 'ambiente-f32-';
const CACHE = PREFIX + VERSION;
const NAVIGATION_TIMEOUT_MS = 3000;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      let files = [];
      try {
        const response = await fetch('./precache.json', { cache: 'no-store' });
        if (response.ok) files = ((await response.json()).files || []).map((f) => './' + f);
      } catch (error) {
        // No manifest (dev build): only the shell is cached.
      }
      await cache.addAll(SHELL);
      await Promise.all(files.map((f) => cache.add(f).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Network first, but only a good same-origin page replaces the cached
    // shell (never a 404, an error page or a captive portal), and a slow
    // network (underground car park) falls back to the cache after 3 s.
    const network = fetch(request).then(async (response) => {
      if (response.ok && !response.redirected && response.type === 'basic') {
        const cache = await caches.open(CACHE);
        await cache.put('./index.html', response.clone()).catch(() => undefined);
      }
      return response;
    });
    event.waitUntil(network.then(() => undefined, () => undefined));
    event.respondWith(
      (async () => {
        const cachedShell = async () => (await caches.match('./index.html')) || (await caches.match('./'));
        const timedOut = new Promise((resolve) => setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS));
        try {
          const first = await Promise.race([network, timedOut]);
          if (first) return first;
          const cached = await cachedShell();
          return cached || (await network); // nothing cached yet: keep waiting
        } catch (error) {
          const cached = await cachedShell();
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone()).catch(() => undefined);
      }
      return response;
    })(),
  );
});
