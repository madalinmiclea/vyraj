const BUILD = '__VYRAJ_BUILD__';
const PRECACHE = ['__VYRAJ_PRECACHE__'];
const SHELL = `vyraj-shell-${BUILD}`;
const DATA = 'vyraj-data';
const STATIC = 'vyraj-static';
const SCOPE = new URL(self.registration.scope);
const at = (p) => new URL(p, SCOPE).href;
const INDEX = at('index.html');

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    const files = PRECACHE.filter((p) => !p.startsWith('__'));
    await Promise.all(files.map((p) => cache.add(new Request(at(p), { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('vyraj-shell-') && k !== SHELL).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});

async function fromNetwork(request, cacheName) {
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(request, copy)).catch(() => {});
  }
  return res;
}

async function cacheFirst(request, cacheName) {
  const hit = await caches.match(request);
  return hit || fromNetwork(request, cacheName);
}

async function staleWhileRevalidate(event, cacheName) {
  const hit = await caches.match(event.request);
  const fresh = fromNetwork(event.request, cacheName);
  if (hit) {
    event.waitUntil(fresh.catch(() => {}));
    return hit;
  }
  return fresh;
}

async function navigation(event) {
  try {
    const preload = await event.preloadResponse;
    const res = preload || await fetch(event.request);
    if (res.ok && new URL(event.request.url).href === SCOPE.href) {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put(INDEX, copy)).catch(() => {});
    }
    return res;
  } catch {
    return (await caches.match(INDEX)) || Response.error();
  }
}

async function pruneData(manifest) {
  const keep = new Set(Object.values(manifest).map((f) => at(`data/${f}`)));
  const cache = await caches.open(DATA);
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
}

async function dataManifest(event) {
  try {
    const res = await fetch(event.request);
    if (res.ok) {
      const copy = res.clone();
      event.waitUntil(copy.json().then(async (m) => {
        await (await caches.open(SHELL)).put(at('data/manifest.json'), new Response(JSON.stringify(m), { headers: { 'Content-Type': 'application/json' } }));
        await pruneData(m);
      }).catch(() => {}));
    }
    return res;
  } catch {
    return (await caches.match(at('data/manifest.json'))) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin || !url.href.startsWith(SCOPE.href)) return;
  if (request.headers.has('range')) return;
  const path = url.pathname.slice(SCOPE.pathname.length);
  if (request.mode === 'navigate') return event.respondWith(navigation(event));
  if (path === 'data/manifest.json') return event.respondWith(dataManifest(event));
  if (path.startsWith('assets/')) return event.respondWith(cacheFirst(request, SHELL));
  if (path.startsWith('data/') && /\.[0-9a-f]{8,}\.json$/.test(path)) return event.respondWith(cacheFirst(request, DATA));
  if (path === 'sw.js' || url.search) return;
  if (/\.(woff2|png|svg|ico|webmanifest|jpg|webp)$/.test(path)) return event.respondWith(staleWhileRevalidate(event, STATIC));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || at('#/home');
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find((c) => c.url.startsWith(SCOPE.href));
    if (open) {
      await open.focus();
      if (event.notification.data?.url) open.navigate(target).catch(() => {});
      return;
    }
    await self.clients.openWindow(target);
  })());
});
