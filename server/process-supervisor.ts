/**
 * 模块职责：观察并管理宿主子进程及辅助程序，实际退出未确认时保留原进程资源额度。
 * Module purpose: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { hostRuntime, resourceContext, type ResourceLease } from './host-runtime/index.ts';
import { AppError } from '../shared/errors.ts';
import { pluginAuthority, pluginCleanup } from './plugin-authority.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
import { captureOperationCheck } from './operation-context.ts';

const nativeSpawnAdmission = new AsyncLocalStorage<{
  active: boolean;
  lease: ResourceLease;
  adapter: HostProcessAdapter;
  created?: ObservedHostProcess;
}>();
/** Only a synchronous, already-budgeted adapter construction may call the raw launcher. */
/**
 * 入口 / Entry: callback@19.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
 * 输入 / Inputs: args: unknown[]
 * 输出 / Returns: `child`.
 * 副作用 / Effects: 更新 / updates `admission.created`.
 * 拒绝 / Refusals: 条件 / conditions `!admission?.active || admission.created`; 异常 / errors `new Error('Host process has no unused active admission')`.
 */
export const spawnObserved = ((...args: unknown[]) => {
  const admission = nativeSpawnAdmission.getStore();
  if (!admission?.active || admission.created) throw new Error('Host process has no unused active admission');
  const child = Reflect.apply(spawn, undefined, args) as ChildProcess;
  admission.created = new ObservedHostProcess(child, admission.lease, admission.adapter);
  return child;
}) as typeof spawn;

export type ProcessAdmission = {
  owner: string;
  kind: 'vm' | 'tool' | 'helper';
  label: string;
  lane?: 'interactive' | 'background' | 'control';
  signal?: AbortSignal;
  queueTimeoutMs?: number;
  /** Known launch participants: a direct child or Native Host plus its target. */
  mode?: 'direct' | 'native-owner';
};
export type HelperExit = { code: number | null; signal: NodeJS.Signals | null; failure: string };
type HelperOptions = Omit<ProcessAdmission, 'kind' | 'mode'> & {
  helper: 'virtiofsd' | 'swtpm';
  file: string;
  args: string[];
  /**
   * 签名 / Signature: HelperOptions.onExit.
   * 功能：为观察并管理宿主子进程及辅助程序声明 onExit 的输入与结果契约，所属容器为 HelperOptions。
   * Purpose: Declares the input/result contract for onExit in HelperOptions. Module responsibility: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
   * 输入 / Inputs: exit: HelperExit
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  onExit?: (exit: HelperExit) => void;
  graceMs?: number;
  closeTimeoutMs?: number;
};
/**
 * 签名 / Signature: SpawnHelper.SpawnHelper.
 * 功能：为观察并管理宿主子进程及辅助程序声明 SpawnHelper 的输入与结果契约，所属容器为 SpawnHelper。
 * Purpose: Declares the input/result contract for SpawnHelper in SpawnHelper. Module responsibility: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
 * 输入 / Inputs: file: string; args: string[]
 * 输出 / Returns: ChildProcess.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
type SpawnHelper = (file: string, args: string[]) => ChildProcess;
export const hostProcessAdapters = {
  'windows-probe': 'tool',
  'ssh-permissions': 'tool',
  'trusted-boot-probe': 'tool',
  'trusted-update': 'tool',
  'virtio-fs-probe': 'tool',
  dpapi: 'tool',
  'process-interop': 'tool',
  'windows-registry': 'tool',
  'windows-user-application': 'tool',
  'clipboard-command': 'tool',
  'clipboard-launch': 'tool',
  'clipboard-descendants': 'helper',
  'gpg-discovery': 'tool',
  'gpg-asset-guard': 'helper',
  'gpg-native-relay': 'helper',
  'drill-watchdog': 'helper',
  'drill-probe': 'tool',
  'drill-validation-controller': 'helper',
} as const;
export type HostProcessAdapter = keyof typeof hostProcessAdapters;
/**
 * 入口 / Entry: startHelper.
 * 功能：把本层请求转交 `spawn`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `spawn` and propagates the provider result or rejection.
 * 输入 / Inputs: file; args
 * 输出 / Returns: `spawn(file, args, { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], })`.
 * 副作用 / Effects: `spawn`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const startHelper: SpawnHelper = (file, args) =>
  spawn(file, args, {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
/**
 * 入口 / Entry: cleanupError.
 * 功能：从当前输入或状态计算 `new AppError('宿主进程退出尚未确认，保留资源名额', 503, 'HOST_PROCESS_CLEANUP_PENDING')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('宿主进程退出尚未确认，保留资源名额', 503, 'HOST_PROCESS_CLEANUP_PENDING')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('宿主进程退出尚未确认，保留资源名额', 503, 'HOST_PROCESS_CLEANUP_PENDING')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const cleanupError = () =>
  new AppError('宿主进程退出尚未确认，保留资源名额', 503, 'HOST_PROCESS_CLEANUP_PENDING');

/** The governor owns admission; adapters retain their native ownership protocols. */
export class ProcessSupervisor {
  /**
   * 入口 / Entry: ProcessSupervisor.constructor.
   * 功能：建立 ProcessSupervisor 的观察并管理宿主子进程及辅助程序上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProcessSupervisor context for this module's responsibility: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: governor: Pick<typeof hostRuntime, 'acquire' | 'tryAcquire'> default=hostRuntime; spawnHelper: SpawnHelper default=startHelper
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private governor: Pick<typeof hostRuntime, 'acquire' | 'tryAcquire'> = hostRuntime,
    private spawnHelper: SpawnHelper = startHelper,
  ) {}

  /**
   * 入口 / Entry: ProcessSupervisor.acquire.
   * 功能：在观察并管理宿主子进程及辅助程序中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.governor.acquire({ owner: options.owner, kind: 'process.' + options.kind, label: options.label, lane: options.lane || 'b…` 供上层消费（`ProcessSupervisor`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProcessSupervisor`; this entry produces `this.governor.acquire({ owner: options.owner, kind: 'process.' + options.kind, label: options.label, lane: options.lane || 'b…` for its caller. Module context: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
   * 处理：通过 `pluginAuthority`, `pluginCleanup`, `instance.check`, `AbortSignal.any` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `pluginAuthority`, `pluginCleanup`, `instance.check`, `AbortSignal.any`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `instance`; `pluginCleanup() !== instance`.
   * 输入 / Inputs: options: ProcessAdmission
   * 输出 / Returns: `this.governor.acquire({ owner: options.owner, kind: 'process.' + options.kind, label: options.label, lane: options.lane || 'b…`.
   * 副作用 / Effects: `AbortSignal.any`; `this.governor.acquire().then`; `this.governor.acquire`; 更新 / updates `options`.
   * 拒绝 / Refusals: 条件 / conditions `!['direct', 'native-owner'].includes(mode) || (mode === 'native-owner' && options.kind === 'helper')`; 异常 / errors `new Error('Invalid process ownership mode')`.
   */
  private acquire(options: ProcessAdmission) {
    const instance = pluginAuthority();
    if (instance) {
      if (pluginCleanup() !== instance) instance.check('process', true);
      options = { ...options, owner: instance.owner, signal: pluginCleanup() === instance ? options.signal :
        options.signal ? AbortSignal.any([options.signal, instance.signal]) : instance.signal };
    }
    const mode = options.mode || 'direct';
    if (!['direct', 'native-owner'].includes(mode) || (mode === 'native-owner' && options.kind === 'helper'))
      throw new Error('Invalid process ownership mode');
    return this.governor.acquire({
      owner: options.owner,
      kind: 'process.' + options.kind,
      label: options.label,
      lane: options.lane || 'background',
      signal: options.signal,
      timeoutMs: options.queueTimeoutMs,
      cost: { process: mode === 'native-owner' ? 2 : 1, ['process.' + options.kind]: 1 },
    }).then(lease => {
      try { if (instance && pluginCleanup() !== instance) instance.check('process', true); }
      catch (error) { lease.release(); throw error; }
      return lease;
    });
  }

  /** 协议握手仍由适配器负责；此层观察实际创建的宿主子进程及其物理关闭。 */
  /**
   * 入口 / Entry: ProcessSupervisor.observe.
   * 功能：在观察并管理宿主子进程及辅助程序中，执行此领域的具体处理步骤并返回其结果；本入口产生 `nativeSpawnAdmission.run(admission, () => { const child = create(); if (admission.created && admission.created.child !== chil…` 供上层消费（`ProcessSupervisor`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProcessSupervisor`; this entry produces `nativeSpawnAdmission.run(admission, () => { const child = create(); if (admission.created && admission.created.child !== chil…` for its caller. Module context: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
   * 处理：通过 `pluginAuthority`, `pluginCleanup`, `instance.check`, `AbortSignal.any` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `pluginAuthority`, `pluginCleanup`, `instance.check`, `AbortSignal.any`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `instance && pluginCleanup() !== instance`; `instance`; `request.kind === 'helper' && request.lane !== 'control'`.
   * 输入 / Inputs: adapter: HostProcessAdapter; create: () => ChildProcess; options: Partial<Omit<ProcessAdmission, 'kind' | 'mode'>> default={}
   * 输出 / Returns: `nativeSpawnAdmission.run(admission, () => { const child = create(); if (admission.created && admission.created.child !== chil…`.
   * 副作用 / Effects: `AbortSignal.any`; `this.acquire`; `lease.release`; `admission.created.child.kill`; `admission.created.waitForClose`; 更新 / updates `options`, `admission.active`.
   * 拒绝 / Refusals: 条件 / conditions `!Object.hasOwn(hostProcessAdapters, adapter)`; `!lease`; `instance && pluginCleanup() !== instance`; 异常 / errors `new Error('Unknown host process adapter')`; `new AppError('宿主辅助进程已达到资源额度', 429, 'RESOURCE_CAPACITY')`.
   * 收尾：退出 try 区域时始终执行 `admission.active = false;`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `admission.active = false;`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `lease.release();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `lease.release();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async observe(
    adapter: HostProcessAdapter,
    create: () => ChildProcess,
    options: Partial<Omit<ProcessAdmission, 'kind' | 'mode'>> = {},
  ) {
    if (!Object.hasOwn(hostProcessAdapters, adapter)) throw new Error('Unknown host process adapter');
    const instance = pluginAuthority();
    if (instance && pluginCleanup() !== instance) instance.check('process', true);
    if (instance) options = { ...options, owner: instance.owner,
      signal: pluginCleanup() === instance ? options.signal : options.signal ? AbortSignal.any([options.signal, instance.signal]) : instance.signal };
    const request = {
      owner: options.owner || resourceContext()?.owner || `core:${adapter}`,
      label: adapter,
      ...options,
      kind: hostProcessAdapters[adapter],
      mode: 'direct' as const,
    };
    if (request.kind === 'helper' && request.lane !== 'control') await captureOperationCheck()();
    // 协议保护器可能已持有一个辅助进程；再排队申请会在额度耗尽时互等，所以即时准入或失败。
    const lease =
      request.kind === 'helper'
        ? this.governor.tryAcquire({
            ...request,
            kind: 'process.helper',
            cost: { process: 1, 'process.helper': 1 },
          })
        : await this.acquire(request);
    if (!lease) throw new AppError('宿主辅助进程已达到资源额度', 429, 'RESOURCE_CAPACITY');
    if (instance && pluginCleanup() !== instance) {
      try { instance.check('process', true); } catch (error) { lease.release(); throw error; }
    }
    const admission: NonNullable<ReturnType<typeof nativeSpawnAdmission.getStore>> = {
      active: true,
      lease,
      adapter,
    };
    try {
      options.signal?.throwIfAborted();
      try {
        return nativeSpawnAdmission.run(admission, () => {
          const child = create();
          if (admission.created && admission.created.child !== child)
            throw new Error('Host adapter returned another process');
          return admission.created || new ObservedHostProcess(child, lease, adapter);
        });
      } finally {
        admission.active = false;
      }
    } catch (error) {
      if (admission.created) {
        // 适配器可能创建子进程后才抛错；构造失败也必须保留额度直到确切子进程物理关闭。
        admission.created.child.kill('SIGKILL');
        await admission.created.waitForClose();
      } else lease.release();
      throw error;
    }
  }

  /**
   * 入口 / Entry: ProcessSupervisor.run.
   * 功能：在观察并管理宿主子进程及辅助程序中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await operation({ cleanupPending(error) { unresolved = true; lease.cleanupPending(error); }, })` 供上层消费（`ProcessSupervisor`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProcessSupervisor`; this entry produces `await operation({ cleanupPending(error) { unresolved = true; lease.cleanupPending(error); }, })` for its caller. Module context: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
   * 处理：通过 `this.acquire`, `options.signal.throwIfAborted`, `operation`, `lease.release` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.acquire`, `options.signal.throwIfAborted`, `operation`, `lease.release`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!unresolved`.
   * 输入 / Inputs: options: ProcessAdmission; operation: (control: { cleanupPending(error: unknown): void }) => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `await operation({ cleanupPending(error) { unresolved = true; lease.cleanupPending(error); }, })`.
   * 副作用 / Effects: `this.acquire`; `lease.release`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `if (!unresolved) lease.release();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `if (!unresolved) lease.release();`; these steps also apply to exceptional exits.
   */
  async run<T>(
    options: ProcessAdmission,
    operation: (control: {
    /**
     * 签名 / Signature: ProcessSupervisor.run.cleanupPending.
     * 功能：为观察并管理宿主子进程及辅助程序声明 cleanupPending 的输入与结果契约，所属容器为 ProcessSupervisor.run。
     * Purpose: Declares the input/result contract for cleanupPending in ProcessSupervisor.run. Module responsibility: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
     * 输入 / Inputs: error: unknown
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    cleanupPending(error: unknown): void }) => Promise<T>,
  ): Promise<T> {
    const lease = await this.acquire(options);
    let unresolved = false;
    try {
      options.signal?.throwIfAborted();
      // 取消只通知适配器；不以 Promise 竞速提前交还额度，必须收到实际退出/清理确认。
      return await operation({
        /**
         * 入口 / Entry: ProcessSupervisor.run.cleanupPending.
         * 功能：在观察并管理宿主子进程及辅助程序中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ProcessSupervisor`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProcessSupervisor`; the calls and state transitions below complete the operation. Module context: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
         * 处理：通过 `lease.cleanupPending` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `lease.cleanupPending`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: error
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 更新 / updates `unresolved`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        cleanupPending(error) {
          unresolved = true;
          lease.cleanupPending(error);
        },
      });
    } finally {
      if (!unresolved) lease.release();
    }
  }

  /**
   * 入口 / Entry: ProcessSupervisor.helper.
   * 功能：在观察并管理宿主子进程及辅助程序中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new ManagedHelper(this.spawnHelper(options.file, [...options.args]), lease, options)` 供上层消费（`ProcessSupervisor`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProcessSupervisor`; this entry produces `new ManagedHelper(this.spawnHelper(options.file, [...options.args]), lease, options)` for its caller. Module context: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
   * 处理：通过 `inline.includes`, `this.acquire`, `options.signal.throwIfAborted`, `this.spawnHelper` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.includes`, `this.acquire`, `options.signal.throwIfAborted`, `this.spawnHelper`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: options: HelperOptions
   * 输出 / Returns: Promise<ManagedHelper>；结果来自 / values from `new ManagedHelper(this.spawnHelper(options.file, [...options.args]), lease, options)`.
   * 副作用 / Effects: `this.acquire`; `this.spawnHelper`; `lease.release`.
   * 拒绝 / Refusals: 条件 / conditions `!['virtiofsd', 'swtpm'].includes(options.helper)`; `!Number.isSafeInteger(value) || value < 0 || value > 2147483647`; 异常 / errors `new Error('Unknown managed helper')`; `new Error('Invalid helper close deadline')`.
   * 失败处理：catch 分支执行 `lease.release();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `lease.release();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async helper(options: HelperOptions): Promise<ManagedHelper> {
    if (!['virtiofsd', 'swtpm'].includes(options.helper)) throw new Error('Unknown managed helper');
    for (const value of [options.graceMs ?? 2000, options.closeTimeoutMs ?? 5000])
      if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647)
        throw new Error('Invalid helper close deadline');
    const lease = await this.acquire({ ...options, kind: 'helper', mode: 'direct' });
    try {
      options.signal?.throwIfAborted();
      return new ManagedHelper(this.spawnHelper(options.file, [...options.args]), lease, options);
    } catch (error) {
      lease.release();
      throw error;
    }
  }
}

/** EOF、取消或 exit 都不等于物理关闭；迟到的 close 仍能核销原先待清理的额度。 */
export class ObservedHostProcess {
  readonly closed: Promise<HelperExit>;
  private actual?: HelperExit;
  private error?: Error;
  /**
   * 入口 / Entry: ObservedHostProcess.constructor.
   * 功能：建立 ObservedHostProcess 的观察并管理宿主子进程及辅助程序上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ObservedHostProcess context for this module's responsibility: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: child: ChildProcess; lease: ResourceLease; adapter: HostProcessAdapter
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    readonly child: ChildProcess,
    private lease: ResourceLease,
    private adapter: HostProcessAdapter,
  ) {
    child.on('error', (error) => {
      this.error = error;
    });
    this.closed = new Promise((resolve) =>
      child.once('close', (code, signal) => {
        this.actual = { code, signal, failure: this.error?.message || '' };
        lease.release();
        resolve(this.actual);
      }),
    );
  }
  /**
   * 入口 / Entry: ObservedHostProcess.cleanupPending.
   * 功能：在观察并管理宿主子进程及辅助程序中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ObservedHostProcess`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ObservedHostProcess`; the calls and state transitions below complete the operation. Module context: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
   * 处理：通过 `this.lease.cleanupPending` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.lease.cleanupPending`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.actual`.
   * 输入 / Inputs: error: unknown
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  cleanupPending(error: unknown) {
    if (!this.actual) this.lease.cleanupPending(error);
  }
  /**
   * 入口 / Entry: ObservedHostProcess.waitForClose.
   * 功能：在观察并管理宿主子进程及辅助程序中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.actual` / `await Promise.race([ this.closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(cleanupError()), timeou…` 供上层消费（`ObservedHostProcess`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ObservedHostProcess`; this entry produces `this.actual` / `await Promise.race([ this.closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(cleanupError()), timeou…` for its caller. Module context: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
   * 处理：通过 `Promise.race`, `this.cleanupPending`, `clearTimeout` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.race`, `this.cleanupPending`, `clearTimeout`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.actual`.
   * 输入 / Inputs: timeoutMs: default=5000
   * 输出 / Returns: `this.actual`; `await Promise.race([ this.closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(cleanupError()), timeou…`.
   * 副作用 / Effects: `clearTimeout`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 收尾：退出 try 区域时始终执行 `clearTimeout(timer);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `clearTimeout(timer);`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `this.cleanupPending(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.cleanupPending(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async waitForClose(timeoutMs = 5000) {
    if (this.actual) return this.actual;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.closed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(cleanupError()), timeoutMs);
        }),
      ]);
    } catch (error) {
      this.cleanupPending(error);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  /**
   * 入口 / Entry: ObservedHostProcess.handoffToUser.
   * 功能：在观察并管理宿主子进程及辅助程序中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ObservedHostProcess`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ObservedHostProcess`; the calls and state transitions below complete the operation. Module context: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
   * 处理：通过 `this.lease.transfer`, `this.lease.release` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.lease.transfer`, `this.lease.release`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.lease.release`.
   * 拒绝 / Refusals: 条件 / conditions `this.adapter !== 'windows-user-application'`; 异常 / errors `new Error('This process cannot be handed off')`.
   */
  handoffToUser() {
    if (this.adapter !== 'windows-user-application') throw new Error('This process cannot be handed off');
    this.lease.transfer('user:desktop');
    this.lease.release();
  }
}

export class ManagedHelper {
  readonly closed: Promise<HelperExit>;
  private actual?: HelperExit;
  private ended = false;
  private closing = false;
  private closeTask?: Promise<void>;
  private tail = Buffer.alloc(0);
  private spawnFailure?: Error;
  /**
   * 签名 / Signature: ManagedHelper.abort.
   * 功能：为观察并管理宿主子进程及辅助程序声明 abort 的输入与结果契约，所属容器为 ManagedHelper。
   * Purpose: Declares the input/result contract for abort in ManagedHelper. Module responsibility: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private readonly abort: () => void;

  /**
   * 入口 / Entry: ManagedHelper.constructor.
   * 功能：建立 ManagedHelper 的观察并管理宿主子进程及辅助程序上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ManagedHelper context for this module's responsibility: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: child: ChildProcess; lease: ResourceLease; options: HelperOptions
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `options.signal.addEventListener`; `this.abort`; 更新 / updates `this.closed`, `this.abort`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    private child: ChildProcess,
    private lease: ResourceLease,
    private options: HelperOptions,
  ) {
    child.stderr?.on('data', (data: Buffer) => {
      this.tail = Buffer.concat([this.tail, data.subarray(-16384)]).subarray(-16384);
    });
    child.on('error', (error) => {
      this.spawnFailure = error;
    });
    let notified = false;
    /**
     * 入口 / Entry: ManagedHelper.constructor.notify.
     * 功能：在观察并管理宿主子进程及辅助程序中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`ManagedHelper`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ManagedHelper`; this entry produces `void` for its caller. Module context: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
     * 处理：通过 `options.onExit` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `options.onExit`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `this.closing || notified`.
     * 输入 / Inputs: exit: HelperExit
     * 输出 / Returns: `void`.
     * 副作用 / Effects: 更新 / updates `notified`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 失败处理：catch 分支执行 ，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute ; these statements determine whether a failure is absorbed or rejected again.
     */
    const notify = (exit: HelperExit) => {
      if (this.closing || notified) return;
      notified = true;
      try {
        options.onExit?.(exit);
      } catch {
        /* The owner cannot prevent resource release. */
      }
    };
    child.once('exit', (code, signal) => {
      this.ended = true;
      notify({ code, signal, failure: this.failure });
    });
    /**
     * 入口 / Entry: ManagedHelper.constructor.callback@284.
     * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（child.once / close）。
     * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (child.once / close).
     * 输入 / Inputs: code; signal
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `lease.release`; 更新 / updates `this.ended`, `this.actual`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    this.closed = new Promise((resolve) =>
      child.once('close', (code, signal) => {
        this.ended = true;
        this.actual = { code, signal, failure: this.failure };
        options.signal?.removeEventListener('abort', this.abort);
        // kill 请求及 exit 事件仍不证明 stdio 已关闭；此 close 回调才释放进程额度。
        lease.release();
        resolve(this.actual);
        notify(this.actual);
      }),
    );
    /**
     * 入口 / Entry: ManagedHelper.constructor.this.abort.
     * 功能：在观察并管理宿主子进程及辅助程序中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ManagedHelper`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ManagedHelper`; the calls and state transitions below complete the operation. Module context: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
     * 处理：通过 `this.close().catch`, `this.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.close().catch`, `this.close`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.close().catch`; `this.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    this.abort = () => {
      void this.close().catch(() => {});
    };
    options.signal?.addEventListener('abort', this.abort, { once: true });
    if (options.signal?.aborted) this.abort();
  }
  /**
   * 入口 / Entry: ManagedHelper.failure.
   * 功能：在观察并管理宿主子进程及辅助程序中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.spawnFailure?.message || this.tail.toString('utf8').trim()` 供上层消费（`ManagedHelper`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ManagedHelper`; this entry produces `this.spawnFailure?.message || this.tail.toString('utf8').trim()` for its caller. Module context: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
   * 处理：通过 `this.tail.toString().trim`, `this.tail.toString` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.tail.toString().trim`, `this.tail.toString`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.spawnFailure?.message || this.tail.toString('utf8').trim()`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  get failure() {
    return this.spawnFailure?.message || this.tail.toString('utf8').trim();
  }
  /**
   * 入口 / Entry: ManagedHelper.exited.
   * 功能：向调用者提供 `this.ended` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.ended` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.ended`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get exited() {
    return this.ended;
  }

  /**
   * 入口 / Entry: ManagedHelper.ready.
   * 功能：在观察并管理宿主子进程及辅助程序中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `void` 供上层消费（`ManagedHelper`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ManagedHelper`; this entry produces `void` for its caller. Module context: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
   * 处理：通过 `performance.now`, `this.options.signal.throwIfAborted`, `Promise.race().finally`, `Promise.race` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `performance.now`, `this.options.signal.throwIfAborted`, `Promise.race().finally`, `Promise.race`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `found && !this.ended && !this.closing`.
   * 输入 / Inputs: probe: () => Promise<boolean>; timeoutMs: default=5000
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.closed.then`.
   * 拒绝 / Refusals: 条件 / conditions `!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647`; 异常 / errors `new Error('Invalid helper readiness deadline')`; `new AppError(this.failure || `${this.options.helper} 未在限时内就绪`, 503)`.
   */
  async ready(probe: () => Promise<boolean>, timeoutMs = 5000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647)
      throw new Error('Invalid helper readiness deadline');
    const deadline = performance.now() + timeoutMs;
    while (!this.ended && !this.spawnFailure && !this.closing && performance.now() < deadline) {
      this.options.signal?.throwIfAborted();
      const remaining = Math.max(1, deadline - performance.now());
      let timer: ReturnType<typeof setTimeout> | undefined;
      const found = await Promise.race([
        probe(),
        this.closed.then(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), remaining);
        }),
      ]).finally(() => clearTimeout(timer));
      this.options.signal?.throwIfAborted();
      if (found && !this.ended && !this.closing) return;
      await delay(50);
    }
    throw new AppError(this.failure || `${this.options.helper} 未在限时内就绪`, 503);
  }

  /**
   * 入口 / Entry: ManagedHelper.close.
   * 功能：在观察并管理宿主子进程及辅助程序中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.closeTask` 供上层消费（`ManagedHelper`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ManagedHelper`; this entry produces `this.closeTask` for its caller. Module context: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
   * 处理：通过 `Promise.resolve().then().catch`, `Promise.resolve().then`, `Promise.resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.resolve().then().catch`, `Promise.resolve().then`, `Promise.resolve`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closeTask`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>；结果来自 / values from `this.closeTask`.
   * 副作用 / Effects: 更新 / updates `this.closing`, `this.closeTask`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closing = true;
    /**
     * 入口 / Entry: ManagedHelper.close.callback@333.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.resolve().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.resolve().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `this.child.kill`.
     * 拒绝 / Refusals: 异常 / errors `cleanupError()`.
     */
    this.closeTask = Promise.resolve()
      .then(async () => {
        if (this.actual) return;
        /**
         * 入口 / Entry: ManagedHelper.close.wait.
         * 功能：在观察并管理宿主子进程及辅助程序中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Promise.race([ this.closed.then(() => true), new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms)…` 供上层消费（`ManagedHelper`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `ManagedHelper`; this entry produces `Promise.race([ this.closed.then(() => true), new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms)…` for its caller. Module context: Owns host children/helpers and retains process capacity until actual physical exit/closure is confirmed.
         * 处理：通过 `Promise.race().finally`, `Promise.race`, `this.closed.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `Promise.race().finally`, `Promise.race`, `this.closed.then`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: ms: number
         * 输出 / Returns: `Promise.race([ this.closed.then(() => true), new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms)…`.
         * 副作用 / Effects: `this.closed.then`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const wait = async (ms: number) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          return Promise.race([
            this.closed.then(() => true),
            new Promise<boolean>((resolve) => {
              timer = setTimeout(() => resolve(false), ms);
            }),
          ]).finally(() => clearTimeout(timer));
        };
        if (!this.ended) this.child.kill('SIGTERM');
        if (await wait(this.options.graceMs ?? 2000)) return;
        if (!this.ended) this.child.kill('SIGKILL');
        if (await wait(this.options.closeTimeoutMs ?? 5000)) return;
        throw cleanupError();
      })
      .catch((error) => {
        this.lease.cleanupPending(error);
        this.closeTask = undefined;
        throw error;
      });
    return this.closeTask;
  }
}

export const processSupervisor = new ProcessSupervisor();
