/* PDF-Xploder service worker: the whole app is cached at install, so it works offline.
   Generated into the build by the pwa plugin in vite.config.ts (FILES and VERSION are filled in). */
const FILES = self.__FILES__;
const VERSION = self.__VERSION__;
const PRECACHE = `pdf-xploder-${VERSION}`;
// Fonts and OCR data loaded on demand from versioned CDN URLs: they never change, so this cache is kept across versions.
const CDN_CACHE = 'pdf-xploder-cdn';
const CDN = 'https://cdn.jsdelivr.net/';
/** The app shell; everything else (character maps, fonts) is cached best-effort so one failure does not stop the install. */
const isCore = (f) => f === './' || f === 'index.html' || /^assets\//.test(f) || f === 'manifest.webmanifest';

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      await cache.addAll(FILES.filter(isCore));
      await Promise.allSettled(FILES.filter((f) => !isCore(f)).map((f) => cache.add(f)));
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('pdf-xploder-') && key !== PRECACHE && key !== CDN_CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

/** Cached copy if there is one, else the network (successful answers are kept in `cacheName`). */
async function cacheFirst(req, cacheName) {
  const hit = await caches.match(req, { cacheName, ignoreSearch: cacheName === PRECACHE });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(req, copy));
  }
  return res;
}

/** The network with a time limit; on failure, timeout or an error page, the cached app. */
async function navigate(req) {
  const cached = () => caches.match(new URL('index.html', self.registration.scope).href, { cacheName: PRECACHE });
  try {
    const res = await Promise.race([fetch(req), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))]);
    if (res.ok) return res;
    return (await cached()) ?? res;
  } catch {
    return (await cached()) ?? Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  if (req.mode === 'navigate') e.respondWith(navigate(req));
  // Same-origin files belong to this version (precached, or added to its cache when fetched).
  else if (url.startsWith(self.registration.scope)) e.respondWith(cacheFirst(req, PRECACHE));
  else if (url.startsWith(CDN)) e.respondWith(cacheFirst(req, CDN_CACHE));
});
