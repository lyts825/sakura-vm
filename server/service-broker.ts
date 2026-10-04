import { AppError } from '../shared/errors.ts';
import type { PluginManifest } from '../shared/plugin-protocol.ts';
import type { ServiceContract, ServiceRef } from './service-ref.ts';
import { serviceRef } from './service-ref.ts';
import type { PluginInstance } from './plugin-instance.ts';
import type { PluginDirectory } from './plugin-directory.ts';
import { withPluginAuthority, withPluginCleanup } from './plugin-authority.ts';
import { resourceContext, withResourceContext } from './host-runtime/context.ts';
import { isVmLiveView } from './vm-reference.ts';
import { cleanupReceipt, isCleanupReceipt } from './cleanup-receipt.ts';
import { PUBLIC_SERVICE_CONTRACTS } from './public-service-members.ts';
import { officialServiceContracts, systemServiceContracts } from './service-contracts.ts';

type Registration = { instance: PluginInstance; version: number; contract: ServiceContract<any>; value: unknown };
const serviceRefForSystem = <T>(id: string) => serviceRef<T>(id, 'service');
const hidden = new Set(['constructor', '__proto__', 'prototype', 'machines', 'engine', 'options']);
const lifecycle = new Set(['init', 'close', 'file', 'dataFile']);
// A handle forwarded by another provider remains executable and keeps its original checks.
const publicHandles = new WeakMap<object, ServiceContract<any>>();
const descriptor = (value?: string | ServiceContract<any>) => typeof value === 'string' ? PUBLIC_SERVICE_CONTRACTS[value] : value;
function snapshotContract<T>(contract: ServiceContract<T>, seen = new WeakMap<object, ServiceContract<any>>()): ServiceContract<T> {
  if (seen.has(contract)) return seen.get(contract)!;
  const snapshot: any = { id: contract.id, version: contract.version, members: Object.freeze([...contract.members]),
    optional: contract.optional && Object.freeze([...contract.optional]), methods: contract.methods && Object.freeze([...contract.methods]) };
  seen.set(contract, snapshot);
  const nested = (values?: Readonly<Record<string, string | ServiceContract<any>>>) => values &&
    Object.freeze(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'string' ? value : snapshotContract(value, seen)])));
  snapshot.properties = nested(contract.properties); snapshot.returns = nested(contract.returns);
  return Object.freeze(snapshot);
}
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
  registerSystem<T>(instance: PluginInstance, value: T, declared?: ServiceContract<T>) {
    instance.check(undefined, true);
    if (instance.source !== 'system') throw new Error('系统服务身份无效');
    const expected = systemServiceContracts[instance.pluginId];
    const contract = expected || declared;
    if (!contract) throw new AppError('系统服务缺少公共契约：' + instance.pluginId, 500, 'PLUGIN_SERVICE_CONTRACT_MISSING');
    if (expected && declared && (declared.id !== expected.id || declared.version !== expected.version))
      throw new AppError('系统服务契约不兼容', 409, 'PLUGIN_SERVICE_CONTRACT');
    this.assertContract(contract, value);
    this.registrations.set(`${instance.identity}/service`, { instance, version: contract.version, contract: snapshotContract(contract), value });
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
    const expected = officialServiceContracts[`${instance.pluginId}/${key}`];
    const contract = expected || reference.contract;
    if (!contract) throw new AppError('插件服务缺少公共契约：' + key, 500, 'PLUGIN_SERVICE_CONTRACT_MISSING');
    if (expected && reference.contract && reference.contract.id !== expected.id)
      throw new AppError('插件服务契约不兼容', 409, 'PLUGIN_SERVICE_CONTRACT');
    if (contract.version !== reference.version)
      throw new AppError('插件服务版本不兼容', 409, 'PLUGIN_SERVICE_VERSION');
    this.assertContract(contract, value);
    this.registrations.set(id, {
      instance,
      value: this.unwrap(value),
      version: reference.version,
      contract: snapshotContract(contract),
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
    if (entry.version !== reference.version || (reference.contractId && reference.contractId !== entry.contract.id) || (dependencyVersion && dependencyVersion !== provider!.version))
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
    const wrappers = new WeakMap<object, Map<string, any>>(),
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
    const invoke = (callable: Function, receiver: unknown, args: unknown[], resultContract?: string | ServiceContract<any>) => {
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
        ), descriptor(resultContract),
      );
    };
    const wrap = (value: any, declared?: ServiceContract<any>): any => {
      if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
      if (isCleanupReceipt(value)) return receipt(value);
      if (value instanceof Promise) {
        if (!promises.has(value)) promises.set(value, observe(value.then((result) => wrap(result, declared))));
        return promises.get(value);
      }
      if (Array.isArray(value)) return value.map((item) => wrap(item, declared));
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
        !declared && !publicHandles.has(value) &&
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
      const contract = declared || publicHandles.get(value);
      const shapeId = contract?.id || '';
      let objectWrappers = wrappers.get(value);
      if (!objectWrappers) wrappers.set(value, (objectWrappers = new Map()));
      if (objectWrappers.has(shapeId)) return objectWrappers.get(shapeId);
      if (typeof value === 'function') {
        const callable = (...args: unknown[]) => invoke(value, undefined, args);
        objectWrappers.set(shapeId, callable);
        return callable;
      }
      const publicKeys = contract?.members || [];
      const keys = new Set(publicKeys);
      const proxy = new Proxy(Object.create(null), {
        has: (_target, key) => typeof key === 'string' && keys.has(key) && Reflect.has(value, key),
        get: (_target, key) => {
          if (key === 'then' && !keys.has('then')) return undefined;
          if (
            typeof key !== 'string' ||
            (hidden.has(key) ||
              !keys.has(key) ||
              (lifecycle.has(key) && provider !== consumer && consumer.identity !== 'system:operation-host'))
          )
            throw new AppError('服务内部实现不可访问', 403, 'PLUGIN_SERVICE_PRIVATE');
          const member = Reflect.get(value, key, value);
          if (isCleanupReceipt(member)) return member;
          check();
          if (typeof member !== 'function') return wrap(member, descriptor(contract?.properties?.[key]));
          return (...args: unknown[]) => invoke(member, value, args, contract?.returns?.[String(key)]);
        },
        set: () => {
          throw new AppError('公共服务接口不可写', 403, 'PLUGIN_SERVICE_READONLY');
        },
        defineProperty: () => false,
        deleteProperty: () => false,
      });
      objectWrappers.set(shapeId, proxy);
      if (contract) publicHandles.set(proxy, contract);
      this.originals.set(proxy, value);
      return proxy;
    };
    const handle = wrap(entry.value, entry.contract) as T;
    cache.set(entry, handle);
    return handle;
  }
  activeBorrows(instance: PluginInstance) {
    return this.borrows.get(instance) || 0;
  }
  private assertContract(contract: ServiceContract<any>, value: unknown) {
    if (!contract.id || !Number.isInteger(contract.version) || contract.version < 1 || !Array.isArray(contract.members))
      throw new AppError('服务公共契约声明无效', 500, 'PLUGIN_SERVICE_CONTRACT_MISSING');
    if (!value || (typeof value !== 'object' && typeof value !== 'function'))
      throw new AppError('服务公共契约必须绑定对象', 500, 'PLUGIN_SERVICE_CONTRACT');
    // Optional contract slots may be absent. Runtime visibility comes only from this immutable snapshot.
    if (new Set(contract.members).size !== contract.members.length || contract.members.some((key) => hidden.has(key) || key === 'init'))
      throw new AppError('服务公共契约包含内部成员', 500, 'PLUGIN_SERVICE_CONTRACT');
    for (const key of contract.members) {
      if (!(key in value) && !contract.optional?.includes(key))
        throw new AppError('服务缺少声明成员：' + key, 500, 'PLUGIN_SERVICE_CONTRACT');
      if (key in value && contract.methods?.includes(key) && typeof Reflect.get(value, key) !== 'function')
        throw new AppError('服务声明方法不可调用：' + key, 500, 'PLUGIN_SERVICE_CONTRACT');
    }
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
