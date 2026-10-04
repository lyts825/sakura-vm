import { AppError } from '../shared/errors.ts';
import type { PluginManifest } from '../shared/plugin-protocol.ts';
import type { ServiceRef } from './service-ref.ts';
import { serviceRef } from './service-ref.ts';
import type { PluginInstance } from './plugin-instance.ts';
import type { PluginDirectory } from './plugin-directory.ts';
import { withPluginAuthority, withPluginCleanup } from './plugin-authority.ts';
import { resourceContext, withResourceContext } from './host-runtime/context.ts';
import { isVmLiveView } from './vm-reference.ts';
import { cleanupReceipt, isCleanupReceipt } from './cleanup-receipt.ts';
import { PUBLIC_SERVICE_MEMBERS } from './public-service-members.ts';

type Registration = { instance: PluginInstance; version: number; value: unknown };
const serviceRefForSystem = <T>(id: string) => serviceRef<T>(id, 'service');
const hidden = new Set(['constructor', '__proto__', 'prototype', 'machines', 'engine', 'options']);
const lifecycle = new Set(['init', 'close', 'file', 'dataFile']);
// A handle forwarded by another provider remains executable and keeps its original checks.
const publicHandles = new WeakMap<object, readonly string[]>();
function executable(value: any, seen = new WeakSet<object>()): boolean {
  if (typeof value === 'function') return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  if (value instanceof AbortSignal || isVmLiveView(value)) return false;
  if (publicHandles.has(value)) return true;
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) return true;
  return Object.values(value).some((item) => executable(item, seen));
}
/** References are bound to two exact activations, including nested methods and cached callbacks. */
export class ServiceBroker {
  private registrations = new Map<string, Registration>();
  private borrows = new Map<PluginInstance, number>();
  private originals = new WeakMap<object, object>();
  private handles = new WeakMap<PluginInstance, Map<Registration, unknown>>();
  constructor(
    private directory: PluginDirectory,
    private catalog: readonly PluginManifest[],
  ) {}
  registerSystem<T>(instance: PluginInstance, value: T) {
    instance.check(undefined, true);
    if (instance.source !== 'system') throw new Error('系统服务身份无效');
    this.registrations.set(`${instance.identity}/service`, { instance, version: 1, value });
  }
  system<T>(consumer: PluginInstance, id: string, allowed: readonly string[]): T | undefined {
    consumer.check('services', true);
    if (!allowed.includes(id))
      throw new AppError('未声明系统服务依赖：' + id, 403, 'PLUGIN_DEPENDENCY_DENIED');
    return this.handle(consumer, serviceRefForSystem(id), true, 'system');
  }
  register<T>(instance: PluginInstance, reference: ServiceRef<T>, value: T) {
    instance.check(undefined, true);
    const key = reference.key;
    if (reference.pluginId !== instance.pluginId)
      throw new Error(`插件 ${instance.pluginId} 不能注册其他提供者的服务：${reference.pluginId}`);
    const manifest = this.catalog.find((item) => item.id === instance.pluginId);
    if (!manifest?.services.includes(key))
      throw new Error(`插件 ${instance.pluginId} 不能注册非自有服务：${key}`);
    const id = `${instance.identity}/${key}`;
    if (this.registrations.has(id)) throw new Error(`插件服务已注册：${key}`);
    this.registrations.set(id, {
      instance,
      value: this.unwrap(value),
      version: reference.version,
    });
    return value;
  }
  lookup<T>(
    consumer: PluginInstance,
    manifest: PluginManifest,
    reference: ServiceRef<T>,
    optional = false,
  ): T | undefined {
    consumer.check(undefined, true);
    const dependency = [...manifest.requires, ...manifest.optional].find(
      (item) => item.id === reference.pluginId,
    );
    if (reference.pluginId !== consumer.pluginId && !dependency)
      throw new Error(`插件 ${consumer.pluginId} 未声明依赖 ${reference.pluginId}`);
    if (!this.catalog.some((item) => item.id === reference.pluginId && item.services.includes(reference.key)))
      throw new Error(`插件 ${reference.pluginId} 未声明服务：${reference.key}`);
    return this.handle(consumer, reference, optional, 'official', dependency?.version);
  }
  private handle<T>(
    consumer: PluginInstance,
    reference: ServiceRef<T>,
    optional: boolean,
    source: 'official' | 'system',
    dependencyVersion?: string,
  ): T | undefined {
    const provider = this.directory.get(source, reference.pluginId);
    const entry = provider && this.registrations.get(`${provider.identity}/${reference.key}`);
    if (!entry || (provider !== consumer && provider.phase !== 'running')) {
      if (optional) return undefined;
      throw new AppError(
        `插件服务未运行：${reference.pluginId}.${reference.key}`,
        403,
        'PLUGIN_SERVICE_UNAVAILABLE',
      );
    }
    if (entry.version !== reference.version || (dependencyVersion && dependencyVersion !== provider!.version))
      throw new AppError('插件服务版本不兼容', 409, 'PLUGIN_SERVICE_VERSION');
    const check = () => {
      consumer.check('services', true);
      provider!.check(undefined, provider === consumer);
      if (
        this.directory.get(source, reference.pluginId) !== provider ||
        this.registrations.get(`${provider!.identity}/${reference.key}`) !== entry
      )
        throw new AppError('插件服务代次已改变', 403, 'PLUGIN_REVOKED');
    };
    let cache = this.handles.get(consumer);
    if (!cache) this.handles.set(consumer, (cache = new Map()));
    if (cache.has(entry)) return cache.get(entry) as T;
    const wrappers = new WeakMap<object, any>(),
      promises = new WeakMap<Promise<unknown>, Promise<unknown>>(),
      receipts = new WeakMap<Function, () => void | Promise<void>>();
    const observe = <R>(operation: Promise<R>): Promise<R> => {
      this.borrows.set(provider!, (this.borrows.get(provider!) || 0) + 1);
      const pending = operation.finally(() => {
        const left = (this.borrows.get(provider!) || 1) - 1;
        if (left) this.borrows.set(provider!, left);
        else this.borrows.delete(provider!);
      });
      consumer.scope.observe(pending);
      provider!.scope.observe(pending);
      return pending;
    };
    const receipt = (work: () => unknown) => {
      const existing = receipts.get(work);
      if (existing) return existing;
      let closed = false;
      let pending: Promise<void> | undefined;
      const failures = new Set<unknown>();
      const confirmations: ((error: unknown) => void)[] = [];
      const confirm = () => {
        closed = true;
        for (const error of failures) for (const confirmed of confirmations) confirmed(error);
        failures.clear();
      };
      const unregister = cleanupReceipt(() => {
        if (closed) return;
        if (pending) return pending;
        let completed: unknown;
        try {
          completed = withPluginCleanup(provider!, work);
        } catch (error) {
          failures.add(error);
          throw error;
        }
        if (!(completed instanceof Promise)) {
          confirm();
          return;
        }
        pending = observe(
          completed.then(confirm, (error) => {
            failures.add(error);
            pending = undefined;
            throw error;
          }),
        );
        return pending;
      });
      receipts.set(work, unregister);
      const revoke = () => {
        try {
          void Promise.resolve(unregister()).catch(() => {});
        } catch {
          /* Both original scopes retain the receipt for recovery. */
        }
      };
      confirmations.push(
        consumer.scope.retainCleanup(async () => {
          await unregister();
        }),
      );
      if (provider !== consumer)
        confirmations.push(
          provider!.scope.retainCleanup(async () => {
            await unregister();
          }),
        );
      consumer.signal.addEventListener('abort', revoke, { once: true });
      if (provider !== consumer) provider!.signal.addEventListener('abort', revoke, { once: true });
      if (consumer.signal.aborted || provider!.signal.aborted) revoke();
      return unregister;
    };
    const invoke = (callable: Function, receiver: unknown, args: unknown[]) => {
      check();
      const before = resourceContext();
      const forwarded = args.map((arg) =>
        typeof arg === 'function'
          ? (...input: unknown[]) =>
              withPluginAuthority(consumer, () => Reflect.apply(arg, undefined, input), check)
          : arg,
      );
      return wrap(
        withPluginAuthority(
          provider!,
          () =>
            withResourceContext(
              {
                callerPluginInstanceId: before?.callerPluginInstanceId || consumer.identity,
                callerPluginGeneration: before?.callerPluginGeneration || consumer.generation,
                actorId: before?.actorId,
                vmId: before?.vmId,
                projectId: before?.projectId,
              },
              () => Reflect.apply(callable, receiver, forwarded),
            ),
          check,
        ),
      );
    };
    const wrap = (value: any): any => {
      if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
      if (isCleanupReceipt(value)) return receipt(value);
      if (value instanceof Promise) {
        if (!promises.has(value)) promises.set(value, observe(value.then(wrap)));
        return promises.get(value);
      }
      if (Array.isArray(value)) return value.map(wrap);
      if (
        value instanceof Date ||
        ArrayBuffer.isView(value) ||
        value instanceof Error ||
        value instanceof AbortSignal ||
        isVmLiveView(value)
      )
        return value;
      // Data responses have no executable authority. Class instances and capability objects do.
      if (
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
        !publicHandles.has(value) &&
        !executable(value)
      ) {
        const copy: Record<PropertyKey, unknown> = Object.create(Object.getPrototypeOf(value));
        for (const key of Reflect.ownKeys(value))
          Object.defineProperty(copy, key, {
            value: wrap(Reflect.get(value, key)),
            enumerable: Object.getOwnPropertyDescriptor(value, key)?.enumerable,
            writable: true,
            configurable: true,
          });
        return copy;
      }
      if (wrappers.has(value)) return wrappers.get(value);
      if (typeof value === 'function') {
        const callable = (...args: unknown[]) => invoke(value, undefined, args);
        wrappers.set(value, callable);
        return callable;
      }
      const prototype = Object.getPrototypeOf(value);
      const publicKeys =
        publicHandles.get(value) ||
        (prototype === Object.prototype || prototype === null
          ? Object.keys(value)
          : PUBLIC_SERVICE_MEMBERS[prototype.constructor?.name] || []);
      const keys = new Set(publicKeys);
      const proxy = new Proxy(Object.create(null), {
        get: (_target, key) => {
          if (key === 'then' && !keys.has('then')) return undefined;
          if (
            typeof key === 'string' &&
            (hidden.has(key) ||
              !keys.has(key) ||
              (lifecycle.has(key) && provider !== consumer && consumer.identity !== 'system:operation-host'))
          )
            throw new AppError('服务内部实现不可访问', 403, 'PLUGIN_SERVICE_PRIVATE');
          const member = Reflect.get(value, key, value);
          if (isCleanupReceipt(member)) return member;
          check();
          if (typeof member !== 'function') return wrap(member);
          return (...args: unknown[]) => invoke(member, value, args);
        },
        set: () => {
          throw new AppError('公共服务接口不可写', 403, 'PLUGIN_SERVICE_READONLY');
        },
        defineProperty: () => false,
        deleteProperty: () => false,
      });
      wrappers.set(value, proxy);
      publicHandles.set(proxy, publicKeys);
      this.originals.set(proxy, value);
      return proxy;
    };
    const handle = wrap(entry.value) as T;
    cache.set(entry, handle);
    return handle;
  }
  activeBorrows(instance: PluginInstance) {
    return this.borrows.get(instance) || 0;
  }
  unwrap<T>(value: T): T {
    return (
      value && (typeof value === 'object' || typeof value === 'function')
        ? this.originals.get(value as object) || value
        : value
    ) as T;
  }
  remove(instance: PluginInstance) {
    for (const [key, entry] of this.registrations)
      if (entry.instance === instance) this.registrations.delete(key);
  }
}
