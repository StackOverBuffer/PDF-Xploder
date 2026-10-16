/* PDF-Xploder service worker: the whole app is cached at install, so it works offline.
   Generated into the build by the pwa plugin in vite.config.ts (FILES and VERSION are filled in). */
const FILES = self.__FILES__;
const VERSION = self.__VERSION__;
const PRECACHE = `pdf-xploder-${VERSION}`;
// Fonts and OCR data loaded on demand (versioned CDN URLs, so they never change).
const RUNTIME = 'pdf-xploder-runtime';
const CDN = 'https://cdn.jsdelivr.net/';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(PRECACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('pdf-xploder-') && key !== PRECACHE && key !== RUNTIME) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

async function fromCache(req, cacheName) {
  const hit = await caches.match(req, { ignoreSearch: req.url.startsWith(self.registration.scope) });
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheName && (res.ok || res.type === 'opaque')) {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(req, copy));
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  if (req.mode === 'navigate') {
    // Fresh page when online (a new version installs in the background); the cached one offline.
    e.respondWith(
      fetch(req).catch(async () => (await caches.match(new URL('index.html', self.registration.scope).href, { cacheName: PRECACHE })) ?? Response.error()),
    );
  } else if (url.startsWith(self.registration.scope)) {
    e.respondWith(fromCache(req, RUNTIME));
  } else if (url.startsWith(CDN)) {
    e.respondWith(fromCache(req, RUNTIME));
  }
});
