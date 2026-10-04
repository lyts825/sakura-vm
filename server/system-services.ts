import { PLUGINS } from '../shared/plugins.ts';
import { AppError } from '../shared/errors.ts';
import type { PluginDirectory } from './plugin-directory.ts';
import { ServiceBroker } from './service-broker.ts';
import { withPluginAuthority, withPluginCleanup } from './plugin-authority.ts';
import { serviceRef } from './service-ref.ts';
import type { PluginInstance } from './plugin-instance.ts';
import type { HostServiceResolver, HostServiceContracts } from './host-service-contracts.ts';
import { cleanupReceipt } from './cleanup-receipt.ts';
import { vmAccess } from './vm-access.ts';
import type { Machines } from './machines.ts';
import { ExecutionScope } from './execution-scope.ts';
import { resourceContext } from './host-runtime/context.ts';

/** Required host providers share the same instance, broker and cleanup machinery. */
export class SystemServices {
  readonly broker: ServiceBroker;
  readonly caller: PluginInstance;
  private owned = new Map<string, { instance: PluginInstance; value: any }>();
  private vmPorts = new WeakMap<PluginInstance, ReturnType<typeof vmAccess>>();
  constructor(readonly directory: PluginDirectory) {
    this.broker = new ServiceBroker(directory, PLUGINS);
    this.caller = directory.begin('system', 'operation-host', '1.0.0', 'builtin:operation-host');
    directory.publish(this.caller);
  }
  construct<T>(id: string, create: () => T): T {
    if (this.owned.has(id)) throw new AppError('系统服务已注册：' + id, 409);
    const instance = this.directory.begin('system', id, '1.0.0', 'builtin:' + id);
    let value: T;
    try { value = withPluginAuthority(instance, create); }
    catch (error) { instance.error = String(error); instance.revoke(); instance.phase = 'cleanup-pending'; this.owned.set(id, { instance, value: undefined }); throw error; }
    this.owned.set(id, { instance, value });
    const close = (value as any)?.close;
    if (typeof close === 'function') instance.scope.add(() => close.call(value));
    this.broker.registerSystem(instance, value); this.directory.publish(instance);
    const handle = this.broker.system<T>(this.caller, id, [id])!;
    if (typeof close !== 'function') return handle;
    // The application's close order selects when to retire this provider; ownership stays here.
    return new Proxy(Object.create(null), { get: (_target, key) => key === 'close' ?
      cleanupReceipt(() => this.retire(id)) : Reflect.get(handle as object, key),
      set: () => { throw new AppError('系统服务接口不可写', 403, 'PLUGIN_SERVICE_READONLY'); } }) as T;
  }
  vm(id: string, machines: Machines) {
    const instance = this.directory.get('system', id)!;
    if (!instance) throw new Error('系统服务未建立实例：' + id);
    let port = this.vmPorts.get(instance);
    if (!port) {
      port = vmAccess(machines, instance.scope, instance, (vmId, signal, work) => ExecutionScope.run({ machines,
        vmId, projectId: resourceContext()?.projectId || 'default', owner: ExecutionScope.current()?.owner || instance.owner,
        signal, delegate: true }, work)); this.vmPorts.set(instance, port);
    }
    return port;
  }
  resolver(consumer: PluginInstance, dependencies: readonly string[]): HostServiceResolver {
    return Object.freeze({ optional: <K extends keyof HostServiceContracts>(id: K) =>
      this.broker.system<HostServiceContracts[K]>(consumer, id, dependencies) });
  }
  official<T>(key: string): T | undefined {
    const provider = PLUGINS.find(item => item.services.includes(key)); if (!provider) return undefined;
    return this.broker.lookup(this.caller, { ...provider, id: this.caller.pluginId,
      requires: [], optional: PLUGINS.map(item => ({ id: item.id, version: item.version })) }, serviceRef<T>(provider.id, key), true);
  }
  async retire(id: string) {
    const entry = this.owned.get(id); if (!entry) return;
    const { instance } = entry; instance.revoke(); this.directory.changed();
    try { await instance.scope.dispose(dispose => Promise.resolve(withPluginCleanup(instance, dispose)));
      instance.phase = 'inactive'; this.broker.remove(instance); this.owned.delete(id);
    } catch (error) { instance.phase = 'cleanup-pending'; instance.error = String(error); throw error; }
    finally { this.directory.changed(); }
  }
  async close() {
    const failures: unknown[] = [];
    for (const id of [...this.owned.keys()].reverse()) {
      try { await this.retire(id); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, '系统服务清理未完成');
    this.caller.revoke(); await this.caller.scope.dispose(); this.caller.phase = 'inactive'; this.directory.changed();
  }
}
