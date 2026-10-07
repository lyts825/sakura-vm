/** 只读监控客户端，每次采样获取本机临时凭据，裁剪实例/任务快照，并在用户启用后保存离线副本。
 * Obtain ephemeral local credentials per sample, sanitize VM/job fields and save only validated snapshots after explicit offline opt-in, serializing cross-window cache updates. */
/** 取得监控页面固定 ID 的 DOM 节点，供纯文本渲染与按钮状态更新使用。
 * Look up fixed monitor-page element IDs for plain-text rendering and button-state updates. */
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
/** 读取用户明确启用的离线偏好；浏览器拒绝 localStorage 时返回 false，使采样保持在线模式。
 * Read the explicit offline preference; denied localStorage access returns false and leaves sampling in online mode. */
const enabled = () => {
  try {
    return localStorage.getItem(preference) === 'true';
  } catch {
    return false;
  }
};
/** 只接受字符串并截断到给定上限，其他值转为空串，限制快照展示和缓存中的文本量。
 * Accept only strings and truncate them to the supplied limit; other values become empty strings to bound displayed and cached text. */
const text = (value, max = 128) => (typeof value === 'string' ? value.slice(0, max) : '');
/** 把快照状态限定为本地状态表的自有键，未知值统一显示 unknown，避免继承属性被当成状态。
 * Restrict snapshot states to own keys in the local state table; unfamiliar values become unknown rather than inherited properties. */
const status = (value) => (Object.hasOwn(statuses, value) ? value : 'unknown');
/** 只保留非负安全整数；非法或超出整数精度的资源数量返回 null，由 UI 显示未知。
 * Retain only nonnegative safe integers; invalid or imprecise resource counts return null for the UI to show as unknown. */
const number = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
/** 验证可解析的字符串时间并规范为 ISO 格式；非法类型或时间返回 null，供快照校验和排序共用。
 * Validate string timestamps and normalize them to ISO; invalid types or dates return null for shared snapshot validation and ordering. */
const date = (value) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
// 在线响应和离线缓存都经过同一裁剪入口；只保留显示所需字段并限制集合长度。
/** 验证版本、采样时间及最多各 100 个实例和任务，重建仅含显示所需字段的快照；在线数据与缓存都经此入口，格式错误直接拒绝。
 * Validate the version, sample time and at most 100 VMs and jobs each, then rebuild a snapshot containing only display fields. Both network and cached data use this boundary; malformed snapshots are rejected. */
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
/** 更新错误提示的纯文本及可见性，空消息清除提示，避免残留错误覆盖下一轮采样结果。
 * Update the plain-text error and its visibility; an empty message clears feedback before a new sample. */
function error(message = '') {
  $('error').textContent = message;
  $('error').hidden = !message;
}
/** 按标签创建节点并设置纯文本及可选样式类，统一防止实例名称和任务内容作为 HTML 解释。
 * Create an element with plain text and an optional class, keeping VM names and job data from being interpreted as HTML. */
function element(tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}
/** 把已有时间转为用户区域的可读格式，缺失时间返回明确的未知提示。
 * Format an existing timestamp using the user locale and return an explicit unknown-time label when absent. */
function time(value) {
  return value ? new Date(value).toLocaleString() : '时间未知';
}
/** 由采样年龄、在线标志和页面可见性判断是否仍在 90 秒新鲜窗口内，并刷新离线、安装和清除按钮状态；负年龄提示本地时钟偏差。
 * Combine sample age, the live flag and page visibility to determine the ninety-second freshness window and refresh cache/install/clear controls; negative age reports local clock skew. */
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
/** 重建实例和任务展示，关联任务所属实例并显示总数与最多 100 条的截断信息；渲染使用已裁剪快照和纯文本节点。
 * Rebuild VM and job displays, associate jobs with VM names and show totals with the hundred-item limit; rendering uses the sanitized snapshot and plain-text nodes. */
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
/** 读取本监控页的唯一快照响应，缺失返回 undefined；超过 200,000 字符或不能通过 JSON/结构校验的副本抛错。
 * Read this monitor page’s sole cached snapshot, returning undefined when absent; content over 200,000 characters or invalid JSON/structure throws. */
async function readCached() {
  const response = await (await caches.open(snapshotCache)).match(snapshotUrl);
  if (!response) return undefined;
  const content = await response.text();
  if (content.length > 200_000) throw new Error('离线快照超过大小上限');
  return sanitize(JSON.parse(content));
}
/** 仅在离线偏好启用时写入经校验的快照，忽略损坏旧副本且不让更旧的采样覆盖较新副本；跨窗口串行由调用方持锁保证。
 * Write a validated snapshot only while offline caching is enabled, replace corrupt old data and prevent an older sample from overwriting a newer one; callers hold the cross-window lock. */
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
/** 在命名 Web Lock 中执行缓存工作并返回其结果；缺少跨窗口锁支持时拒绝更新，避免启用与清除相互竞态。
 * Execute cache work under a named Web Lock and return its result; reject browsers without cross-window locks to prevent enable/clear races. */
async function locked(work) {
  if (!navigator.locks) throw new Error('当前浏览器不支持安全的跨窗口缓存更新，请使用新版 Chrome 或 Edge。');
  return navigator.locks.request('sakura-monitor-cache', work);
}
/** 仅注销本监控作用域的 worker，并在静态壳锁下删除本功能的快照与壳缓存；其他页面注册和缓存不受影响。
 * Unregister only the monitor scope and remove this feature’s snapshot and shell caches under the shell lock, preserving other registrations and caches. */
async function clearOwned() {
  for (const registration of await navigator.serviceWorker.getRegistrations())
    if (registration.scope === scope) await registration.unregister();
  await navigator.locks.request('sakura-monitor-shell', async () => {
    for (const name of await caches.keys())
      if (name === snapshotCache || name.startsWith('sakura-monitor-shell-')) await caches.delete(name);
  });
}
/** 注册禁用更新缓存的监控 worker，等待激活或最多 15 秒；冗余状态、未就绪或超时均失败，状态监听与计时器由 finish 清理。
 * Register the monitor worker with update caching disabled and wait at most fifteen seconds for activation; redundant, unready or timed-out workers fail, with listeners and timers released by finish. */
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
  await new Promise(/** 把 worker 状态事件转换为最多 15 秒的 Promise；监听后立即复查以覆盖已激活竞态，finish 同时撤销计时器与监听，redundant 按失败处理。
 * Bridge worker state events into a fifteen-second promise; recheck immediately after attaching to cover prior activation, remove timer/listener together in finish and reject redundant workers. */ (resolve, reject) => {
    /** 结束本次 worker 激活等待，先清理超时与状态监听，再按 failure 参数兑现或拒绝 Promise，防止等待资源残留。
     * Finish the worker activation wait by clearing the timer and state listener before resolving or rejecting from failure, avoiding retained wait resources. */
    const finish = (failure) => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', check);
      failure ? reject(failure) : resolve();
    };
    /** 把 worker 的 activated 状态判为成功、redundant 判为失败；中间状态继续等待，由独立计时器限定总等待时间。
     * Treat activated as success and redundant as failure; intermediate states keep waiting under the separate overall timeout. */
    const check = () => {
      if (worker.state === 'activated') finish();
      if (worker.state === 'redundant') finish(new Error('离线页面准备失败，请重试'));
    };
    const timer = setTimeout(() => finish(new Error('离线页面准备超时，请重试')), 15_000);
    worker.addEventListener('statechange', check);
    check();
  });
}
/** 使用调用方取消信号和可选临时令牌获取禁用缓存的 JSON，非成功 HTTP 响应抛错；凭据不进入离线缓存。
 * Fetch noncached JSON with the caller’s abort signal and optional ephemeral token; unsuccessful HTTP responses throw and credentials never enter offline storage. */
async function json(path, signal, token) {
  const response = await fetch(path, {
    cache: 'no-store',
    signal,
    headers: token ? { 'X-Sakura-Token': token } : {},
  });
  if (!response.ok) throw new Error(`控制服务暂不可用（${response.status}）`);
  return response.json();
}
// 页面隐藏时暂停采样；失败时明确显示旧快照时间，避免把缓存数据标成实时状态。
/** 防止并发采样并在隐藏页面跳过；每轮重新取临时凭据，在 12 秒共同截止时间内获取并裁剪监控结果。缓存失败保留在线结果，采样失败标记旧副本过期，finally 恢复按钮与请求状态。
 * Avoid concurrent sampling and skip hidden pages; obtain fresh ephemeral credentials each round and fetch/sanitize monitoring data within one twelve-second deadline. Cache failure retains live data, sampling failure marks old data stale, and finally resets controls and request state. */
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
$('offline').addEventListener('click', /** 用户启用离线时锁住缓存事务并冻结按钮；成功准备 worker 后才持久化偏好和快照，失败反馈后恢复可重试状态。
 * Lock the cache transaction and disable controls for explicit offline opt-in; persist preference/snapshot only after preparing the worker, then show failures and restore retryable controls. */ async () => {
  cacheBusy = true;
  error();
  renderTime();
  try {
    if (!navigator.serviceWorker || !globalThis.caches) throw new Error('浏览器不支持离线缓存');
    await locked(/** 在跨窗口缓存锁内依次准备 worker、启用偏好和写当前快照；任一步失败先撤销偏好并清除本作用域资源，再传播原失败。
 * Under the cross-window cache lock prepare the worker, enable the preference and write the current snapshot in order; on failure revoke preference and clear this scope’s resources before propagating it. */ async () => {
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
$('clear').addEventListener('click', /** 清除操作先在同一跨窗口锁内关闭偏好与自有缓存，再丢弃内存快照；失败不显示虚假的清除成功，finally 恢复控件。
 * Clear preference/owned caches under the same cross-window lock before discarding the in-memory snapshot; failures do not report false success and finally restores controls. */ async () => {
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
