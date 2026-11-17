/* Kirana service worker (P4, G4.4): offline app shell.
 *
 * Strategy:
 * - navigations: network-first, fall back to the cached shell so the app
 *   opens offline (§15.3 G4.4 "offline shell loads").
 * - same-origin assets: stale-while-revalidate — instant from cache, one
 *   background refresh keeps it current.
 * - /api/* is never intercepted: reads are TanStack's business, writes and
 *   SSE must always reach the server.
 *
 * No telemetry, no third-party requests (AGENTS §8.3): the worker only
 * ever touches this origin.
 */
const CACHE = 'kirana-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.add('/');
      // The hashed asset URLs are only knowable from the shell itself —
      // parse them out and precache, so the very first visit opens offline
      // (assets load before the worker controls the page, so runtime
      // caching alone would miss them).
      const shell = await cache.match('/');
      const html = await shell?.text();
      if (typeof html === 'string') {
        const urls = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((match) => match[1]);
        await Promise.all(urls.map((url) => cache.add(url).catch(() => undefined)));
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (request.mode === 'navigate') {
        try {
          const response = await fetch(request);
          await cache.put('/', response.clone());
          return response;
        } catch {
          const cached = (await cache.match(request)) ?? (await cache.match('/'));
          if (cached !== undefined) return cached;
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      }
      const cached = await cache.match(request);
      if (cached !== undefined) {
        event.waitUntil(
          (async () => {
            try {
              const fresh = await fetch(request);
              if (fresh.ok) await cache.put(request, fresh.clone());
            } catch {
              // Offline: the cached copy is the answer (§8.7).
            }
          })(),
        );
        return cached;
      }
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })(),
  );
});
