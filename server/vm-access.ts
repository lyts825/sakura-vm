/**
 * 模块职责：提供受身份与权限限制的虚拟机访问视图，清理调用必须匹配原客户机资源回执。
 */
import { AppError } from '../shared/errors.ts';
import type { Machines } from './machines.ts';
import type { PluginInstance } from './plugin-instance.ts';
import {
  pluginCleanup,
  withPluginAuthority,
  withPluginBackground,
  withPluginContinuation,
} from './plugin-authority.ts';
import { captureOperationCheck, withOperationCheck } from './operation-context.ts';
import type { PluginScope } from './plugin-scope.ts';
import { ManagedHooks } from './managed-hooks.ts';
import { resourceContext, withResourceContext } from './host-runtime/context.ts';
import { registerVmAccess, vmLiveView } from './vm-reference.ts';
import { vmTransportPort } from './vm-transport-port.ts';
import type {
  VmCatalogPort, VmLockPort, VmEventPort, VmLifecyclePort, VmTransportPort,
  VmGuestFilesPort, VmRescuePort, VmSnapshotPort, VmStoragePort, VmHardwarePort,
  VmMigrationPort, VmHaPort, VmEnginePort, VmStoragePoolsPort,
} from './vm-ports.ts';
export { vmHostIdentity } from './vm-reference.ts';

const methods = [
  'get',
  'state',
  'list',
  'view',
  'isBusy',
  'requireStopped',
  'requireUnlocked',
  'incidentLocked',
  'commandline',
  'configureHardware',
  'start',
  'stop',
  'suspend',
  'resume',
  'create',
  'update',
  'delete',
  'importDisk',
  'adopt',
  'resize',
  'completeResize',
  'setForwards',
  'setMemoryTarget',
  'setIncidentLockdown',
  'exec',
  'execInput',
  'connect',
  'sftp',
  'files',
  'readGuestFile',
  'writeGuestFile',
  'locked',
  'withDiskSecret',
  'withRescue',
  'reserveHostPorts',
  'diskEncryptionStatus',
  'encryptDisk',
  'snapshotIdentity',
  'recordMerge',
  'beforeFileReplace',
  'fileReplacing',
  'beforeHaStart',
  'migrationFingerprint',
  'enterMaintenance',
  'moveStoragePool',
  'createIncomingTarget',
  'completeIncoming',
  'startIncoming',
  'fenceForLiveMigration',
  'fenceForHa',
  'enrollHaWitness',
  'releaseHaWitness',
  'organize',
  'memorySnapshot',
  'onlineSnapshot',
  'snapshot',
  'restoreMemory',
  'restore',
  'editSnapshot',
  'bootGuard',
  'hotplug',
  'releaseHaPromotion',
  'updateHaPromotion',
  'retireHaReplica',
  'startHaReplica',
  'terminateSandbox',
] as const satisfies readonly (keyof VmAccess)[];
export type VmAccess = VmCatalogPort & VmLockPort & VmEventPort & VmLifecyclePort &
  VmTransportPort & VmGuestFilesPort & VmRescuePort & VmSnapshotPort & VmStoragePort &
  VmHardwarePort & VmMigrationPort & VmHaPort & VmEnginePort & {
    readonly storagePools: VmStoragePoolsPort;
  };
const native = new Set(['exec', 'execInput', 'connect', 'sftp']);
const queries = new Set([
  'get',
  'state',
  'isBusy',
  'requireStopped',
  'requireUnlocked',
  'incidentLocked',
  'commandline',
]);

/** An explicit VM port, with read-only catalog views and host-owned registrations. */
export function vmAccess(
  machines: Machines,
  scope: PluginScope,
  instance?: PluginInstance,
  execute: (id: string, signal: AbortSignal, work: () => Promise<any>) => Promise<any> = (
    _id,
    _signal,
    work,
  ) => work(),
): VmAccess {
  const port: any = Object.create(null);
  const tickets = new Map<string, unknown>();
  const listeners = new Map<string | symbol, Map<Function, () => void>>();
  const fallbackHooks = new ManagedHooks<[string, string, any, AbortSignal | undefined]>();
  const cleaning = () => !!instance && pluginCleanup() === instance;
  const check = (permission = 'vm') => {
    if (cleaning()) return;
    scope.signal.throwIfAborted();
    instance?.check(permission, true);
  };
  const invoke = (permission: string, work: () => any) => {
    check(permission);
    return instance && !cleaning() ? withPluginAuthority(instance, work, () => check(permission)) : work();
  };
  const readonlyMap = (map: Map<any, any>, snapshot = false, live = false) => {
    const copy = (value: any) =>
      value && live ? vmLiveView(value) : snapshot && value ? structuredClone(value) : value;
    return Object.freeze({
      get size() {
        check();
        return map.size;
      },
      get(key: string) {
        check();
        return copy(map.get(key));
      },
      has(key: string) {
        check();
        return map.has(key);
      },
      *entries() {
        check();
        for (const [key, value] of map) {
          check();
          yield [key, copy(value)] as [string, any];
        }
      },
      *keys() {
        check();
        yield* map.keys();
      },
      *values() {
        check();
        for (const value of map.values()) {
          check();
          yield copy(value);
        }
      },
      [Symbol.iterator]() {
        return this.entries();
      },
      forEach(callback: (value: any, key: string, map: any) => void) {
        for (const [key, value] of this.entries()) callback(value, key, this);
      },
    });
  };
  for (const name of methods)
    Object.defineProperty(port, name, {
      enumerable: true,
      value: (...args: any[]) => {
        const id = typeof args[0] === 'string' ? args[0] : undefined;
        if (cleaning() && !queries.has(name) && name !== 'locked') {
          if (!native.has(name) || !id || !tickets.has(id) || tickets.get(id) !== machines.live.get(id))
            throw new AppError('清理调用不属于原客户机资源回执', 403, 'PLUGIN_CLEANUP_RECEIPT');
        }
        const permission = native.has(name) ? 'execution' : 'vm';
        return invoke(permission, () => {
          if (name === 'beforeFileReplace' && !machines.beforeFileReplace)
            return fallbackHooks.register(args[0]);
          if (name === 'fileReplacing' && !machines.fileReplacing)
            return fallbackHooks.dispatch(args[0], args[1], args[2], args[3]);
          if (native.has(name) && id && !cleaning()) {
            const live = machines.live.get(id);
            tickets.set(id, live);
            const bound = resourceContext()?.vmId;
            if (bound && bound !== id)
              throw new AppError('客户机不属于当前操作身份', 403, 'PLUGIN_VM_IDENTITY');
            const index = name === 'exec' ? 3 : name === 'execInput' ? 4 : 2;
            const signal = args[index] ? AbortSignal.any([scope.signal, args[index]]) : scope.signal;
            args[index] = signal;
            const projectId = resourceContext()?.projectId;
            const admitted = captureOperationCheck();
            const transportIdentity = resourceContext();
            const continuation = <T>(work: () => T): T => {
              const resume = () =>
                withResourceContext({ ...transportIdentity, vmId: id, projectId }, () =>
                  withOperationCheck(admitted, work),
                );
              return instance ? withPluginContinuation(instance, resume) : resume();
            };
            const transport = <T>(work: () => T): T =>
              invoke('execution', () => {
                const current = resourceContext();
                if (
                  machines.live.get(id) !== live ||
                  (current?.vmId && current.vmId !== id) ||
                  (current?.projectId && projectId && current.projectId !== projectId)
                )
                  throw new AppError('传输运行身份已改变', 403, 'PLUGIN_VM_IDENTITY');
                return withResourceContext({ vmId: id, projectId }, work);
              });
            if (name === 'sftp' && typeof args[1] === 'function') {
              const work = args[1];
              args[1] = (ftp: object, ...rest: unknown[]) =>
                work(vmTransportPort(ftp, 'sftp', transport, continuation), ...rest);
            }
            const pending = withResourceContext({ vmId: id }, () =>
              execute(id, signal, () =>
                Promise.resolve(Reflect.apply((machines as any)[name], machines, args)).then((value) =>
                  name === 'connect'
                    ? vmTransportPort(value as object, 'client', transport, continuation)
                    : value,
                ),
              ),
            );
            scope.observe(pending);
            return pending;
          }
          if (name === 'locked' && typeof args[1] === 'function') {
            const work = args[1];
            args[1] = () => invoke(permission, work);
          }
          if (name === 'get') return structuredClone(machines.get(args[0]));
          return Reflect.apply((machines as any)[name], machines, args);
        });
      },
    });
  for (const name of ['records', 'live', 'logs'] as const)
    Object.defineProperty(port, name, {
      enumerable: true,
      get: () => {
        check();
        return readonlyMap(machines[name] || new Map(), name === 'records', name === 'live');
      },
    });
  Object.defineProperty(port, 'closing', {
    get: () => {
      check();
      return machines.closing;
    },
  });
  const pools = Object.freeze(
    Object.fromEntries(
      ['view', 'directory', 'conflictsWithDataTarget', 'run', 'hasPendingCleanup', 'ensure'].map((key) => [
        key,
        (...args: any[]) =>
          invoke('storage', () =>
            Reflect.apply((machines.storagePools as any)[key], machines.storagePools, args),
          ),
      ]),
    ),
  );
  Object.defineProperty(port, 'storagePools', {
    get: () => {
      check('storage');
      return pools;
    },
  });
  const engine: any = Object.create(null);
  for (const key of ['version', 'aarch64Available', 'whpxAvailable'] as const)
    Object.defineProperty(engine, key, {
      get: () => {
        check();
        return machines.engine[key];
      },
    });
  for (const key of ['run', 'runStatus'] as const)
    Object.defineProperty(engine, key, {
      value: (...args: any[]) =>
        invoke('process', () => Reflect.apply(machines.engine[key], machines.engine, args)),
    });
  port.engine = Object.freeze(engine);
  port.boot = (id: string) => invoke('vm', () => machines.live.get(id)?.startedAt);
  port.on = (event: string | symbol, listener: (...args: any[]) => void) => {
    check('events');
    const byEvent = listeners.get(event) || new Map();
    listeners.set(event, byEvent);
    if (byEvent.has(listener)) return port;
    const removeContribution = instance?.contribute('event', 'vm:' + String(event));
    const managed = (...args: any[]) => {
      if (scope.signal.aborted) return;
      const run = () => listener(...args);
      if (instance && instance.phase !== 'running') return;
      const result: any = instance ? withPluginBackground(instance, run) : run();
      if (result instanceof Promise) {
        scope.observe(result);
        void result.catch(() => {});
      }
    };
    machines.on(event, managed);
    const unregister = () => {
      machines.off(event, managed);
      byEvent.delete(listener);
      removeContribution?.();
      scope.signal.removeEventListener('abort', unregister);
    };
    byEvent.set(listener, unregister);
    scope.signal.addEventListener('abort', unregister, { once: true });
    scope.add(unregister);
    return port;
  };
  port.off = (event: string | symbol, listener: Function) => {
    listeners.get(event)?.get(listener)?.();
    return port;
  };
  port.emit = (event: string | symbol, ...args: any[]) =>
    invoke('events', () => {
      if (event !== 'change') throw new AppError('插件不能发布宿主生命周期事件', 403, 'PLUGIN_EVENT_DENIED');
      return machines.emit(event, ...args);
    });
  registerVmAccess(port, machines);
  return Object.freeze(port) as VmAccess;
}
