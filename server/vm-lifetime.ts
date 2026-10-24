/**
 * 模块职责：跟踪客户机运行代次、活动和状态切换屏障，旧身份执行在代次变化后失效。
 * Module purpose: Tracks VM process/execution generations, activities and transition barriers, invalidating old executions when identities advance.
 */
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from '../shared/errors.ts';
import { ResourceScope } from './resource-scope.ts';
import type { Live } from './vm-state.ts';
import { vmHostIdentity, vmLiveIdentity, type VmLive } from './vm-reference.ts';
import type { VmNetworkLease } from './network/index.ts';
import type { VMRecord } from '../shared/contracts/vm.ts';
import type { BootAttachment } from './machines.ts';
import { pluginAuthority, withPluginAuthority, withPluginCleanup } from './plugin-authority.ts';
import { cleanupReceipt } from './cleanup-receipt.ts';

export type VmSnapshotProvider = {
  /**
   * 签名 / Signature: VmSnapshotProvider.capture.
   * 功能：为跟踪客户机运行代次、活动和状态切换屏障声明 capture 的输入与结果契约，所属容器为 VmSnapshotProvider。
   * Purpose: Declares the input/result contract for capture in VmSnapshotProvider. Module responsibility: Tracks VM process/execution generations, activities and transition barriers, invalidating old executions when identities advance.
   * 输入 / Inputs: id: string; snapshotId: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  capture(id: string, snapshotId: string): Promise<void>;
  /**
   * 签名 / Signature: VmSnapshotProvider.prepareRestore.
   * 功能：为跟踪客户机运行代次、活动和状态切换屏障声明 prepareRestore 的输入与结果契约，所属容器为 VmSnapshotProvider。
   * Purpose: Declares the input/result contract for prepareRestore in VmSnapshotProvider. Module responsibility: Tracks VM process/execution generations, activities and transition barriers, invalidating old executions when identities advance.
   * 输入 / Inputs: id: string; snapshotId: string
   * 输出 / Returns: Promise<() => Promise<void>>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  prepareRestore(id: string, snapshotId: string): Promise<
  /**
   * 中文功能：在快照恢复发布前完成提供者准备的异步钩子。
   * English: Asynchronous provider-preparation hook before publishing a snapshot restore.
   * 所属 / Owner: VmSnapshotProvider.prepareRestore.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `Promise<void>`.
   */
  () => Promise<void>>;
  /**
   * 签名 / Signature: VmSnapshotProvider.remove.
   * 功能：为跟踪客户机运行代次、活动和状态切换屏障声明 remove 的输入与结果契约，所属容器为 VmSnapshotProvider。
   * Purpose: Declares the input/result contract for remove in VmSnapshotProvider. Module responsibility: Tracks VM process/execution generations, activities and transition barriers, invalidating old executions when identities advance.
   * 输入 / Inputs: id: string; snapshotId: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  remove(id: string, snapshotId: string): Promise<void>;
  /**
   * 签名 / Signature: VmSnapshotProvider.ensureOnlineAllowed.
   * 功能：为跟踪客户机运行代次、活动和状态切换屏障声明 ensureOnlineAllowed 的输入与结果契约，所属容器为 VmSnapshotProvider。
   * Purpose: Declares the input/result contract for ensureOnlineAllowed in VmSnapshotProvider. Module responsibility: Tracks VM process/execution generations, activities and transition barriers, invalidating old executions when identities advance.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  ensureOnlineAllowed(id: string): Promise<void>;
};

export type VmBootProvider = {
  /**
   * 签名 / Signature: VmBootProvider.prepare.
   * 功能：为跟踪客户机运行代次、活动和状态切换屏障声明 prepare 的输入与结果契约，所属容器为 VmBootProvider。
   * Purpose: Declares the input/result contract for prepare in VmBootProvider. Module responsibility: Tracks VM process/execution generations, activities and transition barriers, invalidating old executions when identities advance.
   * 输入 / Inputs: vm: VMRecord; onExit: (error: string) => void
   * 输出 / Returns: Promise<BootAttachment | undefined>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  prepare(vm: VMRecord, onExit:
  /**
   * 中文功能：报告当前启动提供者退出原因的生命周期通知。
   * English: Lifecycle notification reporting the current boot provider exit reason.
   * 所属 / Owner: VmBootProvider.prepare.onExit.
   * 输入 / Inputs: error: string.
   * 结果 / Result: `void`.
   */
  (error: string) => void): Promise<BootAttachment | undefined>;
  /**
   * 签名 / Signature: VmBootProvider.firmware.
   * 功能：为跟踪客户机运行代次、活动和状态切换屏障声明 firmware 的输入与结果契约，所属容器为 VmBootProvider。
   * Purpose: Declares the input/result contract for firmware in VmBootProvider. Module responsibility: Tracks VM process/execution generations, activities and transition barriers, invalidating old executions when identities advance.
   * 输入 / Inputs: vm: VMRecord
   * 输出 / Returns: Promise<{ code: string; vars: string } | undefined>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  firmware?(vm: VMRecord): Promise<{ code: string; vars: string } | undefined>;
  allowInitialReset?: boolean;
  /**
   * 签名 / Signature: VmBootProvider.stateFingerprint.
   * 功能：为跟踪客户机运行代次、活动和状态切换屏障声明 stateFingerprint 的输入与结果契约，所属容器为 VmBootProvider。
   * Purpose: Declares the input/result contract for stateFingerprint in VmBootProvider. Module responsibility: Tracks VM process/execution generations, activities and transition barriers, invalidating old executions when identities advance.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<string>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  stateFingerprint?(id: string): Promise<string>;
  snapshot?: VmSnapshotProvider;
};
const bootProviders = new WeakMap<object, Map<string, VmBootProvider>>();
/**
 * 入口 / Entry: registerVmBootProvider.
 * 功能：在宿主身份下登记唯一 boot 提供者，并绑定插件权限、贡献及原附件清理回执。
 * Purpose: Registers a unique boot provider under the host identity and binds plugin authority, contribution ownership and original-attachment cleanup receipts.
 * 输入 / Inputs: owner: object; name: string; provider: VmBootProvider
 * 输出 / Returns: `unregister`.
 * 副作用 / Effects: `bootProviders.set`; `providers.set`; `instance.scope.add`; 更新 / updates `owner`, `providers`.
 * 拒绝 / Refusals: 条件 / conditions `providers.has(name)`; 异常 / errors `new Error(`VM boot provider already registered: ${name}`)`.
 */
export function registerVmBootProvider(owner: object, name: string, provider: VmBootProvider) {
  owner = vmHostIdentity(owner);
  const instance = pluginAuthority();
  instance?.check('events', true);
  let providers = bootProviders.get(owner);
  if (!providers) bootProviders.set(owner, (providers = new Map()));
  if (providers.has(name)) throw new Error(`VM boot provider already registered: ${name}`);
  const removeContribution = instance?.contribute('interceptor', 'vm-boot:' + name);
  /**
   * 入口 / Entry: registerVmBootProvider.callback@41.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
   * 输入 / Inputs: args: A
   * 输出 / Returns: R；结果来自 / values from `work(...args)`; `value`.
   * 副作用 / Effects: `instance.scope.observe`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  /**
   * 入口 / Entry: registerVmBootProvider.bind.
   * 功能：在跟踪客户机运行代次、活动和状态切换屏障中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(...args: A): R => { if (!instance) return work(...args); const value = withPluginAuthority(instance, () => work(...args)); i…` / `work(...args)` 供上层消费（`vm-lifetime.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-lifetime.ts`; this entry produces `(...args: A): R => { if (!instance) return work(...args); const value = withPluginAuthority(instance, () => work(...args)); i…` / `work(...args)` for its caller. Module context: Tracks VM process/execution generations, activities and transition barriers, invalidating old executions when identities advance.
   * 处理：通过 `work`, `withPluginAuthority`, `instance.scope.observe` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `work`, `withPluginAuthority`, `instance.scope.observe`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!instance`; `value instanceof Promise`.
   * 输入 / Inputs: work: (...args: A) => R
   * 输出 / Returns: `(...args: A): R => { if (!instance) return work(...args); const value = withPluginAuthority(instance, () => work(...args)); i…`; `work(...args)`; `value`.
   * 副作用 / Effects: `instance.scope.observe`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const bind =
    <A extends unknown[], R>(work:
    /**
     * 中文功能：将 registerVmBootProvider.bind.work 所属工作交给原调用上下文，按声明返回业务结果或异步拒绝。
     * English: Supplies work to the original context owned by registerVmBootProvider.bind.work, returning the declared business result or asynchronous rejection.
     * 所属 / Owner: registerVmBootProvider.bind.work.
     * 输入 / Inputs: ...args: A.
     * 结果 / Result: `R`.
     */
    (...args: A) => R) =>
    (...args: A): R => {
      if (!instance) return work(...args);
      const value = withPluginAuthority(instance, () => work(...args));
      if (value instanceof Promise) instance.scope.observe(value);
      return value;
    };
  const managed: VmBootProvider = instance
    ? {
        allowInitialReset: provider.allowInitialReset,
        prepare: bind(async (...args: Parameters<VmBootProvider['prepare']>) => {
          const attachment = await provider.prepare(...args);
          return (
            attachment && {
              ...attachment,
              close: cleanupReceipt(() => withPluginCleanup(instance, attachment.close)),
            }
          );
        }),
        firmware: provider.firmware && bind(provider.firmware.bind(provider)),
        stateFingerprint: provider.stateFingerprint && bind(provider.stateFingerprint.bind(provider)),
        snapshot: provider.snapshot && {
          capture: bind(provider.snapshot.capture.bind(provider.snapshot)),
          remove: bind(provider.snapshot.remove.bind(provider.snapshot)),
          ensureOnlineAllowed: bind(provider.snapshot.ensureOnlineAllowed.bind(provider.snapshot)),
          prepareRestore: bind(async (id: string, snapshotId: string) =>
            bind(await provider.snapshot!.prepareRestore(id, snapshotId)),
          ),
        },
      }
    : provider;
  providers.set(name, managed);
  const unregister = cleanupReceipt(() => {
    if (providers!.get(name) === managed) providers!.delete(name);
    removeContribution?.();
  });
  if (instance) instance.scope.add(unregister);
  return unregister;
}
/**
 * 入口 / Entry: vmBootProviders.
 * 功能：返回指定宿主身份当前登记的 boot 提供者条目快照。
 * Purpose: Returns an entry snapshot of the boot providers registered for the specified host identity.
 * 输入 / Inputs: owner: object
 * 输出 / Returns: ReadonlyArray<readonly [string, VmBootProvider]>；结果来自 / values from `[...(bootProviders.get(vmHostIdentity(owner)) || [])]`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function vmBootProviders(owner: object): ReadonlyArray<readonly [string, VmBootProvider]> {
  return [...(bootProviders.get(vmHostIdentity(owner)) || [])];
}

export type VmIdentity = Readonly<{
  vmId: string;
  vmProcessId: string;
  executionGeneration: string;
  bootId?: string;
  networkGeneration?: string;
}>;
type Activity = {
  abort: AbortController;
  done: Promise<void>;
  persistent: boolean;
  failure?: unknown;
  /**
   * 签名 / Signature: Activity.release.
   * 功能：为跟踪客户机运行代次、活动和状态切换屏障声明 release 的输入与结果契约，所属容器为 Activity。
   * Purpose: Declares the input/result contract for release in Activity. Module responsibility: Tracks VM process/execution generations, activities and transition barriers, invalidating old executions when identities advance.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  release(): void;
};
const legacy = new WeakMap<object, VmLifetime>();
const exclusiveContext = new AsyncLocalStorage<{ lifetime: VmLifetime; active: boolean }>();
/** 本体预约只重入当前 VM 排他域；不恢复调用者、资源归属或业务授权上下文。 */
export function captureVmExclusive(lifetime: VmLifetime) {
  const context = exclusiveContext.getStore();
  if (!context?.active || context.lifetime !== lifetime) throw changed();
  const identity = lifetime.capture();
  return <T>(work: () => T): T => {
    if (!context.active) throw changed();
    lifetime.assert(identity);
    return exclusiveContext.run(context, work);
  };
}
/**
 * 入口 / Entry: changed.
 * 功能：从当前输入或状态计算 `new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const changed = () => new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');

/** 宿主进程、恢复内存后的执行代次与客户机 boot 是独立身份，不能用其中一个替代全部核对。 */
export class VmLifetime {
  readonly vmProcessId = randomUUID();
  readonly resources: ResourceScope;
  private generation = randomUUID();
  private execution = new AbortController();
  private observedBoot?: string;
  private bootGeneration?: string;
  private network?: VmNetworkLease;
  private activities = new Set<Activity>();
  private barriers = 0;
  private ended = false;
  private ownsNetwork = false;
  /**
   * 入口 / Entry: VmLifetime.constructor.
   * 功能：建立 VmLifetime 的跟踪客户机运行代次、活动和状态切换屏障上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the VmLifetime context for this module's responsibility: Tracks VM process/execution generations, activities and transition barriers, invalidating old executions when identities advance. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: vmId: string; abort: default=new AbortController()
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `abort.signal.addEventListener`; 更新 / updates `this.resources`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    readonly vmId: string,
    readonly abort = new AbortController(),
  ) {
    this.resources = new ResourceScope({ owner: `vm:${vmId}`, signal: abort.signal });
    abort.signal.addEventListener(
      'abort',
      () => {
        this.ended = true;
        this.execution.abort(abort.signal.reason);
        for (const activity of this.activities) activity.abort.abort(abort.signal.reason);
      },
      { once: true },
    );
  }
  /**
   * 入口 / Entry: VmLifetime.signal.
   * 功能：向调用者提供 `this.execution.signal` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.execution.signal` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.execution.signal`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get signal() {
    return this.execution.signal;
  }
  /**
   * 入口 / Entry: VmLifetime.lastObservedBootId.
   * 功能：向调用者提供 `this.observedBoot` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.observedBoot` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.observedBoot`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get lastObservedBootId() {
    return this.observedBoot;
  }
  /**
   * 入口 / Entry: VmLifetime.active.
   * 功能：向调用者提供 `this.activities.size` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.activities.size` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.activities.size`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get active() {
    return this.activities.size;
  }
  /**
   * 入口 / Entry: VmLifetime.admitting.
   * 功能：向调用者提供 `!this.ended && !this.abort.signal.aborted && this.barriers === 0` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `!this.ended && !this.abort.signal.aborted && this.barriers === 0` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `!this.ended && !this.abort.signal.aborted && this.barriers === 0`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get admitting() {
    return !this.ended && !this.abort.signal.aborted && this.barriers === 0;
  }
  /**
   * 入口 / Entry: VmLifetime.capture.
   * 功能：冻结 VM 进程、执行代次以及当前已确认 boot 和网络代次，生成完整执行票据。
   * Purpose: Freezes VM-process and execution generations with the currently confirmed boot and network generations into an execution ticket.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: VmIdentity；结果来自 / values from `Object.freeze({ vmId: this.vmId, vmProcessId: this.vmProcessId, executionGeneration: this.generation, ...(this.observedBoot &…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  capture(): VmIdentity {
    return Object.freeze({
      vmId: this.vmId,
      vmProcessId: this.vmProcessId,
      executionGeneration: this.generation,
      ...(this.observedBoot && this.bootGeneration === this.generation ? { bootId: this.observedBoot } : {}),
      ...(this.network ? { networkGeneration: this.network.generation } : {}),
    });
  }
  /**
   * 入口 / Entry: VmLifetime.assert.
   * 功能：核对票据各代次与当前生命周期，任一改变或停止都拒绝旧操作。
   * Purpose: Checks ticket generations against the current lifetime, rejecting stale work after any identity change or shutdown.
   * 输入 / Inputs: identity: VmIdentity
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.ended || this.abort.signal.aborted || identity.vmId !== this.vmId || identity.vmProcessId !== this.vmProcessId || identi…`; 异常 / errors `changed()`.
   */
  assert(identity: VmIdentity) {
    if (
      this.ended ||
      this.abort.signal.aborted ||
      identity.vmId !== this.vmId ||
      identity.vmProcessId !== this.vmProcessId ||
      identity.executionGeneration !== this.generation ||
      (identity.bootId !== undefined && identity.bootId !== this.observedBoot) ||
      (identity.networkGeneration !== undefined && identity.networkGeneration !== this.network?.generation)
    )
      throw changed();
  }
  /**
   * 入口 / Entry: VmLifetime.observeBoot.
   * 功能：校验实际客户机 boot UUID，当前代次内 boot 改变时推进执行代次。
   * Purpose: Validates an observed guest boot UUID and advances execution generation when boot changes within the current generation.
   * 输入 / Inputs: bootId: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.observedBoot`, `this.bootGeneration`.
   * 拒绝 / Refusals: 条件 / conditions `!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(bootId)`; 异常 / errors `new Error('Invalid observed guest boot identity')`.
   */
  observeBoot(bootId: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(bootId))
      throw new Error('Invalid observed guest boot identity');
    if (this.bootGeneration === this.generation && this.observedBoot && this.observedBoot !== bootId)
      this.advanceExecution();
    this.observedBoot = bootId;
    this.bootGeneration = this.generation;
  }
  /**
   * 入口 / Entry: VmLifetime.advanceExecution.
   * 功能：取消旧执行信号并生成新执行代次，保留最后读到的 boot 但不确认它属于新代次。
   * Purpose: Cancels the old execution signal and creates a new generation, retaining the last observed boot without confirming it for that new generation.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.capture()`.
   * 副作用 / Effects: `this.execution.abort`; 更新 / updates `this.execution`, `this.generation`.
   * 拒绝 / Refusals: 条件 / conditions `this.ended || this.abort.signal.aborted`; 异常 / errors `changed()`.
   */
  advanceExecution() {
    if (this.ended || this.abort.signal.aborted) throw changed();
    this.execution.abort(changed());
    this.execution = new AbortController();
    this.generation = randomUUID();
    // 保留最后实际读到的 boot，但不把它盖到未观察的新代次上；恢复内存也可能回到旧 boot_id。
    return this.capture();
  }
  /**
   * 入口 / Entry: VmLifetime.setNetwork.
   * 功能：接管匹配此 VM 的网络租约并登记生命周期清理；无效归属先关闭新租约再拒绝。
   * Purpose: Takes ownership of a network lease matching this VM and registers lifetime cleanup; an invalid owner closes the new lease before rejection.
   * 输入 / Inputs: lease: VmNetworkLease
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `lease.close`; `this.resources.defer`; 更新 / updates `this.network`, `this.ownsNetwork`.
   * 拒绝 / Refusals: 条件 / conditions `lease.vmId !== this.vmId || this.ended || this.abort.signal.aborted`; 异常 / errors `changed()`.
   */
  async setNetwork(lease: VmNetworkLease) {
    if (lease.vmId !== this.vmId || this.ended || this.abort.signal.aborted) {
      await lease.close();
      throw changed();
    }
    this.network = lease;
    if (!this.ownsNetwork) {
      this.resources.defer('network', () => this.network?.close(), 20);
      this.ownsNetwork = true;
    }
  }
  /**
   * 入口 / Entry: VmLifetime.own.
   * 功能：接管可关闭资源，生命周期已结束或登记失败时先清理新资源再拒绝。
   * Purpose: Takes ownership of a closable resource, disposing it before rejection when the lifetime has ended or registration fails.
   * 输入 / Inputs: name: string; resource: T; order: default=0
   * 输出 / Returns: Promise<T>；结果来自 / values from `this.resources.own(name, resource, order)`.
   * 副作用 / Effects: `resource.close`.
   * 拒绝 / Refusals: 条件 / conditions `this.ended || this.abort.signal.aborted`; 异常 / errors `changed()`; `error`.
   * 失败处理：catch 分支执行 `await resource.close();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await resource.close();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async own<T extends {
  /**
   * 签名 / Signature: VmLifetime.own.T.close.
   * 功能：为跟踪客户机运行代次、活动和状态切换屏障声明 close 的输入与结果契约，所属容器为 VmLifetime.own.T。
   * Purpose: Declares the input/result contract for close in VmLifetime.own.T. Module responsibility: Tracks VM process/execution generations, activities and transition barriers, invalidating old executions when identities advance.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: unknown.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  close(): unknown }>(name: string, resource: T, order = 0): Promise<T> {
    if (this.ended || this.abort.signal.aborted) {
      await resource.close();
      throw changed();
    }
    try {
      return this.resources.own(name, resource, order);
    } catch (error) {
      await resource.close();
      throw error;
    }
  }
  /**
   * 入口 / Entry: VmLifetime.enter.
   * 功能：登记执行活动并返回合并取消信号、释放入口和清理待确认入口。
   * Purpose: Registers execution activity and returns combined cancellation, release and cleanup-pending entries.
   * 设计：屏障期间只允许当前排他上下文的活动进入；清理待确认完成等待信号但保留活动证据，不等于 release。
   * Design: During barriers only the current exclusive context may admit work; cleanup-pending finishes waiters while retaining activity evidence and is not release.
   * 输入 / Inputs: identity: default=this.capture(); options: { persistent?: boolean } default={}
   * 输出 / Returns: `{ signal: AbortSignal.any([abort.signal, this.signal, this.abort.signal]), release: activity.release, cleanupPending: (error:…`.
   * 副作用 / Effects: `this.activities.add`; `AbortSignal.any`.
   * 拒绝 / Refusals: 条件 / conditions `!this.admitting && !(exclusive?.lifetime === this && exclusive.active)`; 异常 / errors `new AppError('实例正在切换状态，暂不接收项目执行', 409, 'VM_EXECUTION_DRAINING')`.
   */
  enter(identity = this.capture(), options: { persistent?: boolean } = {}) {
    this.assert(identity);
    const exclusive = exclusiveContext.getStore();
    if (!this.admitting && !(exclusive?.lifetime === this && exclusive.active))
      throw new AppError('实例正在切换状态，暂不接收项目执行', 409, 'VM_EXECUTION_DRAINING');
    const abort = new AbortController();
    let finish!:
    /**
     * 中文功能：完成当前寿命范围内的在途工作结算通知。
     * English: Completion notification settling in-flight work within the current lifetime scope.
     * 所属 / Owner: VmLifetime.enter.finish.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `void`.
     */
    () => void;
    const activity: Activity = {
      abort,
      persistent: !!options.persistent,
      done: new Promise((resolve) => {
        finish = resolve;
      }),
      /**
       * 入口 / Entry: VmLifetime.enter.release.
       * 功能：在跟踪客户机运行代次、活动和状态切换屏障中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`VmLifetime`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `VmLifetime`; the calls and state transitions below complete the operation. Module context: Tracks VM process/execution generations, activities and transition barriers, invalidating old executions when identities advance.
       * 处理：通过 `this.activities.delete`, `finish` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.activities.delete`, `finish`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `this.activities.delete(activity)`.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `this.activities.delete`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      release: () => {
        if (this.activities.delete(activity)) finish();
      },
    };
    this.activities.add(activity);
    return {
      signal: AbortSignal.any([abort.signal, this.signal, this.abort.signal]),
      release: activity.release,
      /**
       * 入口 / Entry: VmLifetime.enter.cleanupPending.
       * 功能：在跟踪客户机运行代次、活动和状态切换屏障中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `activity.failure`（`VmLifetime`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `VmLifetime`; the outcome is recorded in `activity.failure`. Module context: Tracks VM process/execution generations, activities and transition barriers, invalidating old executions when identities advance.
       * 处理：通过 `finish` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `finish`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: error: unknown
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 更新 / updates `activity.failure`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      cleanupPending: (error: unknown) => {
        activity.failure = error;
        finish();
      },
    };
  }
  /** 同步关闭准入，避免新的项目执行与已持有的实例锁竞争；持久会话由对应控制器处理。 */
  /**
   * 入口 / Entry: VmLifetime.exclusive.
   * 功能：在无不允许的非持久活动时临时关闭准入，并于排他异步上下文运行实例操作。
   * Purpose: Temporarily closes admission when no disallowed nonpersistent activity remains and runs the VM operation in an exclusive asynchronous context.
   * 设计：finally 总是撤销本次屏障与上下文 active 标记，避免失败永久关闭准入。
   * Design: Finally always removes this barrier and the context active flag so failure cannot permanently close admission.
   * 输入 / Inputs: work: () => Promise<T>; allowFailed: default=false
   * 输出 / Returns: Promise<T>；结果来自 / values from `await exclusiveContext.run(context, work)`.
   * 副作用 / Effects: 更新 / updates `context.active`.
   * 拒绝 / Refusals: 条件 / conditions `[...this.activities].some( (activity) => !activity.persistent && (!allowFailed || activity.failure === undefined), )`; 异常 / errors `new AppError('该实例的另一项操作正在进行', 409, 'VM_EXECUTION_ACTIVE')`.
   * 收尾：退出 try 区域时始终执行 `context.active = false;`; `this.barriers--;`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `context.active = false;`; `this.barriers--;`; these steps also apply to exceptional exits.
   */
  async exclusive<T>(work: () => Promise<T>, allowFailed = false): Promise<T> {
    if (
      [...this.activities].some(
        (activity) => !activity.persistent && (!allowFailed || activity.failure === undefined),
      )
    )
      throw new AppError('该实例的另一项操作正在进行', 409, 'VM_EXECUTION_ACTIVE');
    this.barriers++;
    const context = { lifetime: this, active: true };
    try {
      return await exclusiveContext.run(context, work);
    } finally {
      context.active = false;
      this.barriers--;
    }
  }
  /** 先关闭准入，再等待已有活动退出；调用方在屏障完成后才进入实例排他操作。 */
  /**
   * 入口 / Entry: VmLifetime.barrier.
   * 功能：关闭准入、可选取消已登记活动，等待其退出并核验清理后运行状态切换。
   * Purpose: Closes admission, optionally cancels registered activity, waits for its exit and checks cleanup before running a state transition.
   * 设计：未确认清理默认拒绝状态切换，只有显式 allowFailed 才放行；finally 恢复屏障计数。
   * Design: Unconfirmed cleanup rejects transitions by default unless allowFailed is explicit; finally restores the barrier count.
   * 输入 / Inputs: work: () => Promise<T>; cancel: default=true; allowFailed: default=false
   * 输出 / Returns: Promise<T>；结果来自 / values from `await work()`.
   * 副作用 / Effects: `activity.abort.abort`.
   * 拒绝 / Refusals: 条件 / conditions `this.ended || this.abort.signal.aborted`; `!allowFailed && active.some((activity) => activity.failure !== undefined)`; 异常 / errors `changed()`; `new AppError('项目执行清理尚未确认，无法切换实例状态', 503, 'EXECUTION_CLEANUP_PENDING')`.
   * 收尾：退出 try 区域时始终执行 `this.barriers--;`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.barriers--;`; these steps also apply to exceptional exits.
   */
  async barrier<T>(work: () => Promise<T>, cancel = true, allowFailed = false): Promise<T> {
    if (this.ended || this.abort.signal.aborted) throw changed();
    this.barriers++;
    try {
      const active = [...this.activities];
      if (cancel)
        for (const activity of active) activity.abort.abort(new AppError('实例状态切换已取消当前执行', 409));
      await Promise.all(active.map((activity) => activity.done));
      if (!allowFailed && active.some((activity) => activity.failure !== undefined))
        throw new AppError('项目执行清理尚未确认，无法切换实例状态', 503, 'EXECUTION_CLEANUP_PENDING');
      if (this.ended || this.abort.signal.aborted) throw changed();
      return await work();
    } finally {
      this.barriers--;
    }
  }
  /**
   * 入口 / Entry: VmLifetime.end.
   * 功能：终止 VM 生命周期并广播取消原因，阻止后续新活动进入。
   * Purpose: Ends the VM lifetime and broadcasts its cancellation reason, preventing subsequent admission.
   * 输入 / Inputs: reason: unknown optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.abort.abort`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  end(reason?: unknown) {
    this.abort.abort(reason);
  }
  /**
   * 入口 / Entry: VmLifetime.close.
   * 功能：终止生命周期后重试资源清理，保留作用域中未确认的资源。
   * Purpose: Ends the lifetime and retries resource cleanup while retaining unconfirmed resources in its scope.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.resources.retryCleanup()`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close() {
    this.end();
    return this.resources.retryCleanup();
  }
}

/** Legacy in-process fixtures receive the same checks; absence never bypasses identity capture. */
/**
 * 入口 / Entry: vmLifetime.
 * 功能：取得 live 引用对应的生命周期，旧测试引用也获得同样的身份校验。
 * Purpose: Obtains the lifetime for a live reference, applying the same identity checks to legacy fixture references.
 * 输入 / Inputs: vmId: string; reference: Live | VmLive
 * 输出 / Returns: VmLifetime；结果来自 / values from `current`; `lifetime`.
 * 副作用 / Effects: `legacy.set`; 更新 / updates `live.lifetime`.
 * 拒绝 / Refusals: 条件 / conditions `current`; `current.vmId !== vmId`; 异常 / errors `changed()`.
 */
export function vmLifetime(vmId: string, reference: Live | VmLive): VmLifetime {
  const live = vmLiveIdentity(reference);
  const current = live.lifetime || legacy.get(live);
  if (current) {
    if (current.vmId !== vmId) throw changed();
    return current;
  }
  const lifetime = new VmLifetime(vmId, live.abort);
  legacy.set(live, lifetime);
  live.lifetime = lifetime;
  return lifetime;
}
