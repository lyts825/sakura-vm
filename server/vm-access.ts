/**
 * 模块职责：提供受身份与权限限制的虚拟机访问视图，清理调用必须匹配原客户机资源回执。
 * Module purpose: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
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
  'networkIsolation',
  'isolateStopped',
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
/**
 * 入口 / Entry: vmAccess.
 * 功能：构造插件或领域可用的受限实例访问器，限制身份、权限与清理票据。
 * Purpose: Builds limited VM access for plugins/domains with identity, authority and cleanup-ticket constraints.
 * 设计：公开方法代理核对原 Live 和当前插件；清理模式只接受原资源零参数回执，不能借旧票据操作新实例。
 * Design: Method proxies check original Live/plugin identity; cleanup accepts original zero-argument receipts and cannot reuse stale tickets against replacement VMs.
 * 输入 / Inputs: machines: Machines; scope: PluginScope; instance: PluginInstance optional; execute: (id: string, signal: AbortSignal, work: () => Promise<any>) => Promise<any> default=( _id, _signal, work, ) => work()
 * 输出 / Returns: VmAccess；结果来自 / values from `Object.freeze(port) as VmAccess`.
 * 副作用 / Effects: `registerVmAccess`; 更新 / updates `port.engine`, `port.boot`, `port.on`, `port.off`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
  const listeners = new Map<string | symbol, Map<Function,
  /**
   * 中文功能：为 vmAccess.listeners 登记事件、状态变化或阶段结束通知，接收本声明规定的事件数据。
   * English: Registers event/state-change/phase-completion notification for vmAccess.listeners using its declared event data.
   * 所属 / Owner: vmAccess.listeners.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `void`.
   */
  () => void>>();
  const fallbackHooks = new ManagedHooks<[string, string, any, AbortSignal | undefined]>();
  /**
   * 入口 / Entry: vmAccess.cleaning.
   * 功能：从当前输入或状态计算 `!!instance && pluginCleanup() === instance`，供调用方后续验证或使用。
   * Purpose: Computes `!!instance && pluginCleanup() === instance` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `!!instance && pluginCleanup() === instance`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const cleaning = () => !!instance && pluginCleanup() === instance;
  /**
   * 入口 / Entry: vmAccess.check.
   * 功能：在提供受身份与权限限制的虚拟机访问视图中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`vm-access.ts`）。
   * Purpose: Checks admission, input or resource ownership in `vm-access.ts`; this entry produces `void` for its caller. Module context: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
   * 处理：通过 `cleaning`, `scope.signal.throwIfAborted`, `instance.check` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `cleaning`, `scope.signal.throwIfAborted`, `instance.check`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `cleaning()`.
   * 输入 / Inputs: permission: default='vm'
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const check = (permission = 'vm') => {
    if (cleaning()) return;
    scope.signal.throwIfAborted();
    instance?.check(permission, true);
  };
  /**
   * 入口 / Entry: vmAccess.invoke.
   * 功能：在提供受身份与权限限制的虚拟机访问视图中，执行此领域的具体处理步骤并返回其结果；本入口产生 `instance && !cleaning() ? withPluginAuthority(instance, work, () => check(permission)) : work()` 供上层消费（`vm-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-access.ts`; this entry produces `instance && !cleaning() ? withPluginAuthority(instance, work, () => check(permission)) : work()` for its caller. Module context: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
   * 处理：通过 `check`, `cleaning`, `withPluginAuthority`, `work` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `check`, `cleaning`, `withPluginAuthority`, `work`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: permission: string; work: () => any
   * 输出 / Returns: `instance && !cleaning() ? withPluginAuthority(instance, work, () => check(permission)) : work()`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const invoke = (permission: string, work:
  /**
   * 中文功能：将 vmAccess.invoke.work 所属工作交给原调用上下文，按声明返回业务结果或异步拒绝。
   * English: Supplies work to the original context owned by vmAccess.invoke.work, returning the declared business result or asynchronous rejection.
   * 所属 / Owner: vmAccess.invoke.work.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `any`.
   */
  () => any) => {
    check(permission);
    return instance && !cleaning() ? withPluginAuthority(instance, work, () => check(permission)) : work();
  };
  /**
   * 入口 / Entry: vmAccess.readonlyMap.
   * 功能：从当前输入或状态计算 `Object.freeze({ get size() { check(); return map.size; }, get(key: string) { check(); return copy(map.get(key)); }, has(key: …`，供调用方后续验证或使用。
   * Purpose: Computes `Object.freeze({ get size() { check(); return map.size; }, get(key: string) { check(); return copy(map.get(key)); }, has(key: …` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: map: Map<any, any>; snapshot: default=false; live: default=false
   * 输出 / Returns: `Object.freeze({ get size() { check(); return map.size; }, get(key: string) { check(); return copy(map.get(key)); }, has(key: …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  const readonlyMap = (map: Map<any, any>, snapshot = false, live = false) => {
    /**
     * 入口 / Entry: vmAccess.copy.
     * 功能：在提供受身份与权限限制的虚拟机访问视图中，执行此领域的具体处理步骤并返回其结果；本入口产生 `value && live ? vmLiveView(value) : snapshot && value ? structuredClone(value) : value` 供上层消费（`vm-access.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-access.ts`; this entry produces `value && live ? vmLiveView(value) : snapshot && value ? structuredClone(value) : value` for its caller. Module context: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
     * 处理：通过 `vmLiveView`, `structuredClone` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `vmLiveView`, `structuredClone`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: value: any
     * 输出 / Returns: `value && live ? vmLiveView(value) : snapshot && value ? structuredClone(value) : value`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const copy = (value: any) =>
      value && live ? vmLiveView(value) : snapshot && value ? structuredClone(value) : value;
    return Object.freeze({
      /**
       * 入口 / Entry: vmAccess.size.
       * 功能：从当前输入或状态计算 `map.size`，供调用方后续验证或使用。
       * Purpose: Computes `map.size` from current inputs/state for the caller to validate or consume.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `map.size`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      get size() {
        check();
        return map.size;
      },
      /**
       * 入口 / Entry: vmAccess.get.
       * 功能：在提供受身份与权限限制的虚拟机访问视图中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `copy(map.get(key))` 供上层消费（`vm-access.ts`）。
       * Purpose: Reads/verifies domain state and constructs a caller-facing result in `vm-access.ts`; this entry produces `copy(map.get(key))` for its caller. Module context: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
       * 处理：通过 `check`, `copy`, `map.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `check`, `copy`, `map.get`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: key: string
       * 输出 / Returns: `copy(map.get(key))`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      get(key: string) {
        check();
        return copy(map.get(key));
      },
      /**
       * 入口 / Entry: vmAccess.has.
       * 功能：在提供受身份与权限限制的虚拟机访问视图中，执行此领域的具体处理步骤并返回其结果；本入口产生 `map.has(key)` 供上层消费（`vm-access.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-access.ts`; this entry produces `map.has(key)` for its caller. Module context: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
       * 处理：通过 `check`, `map.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `check`, `map.has`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: key: string
       * 输出 / Returns: `map.has(key)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      has(key: string) {
        check();
        return map.has(key);
      },
      /**
       * 入口 / Entry: vmAccess.entries.
       * 功能：在提供受身份与权限限制的虚拟机访问视图中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`vm-access.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-access.ts`; the calls and state transitions below complete the operation. Module context: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
       * 处理：通过 `check`, `copy` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `check`, `copy`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      *entries() {
        check();
        for (const [key, value] of map) {
          check();
          yield [key, copy(value)] as [string, any];
        }
      },
      /**
       * 入口 / Entry: vmAccess.keys.
       * 功能：在提供受身份与权限限制的虚拟机访问视图中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`vm-access.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-access.ts`; the calls and state transitions below complete the operation. Module context: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
       * 处理：通过 `check`, `map.keys` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `check`, `map.keys`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      *keys() {
        check();
        yield* map.keys();
      },
      /**
       * 入口 / Entry: vmAccess.values.
       * 功能：在提供受身份与权限限制的虚拟机访问视图中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`vm-access.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-access.ts`; the calls and state transitions below complete the operation. Module context: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
       * 处理：通过 `check`, `map.values`, `copy` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `check`, `map.values`, `copy`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      *values() {
        check();
        for (const value of map.values()) {
          check();
          yield copy(value);
        }
      },
      /**
       * 入口 / Entry: vmAccess.[Symbol.iterator].
       * 功能：把本层请求转交 `this.entries`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.entries` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `this.entries()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      [Symbol.iterator]() {
        return this.entries();
      },
      /**
       * 入口 / Entry: vmAccess.forEach.
       * 功能：在提供受身份与权限限制的虚拟机访问视图中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`vm-access.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-access.ts`; the calls and state transitions below complete the operation. Module context: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
       * 处理：通过 `this.entries`, `callback` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.entries`, `callback`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: callback: (value: any, key: string, map: any) => void
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      forEach(callback: (value: any, key: string, map: any) => void) {
        for (const [key, value] of this.entries()) callback(value, key, this);
      },
    });
  };
  for (const name of methods)
    Object.defineProperty(port, name, {
      enumerable: true,
      /**
       * 入口 / Entry: vmAccess.value.
       * 功能：在提供受身份与权限限制的虚拟机访问视图中，执行此领域的具体处理步骤并返回其结果；本入口产生 `invoke(permission, () => { if (name === 'beforeFileReplace' && !machines.beforeFileReplace) return fallbackHooks.register(arg…` 供上层消费（`vm-access.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-access.ts`; this entry produces `invoke(permission, () => { if (name === 'beforeFileReplace' && !machines.beforeFileReplace) return fallbackHooks.register(arg…` for its caller. Module context: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
       * 处理：通过 `cleaning`, `queries.has`, `native.has`, `tickets.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `cleaning`, `queries.has`, `native.has`, `tickets.has`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: args: any[]
       * 输出 / Returns: `invoke(permission, () => { if (name === 'beforeFileReplace' && !machines.beforeFileReplace) return fallbackHooks.register(arg…`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `cleaning() && !queries.has(name) && name !== 'locked'`; `!native.has(name) || !id || !tickets.has(id) || tickets.get(id) !== machines.live.get(id)`; 异常 / errors `new AppError('清理调用不属于原客户机资源回执', 403, 'PLUGIN_CLEANUP_RECEIPT')`.
       */
      value: (...args: any[]) => {
        const id = typeof args[0] === 'string' ? args[0] : undefined;
        if (cleaning() && !queries.has(name) && name !== 'locked') {
          if (!native.has(name) || !id || !tickets.has(id) || tickets.get(id) !== machines.live.get(id))
            throw new AppError('清理调用不属于原客户机资源回执', 403, 'PLUGIN_CLEANUP_RECEIPT');
        }
        const permission = native.has(name) ? 'execution' : 'vm';
        /**
         * 入口 / Entry: vmAccess.callback@187.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（invoke）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (invoke).
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `fallbackHooks.register(args[0])`; `fallbackHooks.dispatch(args[0], args[1], args[2], args[3])`; `pending`；另有分支返回 / additional branch-specific returns.
         * 副作用 / Effects: `fallbackHooks.register`; `tickets.set`; `AbortSignal.any`; `scope.observe`; 更新 / updates `args[index]`, `args[1]`.
         * 拒绝 / Refusals: 条件 / conditions `native.has(name) && id && !cleaning()`; `bound && bound !== id`; 异常 / errors `new AppError('客户机不属于当前操作身份', 403, 'PLUGIN_VM_IDENTITY')`.
         */
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
            /**
             * 入口 / Entry: vmAccess.continuation.
             * 功能：在提供受身份与权限限制的虚拟机访问视图中，执行此领域的具体处理步骤并返回其结果；本入口产生 `instance ? withPluginContinuation(instance, resume) : resume()` 供上层消费（`vm-access.ts`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-access.ts`; this entry produces `instance ? withPluginContinuation(instance, resume) : resume()` for its caller. Module context: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
             * 处理：通过 `withPluginContinuation`, `resume` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `withPluginContinuation`, `resume`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: work: () => T
             * 输出 / Returns: T；结果来自 / values from `instance ? withPluginContinuation(instance, resume) : resume()`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            const continuation = <T>(work:
            /**
             * 中文功能：将 vmAccess.value.continuation.work 所属工作交给原调用上下文，按声明返回业务结果或异步拒绝。
             * English: Supplies work to the original context owned by vmAccess.value.continuation.work, returning the declared business result or asynchronous rejection.
             * 所属 / Owner: vmAccess.value.continuation.work.
             * 输入 / Inputs: 无显式参数 / no explicit parameters.
             * 结果 / Result: `T`.
             */
            () => T): T => {
              /**
               * 入口 / Entry: vmAccess.resume.
               * 功能：把本层请求转交 `withResourceContext`，沿用该实现的结果与失败路径。
               * Purpose: Delegates this request to `withResourceContext` and propagates the provider result or rejection.
               * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
               * 输出 / Returns: `withResourceContext({ ...transportIdentity, vmId: id, projectId }, () => withOperationCheck(admitted, work), )`.
               * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
               * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
               */
              const resume = () =>
                withResourceContext({ ...transportIdentity, vmId: id, projectId }, () =>
                  withOperationCheck(admitted, work),
                );
              return instance ? withPluginContinuation(instance, resume) : resume();
            };
            /**
             * 入口 / Entry: vmAccess.transport.
             * 功能：把本层请求转交 `invoke`，沿用该实现的结果与失败路径。
             * Purpose: Delegates this request to `invoke` and propagates the provider result or rejection.
             * 输入 / Inputs: work: () => T
             * 输出 / Returns: T；结果来自 / values from `invoke('execution', () => { const current = resourceContext(); if ( machines.live.get(id) !== live || (current?.vmId && curre…`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            const transport = <T>(work:
            /**
             * 中文功能：将 vmAccess.value.transport.work 所属工作交给原调用上下文，按声明返回业务结果或异步拒绝。
             * English: Supplies work to the original context owned by vmAccess.value.transport.work, returning the declared business result or asynchronous rejection.
             * 所属 / Owner: vmAccess.value.transport.work.
             * 输入 / Inputs: 无显式参数 / no explicit parameters.
             * 结果 / Result: `T`.
             */
            () => T): T =>
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
              /**
               * 入口 / Entry: vmAccess.args[1].
               * 功能：在提供受身份与权限限制的虚拟机访问视图中，执行此领域的具体处理步骤并返回其结果；本入口产生 `work(vmTransportPort(ftp, 'sftp', transport, continuation), ...rest)` 供上层消费（`vm-access.ts`）。
               * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-access.ts`; this entry produces `work(vmTransportPort(ftp, 'sftp', transport, continuation), ...rest)` for its caller. Module context: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
               * 处理：通过 `work`, `vmTransportPort` 协调依赖；下列分支决定是否继续、返回或拒绝。
               * Processing: Coordinates its dependencies through `work`, `vmTransportPort`; the branches below determine continuation, return or refusal.
               * 输入 / Inputs: ftp: object; rest: unknown[]
               * 输出 / Returns: `work(vmTransportPort(ftp, 'sftp', transport, continuation), ...rest)`.
               * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
               * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
               */
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
            /**
             * 入口 / Entry: vmAccess.args[1].
             * 功能：把本层请求转交 `invoke`，沿用该实现的结果与失败路径。
             * Purpose: Delegates this request to `invoke` and propagates the provider result or rejection.
             * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
             * 输出 / Returns: `invoke(permission, work)`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
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
      /**
       * 入口 / Entry: vmAccess.get.
       * 功能：在提供受身份与权限限制的虚拟机访问视图中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `readonlyMap(machines[name] || new Map(), name === 'records', name === 'live')` 供上层消费（`vm-access.ts`）。
       * Purpose: Reads/verifies domain state and constructs a caller-facing result in `vm-access.ts`; this entry produces `readonlyMap(machines[name] || new Map(), name === 'records', name === 'live')` for its caller. Module context: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
       * 处理：通过 `check`, `readonlyMap` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `check`, `readonlyMap`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `readonlyMap(machines[name] || new Map(), name === 'records', name === 'live')`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      get: () => {
        check();
        return readonlyMap(machines[name] || new Map(), name === 'records', name === 'live');
      },
    });
  Object.defineProperty(port, 'closing', {
    /**
     * 入口 / Entry: vmAccess.get.
     * 功能：从当前输入或状态计算 `machines.closing`，供调用方后续验证或使用。
     * Purpose: Computes `machines.closing` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `machines.closing`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
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
    /**
     * 入口 / Entry: vmAccess.get.
     * 功能：从当前输入或状态计算 `pools`，供调用方后续验证或使用。
     * Purpose: Computes `pools` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `pools`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    get: () => {
      check('storage');
      return pools;
    },
  });
  const engine: any = Object.create(null);
  for (const key of ['version', 'aarch64Available', 'whpxAvailable'] as const)
    Object.defineProperty(engine, key, {
      /**
       * 入口 / Entry: vmAccess.get.
       * 功能：从当前输入或状态计算 `machines.engine[key]`，供调用方后续验证或使用。
       * Purpose: Computes `machines.engine[key]` from current inputs/state for the caller to validate or consume.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `machines.engine[key]`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      get: () => {
        check();
        return machines.engine[key];
      },
    });
  for (const key of ['run', 'runStatus'] as const)
    Object.defineProperty(engine, key, {
      /**
       * 入口 / Entry: vmAccess.value.
       * 功能：把本层请求转交 `invoke`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `invoke` and propagates the provider result or rejection.
       * 输入 / Inputs: args: any[]
       * 输出 / Returns: `invoke('process', () => Reflect.apply(machines.engine[key], machines.engine, args))`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      value: (...args: any[]) =>
        invoke('process', () => Reflect.apply(machines.engine[key], machines.engine, args)),
    });
  port.engine = Object.freeze(engine);
  /**
   * 入口 / Entry: vmAccess.port.boot.
   * 功能：把本层请求转交 `invoke`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `invoke` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `invoke('vm', () => machines.live.get(id)?.startedAt)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  port.boot = (id: string) => invoke('vm', () => machines.live.get(id)?.startedAt);
  /**
   * 入口 / Entry: vmAccess.port.on.
   * 功能：在提供受身份与权限限制的虚拟机访问视图中，执行此领域的具体处理步骤并返回其结果；本入口产生 `port` 供上层消费（`vm-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-access.ts`; this entry produces `port` for its caller. Module context: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
   * 处理：通过 `check`, `listeners.get`, `listeners.set`, `byEvent.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `check`, `listeners.get`, `listeners.set`, `byEvent.has`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `byEvent.has(listener)`.
   * 输入 / Inputs: event: string | symbol; listener: (...args: any[]) => void
   * 输出 / Returns: `port`.
   * 副作用 / Effects: `listeners.get`; `listeners.set`; `byEvent.set`; `scope.signal.addEventListener`; `scope.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  port.on = (event: string | symbol, listener:
  /**
   * 中文功能：为 vmAccess.listener 登记事件、状态变化或阶段结束通知，接收本声明规定的事件数据。
   * English: Registers event/state-change/phase-completion notification for vmAccess.listener using its declared event data.
   * 所属 / Owner: vmAccess.listener.
   * 输入 / Inputs: ...args: any[].
   * 结果 / Result: `void`.
   */
  (...args: any[]) => void) => {
    check('events');
    const byEvent = listeners.get(event) || new Map();
    listeners.set(event, byEvent);
    if (byEvent.has(listener)) return port;
    const removeContribution = instance?.contribute('event', 'vm:' + String(event));
    /**
     * 入口 / Entry: vmAccess.managed.
     * 功能：在提供受身份与权限限制的虚拟机访问视图中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`vm-access.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-access.ts`; this entry produces `void` for its caller. Module context: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
     * 处理：通过 `withPluginBackground`, `run`, `scope.observe`, `result.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `withPluginBackground`, `run`, `scope.observe`, `result.catch`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `scope.signal.aborted`; `instance && instance.phase !== 'running'`; `result instanceof Promise`.
     * 输入 / Inputs: args: any[]
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `scope.observe`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const managed = (...args: any[]) => {
      if (scope.signal.aborted) return;
      /**
       * 入口 / Entry: vmAccess.run.
       * 功能：把本层请求转交 `listener`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `listener` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `listener(...args)`.
       * 副作用 / Effects: `listener`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const run = () => listener(...args);
      if (instance && instance.phase !== 'running') return;
      const result: any = instance ? withPluginBackground(instance, run) : run();
      if (result instanceof Promise) {
        scope.observe(result);
        void result.catch(() => {});
      }
    };
    machines.on(event, managed);
    /**
     * 入口 / Entry: vmAccess.unregister.
     * 功能：在提供受身份与权限限制的虚拟机访问视图中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`vm-access.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-access.ts`; the calls and state transitions below complete the operation. Module context: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
     * 处理：通过 `machines.off`, `byEvent.delete`, `removeContribution`, `scope.signal.removeEventListener` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `machines.off`, `byEvent.delete`, `removeContribution`, `scope.signal.removeEventListener`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `byEvent.delete`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
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
  /**
   * 入口 / Entry: vmAccess.port.off.
   * 功能：在提供受身份与权限限制的虚拟机访问视图中，执行此领域的具体处理步骤并返回其结果；本入口产生 `port` 供上层消费（`vm-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-access.ts`; this entry produces `port` for its caller. Module context: Exposes identity/authority-constrained VM views; cleanup calls must match original guest resource receipts.
   * 处理：通过 `listeners.get().get()`, `listeners.get().get`, `listeners.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `listeners.get().get()`, `listeners.get().get`, `listeners.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: event: string | symbol; listener: Function
   * 输出 / Returns: `port`.
   * 副作用 / Effects: `listeners.get().get()`; `listeners.get().get`; `listeners.get`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  port.off = (event: string | symbol, listener: Function) => {
    listeners.get(event)?.get(listener)?.();
    return port;
  };
  /**
   * 入口 / Entry: vmAccess.port.emit.
   * 功能：把本层请求转交 `invoke`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `invoke` and propagates the provider result or rejection.
   * 输入 / Inputs: event: string | symbol; args: any[]
   * 输出 / Returns: `invoke('events', () => { if (event !== 'change') throw new AppError('插件不能发布宿主生命周期事件', 403, 'PLUGIN_EVENT_DENIED'); return mac…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  port.emit = (event: string | symbol, ...args: any[]) =>
    invoke('events', () => {
      if (event !== 'change') throw new AppError('插件不能发布宿主生命周期事件', 403, 'PLUGIN_EVENT_DENIED');
      return machines.emit(event, ...args);
    });
  registerVmAccess(port, machines);
  return Object.freeze(port) as VmAccess;
}
