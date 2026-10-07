/**
 * 模块职责：按声明依赖装配和关闭服务，验证就绪状态并支持可降级服务启动及清理确认。
 */
import { AppError } from '../shared/errors.ts';

export type ServiceDependencyResolver = Readonly<{
  get<T = unknown>(id: string): T;
  late<T = unknown>(id: string): T;
  self<T = unknown>(): T;
}>;
export type ServiceDefinition<T> = {
  id: string;
  /** Required providers gate admission; degradable providers may remain unavailable after cleanup. */
  startup?: 'required' | 'degradable';
  requires: readonly string[];
  /** Callbacks used only while application admission is open; drained before disposal. */
  lateRequires?: readonly string[];
  /** Dependencies still used by already admitted work or its cleanup during drain. */
  disposeRequires?: readonly string[];
  create: (dependencies: ServiceDependencyResolver) => T | Promise<T>;
  initialize: (value: T, dependencies: ServiceDependencyResolver) => void | Promise<void>;
  dispose: (value: T | undefined, dependencies: ServiceDependencyResolver) => void | Promise<void>;
  /** Orders independent services only; dependencies always outlive consumers. */
  disposePhase?: number;
};
type Entry = {
  definition: ServiceDefinition<any>;
  state: 'registered' | 'initializing' | 'ready' | 'failed' | 'disposing' | 'cleanup-pending' | 'disposed';
  value?: unknown;
  pending?: Promise<unknown>;
  degradation?: Promise<unknown>;
  attempted: boolean;
  unavailable?: boolean;
  error?: unknown;
};

/** Explicit startup graph. A constructor returning is not a readiness signal. */
export class ServiceLifecycle {
  private entries = new Map<string, Entry>();
  private external = new Map<string, unknown>();
  private closing?: Promise<void>;
  private draining = false;
  get accepting() {
    return !this.draining;
  }

  ready(id: string, value?: unknown) {
    if (this.draining || this.entries.has(id) || this.external.has(id))
      throw new AppError('重复或已关闭的外部就绪阶段：' + id, 409, 'SERVICE_STAGE_INVALID');
    this.external.set(id, value);
  }
  register<T>(definition: ServiceDefinition<T>) {
    if (this.draining || this.entries.has(definition.id) || this.external.has(definition.id))
      throw new AppError('重复或已关闭的服务声明：' + definition.id, 409, 'SERVICE_DECLARATION_INVALID');
    if (
      !definition.id ||
      (definition.startup !== undefined && !['required', 'degradable'].includes(definition.startup)) ||
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
  /** Every lookup is tied to the frozen declaration and checks the live provider state. */
  dependencies(id: string): ServiceDependencyResolver {
    const entry = this.entries.get(id);
    if (!entry) throw new AppError('未知服务：' + id, 404, 'SERVICE_UNKNOWN');
    const resolve = (dependency: string, late: boolean) => {
      const definition = entry.definition;
      if (entry.state === 'registered' || entry.state === 'disposed')
        throw new AppError('依赖消费者尚未就绪或已关闭：' + id, 503, 'SERVICE_NOT_READY');
      const declared = late ? [...definition.requires, ...(definition.lateRequires || []),
        ...(definition.disposeRequires || [])] : definition.requires;
      if (!declared.includes(dependency))
        throw new AppError('未声明服务依赖：' + id + ' → ' + dependency, 403, 'SERVICE_DEPENDENCY_DENIED');
      if (late && entry.state !== 'ready' && entry.state !== 'disposing' && entry.state !== 'cleanup-pending')
        throw new AppError('延迟服务依赖只能由已就绪服务使用：' + id, 503, 'SERVICE_NOT_READY');
      if (this.draining && !definition.requires.includes(dependency) && !definition.disposeRequires?.includes(dependency))
        throw new AppError('入站延迟依赖已关闭：' + id + ' → ' + dependency, 503, 'SERVICE_DRAINING');
      if (this.external.has(dependency)) return this.external.get(dependency);
      const provider = this.entries.get(dependency);
      if (!provider || provider.state !== 'ready')
        throw new AppError('服务依赖尚未就绪：' + id + ' → ' + dependency, 503, 'SERVICE_NOT_READY');
      return provider.value;
    };
    return Object.freeze({
      get: <T>(dependency: string) => resolve(dependency, false) as T,
      late: <T>(dependency: string) => resolve(dependency, true) as T,
      self: <T>() => {
        if (entry.state !== 'ready') throw new AppError('服务尚未就绪：' + id, 503, 'SERVICE_NOT_READY');
        return entry.value as T;
      },
    });
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
      try {
        for (const dependency of entry.definition.requires) {
          if (!this.external.has(dependency)) await this.start(dependency);
        }
        if (this.draining) throw new AppError('服务管理层正在关闭', 503, 'SERVICE_DRAINING');
        entry.state = 'initializing';
        entry.attempted = true;
        const dependencies = this.dependencies(id);
        entry.value = await entry.definition.create(dependencies);
        await entry.definition.initialize(entry.value, dependencies);
        if (this.draining) throw new AppError('初始化期间服务已关闭', 503, 'SERVICE_DRAINING');
        entry.state = 'ready';
        return entry.value;
      } catch (error) {
        entry.state = 'failed';
        entry.error = error;
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
  /** Failed optional providers never publish readiness; their cleanup retains the original graph. */
  async startDegradable<T>(id: string): Promise<T | undefined> {
    if (this.draining) throw new AppError('服务管理层正在关闭', 503, 'SERVICE_DRAINING');
    const entry = this.entries.get(id);
    if (!entry || entry.definition.startup !== 'degradable')
      throw new AppError('服务未声明可降级：' + id, 409, 'SERVICE_DECLARATION_INVALID');
    if (entry.degradation) return entry.degradation as Promise<T | undefined>;
    if (entry.unavailable) return undefined;
    const pending = (async () => {
      try {
        return await this.start<T>(id);
      } catch (error) {
        if (this.draining || entry.state !== 'failed') throw error;
        entry.unavailable = true;
        if (entry.attempted) {
          entry.state = 'disposing';
          try {
            await entry.definition.dispose(entry.value, this.dependencies(id));
            entry.state = 'disposed';
          } catch (cleanup) {
            entry.state = 'cleanup-pending';
            entry.error = new AggregateError([error, cleanup], '附属服务启动失败且清理待确认：' + id);
          }
        }
        return undefined;
      }
    })();
    entry.degradation = pending;
    try { return await pending; }
    finally { entry.degradation = undefined; }
  }
  /** Every admitted consumer still requires all of its declared providers to be ready. */
  validateReady() {
    if (this.draining) throw new AppError('服务管理层正在关闭', 503, 'SERVICE_DRAINING');
    this.validate();
    for (const [id, entry] of this.entries) {
      if (entry.state !== 'ready' && entry.definition.startup === 'degradable' && entry.unavailable &&
          ['failed', 'disposed', 'cleanup-pending'].includes(entry.state)) {
        for (const dependency of [...entry.definition.requires, ...(entry.definition.lateRequires || []),
          ...(entry.definition.disposeRequires || [])])
          if (!this.external.has(dependency) && !this.entries.has(dependency))
            throw new AppError('服务依赖未声明：' + id + ' → ' + dependency, 503, 'SERVICE_DEPENDENCY_MISSING');
        continue;
      }
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
      for (const [id, entry] of this.entries)
        if (entry.definition.startup === 'degradable') await this.startDegradable(id);
        else await this.start(id);
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
      attempted: entry.attempted,
      startup: entry.definition.startup ?? 'required',
      unavailable: !!entry.unavailable,
      ...(entry.error !== undefined ? { error: String(entry.error) } : {}),
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
        [...this.entries.values()].flatMap(entry =>
          [entry.pending, entry.degradation].filter((pending): pending is Promise<unknown> => !!pending)),
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
          await entry.definition.dispose(entry.value, this.dependencies(next));
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
