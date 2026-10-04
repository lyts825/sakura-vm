import { PLUGINS } from '../shared/plugins.ts';
import { APP_VERSION } from '../shared/version.ts';
import { AppError } from '../shared/errors.ts';
import type { PluginDirectory } from './plugin-directory.ts';
import { ServiceBroker } from './service-broker.ts';
import { withPluginAuthority, withPluginCleanup } from './plugin-authority.ts';
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
import type { SystemServiceContracts } from './service-contracts.ts';
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
    create(dependencies: SystemFactoryResolver<K, R, L, D>): T | Promise<T>;
    initialize(value: T, dependencies: SystemFactoryResolver<K, R, L, D>): void | Promise<void>;
    dispose(value: T | undefined, dependencies: SystemFactoryResolver<K, R, L, D>): void | Promise<void>;
  };

/** Required host providers share the same instance, broker and cleanup machinery. */
export class SystemServices {
  readonly broker: ServiceBroker;
  readonly caller: PluginInstance;
  private owned = new Map<string, { instance: PluginInstance; value: any }>();
  private vmPorts = new WeakMap<PluginInstance, ReturnType<typeof vmAccess>>();
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
    const resolver = (raw: ServiceDependencyResolver, instance: PluginInstance): SystemFactoryResolver<K, R, L, D> => {
      const lookup = (id: DependencyId, late: boolean) => {
        const value = late ? raw.late(id) : raw.get(id);
        return id.startsWith('@') ? value : this.broker.system(instance, id, [id]);
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
          instance.error = String(error);
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
          instance.error = String(error);
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
  ready<K extends keyof SystemExternalDependencies>(id: K, value: SystemExternalDependencies[K]) {
    this.lifecycle.ready(id, value);
  }
  async startAll() {
    await this.lifecycle.startAll();
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
    return [...this.owned.values()].flatMap((entry) => (entry.value?.jobs ? [entry.value.jobs as Jobs] : []));
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
      instance.error = String(error);
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
