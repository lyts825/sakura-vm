export type ResourceRequest = <T = any>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
export type ResourceSnapshot<T = unknown> = { data: T | null; error: string; loading: boolean; updatedAt?: number };
type Listener = (snapshot: ResourceSnapshot) => void;
type Entry = {
  key: string; path: string; request: ResourceRequest; snapshot: ResourceSnapshot;
  listeners: Map<Listener, number>; generation: number; dirty: boolean;
  pending?: Promise<void>; abort?: AbortController; timer?: ReturnType<typeof setTimeout>;
};

/** Keep equal JSON subtrees stable across polling and mutation reconciliation.
 * Form effects must not mistake an unchanged server reply for a new saved draft. */
function shareJson(previous: unknown, incoming: unknown): unknown {
  let remaining = 20000;
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
  constructor(private readonly limit = 256, private readonly retainedMs = 60000) {}
  get generation() { return this.resetGeneration; }
  private key(request: ResourceRequest, path: string) {
    let id = this.identities.get(request);
    if (id === undefined) { id = ++this.sequence; this.identities.set(request, id); }
    return `${id}:${path}`;
  }
  private emit(entry: Entry, update: Partial<ResourceSnapshot>) {
    entry.snapshot = { ...entry.snapshot, ...update };
    for (const listener of entry.listeners.keys()) listener(entry.snapshot);
  }
  private forget(entry: Entry) {
    clearTimeout(entry.timer); entry.generation++; entry.abort?.abort();
    this.entries.delete(entry.key);
  }
  private interval(entry: Entry) {
    const intervals = [...entry.listeners.values()].filter(value => value > 0);
    return intervals.length ? Math.min(...intervals) : 0;
  }
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
  private load(entry: Entry) {
    if (entry.pending || !entry.listeners.size || !this.visible) return entry.pending || Promise.resolve();
    const generation = entry.generation;
    entry.dirty = false;
    const abort = entry.abort = new AbortController();
    // Each read has one bounded lifetime shared by all observers of that key.
    const timeout = setTimeout(() => abort.abort(new Error('资源读取超时')), 15000);
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
  watch<T>(request: ResourceRequest, path: string, listener: (snapshot: ResourceSnapshot<T>) => void, interval = 5000) {
    if (!Number.isFinite(interval) || interval < 0) throw new RangeError('Invalid resource refresh interval');
    const key = this.key(request, path);
    let entry = this.entries.get(key);
    if (!entry) {
      while (this.entries.size >= this.limit) {
        const idle = [...this.entries.values()].find(value => !value.listeners.size);
        if (!idle) throw new Error('活动资源订阅已达到上限');
        this.forget(idle);
      }
      entry = { key, path, request, snapshot: { data: null, error: '', loading: false },
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
  invalidate(request?: ResourceRequest, path?: string) {
    for (const entry of this.entries.values()) {
      if (request && entry.request !== request || path && entry.path !== path) continue;
      entry.generation++; entry.dirty = true; this.arm(entry);
    }
  }
  invalidateResources(paths: string[]) {
    for (const entry of this.entries.values()) {
      const path = entry.path.split('?')[0];
      if (!paths.some(prefix => prefix === '*' || path === prefix || path.startsWith(prefix + '/'))) continue;
      entry.generation++; entry.dirty = true; this.arm(entry);
    }
  }
  mutation(path: string) {
    const segments = path.split('?')[0].split('/').filter(Boolean);
    this.invalidateResources(segments[0] === 'vms' && segments[1]
      ? [`/vms/${segments[1]}`, '/jobs', '/events', '/system'] : [`/${segments[0]}`, '/jobs', '/events']);
    // Lists also reflect mutations of their individual resources.
    for (const entry of this.entries.values()) if (entry.path.split('?')[0] === '/vms') {
      entry.generation++; entry.dirty = true; this.arm(entry);
    }
  }
  reset() {
    this.resetGeneration++;
    for (const entry of this.entries.values()) {
      entry.generation++; entry.dirty = true; entry.abort?.abort();
      this.emit(entry, { data: null, error: '', loading: false, updatedAt: undefined });
      this.arm(entry);
    }
  }
  setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible;
    for (const entry of this.entries.values()) {
      if (visible) { entry.generation++; entry.dirty = true; }
      this.arm(entry);
    }
  }
  close() { for (const entry of [...this.entries.values()]) this.forget(entry); }
}

export const resourceCache = new ResourceCache();
