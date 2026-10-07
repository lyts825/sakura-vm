/** 监控 PWA 的版本化静态壳缓存；仅缓存明确列出的同源无查询 GET 资源，监控 API 和控制台请求始终直连。
 * Version the monitor static-shell cache and intercept only allowlisted same-origin query-free GET resources; monitoring/control API traffic always uses the network. */
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
/** 安装事务与用户清壳共用 Web Lock，完整 reload 预缓存成功后才 skipWaiting；单资源 12 秒截止，waitUntil 保留安装生命周期直至事务结束。
 * Share a Web Lock with user shell clearing, calling skipWaiting only after complete reload precaching; twelve-second resource deadlines and waitUntil keep installation alive until the transaction settles. */
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
/** 激活时仅删除旧版监控壳，再接管同作用域页面；快照缓存与其他功能缓存按各自生命周期维护。
 * On activation remove only older monitor shells before claiming scoped clients; snapshot/other-feature caches keep their separate lifetimes. */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith('sakura-monitor-shell-') && name !== cacheName) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});
/** 请求须同源无查询 GET 且在固定壳白名单；仅命中时 cache-first，否则走网络，API/下载/控制页永不被离线壳截获。
 * Intercept only same-origin query-free GETs in the fixed shell allowlist; use cache-first for these, otherwise the network, leaving API/download/control-page traffic outside offline-shell interception. */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== base.origin || url.search) return;
  const path = url.href === base.href ? new URL('index.html', base).href : url.href;
  // API, WebSocket, downloads and the control-panel shell always bypass this worker.
  if (!shell.includes(path)) return;
  event.respondWith((async () => (await caches.match(path, { cacheName })) || fetch(event.request))());
});
