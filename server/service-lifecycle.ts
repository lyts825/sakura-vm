import { AppError } from '../shared/errors.ts';

export type ServiceDefinition<T> = {
  id: string;
  requires: readonly string[];
  /** Callbacks used only while application admission is open; drained before disposal. */
  lateRequires?: readonly string[];
  /** Dependencies still used by already admitted work or its cleanup during drain. */
  disposeRequires?: readonly string[];
  create: () => T | Promise<T>;
  initialize: (value: T) => void | Promise<void>;
  dispose: (value: T | undefined) => void | Promise<void>;
  /** Orders independent services only; dependencies always outlive consumers. */
  disposePhase?: number;
};
type Entry = {
  definition: ServiceDefinition<any>;
  state: 'registered' | 'initializing' | 'ready' | 'failed' | 'disposing' | 'cleanup-pending' | 'disposed';
  value?: unknown;
  pending?: Promise<unknown>;
  attempted: boolean;
};

/** Explicit startup graph. A constructor returning is not a readiness signal. */
export class ServiceLifecycle {
  private entries = new Map<string, Entry>();
  private external = new Set<string>();
  private closing?: Promise<void>;
  private draining = false;
  get accepting() {
    return !this.draining;
  }

  ready(id: string) {
    if (this.draining || this.entries.has(id) || this.external.has(id))
      throw new AppError('重复或已关闭的外部就绪阶段：' + id, 409, 'SERVICE_STAGE_INVALID');
    this.external.add(id);
  }
  register<T>(definition: ServiceDefinition<T>) {
    if (this.draining || this.entries.has(definition.id) || this.external.has(definition.id))
      throw new AppError('重复或已关闭的服务声明：' + definition.id, 409, 'SERVICE_DECLARATION_INVALID');
    if (
      !definition.id ||
      !Array.isArray(definition.requires) ||
      (definition.lateRequires !== undefined && !Array.isArray(definition.lateRequires)) ||
      (definition.disposeRequires !== undefined && !Array.isArray(definition.disposeRequires)) ||
      [...definition.requires, ...(definition.lateRequires || []), ...(definition.disposeRequires || [])]
        .some(id => typeof id !== 'string' || !id) ||
      !['create', 'initialize', 'dispose'].every(
        (key) => typeof definition[key as keyof typeof definition] === 'function',
      )
    )
      throw new AppError('服务生命周期声明不完整', 400, 'SERVICE_DECLARATION_INVALID');
    this.entries.set(definition.id, { definition: { ...definition,
      requires: Object.freeze([...new Set(definition.requires)]),
      lateRequires: Object.freeze([...new Set(definition.lateRequires || [])]),
      disposeRequires: Object.freeze([...new Set(definition.disposeRequires || [])]),
    }, state: 'registered', attempted: false });
  }
  validate() {
    const visited = new Set<string>(),
      active = new Set<string>();
    const visit = (id: string, path: string[]) => {
      if (this.external.has(id) || visited.has(id)) return;
      const entry = this.entries.get(id);
      if (!entry)
        throw new AppError(
          '服务依赖未声明或未就绪：' + [...path, id].join(' → '),
          503,
          'SERVICE_DEPENDENCY_MISSING',
        );
      if (active.has(id))
        throw new AppError('服务依赖形成循环：' + [...path, id].join(' → '), 409, 'SERVICE_DEPENDENCY_CYCLE');
      active.add(id);
      for (const dependency of entry.definition.requires) visit(dependency, [...path, id]);
      active.delete(id);
      visited.add(id);
    };
    for (const id of this.entries.keys()) visit(id, []);
  }
  async start<T>(id: string): Promise<T> {
    if (this.draining) throw new AppError('服务管理层正在关闭', 503, 'SERVICE_DRAINING');
    this.validate();
    const entry = this.entries.get(id);
    if (!entry) throw new AppError('未知服务：' + id, 404, 'SERVICE_UNKNOWN');
    if (entry.state === 'ready') return entry.value as T;
    if (entry.pending) return entry.pending as Promise<T>;
    if (entry.state !== 'registered')
      throw new AppError('服务启动失败，需先确认清理：' + id, 503, 'SERVICE_NOT_READY');
    const pending = Promise.resolve().then(async () => {
      for (const dependency of entry.definition.requires) {
        if (!this.external.has(dependency)) await this.start(dependency);
      }
      if (this.draining) throw new AppError('服务管理层正在关闭', 503, 'SERVICE_DRAINING');
      entry.state = 'initializing';
      entry.attempted = true;
      try {
        entry.value = await entry.definition.create();
        await entry.definition.initialize(entry.value);
        if (this.draining) throw new AppError('初始化期间服务已关闭', 503, 'SERVICE_DRAINING');
        entry.state = 'ready';
        return entry.value;
      } catch (error) {
        entry.state = 'failed';
        throw error;
      }
    });
    entry.pending = pending;
    try {
      return (await pending) as T;
    } finally {
      entry.pending = undefined;
    }
  }
  /** Admission opens only after every early and deferred dependency is ready. */
  validateReady() {
    if (this.draining) throw new AppError('服务管理层正在关闭', 503, 'SERVICE_DRAINING');
    this.validate();
    for (const [id, entry] of this.entries) {
      if (entry.state !== 'ready')
        throw new AppError('服务尚未就绪：' + id, 503, 'SERVICE_NOT_READY');
      for (const dependency of [...entry.definition.requires, ...(entry.definition.lateRequires || []),
        ...(entry.definition.disposeRequires || [])])
        if (!this.external.has(dependency) && this.entries.get(dependency)?.state !== 'ready')
          throw new AppError('延迟服务依赖尚未就绪：' + id + ' → ' + dependency, 503, 'SERVICE_NOT_READY');
    }
    const visited = new Set<string>(), active = new Set<string>();
    const visit = (id: string) => {
      if (this.external.has(id) || visited.has(id)) return;
      if (active.has(id)) throw new AppError('服务清理依赖形成循环：' + id, 409, 'SERVICE_DISPOSE_DEPENDENCY_CYCLE');
      active.add(id);
      const definition = this.entries.get(id)!.definition;
      for (const dependency of [...definition.requires, ...(definition.disposeRequires || [])]) visit(dependency);
      active.delete(id); visited.add(id);
    };
    for (const id of this.entries.keys()) visit(id);
  }
  async startAll() {
    this.validate();
    try {
      for (const id of this.entries.keys()) await this.start(id);
      this.validateReady();
    } catch (error) {
      try {
        await this.close();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], '服务启动及清理失败');
      }
      throw error;
    }
  }
  view() {
    return [...this.entries].map(([id, entry]) => ({
      id,
      state: entry.state,
      requires: [...entry.definition.requires],
      lateRequires: [...(entry.definition.lateRequires || [])],
      disposeRequires: [...(entry.definition.disposeRequires || [])],
    }));
  }
  /** The owning scope has confirmed disposal, including an explicit recovery outside close(). */
  confirmDisposed(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.state = 'disposed';
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.draining = true;
    const pending = Promise.resolve().then(async () => {
      await Promise.allSettled(
        [...this.entries.values()].flatMap((entry) => (entry.pending ? [entry.pending] : [])),
      );
      const remaining = new Set(
        [...this.entries]
          .filter(([, entry]) => entry.attempted && entry.state !== 'disposed')
          .map(([id]) => id),
      );
      const failures: unknown[] = [],
        failed = new Set<string>();
      while (remaining.size) {
        const next = [...remaining]
          .filter(
            (id) =>
              !failed.has(id) &&
              ![...remaining].some(
                (other) => other !== id && [
                  ...this.entries.get(other)!.definition.requires,
                  ...(this.entries.get(other)!.definition.disposeRequires || []),
                ].includes(id),
              ),
          )
          .sort(
            (a, b) =>
              (this.entries.get(a)!.definition.disposePhase ?? 0) -
              (this.entries.get(b)!.definition.disposePhase ?? 0),
          )[0];
        if (!next) break;
        const entry = this.entries.get(next)!;
        entry.state = 'disposing';
        try {
          await entry.definition.dispose(entry.value);
          entry.state = 'disposed';
          remaining.delete(next);
        } catch (error) {
          entry.state = 'cleanup-pending';
          failed.add(next);
          failures.push(error);
        }
      }
      if (remaining.size)
        throw new AggregateError(failures, '服务清理未确认，保留依赖：' + [...remaining].join(', '));
    });
    this.closing = pending;
    void pending.catch(() => {
      if (this.closing === pending) this.closing = undefined;
    });
    return pending;
  }
}
