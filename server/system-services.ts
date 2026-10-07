/**
 * 模块职责：装配系统服务并提供受限解析器，协调就绪、实例归属和生命周期退休。
 */
import { PLUGINS } from '../shared/plugins.ts';
import { APP_VERSION } from '../shared/version.ts';
import { AppError } from '../shared/errors.ts';
import type { PluginDirectory } from './plugin-directory.ts';
import { ServiceBroker } from './service-broker.ts';
import { pluginCleanup, withPluginAuthority, withPluginCleanup } from './plugin-authority.ts';
import { serviceRef } from './service-ref.ts';
import type { PluginInstance } from './plugin-instance.ts';
import type { HostServiceResolver, HostServiceContracts } from './host-service-contracts.ts';
import { vmAccess } from './vm-access.ts';
import type { Machines } from './machines.ts';
import { ExecutionScope } from './execution-scope.ts';
import { resourceContext } from './host-runtime/context.ts';
import type { Jobs } from './jobs.ts';
import { systemArtifactDigest } from './plugin-artifact.ts';
import { ServiceLifecycle, type ServiceDefinition, type ServiceDependencyResolver } from './service-lifecycle.ts';
import { systemServiceContracts, type SystemServiceContracts } from './service-contracts.ts';
import { cleanupService } from './service-cleanup.ts';
import type { Features } from './features.ts';
import type { AuditLog } from './audit.ts';

export interface SystemExternalDependencies {
  '@machines': Machines;
  '@plugins': Features;
  '@audit': AuditLog;
  '@pluginDirectory': PluginDirectory;
}
type DependencyContracts = SystemServiceContracts & SystemExternalDependencies;
type DependencyId = keyof DependencyContracts;
const startupDiagnostic = (error: unknown) => {
  if (error instanceof SyntaxError) return '配置 JSON 无法解析（SyntaxError）';
  if (error instanceof Error && error.name === 'ZodError') return '配置未通过格式校验（ZodError）';
  const code = error instanceof AppError ? error.code : error instanceof Error ? error.name : undefined;
  return '服务初始化未完成' + (code && /^[A-Za-z0-9_]+$/.test(code) ? `（${code}）` : '');
};
export type SystemFactoryResolver<K extends keyof SystemServiceContracts = keyof SystemServiceContracts,
  R extends readonly DependencyId[] = readonly DependencyId[], L extends readonly DependencyId[] = readonly DependencyId[],
  D extends readonly DependencyId[] = readonly DependencyId[]> = Readonly<{
    get<I extends R[number]>(id: I): DependencyContracts[I];
    late<I extends R[number] | L[number] | D[number]>(id: I): DependencyContracts[I];
    self(): SystemServiceContracts[K];
    vm: '@machines' extends R[number] ? () => ReturnType<typeof vmAccess> : never;
  }>;
type SystemDefinition<K extends keyof SystemServiceContracts, T extends SystemServiceContracts[K],
  R extends readonly DependencyId[], L extends readonly DependencyId[], D extends readonly DependencyId[]> =
  Omit<ServiceDefinition<T>, 'id' | 'requires' | 'lateRequires' | 'disposeRequires' | 'create' | 'initialize' | 'dispose'> & {
    id: K; requires: R; lateRequires?: L; disposeRequires?: D;
    /** Local diagnostic only; never included in a public missing-service response. */
    startupRecovery?: string;
    create(dependencies: SystemFactoryResolver<K, R, L, D>): T | Promise<T>;
    initialize(value: T, dependencies: SystemFactoryResolver<K, R, L, D>): void | Promise<void>;
    dispose(value: T | undefined, dependencies: SystemFactoryResolver<K, R, L, D>): void | Promise<void>;
  };

/** Host providers share the same instance, broker and cleanup machinery. */
export class SystemServices {
  readonly broker: ServiceBroker;
  readonly caller: PluginInstance;
  private owned = new Map<string, { instance: PluginInstance; value: any }>();
  private vmPorts = new WeakMap<PluginInstance, ReturnType<typeof vmAccess>>();
  private startupRecovery = new Map<string, string>();
  readonly lifecycle = new ServiceLifecycle();
  constructor(readonly directory: PluginDirectory) {
    this.broker = new ServiceBroker(directory, PLUGINS);
    this.caller = directory.begin(
      'system',
      'operation-host',
      APP_VERSION,
      systemArtifactDigest('operation-host'),
    );
    directory.publish(this.caller);
  }
  /** Startup-only API. Public handles are published after the initializer succeeds. */
  register<K extends keyof SystemServiceContracts, T extends SystemServiceContracts[K],
    const R extends readonly DependencyId[], const L extends readonly DependencyId[] = readonly [],
    const D extends readonly DependencyId[] = readonly []>(definition: SystemDefinition<K, T, R, L, D>) {
    definition = Object.freeze({ ...definition });
    if (definition.startupRecovery) this.startupRecovery.set(definition.id, definition.startupRecovery);
    const resolver = (raw: ServiceDependencyResolver, instance: PluginInstance): SystemFactoryResolver<K, R, L, D> => {
      const originals = new Map<string, PluginInstance>();
      const lookup = (id: DependencyId, late: boolean) => {
        const value = late ? raw.late(id) : raw.get(id);
        if (pluginCleanup() === instance) {
          if (id.startsWith('@') || ![...definition.requires, ...(definition.disposeRequires || [])].includes(id))
            throw new AppError('清理依赖未声明为原资源依赖：' + id, 403, 'SERVICE_DEPENDENCY_DENIED');
          const provider = this.owned.get(id);
          if (!provider || provider.value !== value)
            throw new AppError('原清理依赖不可用：' + id, 503, 'SERVICE_NOT_READY');
          if (!originals.has(id)) originals.set(id, provider.instance);
          const original = originals.get(id)!;
          const check = () => {
            if (pluginCleanup() !== instance || !['draining', 'cleanup-pending'].includes(instance.phase) ||
                this.directory.get('system', definition.id) !== instance ||
                this.directory.get('system', id) !== original || this.owned.get(id)?.instance !== original)
              throw new AppError('原服务清理上下文或代次已变化', 403, 'PLUGIN_REVOKED');
            if ((late ? raw.late(id) : raw.get(id)) !== value)
              throw new AppError('原清理依赖已变化：' + id, 403, 'PLUGIN_REVOKED');
            original.check('services');
          };
          return cleanupService(value, systemServiceContracts[id], original, check);
        }
        if (id.startsWith('@')) return value;
        const provider = this.directory.get('system', id);
        if (provider) {
          const original = originals.get(id);
          if (original && original !== provider)
            throw new AppError('服务依赖代次已变化：' + id, 403, 'PLUGIN_REVOKED');
          originals.set(id, provider);
        }
        return this.broker.system(instance, id, [id]);
      };
      return Object.freeze({ get: (id: R[number]) => lookup(id, false),
        late: (id: R[number] | L[number] | D[number]) => lookup(id, true),
        self: () => { raw.self(); return this.broker.system(instance, definition.id, [definition.id])!; },
        vm: () => this.vm(definition.id, raw.get<Machines>('@machines')),
      }) as SystemFactoryResolver<K, R, L, D>;
    };
    this.lifecycle.register({
      ...definition,
      create: async (raw) => {
        if (this.owned.has(definition.id)) throw new AppError('系统服务已注册：' + definition.id, 409);
        const instance = this.directory.begin(
          'system',
          definition.id,
          APP_VERSION,
          systemArtifactDigest(definition.id),
        );
        const entry: { instance: PluginInstance; value: T | undefined } = { instance, value: undefined };
        this.owned.set(definition.id, entry);
        const dependencies = resolver(raw, instance);
        instance.scope.add(() => Promise.resolve(definition.dispose(entry.value, dependencies)));
        try {
          entry.value = await withPluginAuthority(instance, () => definition.create(dependencies));
          return entry.value;
        } catch (error) {
          instance.error = definition.startup === 'degradable' ? startupDiagnostic(error) : String(error);
          instance.revoke();
          instance.phase = 'cleanup-pending';
          this.directory.changed();
          throw error;
        }
      },
      initialize: async (value, raw) => {
        const instance = this.owned.get(definition.id)!.instance;
        const started = performance.now();
        try {
          await withPluginAuthority(instance, () => definition.initialize(value, resolver(raw, instance)));
          if (!this.lifecycle.accepting) throw new AppError('初始化期间服务已关闭', 503, 'SERVICE_DRAINING');
          this.broker.registerSystem(instance, value);
          instance.activationMs = performance.now() - started;
          this.directory.publish(instance);
        } catch (error) {
          instance.error = definition.startup === 'degradable' ? startupDiagnostic(error) : String(error);
          instance.revoke();
          instance.phase = 'cleanup-pending';
          this.directory.changed();
          throw error;
        }
      },
      dispose: () => this.retire(definition.id),
    });
  }
  async start<K extends keyof SystemServiceContracts, T extends SystemServiceContracts[K],
    const R extends readonly DependencyId[], const L extends readonly DependencyId[] = readonly [],
    const D extends readonly DependencyId[] = readonly []>(definition: SystemDefinition<K, T, R, L, D>): Promise<SystemServiceContracts[K]> {
    this.register(definition);
    await this.lifecycle.start<T>(definition.id);
    return this.broker.system<SystemServiceContracts[K]>(this.caller, definition.id, [definition.id])!;
  }
  async startDegradable<K extends keyof SystemServiceContracts, T extends SystemServiceContracts[K],
    const R extends readonly DependencyId[], const L extends readonly DependencyId[] = readonly [],
    const D extends readonly DependencyId[] = readonly []>(
    definition: SystemDefinition<K, T, R, L, D> & { startup: 'degradable' },
  ): Promise<SystemServiceContracts[K] | undefined> {
    this.register(definition);
    const value = await this.lifecycle.startDegradable<T>(definition.id);
    if (value !== undefined) return this.require(definition.id);
    await this.recordUnavailable(definition.id);
    return undefined;
  }
  private async recordUnavailable(id: string) {
    const stage = this.lifecycle.view().find(entry => entry.id === id);
    if (!stage?.unavailable) return;
    let instance = this.directory.get('system', id);
    if (!instance) {
      instance = this.directory.begin('system', id, APP_VERSION, systemArtifactDigest(id));
      instance.revoke();
      await instance.scope.dispose();
    }
    const original = instance.error || stage.error || '依赖服务不可用';
    instance.error = `${original}。${this.startupRecovery.get(id) || '检查本服务配置与启动诊断'}；修复后重启 Sakura。`;
    if (instance.phase !== 'cleanup-pending') instance.phase = 'failed';
    this.directory.changed();
  }
  require<K extends keyof SystemServiceContracts>(id: K): SystemServiceContracts[K] {
    if (!this.has(id))
      throw new AppError(`服务 ${id} 当前不可用；请查看插件管理中的启动诊断，修复后重启 Sakura。`,
        503, 'SERVICE_UNAVAILABLE');
    return this.broker.system<SystemServiceContracts[K]>(this.caller, id, [id])!;
  }
  ready<K extends keyof SystemExternalDependencies>(id: K, value: SystemExternalDependencies[K]) {
    this.lifecycle.ready(id, value);
  }
  async startAll() {
    await this.lifecycle.startAll();
    for (const entry of this.lifecycle.view()) if (entry.unavailable) await this.recordUnavailable(entry.id);
  }
  vm(id: string, machines: Machines) {
    const instance = this.directory.get('system', id)!;
    if (!instance) throw new Error('系统服务未建立实例：' + id);
    let port = this.vmPorts.get(instance);
    if (!port) {
      port = vmAccess(machines, instance.scope, instance, (vmId, signal, work) =>
        ExecutionScope.run(
          {
            machines,
            vmId,
            projectId: resourceContext()?.projectId || 'default',
            owner: ExecutionScope.current()?.owner || instance.owner,
            signal,
            delegate: true,
          },
          work,
        ),
      );
      this.vmPorts.set(instance, port);
    }
    return port;
  }
  resolver(consumer: PluginInstance, dependencies: readonly string[]): HostServiceResolver {
    return Object.freeze({
      optional: <K extends keyof HostServiceContracts>(id: K) =>
        this.broker.system<HostServiceContracts[K]>(consumer, id, dependencies),
    });
  }
  official<T>(key: string): T | undefined {
    const provider = PLUGINS.find((item) => item.services.includes(key));
    if (!provider) return undefined;
    return this.broker.lookup(
      this.caller,
      {
        ...provider,
        id: this.caller.pluginId,
        requires: [],
        optional: PLUGINS.map((item) => ({ id: item.id, version: item.version })),
      },
      serviceRef<T>(provider.id, key),
      true,
    );
  }
  jobStores(): Jobs[] {
    return [...this.owned.values()].flatMap(entry =>
      entry.instance.phase === 'running' && entry.value?.jobs ? [entry.value.jobs as Jobs] : []);
  }
  has(id: string) {
    return this.owned.get(id)?.instance.phase === 'running';
  }
  ownsInstance(instance: PluginInstance) {
    return instance === this.caller || this.owned.get(instance.pluginId)?.instance === instance;
  }
  async retire(id: string) {
    const entry = this.owned.get(id);
    if (!entry) return;
    const { instance } = entry;
    const originalError = instance.error;
    instance.revoke();
    this.directory.changed();
    try {
      await instance.scope.dispose((dispose) => Promise.resolve(withPluginCleanup(instance, dispose)));
      instance.phase = 'inactive';
      this.broker.remove(instance);
      this.owned.delete(id);
      this.lifecycle.confirmDisposed(id);
    } catch (error) {
      instance.phase = 'cleanup-pending';
      instance.error = originalError ? `${originalError}；清理待确认：${String(error)}` : String(error);
      throw error;
    } finally {
      this.directory.changed();
    }
  }
  async close() {
    const failures: unknown[] = [];
    try {
      await this.lifecycle.close();
    } catch (error) {
      failures.push(error);
    }
    const managed = new Set(this.lifecycle.view().map((entry) => entry.id));
    for (const id of [...this.owned.keys()].reverse().filter((id) => !managed.has(id))) {
      try {
        await this.retire(id);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, '系统服务清理未完成');
    this.caller.revoke();
    try {
      await this.caller.scope.dispose();
      this.caller.phase = 'inactive';
    } catch (error) {
      this.caller.phase = 'cleanup-pending'; this.caller.error = String(error);
      throw error;
    } finally { this.directory.changed(); }
  }
}
