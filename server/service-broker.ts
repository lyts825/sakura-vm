import { AppError } from '../shared/errors.ts';
import type { PluginManifest } from '../shared/plugin-protocol.ts';
import type { ServiceRef } from './service-ref.ts';
import type { PluginInstance } from './plugin-instance.ts';
import type { PluginDirectory } from './plugin-directory.ts';
import { withPluginAuthority } from './plugin-authority.ts';
import { resourceContext, withResourceContext } from './host-runtime/context.ts';
import { isVmLiveView } from './vm-reference.ts';

type Registration = { instance: PluginInstance; version: number; value: unknown };
const hidden = new Set(['constructor', '__proto__', 'prototype', 'machines', 'engine', 'options']);
const cleanupReturns = new Set(['onConfigChange', 'beforeConfigChange', 'beforeAction', 'enableBackground', 'onSwitch', 'guard', 'beforeSwitch', 'beforeChange']);
function executable(value: any, seen = new WeakSet<object>()): boolean {
  if (typeof value === 'function') return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  if (value instanceof AbortSignal || isVmLiveView(value)) return false;
  seen.add(value);
  if (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) return true;
  return Object.values(value).some(item => executable(item, seen));
}
/** References are bound to two exact activations, including nested methods and cached callbacks. */
export class ServiceBroker {
  private registrations = new Map<string, Registration>();
  private borrows = new Map<PluginInstance, number>();
  private originals = new WeakMap<object, object>();
  constructor(private directory: PluginDirectory, private catalog: readonly PluginManifest[]) {}
  register<T>(instance: PluginInstance, reference: ServiceRef<T> | string, value: T) {
    instance.check(undefined, true);
    const key = typeof reference === 'string' ? reference : reference.key;
    if (typeof reference !== 'string' && reference.pluginId !== instance.pluginId)
      throw new Error(`插件 ${instance.pluginId} 不能注册其他提供者的服务：${reference.pluginId}`);
    const manifest = this.catalog.find(item => item.id === instance.pluginId);
    if (!manifest?.services.includes(key)) throw new Error(`插件 ${instance.pluginId} 不能注册非自有服务：${key}`);
    const id = `${instance.identity}/${key}`;
    if (this.registrations.has(id)) throw new Error(`插件服务已注册：${key}`);
    this.registrations.set(id, { instance, value: this.unwrap(value), version: typeof reference === 'string' ? 1 : reference.version });
    return value;
  }
  lookup<T>(consumer: PluginInstance, manifest: PluginManifest, reference: ServiceRef<T>, optional = false): T | undefined {
    consumer.check(undefined, true);
    const dependency = [...manifest.requires, ...manifest.optional].find(item => item.id === reference.pluginId);
    if (reference.pluginId !== consumer.pluginId && !dependency)
      throw new Error(`插件 ${consumer.pluginId} 未声明依赖 ${reference.pluginId}`);
    if (!this.catalog.some(item => item.id === reference.pluginId && item.services.includes(reference.key)))
      throw new Error(`插件 ${reference.pluginId} 未声明服务：${reference.key}`);
    const provider = this.directory.get('official', reference.pluginId);
    const entry = provider && this.registrations.get(`${provider.identity}/${reference.key}`);
    if (!entry || provider !== consumer && provider.phase !== 'running') {
      if (optional) return undefined;
      throw new AppError(`插件服务未运行：${reference.pluginId}.${reference.key}`, 403, 'PLUGIN_SERVICE_UNAVAILABLE');
    }
    if (entry.version !== reference.version || dependency && dependency.version !== provider!.version)
      throw new AppError('插件服务版本不兼容', 409, 'PLUGIN_SERVICE_VERSION');
    const check = () => {
      consumer.check('services', true);
      provider!.check(undefined, provider === consumer);
      if (this.directory.get('official', reference.pluginId) !== provider ||
          this.registrations.get(`${provider!.identity}/${reference.key}`) !== entry)
        throw new AppError('插件服务代次已改变', 403, 'PLUGIN_REVOKED');
    };
    const wrappers = new WeakMap<object, any>();
    const wrap = (value: any): any => {
      if (value === null || typeof value !== 'object' && typeof value !== 'function') return value;
      if (value instanceof Promise) return value.then(wrap);
      if (Array.isArray(value) || value instanceof Date || ArrayBuffer.isView(value) || value instanceof Error || value instanceof AbortSignal || isVmLiveView(value)) return value;
      // Data responses have no executable authority. Class instances and capability objects do.
      if (Object.getPrototypeOf(value) === Object.prototype && !executable(value)) return value;
      if (typeof value === 'function') return (...args: unknown[]) => {
        check(); return withPluginAuthority(provider!, () => wrap(Reflect.apply(value, undefined, args)), check);
      };
      if (wrappers.has(value)) return wrappers.get(value);
      const proxy = new Proxy(Object.create(null), {
        get: (_target, key) => {
          check();
          if (typeof key === 'string' && hidden.has(key)) throw new AppError('服务内部实现不可访问', 403, 'PLUGIN_SERVICE_PRIVATE');
          const member = Reflect.get(value, key, value);
          if (typeof member !== 'function') return wrap(member);
          return (...args: unknown[]) => {
            check();
            const before = resourceContext();
            const forwarded = args.map(arg => typeof arg === 'function' ? (...input: unknown[]) =>
              withPluginAuthority(consumer, () => Reflect.apply(arg, undefined, input), check) : arg);
            const run = () => withPluginAuthority(provider!, () => withResourceContext({
              callerPluginInstanceId: consumer.identity, callerPluginGeneration: consumer.generation,
              actorId: before?.actorId, vmId: before?.vmId, projectId: before?.projectId,
            }, () => Reflect.apply(member, value, forwarded)), check);
            const result = run();
            if (typeof result === 'function' && typeof key === 'string' && cleanupReturns.has(key)) {
              let closed = false;
              const unregister = () => { if (closed) return; result(); closed = true; };
              consumer.scope.add(unregister);
              consumer.signal.addEventListener('abort', unregister, { once: true });
              return unregister;
            }
            if (result instanceof Promise) {
              this.borrows.set(provider!, (this.borrows.get(provider!) || 0) + 1);
              const pending = result.finally(() => {
                const left = (this.borrows.get(provider!) || 1) - 1;
                if (left) this.borrows.set(provider!, left); else this.borrows.delete(provider!);
              });
              consumer.scope.observe(pending); provider!.scope.observe(pending);
              return pending.then(wrap);
            }
            return wrap(result);
          };
        },
        set: () => { throw new AppError('公共服务接口不可写', 403, 'PLUGIN_SERVICE_READONLY'); },
        defineProperty: () => false,
        deleteProperty: () => false,
      });
      wrappers.set(value, proxy); this.originals.set(proxy, value); return proxy;
    };
    return wrap(entry.value) as T;
  }
  activeBorrows(instance: PluginInstance) { return this.borrows.get(instance) || 0; }
  unwrap<T>(value: T): T { return (value && (typeof value === 'object' || typeof value === 'function') ? this.originals.get(value as object) || value : value) as T; }
  remove(instance: PluginInstance) {
    for (const [key, entry] of this.registrations) if (entry.instance === instance) this.registrations.delete(key);
  }
}
