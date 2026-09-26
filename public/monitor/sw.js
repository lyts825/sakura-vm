const cacheName = 'sakura-monitor-shell-__MONITOR_REVISION__';
const base = new URL('./', self.location.href);
const shell = [
  'index.html',
  'monitor.js',
  'monitor.css',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
].map((path) => new URL(path, base).href);
self.addEventListener('install', (event) => {
  event.waitUntil(
    self.navigator.locks.request('sakura-monitor-shell', async () => {
      const cache = await caches.open(cacheName);
      await cache.addAll(
        shell.map((url) => new Request(url, { cache: 'reload', signal: AbortSignal.timeout(12_000) })),
      );
      await self.skipWaiting();
    }),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith('sakura-monitor-shell-') && name !== cacheName) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== base.origin || url.search) return;
  const path = url.href === base.href ? new URL('index.html', base).href : url.href;
  // API, WebSocket, downloads and the control-panel shell always bypass this worker.
  if (!shell.includes(path)) return;
  event.respondWith((async () => (await caches.match(path, { cacheName })) || fetch(event.request))());
});
