const $ = (id) => document.getElementById(id);
const preference = 'sakura-monitor-offline-v1';
const snapshotCache = 'sakura-monitor-snapshots-v1';
const snapshotUrl = new URL('./snapshot.json', location.href).href;
const scope = new URL('./', location.href).href;
const statuses = {
  running: '运行中',
  paused: '已暂停',
  stopped: '已停止',
  starting: '启动中',
  stopping: '停止中',
  done: '已完成',
  error: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
  unknown: '未知',
};
let snapshot,
  live = false,
  refreshing = false,
  cacheBusy = false,
  activeRequest,
  installPrompt;
const enabled = () => {
  try {
    return localStorage.getItem(preference) === 'true';
  } catch {
    return false;
  }
};
const text = (value, max = 128) => (typeof value === 'string' ? value.slice(0, max) : '');
const status = (value) => (Object.hasOwn(statuses, value) ? value : 'unknown');
const number = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const date = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
function sanitize(raw) {
  if (
    !raw ||
    raw.version !== 1 ||
    !date(raw.capturedAt) ||
    !Array.isArray(raw.vms) ||
    !Array.isArray(raw.jobs) ||
    raw.vms.length > 100 ||
    raw.jobs.length > 100
  )
    throw new Error('监控快照格式无效');
  return {
    version: 1,
    capturedAt: date(raw.capturedAt),
    host: text(raw.host),
    totalVms: number(raw.totalVms),
    totalJobs: number(raw.totalJobs),
    vms: raw.vms.map((vm) => ({
      id: text(vm.id),
      name: text(vm.name),
      status: status(vm.status),
      cpus: number(vm.cpus),
      memoryMiB: number(vm.memoryMiB),
    })),
    jobs: raw.jobs.map((job) => ({
      id: text(job.id),
      vmId: text(job.vmId),
      scope: text(job.scope, 80),
      action: text(job.action, 80),
      status: status(job.status),
      startedAt: date(job.startedAt),
      finishedAt: date(job.finishedAt),
    })),
  };
}
function error(message = '') {
  $('error').textContent = message;
  $('error').hidden = !message;
}
function element(tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}
function time(value) {
  return value ? new Date(value).toLocaleString() : '时间未知';
}
function renderTime() {
  const age = snapshot ? Math.floor((Date.now() - Date.parse(snapshot.capturedAt)) / 1000) : null;
  const fresh = live && age !== null && age >= 0 && age <= 90;
  $('connection').textContent = document.hidden
    ? '页面已隐藏 · 暂停采样'
    : fresh
      ? '已连接 · 最近采样'
      : snapshot
        ? '离线或已过期 · 缓存快照'
        : '没有可用的采样';
  $('sample-time').textContent = snapshot
    ? `${snapshot.host || '本机'} · 采样于 ${time(snapshot.capturedAt)} · ${age < 0 ? '本地时钟早于采样时间' : `${age} 秒前`}`
    : '尚无采样记录';
  $('cache-state').textContent = enabled() ? '离线缓存已启用 · 只保留最近一次快照' : '离线缓存未启用';
  $('offline').disabled = cacheBusy || enabled();
  $('clear').disabled = cacheBusy;
  $('install').hidden = !installPrompt || !enabled();
}
function render() {
  renderTime();
  $('vms').replaceChildren();
  $('jobs').replaceChildren();
  $('vm-count').textContent = snapshot
    ? `显示 ${snapshot.vms.length} / ${snapshot.totalVms ?? '?'} 个实例（最多 100 个）`
    : '';
  $('job-count').textContent = snapshot
    ? `显示 ${snapshot.jobs.length} / ${snapshot.totalJobs ?? '?'} 个任务（最多 100 个）`
    : '';
  if (!snapshot?.vms.length) $('vms').append(element('p', snapshot ? '没有实例' : '没有可显示的快照'));
  for (const vm of snapshot?.vms || []) {
    const card = element('article', '', 'card');
    card.append(
      element('h3', vm.name || '未命名实例'),
      element('span', statuses[vm.status], 'state'),
      element('p', `${vm.cpus ?? '?'} vCPU · ${vm.memoryMiB ?? '?'} MiB`, 'muted'),
    );
    $('vms').append(card);
  }
  if (!snapshot?.jobs.length) $('jobs').append(element('li', snapshot ? '没有任务事件' : '没有可显示的快照'));
  for (const job of snapshot?.jobs || []) {
    const item = document.createElement('li');
    const vm = snapshot.vms.find((vm) => vm.id === job.vmId);
    item.append(
      element('strong', `${job.scope} / ${job.action} · ${statuses[job.status]}`),
      element('p', `${vm?.name || '主机任务'} · ${time(job.finishedAt || job.startedAt)}`, 'muted'),
    );
    $('jobs').append(item);
  }
}
async function readCached() {
  const response = await (await caches.open(snapshotCache)).match(snapshotUrl);
  if (!response) return undefined;
  const content = await response.text();
  if (content.length > 200_000) throw new Error('离线快照超过大小上限');
  return sanitize(JSON.parse(content));
}
async function writeCached(value) {
  if (!enabled()) return;
  let previous;
  try {
    previous = await readCached();
  } catch {
    /* Replace invalid data with a fresh validated sample. */
  }
  if (previous && Date.parse(previous.capturedAt) > Date.parse(value.capturedAt)) return;
  await (
    await caches.open(snapshotCache)
  ).put(
    snapshotUrl,
    new Response(JSON.stringify(sanitize(value)), { headers: { 'Content-Type': 'application/json' } }),
  );
}
async function locked(work) {
  if (!navigator.locks) throw new Error('当前浏览器不支持安全的跨窗口缓存更新，请使用新版 Chrome 或 Edge。');
  return navigator.locks.request('sakura-monitor-cache', work);
}
async function clearOwned() {
  for (const registration of await navigator.serviceWorker.getRegistrations())
    if (registration.scope === scope) await registration.unregister();
  await navigator.locks.request('sakura-monitor-shell', async () => {
    for (const name of await caches.keys())
      if (name === snapshotCache || name.startsWith('sakura-monitor-shell-')) await caches.delete(name);
  });
}
async function prepareWorker() {
  const registration = await navigator.serviceWorker.register('./sw.js', {
    scope: './',
    updateViaCache: 'none',
  });
  const worker = registration.installing || registration.waiting;
  if (!worker) {
    if (!registration.active) throw new Error('离线页面尚未就绪');
    return;
  }
  await new Promise((resolve, reject) => {
    const finish = (failure) => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', check);
      failure ? reject(failure) : resolve();
    };
    const check = () => {
      if (worker.state === 'activated') finish();
      if (worker.state === 'redundant') finish(new Error('离线页面准备失败，请重试'));
    };
    const timer = setTimeout(() => finish(new Error('离线页面准备超时，请重试')), 15_000);
    worker.addEventListener('statechange', check);
    check();
  });
}
async function json(path, signal, token) {
  const response = await fetch(path, {
    cache: 'no-store',
    signal,
    headers: token ? { 'X-Sakura-Token': token } : {},
  });
  if (!response.ok) throw new Error(`控制服务暂不可用（${response.status}）`);
  return response.json();
}
async function refresh() {
  if (refreshing || document.hidden) return;
  refreshing = true;
  $('refresh').disabled = true;
  activeRequest = new AbortController();
  try {
    const signal = AbortSignal.any([activeRequest.signal, AbortSignal.timeout(12_000)]);
    const credentials = await json('/api/bootstrap', signal);
    if (typeof credentials.token !== 'string' || !credentials.token)
      throw new Error('控制服务未返回有效凭证');
    const value = sanitize(await json('/api/monitor', signal, credentials.token));
    snapshot = value;
    live = true;
    error();
    render();
    if (enabled()) {
      try {
        await locked(() => writeCached(value));
      } catch {
        error('最新状态已读取，但离线快照保存失败。请检查浏览器存储权限或清除缓存后重试。');
      }
    }
  } catch (failure) {
    live = false;
    if (!document.hidden)
      error(snapshot ? '无法获取或保存新采样，显示上次快照。' : '无法连接控制服务，且没有可用的离线快照。');
    renderTime();
  } finally {
    refreshing = false;
    $('refresh').disabled = false;
    activeRequest = undefined;
  }
}
$('refresh').addEventListener('click', () => void refresh());
$('offline').addEventListener('click', async () => {
  cacheBusy = true;
  error();
  renderTime();
  try {
    if (!navigator.serviceWorker || !globalThis.caches) throw new Error('浏览器不支持离线缓存');
    await locked(async () => {
      try {
        await prepareWorker();
        localStorage.setItem(preference, 'true');
        if (snapshot) await writeCached(snapshot);
      } catch (failure) {
        try {
          localStorage.setItem(preference, 'false');
        } catch {
          /* Storage may be disabled. */
        }
        await clearOwned();
        throw failure;
      }
    });
  } catch (failure) {
    error(failure.message || '无法启用离线缓存');
  } finally {
    cacheBusy = false;
    renderTime();
  }
});
$('clear').addEventListener('click', async () => {
  cacheBusy = true;
  error();
  renderTime();
  try {
    await locked(async () => {
      localStorage.setItem(preference, 'false');
      await clearOwned();
    });
    snapshot = undefined;
    live = false;
    render();
  } catch (failure) {
    error(failure.message || '清除失败，请重试');
  } finally {
    cacheBusy = false;
    renderTime();
  }
});
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  renderTime();
});
window.addEventListener('appinstalled', () => {
  installPrompt = undefined;
  renderTime();
});
$('install').addEventListener('click', async () => {
  const prompt = installPrompt;
  installPrompt = undefined;
  renderTime();
  try {
    await prompt?.prompt();
  } catch {
    error('请使用浏览器菜单中的安装入口');
  }
});
window.addEventListener('storage', (event) => {
  if (event.key === preference || event.key === null) renderTime();
});
window.addEventListener('offline', () => {
  live = false;
  activeRequest?.abort();
  renderTime();
});
window.addEventListener('online', () => void refresh());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) activeRequest?.abort();
  else void refresh();
  renderTime();
});
setInterval(() => void refresh(), 30_000);
setInterval(renderTime, 1000);
if (enabled()) {
  try {
    snapshot = await readCached();
  } catch {
    error('离线快照损坏，可以清除缓存后重新采样。');
  }
  // Offline startup must not depend on a successful worker update.
  if (navigator.onLine)
    void locked(async () => {
      if (enabled()) await prepareWorker();
    }).catch(() => {});
}
render();
void refresh();
