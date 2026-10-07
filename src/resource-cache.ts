/**
 * 模块职责（中文）：按请求能力和完整路径共享资源读取、轮询及订阅，并按会话/插件代次隔离缓存结果。
 * Module responsibility (English): Sharing reads and polling by access capability, complete URL and authority generation.
 * 详细范围（中文）：公开入口包括 ResourceRequest, setResourceRequestScope, resourceRequestScope, ResourceSnapshot, ResourceCache, resourceCache；职责覆盖按访问能力、完整 URL 与权限代次共享读取和轮询，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ResourceRequest, setResourceRequestScope, resourceRequestScope, ResourceSnapshot, ResourceCache, resourceCache. The scope covers Sharing reads and polling by access capability, complete URL and authority generation. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { pluginGeneration } from './plugin-generation';

export type ResourceRequest = /** 中文：声明按路径/操作和请求选项传输数据的能力，返回类型由调用契约决定；取消和错误由实现能力传回 | English: Declare a transport capability accepting paths/operations and request options; the call contract determines result type, with cancellation/errors propagated by the implementation | 中文：输入：path：目标文件或请求路径；method：请求 HTTP 方法；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命 | English: Inputs: path: target file/request path; method: request HTTP method; body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation | 中文：结果：Promise<T>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<T>; callers depend on this type contract, with promise rejection representing asynchronous failure */ <T = unknown>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
const requestScopes = new WeakMap<ResourceRequest, string>();
/**
 * 中文：将请求函数与插件安装身份绑定在 WeakMap 中，不强持有已失去引用的能力；包装请求时复制此元数据以保持局部失效范围。
 * English: Bind request functions to plugin installation identities in a WeakMap without retaining unreachable capabilities; copy this metadata when wrapping requests to preserve scoped invalidation.
 * 中文：输入：request：带身份和权限作用域的传输能力；identity：插件安装或资源权限身份
 * English: Inputs: request: transport capability bound to identity/authority scope; identity: plugin installation/resource authority identity
 */
export const setResourceRequestScope = (request: ResourceRequest, identity: string) => requestScopes.set(request, identity);
/**
 * 中文：读取请求能力绑定的插件身份，未绑定能力返回 undefined。
 * English: Read the plugin identity bound to a request capability, returning undefined when unbound.
 * 中文：输入：request：带身份和权限作用域的传输能力
 * English: Inputs: request: transport capability bound to identity/authority scope
 */
export const resourceRequestScope = (request: ResourceRequest) => requestScopes.get(request);
export type ResourceSnapshot<T = unknown> = { data: T | null; error: string; loading: boolean; updatedAt?: number };
type Listener = /** 中文：声明同步接收共享资源快照的观察者，快照包含 data/error/loading 及可选更新时间；回调没有异步返回契约。 | English: Declare a synchronous observer of shared resource snapshots containing data/error/loading/optional timestamp, without an asynchronous return contract. | 中文：输入：snapshot：签名所示 ResourceSnapshot 业务值 | English: Inputs: snapshot: the ResourceSnapshot domain value in the signature | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (snapshot: ResourceSnapshot) => void;
type Entry = {
  key: string; path: string; request: ResourceRequest; snapshot: ResourceSnapshot; scopes: readonly string[];
  listeners: Map<Listener, number>; generation: number; dirty: boolean;
  pending?: Promise<void>; abort?: AbortController; timer?: ReturnType<typeof setTimeout>;
};

/** Keep equal JSON subtrees stable across polling and mutation reconciliation.
 * Form effects must not mistake an unchanged server reply for a new saved draft. */
/**
 * 中文：递归复用相等 JSON 子树的引用，使轮询不会把未变化的服务端数据误判成新草稿。节点预算为 20000、深度为 64；超出后使用新值，不继续递归。
 * English: Recursively retain equal JSON subtree references so polling does not look like a newly saved draft. A 20000-node/64-depth budget bounds recursion; incoming values replace branches beyond that budget.
 * 中文：输入：previous：用于比较或复用的上一快照；incoming：本次收到的新数据
 * English: Inputs: previous: previous snapshot for comparison/reuse; incoming: newly received data
 * 中文：结果：unknown，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: unknown carrying the described computation/transport result; throwing branches do not provide success
 */
function shareJson(previous: unknown, incoming: unknown): unknown {
  let remaining = 20000;
  /**
   * 中文：在共享节点预算内比较数组和普通对象子树；相等分支复用旧引用，深度/预算超限或非普通对象使用新值，并用 defineProperty 安全保留任意 JSON 键。
   * English: Compare arrays/plain-object subtrees within a shared node budget. Reuse equal branches, replace overbudget/deep/nonplain branches and use defineProperty to retain arbitrary JSON keys safely.
   * 中文：输入：old：签名所示 unknown 业务值；next：待采用的新状态或数据；depth：当前递归深度，用于限制开销
   * English: Inputs: old: the unknown domain value in the signature; next: new state/data to adopt; depth: current recursion depth for bounding work
   * 中文：结果：unknown，包含上述计算或传输完成值；抛错分支不提供成功结果
   * English: Result: unknown carrying the described computation/transport result; throwing branches do not provide success
   */
  const visit = (old: unknown, next: unknown, depth: number): unknown => {
    if (Object.is(old, next)) return old;
    if (--remaining < 0 || depth > 64 || !old || !next || typeof old !== 'object' || typeof next !== 'object') return next;
    if (Array.isArray(old) && Array.isArray(next)) {
      const values = next.map((value, index) => visit(old[index], value, depth + 1));
      return old.length === values.length && values.every((value, index) => Object.is(value, old[index])) ? old : values;
    }
    if (Object.getPrototypeOf(old) !== Object.prototype || Object.getPrototypeOf(next) !== Object.prototype) return next;
    const before = old as Record<string, unknown>, after = next as Record<string, unknown>;
    const keys = Object.keys(after), value: Record<string, unknown> = {};
    let equal = Object.keys(before).length === keys.length;
    for (const key of keys) {
      const shared = visit(before[key], after[key], depth + 1);
      Object.defineProperty(value, key, { value: shared, enumerable: true, writable: true, configurable: true });
      if (!Object.hasOwn(before, key) || !Object.is(shared, before[key])) equal = false;
    }
    return equal ? old : value;
  };
  return visit(previous, incoming, 0);
}

/** A request capability plus its complete path/query identifies one cached resource. */
export class ResourceCache {
  private identities = new WeakMap<ResourceRequest, number>();
  private sequence = 0;
  private entries = new Map<string, Entry>();
  private visible = true;
  private resetGeneration = 0;
  private scopeGenerations = new Map<string, number>();
  /**
   * 中文：配置缓存条目上限和最后退订后的保留时长，默认 256 条与 60 秒；活动订阅不能为容量而被淘汰。
   * English: Configure the entry limit and retention after final unsubscribe, defaulting to 256 entries/sixty seconds; capacity eviction must not remove active subscriptions.
   * 中文：输入：limit：资源或条目数量上限（缺省 256）；retainedMs：最后退订后的缓存保留毫秒数（缺省 60000）
   * English: Inputs: limit: resource/entry count limit (default 256); retainedMs: cache retention milliseconds after final unsubscribe (default 60000)
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  constructor(private readonly limit = 256, private readonly retainedMs = 60000) {}
  /**
   * 中文：读取全局 reset 水位，供订阅者拒绝重置前保存的快照。
   * English: Read the global reset watermark so subscribers reject snapshots saved before reset.
   */
  get generation() { return this.resetGeneration; }
  /**
   * 中文：合并请求能力显式绑定的身份和路由归属身份并去重，任一身份撤销都应使此缓存失效。
   * English: Deduplicate the explicit request-capability identity and route-owner identity; revoking either must invalidate this cache.
   * 中文：输入：request：带身份和权限作用域的传输能力；path：目标文件或请求路径
   * English: Inputs: request: transport capability bound to identity/authority scope; path: target file/request path
   */
  private scopes(request: ResourceRequest, path: string) {
    return [...new Set([resourceRequestScope(request), pluginGeneration.identityFor(path)].filter((identity): identity is string => !!identity))];
  }
  /**
   * 中文：把全局重置代次与相关插件作用域代次拼成稳定快照标识，隔离无关插件的更新。
   * English: Combine global-reset and relevant plugin-scope generations into a stable snapshot identity, isolating unrelated plugin changes.
   * 中文：输入：request：带身份和权限作用域的传输能力；path：目标文件或请求路径
   * English: Inputs: request: transport capability bound to identity/authority scope; path: target file/request path
   */
  generationFor(request: ResourceRequest, path: string) {
    return `${this.resetGeneration}:${this.scopes(request, path).map(identity => `${identity}:${this.scopeGenerations.get(identity) || 0}`).join('|')}`;
  }
  // 请求函数本身代表访问能力；相同 URL 但不同能力不能复用缓存或正在进行的读取。
  /**
   * 中文：以请求函数身份和完整路径生成缓存键；不同授权能力或查询参数拥有独立缓存，防止跨工作区复用权限或数据。
   * English: Build cache keys from request-function identity and the complete path. Different authority capabilities or queries keep separate caches, preventing cross-workspace authority/data reuse.
   * 中文：输入：request：带身份和权限作用域的传输能力；path：目标文件或请求路径
   * English: Inputs: request: transport capability bound to identity/authority scope; path: target file/request path
   */
  private key(request: ResourceRequest, path: string) {
    let id = this.identities.get(request);
    if (id === undefined) { id = ++this.sequence; this.identities.set(request, id); }
    return `${id}:${path}`;
  }
  /**
   * 中文：不可变合并部分快照并同步通知本条目的观察者，共享数据引用保持不变直到实际更新。
   * English: Immutably merge a partial snapshot and synchronously notify this entry's observers, retaining shared data references until an actual update.
   * 中文：输入：entry：缓存中当前处理的共享资源条目；update：要发布的部分快照字段
   * English: Inputs: entry: shared resource-cache entry being processed; update: partial snapshot fields to publish
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  private emit(entry: Entry, update: Partial<ResourceSnapshot>) {
    entry.snapshot = { ...entry.snapshot, ...update };
    for (const listener of entry.listeners.keys()) listener(entry.snapshot);
  }
  /**
   * 中文：清除条目计时器、推进代次并取消读取，再从缓存移除；旧 Promise 即使完成也不能重新登记条目。
   * English: Clear the entry timer, advance generation, abort its read and remove it; even a completing old promise cannot re-register the entry.
   * 中文：输入：entry：缓存中当前处理的共享资源条目
   * English: Inputs: entry: shared resource-cache entry being processed
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  private forget(entry: Entry) {
    clearTimeout(entry.timer); entry.generation++; entry.abort?.abort();
    this.entries.delete(entry.key);
  }
  /**
   * 中文：从正数订阅间隔取最小值；零表示仅按失效刷新，不参与周期最小值计算。
   * English: Choose the smallest positive observer interval; zero means invalidation-only refresh and does not enter periodic minimum calculation.
   * 中文：输入：entry：缓存中当前处理的共享资源条目
   * English: Inputs: entry: shared resource-cache entry being processed
   */
  private interval(entry: Entry) {
    const intervals = [...entry.listeners.values()].filter(value => value > 0);
    return intervals.length ? Math.min(...intervals) : 0;
  }
  /**
   * 中文：为闲置缓存安排保留期淘汰，为可见且无在途读取的活动缓存安排刷新。脏数据立即刷新；没有轮询间隔时只响应失效事件。
   * English: Schedule retained-cache expiry when idle and refresh active visible entries only when no read is in flight. Dirty data refreshes immediately; entries without a polling interval refresh through invalidation events.
   * 中文：输入：entry：缓存中当前处理的共享资源条目
   * English: Inputs: entry: shared resource-cache entry being processed
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  private arm(entry: Entry) {
    clearTimeout(entry.timer); entry.timer = undefined;
    if (!entry.listeners.size) {
      entry.timer = setTimeout(() => this.forget(entry), this.retainedMs);
      return;
    }
    if (!this.visible || entry.pending) return;
    const interval = this.interval(entry);
    if (entry.dirty || interval) entry.timer = setTimeout(() => { void this.load(entry); }, entry.dirty ? 0 : interval);
  }
  // 每个条目同时只有一次读取。失效可以让正在进行的请求自然结束，代次检查负责拒绝其结果，随后重读。
  /**
   * 中文：合并同一条目的并发读取，发出 15 秒超时 GET；只有代次仍相同且未取消的结果才发布。失效后旧响应丢弃，finally 释放正在读取标记并安排脏数据或轮询的下一次读取。
   * English: Coalesce concurrent reads of one entry into a GET with a 15-second lifetime. Publish only results from the current, un-aborted generation. Discard stale replies, then clear the pending read and re-arm dirty/polling work in finally.
   * 中文：输入：entry：缓存中当前处理的共享资源条目
   * English: Inputs: entry: shared resource-cache entry being processed
   */
  private load(entry: Entry) {
    if (entry.pending || !entry.listeners.size || !this.visible) return entry.pending || Promise.resolve();
    const generation = entry.generation;
    entry.dirty = false;
    const abort = entry.abort = new AbortController();
    // Each read has one bounded lifetime shared by all observers of that key.
    const timeout = setTimeout(/** 中文：在按访问能力、完整 URL 与权限代次共享读取和轮询流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Sharing reads and polling by access capability, complete URL and authority generation, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation */ () => abort.abort(new Error('资源读取超时')), 15000);
    this.emit(entry, { loading: true });
    const pending = Promise.resolve().then(() => entry.request(entry.path, 'GET', undefined, abort.signal))
      .then(data => {
        if (generation === entry.generation && !abort.signal.aborted)
          this.emit(entry, { data: shareJson(entry.snapshot.data, data), error: '', loading: false, updatedAt: Date.now() });
      }, error => {
        if (generation === entry.generation && entry.listeners.size)
          this.emit(entry, { error: (abort.signal.reason as Error)?.message || (error as Error).message, loading: false });
      }).finally(() => {
        clearTimeout(timeout);
        if (entry.pending === pending) { entry.pending = undefined; entry.abort = undefined; }
        if (this.entries.get(entry.key) === entry) this.arm(entry);
      });
    entry.pending = pending;
    return pending;
  }
  // 活跃订阅不参与容量淘汰；离开最后一个观察者时取消读取，并短暂保留旧数据供重新挂载。
  /**
   * 中文：订阅共享资源并立即交付已有快照；各订阅的最短正间隔控制轮询。达到容量时仅淘汰闲置条目；活动条目满则拒绝。返回幂等退订函数，最后退订取消读取并保留短期缓存。
   * English: Subscribe to a shared resource and immediately deliver its existing snapshot. The shortest positive observer interval controls polling. Evict only idle entries at capacity; reject if all entries are active. Return an idempotent unsubscribe that cancels the last read and retains a short-lived cache.
   * 中文：输入：request：带身份和权限作用域的传输能力；path：目标文件或请求路径；listener：本订阅的变化观察者；interval：刷新间隔，零表示按失效事件更新（缺省 5000）
   * English: Inputs: request: transport capability bound to identity/authority scope; path: target file/request path; listener: change observer for this subscription; interval: refresh interval; zero means invalidation-driven updates (default 5000)
   * 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用
   * English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary
   * 中文：拒绝原因：Invalid resource refresh interval；活动资源订阅已达到上限。这些错误交给直接调用者或本函数 catch 处理
   * English: Refusal reasons: Invalid resource refresh interval; 活动资源订阅已达到上限. These errors reach the direct caller or this function's catch handler
   */
  watch<T>(request: ResourceRequest, path: string, listener: /** 中文：接收所属状态或资源变化，保持回调作用域与订阅一致；这是 ResourceCache.watch 的调用契约 | English: Receive owned state/resource changes within the subscription scope; this is the callable contract of ResourceCache.watch | 中文：输入：snapshot：签名所示 ResourceSnapshot<T> 业务值 | English: Inputs: snapshot: the ResourceSnapshot<T> domain value in the signature | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (snapshot: ResourceSnapshot<T>) => void, interval = 5000) {
    if (!Number.isFinite(interval) || interval < 0) throw new RangeError('Invalid resource refresh interval');
    const key = this.key(request, path);
    let entry = this.entries.get(key);
    if (!entry) {
      while (this.entries.size >= this.limit) {
        const idle = [...this.entries.values()].find(value => !value.listeners.size);
        if (!idle) throw new Error('活动资源订阅已达到上限');
        this.forget(idle);
      }
      entry = { key, path, request, scopes: this.scopes(request, path), snapshot: { data: null, error: '', loading: false },
        generation: 0, dirty: true, listeners: new Map() };
      this.entries.set(key, entry);
    }
    const current = entry, callback = listener as Listener;
    clearTimeout(current.timer); current.timer = undefined;
    current.listeners.set(callback, interval);
    callback(current.snapshot);
    if (!current.snapshot.updatedAt || (interval && Date.now() - current.snapshot.updatedAt >= interval)) current.dirty = true;
    if (current.dirty) void this.load(current); else this.arm(current);
    let closed = false;
    /**
     * 中文：在按访问能力、完整 URL 与权限代次共享读取和轮询流程中删除匹配条目，取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Sharing reads and polling by access capability, complete URL and authority generation, delete matching entries, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      if (closed) return; closed = true;
      current.listeners.delete(callback);
      if (!current.listeners.size) {
        current.generation++; current.dirty = true; current.abort?.abort();
        current.snapshot = { ...current.snapshot, loading: false };
      }
      this.arm(current);
    };
  }
  /**
   * 中文：标记匹配能力/路径为脏并提高条目代次；不重放写入，也不让已经发出的旧读取覆盖随后确认的状态。
   * English: Mark matching capabilities/paths dirty and advance entry generations. Do not replay mutations or allow already-issued old reads to replace subsequently confirmed state.
   * 中文：输入：request：带身份和权限作用域的传输能力；path：目标文件或请求路径
   * English: Inputs: request: transport capability bound to identity/authority scope; path: target file/request path
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  invalidate(request?: ResourceRequest, path?: string) {
    for (const entry of this.entries.values()) {
      if (request && entry.request !== request || path && entry.path !== path) continue;
      entry.generation++; entry.dirty = true; this.arm(entry);
    }
  }
  // 事件资源路径匹配整段前缀，避免 /vms/a 的变化误失效 /vms/ab；查询字符串仍属于缓存键。
  /**
   * 中文：用去查询后的路径按精确值或目录前缀匹配事件资源，星号匹配全部；推进匹配条目代次并安排重读。
   * English: Match event resources by query-free exact path/directory prefix, with wildcard matching all; advance matching generations and schedule rereads.
   * 中文：输入：paths：待匹配或使其失效的资源路径集合
   * English: Inputs: paths: resource paths to match/invalidate
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  invalidateResources(paths: string[]) {
    for (const entry of this.entries.values()) {
      const path = entry.path.split('?')[0];
      if (!paths.some(prefix => prefix === '*' || path === prefix || path.startsWith(prefix + '/'))) continue;
      entry.generation++; entry.dirty = true; this.arm(entry);
    }
  }
  /**
   * 中文：把成功写入映射到实例或顶层资源以及任务/事件/系统失效，另使实例列表失效，避免详情更新后列表仍显示旧状态。
   * English: Map successful mutations to VM/top-level resources and job/event/system invalidations, also invalidating the VM list so details cannot update while the list stays stale.
   * 中文：输入：path：目标文件或请求路径
   * English: Inputs: path: target file/request path
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  mutation(path: string) {
    const segments = path.split('?')[0].split('/').filter(Boolean);
    this.invalidateResources(segments[0] === 'vms' && segments[1]
      ? [`/vms/${segments[1]}`, '/jobs', '/events', '/system'] : [`/${segments[0]}`, '/jobs', '/events']);
    // Lists also reflect mutations of their individual resources.
    for (const entry of this.entries.values()) if (entry.path.split('?')[0] === '/vms') {
      entry.generation++; entry.dirty = true; this.arm(entry);
    }
  }
  /**
   * 中文：推进全局代次并撤销每个条目旧读取，清空数据/错误/时间戳后安排可见订阅刷新；保留订阅关系。
   * English: Advance global generation, abort old entry reads, clear data/error/timestamps and schedule visible subscriptions to refresh while retaining observers.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  reset() {
    this.resetGeneration++;
    for (const entry of this.entries.values()) {
      entry.generation++; entry.dirty = true; entry.abort?.abort();
      this.emit(entry, { data: null, error: '', loading: false, updatedAt: undefined });
      this.arm(entry);
    }
  }
  // 插件撤权仅清空所属作用域；请求级能力身份和路由归属均可触发失效。
  /**
   * 中文：提高所选插件作用域代次并清空其缓存、错误和时间戳，取消旧读取；其他插件订阅继续工作。作用域同时来自请求能力和路径归属。
   * English: Advance selected plugin-scope generations, clear their data/errors/timestamps and cancel old reads while leaving other scopes running. Scopes come from both request authority and route ownership.
   * 中文：输入：identities：待撤销的插件安装身份集合
   * English: Inputs: identities: plugin installation identities to revoke
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  resetScopes(identities: readonly string[]) {
    const scopes = new Set(identities);
    for (const identity of scopes) this.scopeGenerations.set(identity, (this.scopeGenerations.get(identity) || 0) + 1);
    for (const entry of this.entries.values()) {
      if (!entry.scopes.some(identity => scopes.has(identity))) continue;
      entry.generation++; entry.dirty = true; entry.abort?.abort();
      this.emit(entry, { data: null, error: '', loading: false, updatedAt: undefined });
      this.arm(entry);
    }
  }
  // 隐藏页面停止安排轮询；重新可见时提高代次并标记脏数据，确保返回页面后重新核对。
  /**
   * 中文：仅处理可见性变化；恢复时推进条目代次并标脏，隐藏时撤销调度计时器，避免后台轮询积累。
   * English: Handle visibility changes only; on return advance entry generations/mark dirty, and while hidden cancel scheduled timers to avoid background polling buildup.
   * 中文：输入：visible：签名所示 boolean 业务值
   * English: Inputs: visible: the boolean domain value in the signature
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible;
    for (const entry of this.entries.values()) {
      if (visible) { entry.generation++; entry.dirty = true; }
      this.arm(entry);
    }
  }
  /**
   * 中文：通过统一 forget 路径取消并移除所有条目，释放读取和计时器。
   * English: Cancel/remove every entry through forget, releasing reads and timers.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  close() { for (const entry of [...this.entries.values()]) this.forget(entry); }
}

export const resourceCache = new ResourceCache();
pluginGeneration.subscribe(identities => resourceCache.resetScopes(identities));
