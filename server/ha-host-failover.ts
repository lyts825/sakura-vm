/**
 * 模块职责：管理宿主失联接管、来源启动授权和重加入，依赖见证服务确认防止双主。
 * Module purpose: Owns host-loss promotion, source startup authority and rejoin; witness confirmation prevents competing active owners.
 */
import type { HostPeersV1, SnapshotReplicationsV1 } from './service-contracts/v1.ts';
import { AppError } from '../shared/errors.ts';
import { checkHaFailover, haFailoverOptions } from './ha-failover.ts';
import type { HaWitnessClient } from './ha-witness-client.ts';
import type { HaWitnessPlan } from './ha-witness-core.ts';
import type { VmAccess as Machines } from './vm-access.ts';

type Policy = { enabled: boolean; options: unknown };
const INTERVAL_MS = 15_000;

/** Source-side heartbeat and start gate for the independent witness process. */
export class HaHostFailover {
  private work = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private keepaliveTimer?: ReturnType<typeof setInterval>;
  private keepalivePending: Promise<void> | null = null;
  private closed = false;
  private errors: Record<string, string> = {};
  private armed: Record<string, boolean> = {};
  private phases: Record<string, string> = {};
  private targetVmIds: Record<string, string> = {};
  private pendingReturns = new Map<string, number>();
  private statusPending = new Set<string>();
  private failbackPhases: Record<string, 'pending' | 'completed' | null> = {};
  private recoveries: Record<string, boolean> = {};
  /**
   * 签名 / Signature: HaHostFailover.unregisterStart.
   * 功能：为管理宿主失联接管、来源启动授权和重加入声明 unregisterStart 的输入与结果契约，所属容器为 HaHostFailover。
   * Purpose: Declares the input/result contract for unregisterStart in HaHostFailover. Module responsibility: Owns host-loss promotion, source startup authority and rejoin; witness confirmation prevents competing active owners.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private unregisterStart?: () => void;

  /**
   * 入口 / Entry: HaHostFailover.constructor.
   * 功能：建立 HaHostFailover 的管理宿主失联接管、来源启动授权和重加入上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the HaHostFailover context for this module's responsibility: Owns host-loss promotion, source startup authority and rejoin; witness confirmation prevents competing active owners. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; peers: HostPeersV1; replications: SnapshotReplicationsV1; policies: () => Promise<Record<string, Policy>>; client: HaWitnessClient | null
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private peers: HostPeersV1,
    private replications: SnapshotReplicationsV1,
    private policies: () => Promise<Record<string, Policy>>,
    private client: HaWitnessClient | null,
  ) {}

  /**
   * 入口 / Entry: HaHostFailover.configured.
   * 功能：从当前输入或状态计算 `!!this.client`，供调用方后续验证或使用。
   * Purpose: Computes `!!this.client` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `!!this.client`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  configured() {
    return !!this.client;
  }
  /**
   * 入口 / Entry: HaHostFailover.view.
   * 功能：从当前输入或状态计算 `{ configured: !!this.client, armed: !!this.armed[id], phase: this.phases[id] || null, targetVmId: this.targetVmIds[id] || nul…`，供调用方后续验证或使用。
   * Purpose: Computes `{ configured: !!this.client, armed: !!this.armed[id], phase: this.phases[id] || null, targetVmId: this.targetVmIds[id] || nul…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ configured: !!this.client, armed: !!this.armed[id], phase: this.phases[id] || null, targetVmId: this.targetVmIds[id] || nul…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(id: string) {
    return {
      configured: !!this.client,
      armed: !!this.armed[id],
      phase: this.phases[id] || null,
      targetVmId: this.targetVmIds[id] || null,
      failback: this.failbackPhases[id] || null,
      recoveryHeld: !!this.recoveries[id],
      statusPending: this.statusPending.has(id),
      error: this.errors[id] || null,
    };
  }

  /**
   * 入口 / Entry: HaHostFailover.identity.
   * 功能：从当前输入或状态计算 `{ sourceHostId: this.peers.view().hostId, sourceVmId: id }`，供调用方后续验证或使用。
   * Purpose: Computes `{ sourceHostId: this.peers.view().hostId, sourceVmId: id }` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ sourceHostId: this.peers.view().hostId, sourceVmId: id }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private identity(id: string) {
    return { sourceHostId: this.peers.view().hostId, sourceVmId: id };
  }

  /**
   * 入口 / Entry: HaHostFailover.authorizeStart.
   * 功能：在管理宿主失联接管、来源启动授权和重加入中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`HaHostFailover`）。
   * Purpose: Checks admission, input or resource ownership in `HaHostFailover`; this entry produces `void` for its caller. Module context: Owns host-loss promotion, source startup authority and rejoin; witness confirmation prevents competing active owners.
   * 处理：通过 `this.machines.get`, `this.client.authorizeStart`, `this.identity` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.client.authorizeStart`, `this.identity`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.machines.get(id).haWitnessEnrollment`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.client`; 异常 / errors `new AppError('宿主失联接管已启用，但见证节点未配置', 503, 'HA_WITNESS_UNAVAILABLE')`; `new AppError( `见证节点未确认来源启动：${(error as Error).message}`, 503, 'HA_WITNESS_UNAVAILABLE', )`.
   * 失败处理：catch 分支执行 `throw new AppError( `见证节点未确认来源启动：${(error as Error).message}`, 503, 'HA_WITNESS_UNAVAILABLE', );`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError( `见证节点未确认来源启动：${(error as Error).message}`, 503, 'HA_WITNESS_UNAVAILABLE', );`; these statements determine whether a failure is absorbed or rejected again.
   */
  async authorizeStart(id: string) {
    if (!this.machines.get(id).haWitnessEnrollment) return;
    if (!this.client)
      throw new AppError('宿主失联接管已启用，但见证节点未配置', 503, 'HA_WITNESS_UNAVAILABLE');
    try {
      await this.client.authorizeStart(this.identity(id));
    } catch (error) {
      throw new AppError(
        `见证节点未确认来源启动：${(error as Error).message}`,
        503,
        'HA_WITNESS_UNAVAILABLE',
      );
    }
  }

  /**
   * 入口 / Entry: HaHostFailover.disarm.
   * 功能：把本层请求转交 `this.enqueue`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.enqueue` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; failureThreshold: number
   * 输出 / Returns: `this.enqueue(() => this.disarmNow(id, failureThreshold))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  disarm(id: string, failureThreshold: number) {
    return this.enqueue(() => this.disarmNow(id, failureThreshold));
  }

  /**
   * 入口 / Entry: HaHostFailover.disarmNow.
   * 功能：在管理宿主失联接管、来源启动授权和重加入中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.armed[id]`, `this.phases[id]`（`HaHostFailover`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaHostFailover`; the outcome is recorded in `this.armed[id]`, `this.phases[id]`. Module context: Owns host-loss promotion, source startup authority and rejoin; witness confirmation prevents competing active owners.
   * 处理：通过 `this.client.heartbeat`, `this.identity`, `this.rememberReturn` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.client.heartbeat`, `this.identity`, `this.rememberReturn`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; failureThreshold: number
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.armed[id]`, `this.phases[id]`.
   * 拒绝 / Refusals: 条件 / conditions `!this.client`; 异常 / errors `new AppError('见证节点未配置，不能安全撤销宿主失联策略', 503)`.
   */
  private async disarmNow(id: string, failureThreshold: number) {
    if (!this.client) throw new AppError('见证节点未配置，不能安全撤销宿主失联策略', 503);
    const result = await this.client.heartbeat({ ...this.identity(id), failureThreshold, plan: null });
    this.rememberReturn(id, failureThreshold, result.failback);
    this.armed[id] = false;
    this.phases[id] = 'source';
  }

  /**
   * 入口 / Entry: HaHostFailover.sample.
   * 功能：把本层请求转交 `this.enqueue`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.enqueue` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.enqueue(() => this.scan())`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  sample() {
    return this.enqueue(() => this.scan());
  }

  /**
   * 入口 / Entry: HaHostFailover.enqueue.
   * 功能：在管理宿主失联接管、来源启动授权和重加入中，执行此领域的具体处理步骤并返回其结果；本入口产生 `current` 供上层消费（`HaHostFailover`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaHostFailover`; this entry produces `current` for its caller. Module context: Owns host-loss promotion, source startup authority and rejoin; witness confirmation prevents competing active owners.
   * 处理：通过 `this.work.catch().then`, `this.work.catch`, `current.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.work.catch().then`, `this.work.catch`, `current.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: task: () => Promise<T>
   * 输出 / Returns: `current`.
   * 副作用 / Effects: 更新 / updates `this.work`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private enqueue<T>(task: () => Promise<T>) {
    const current = this.work.catch(() => {}).then(task);
    this.work = current.then(
      () => {},
      () => {},
    );
    return current;
  }

  /**
   * 入口 / Entry: HaHostFailover.keepalive.
   * 功能：在管理宿主失联接管、来源启动授权和重加入中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Promise.resolve()` / `this.keepalivePending` 供上层消费（`HaHostFailover`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaHostFailover`; this entry produces `Promise.resolve()` / `this.keepalivePending` for its caller. Module context: Owns host-loss promotion, source startup authority and rejoin; witness confirmation prevents competing active owners.
   * 处理：通过 `Promise.resolve`, `this.sendKeepalives().finally`, `this.sendKeepalives` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.resolve`, `this.sendKeepalives().finally`, `this.sendKeepalives`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || !this.client`; `this.keepalivePending`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `Promise.resolve()`; `this.keepalivePending`; `current`.
   * 副作用 / Effects: `this.sendKeepalives().finally`; `this.sendKeepalives`; 更新 / updates `this.keepalivePending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private keepalive() {
    if (this.closed || !this.client) return Promise.resolve();
    if (this.keepalivePending) return this.keepalivePending;
    const current = this.sendKeepalives().finally(() => {
      if (this.keepalivePending === current) this.keepalivePending = null;
    });
    this.keepalivePending = current;
    return current;
  }

  /**
   * 入口 / Entry: HaHostFailover.sendKeepalives.
   * 功能：在管理宿主失联接管、来源启动授权和重加入中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HaHostFailover`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaHostFailover`; the calls and state transitions below complete the operation. Module context: Owns host-loss promotion, source startup authority and rejoin; witness confirmation prevents competing active owners.
   * 处理：通过 `this.policies`, `Promise.all`, `inline.map`, `this.machines.records.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.policies`, `Promise.all`, `inline.map`, `this.machines.records.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async sendKeepalives() {
    const policies = await this.policies();
    /**
     * 入口 / Entry: HaHostFailover.sendKeepalives.callback@112.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline.map）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline.map).
     * 输入 / Inputs: vm
     * 输出 / Returns: `void`.
     * 副作用 / Effects: 更新 / updates `this.errors[vm.id]`, `this.armed[vm.id]`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 失败处理：catch 分支执行 `this.errors[vm.id] = (error as Error).message;`; `this.armed[vm.id] = false;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `this.errors[vm.id] = (error as Error).message;`; `this.armed[vm.id] = false;`; these statements determine whether a failure is absorbed or rejected again.
     */
    await Promise.all(
      [...this.machines.records.values()].map(async (vm) => {
        const enrollment = vm.haWitnessEnrollment;
        const returning = this.pendingReturns.get(vm.id);
        if (returning && this.machines.state(vm.id) === 'running' && !vm.haPromotion) {
          try {
            const result = await this.client!.heartbeat({
              ...this.identity(vm.id),
              failureThreshold: returning,
              plan: null,
            });
            this.rememberReturn(vm.id, returning, result.failback);
          } catch (error) {
            this.errors[vm.id] = (error as Error).message;
          }
          return;
        }
        const policy = policies[vm.id];
        const parsed = haFailoverOptions.safeParse(policy?.options);
        if (
          !enrollment ||
          !policy?.enabled ||
          !parsed.success ||
          !parsed.data.autoHostFailover ||
          parsed.data.targetHostId !== enrollment.targetHostId ||
          parsed.data.failureThreshold !== enrollment.failureThreshold ||
          this.machines.state(vm.id) !== 'running' ||
          vm.haPromotion
        )
          return;
        try {
          const result = await this.client!.heartbeat({
            ...this.identity(vm.id),
            failureThreshold: enrollment.failureThreshold,
          });
          this.armed[vm.id] = this.machines.state(vm.id) === 'running' && !vm.haPromotion && result.armed;
          this.rememberReturn(vm.id, enrollment.failureThreshold, result.failback);
        } catch (error) {
          this.armed[vm.id] = false;
          this.errors[vm.id] = (error as Error).message;
        }
      }),
    );
  }

  /**
   * 入口 / Entry: HaHostFailover.init.
   * 功能：在管理宿主失联接管、来源启动授权和重加入中，初始化并核对当前领域状态；处理结果记录到 `this.unregisterStart`, `this.keepaliveTimer`, `this.timer`（`HaHostFailover`）。
   * Purpose: Initializes and verifies current domain state in `HaHostFailover`; the outcome is recorded in `this.unregisterStart`, `this.keepaliveTimer`, `this.timer`. Module context: Owns host-loss promotion, source startup authority and rejoin; witness confirmation prevents competing active owners.
   * 处理：通过 `this.machines.beforeHaStart`, `this.machines.records.keys`, `this.statusPending.add`, `this.refreshPendingStatuses` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.beforeHaStart`, `this.machines.records.keys`, `this.statusPending.add`, `this.refreshPendingStatuses`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.client`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.statusPending.add`; `setInterval`; 更新 / updates `this.unregisterStart`, `this.keepaliveTimer`, `this.timer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    this.unregisterStart = this.machines.beforeHaStart?.((id) => this.authorizeStart(id));
    // A completed rejoin survives local policy revocation and source-service
    // restart. Discover its pending routing work from the durable witness.
    if (this.client) {
      for (const id of this.machines.records.keys()) this.statusPending.add(id);
      await this.refreshPendingStatuses();
    }
    await this.keepalive();
    this.keepaliveTimer = setInterval(
      () => void this.keepalive().catch((error) => console.error('宿主失联独立心跳失败：', error)),
      5_000,
    );
    this.keepaliveTimer.unref();
    await this.sample();
    this.timer = setInterval(
      () => void this.sample().catch((error) => console.error('宿主失联心跳扫描失败：', error)),
      INTERVAL_MS,
    );
    this.timer.unref();
  }

  /**
   * 入口 / Entry: HaHostFailover.rememberReturn.
   * 功能：在管理宿主失联接管、来源启动授权和重加入中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.failbackPhases[id]`（`HaHostFailover`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaHostFailover`; the outcome is recorded in `this.failbackPhases[id]`. Module context: Owns host-loss promotion, source startup authority and rejoin; witness confirmation prevents competing active owners.
   * 处理：通过 `this.pendingReturns.set`, `this.pendingReturns.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.pendingReturns.set`, `this.pendingReturns.delete`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `phase === 'pending'`; `phase === 'completed' || phase === null`; `phase !== undefined`.
   * 输入 / Inputs: id: string; threshold: number; phase: 'pending' | 'completed' | null | undefined
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.pendingReturns.set`; `this.pendingReturns.delete`; 更新 / updates `this.failbackPhases[id]`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private rememberReturn(id: string, threshold: number, phase: 'pending' | 'completed' | null | undefined) {
    if (phase === 'pending') this.pendingReturns.set(id, threshold);
    else if (phase === 'completed' || phase === null) this.pendingReturns.delete(id);
    if (phase !== undefined) this.failbackPhases[id] = phase;
    if (phase === 'completed') delete this.errors[id];
  }

  /**
   * 入口 / Entry: HaHostFailover.recordStatus.
   * 功能：在管理宿主失联接管、来源启动授权和重加入中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.phases[id]`, `this.targetVmIds[id]`, `this.recoveries[id]`（`HaHostFailover`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaHostFailover`; the outcome is recorded in `this.phases[id]`, `this.targetVmIds[id]`, `this.recoveries[id]`. Module context: Owns host-loss promotion, source startup authority and rejoin; witness confirmation prevents competing active owners.
   * 处理：通过 `this.statusPending.delete`, `this.pendingReturns.delete`, `this.rememberReturn` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.statusPending.delete`, `this.pendingReturns.delete`, `this.rememberReturn`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `status.error`; `status.recoveryHeld`; `status.phase === 'source' && status.failureThreshold`.
   * 输入 / Inputs: id: string; status: Awaited<ReturnType<HaWitnessClient['status']>>
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.statusPending.delete`; `this.pendingReturns.delete`; 更新 / updates `this.phases[id]`, `this.targetVmIds[id]`, `this.recoveries[id]`, `this.errors[id]`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private recordStatus(id: string, status: Awaited<ReturnType<HaWitnessClient['status']>>) {
    this.statusPending.delete(id);
    this.phases[id] = status.phase || '';
    this.targetVmIds[id] = status.targetVmId || '';
    this.recoveries[id] = !!status.recoveryHeld;
    if (status.error) this.errors[id] = status.error;
    if (status.recoveryHeld) this.pendingReturns.delete(id);
    else if (status.phase === 'source' && status.failureThreshold)
      this.rememberReturn(id, status.failureThreshold, status.failback?.phase || null);
  }

  /**
   * 入口 / Entry: HaHostFailover.refreshPendingStatuses.
   * 功能：在管理宿主失联接管、来源启动授权和重加入中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HaHostFailover`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaHostFailover`; this entry produces `void` for its caller. Module context: Owns host-loss promotion, source startup authority and rejoin; witness confirmation prevents competing active owners.
   * 处理：通过 `Promise.all`, `inline.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.all`, `inline.map`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.client || this.closed`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async refreshPendingStatuses() {
    if (!this.client || this.closed) return;
    /**
     * 入口 / Entry: HaHostFailover.refreshPendingStatuses.callback@199.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline.map）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline.map).
     * 输入 / Inputs: id
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `this.statusPending.delete`; 更新 / updates `this.errors[id]`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 失败处理：catch 分支执行 `if (error instanceof AppError && error.code === 'HA_WITNESS_NOT_REGISTERED') { this.statusPending.delete(id); if (this.machin…`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (error instanceof AppError && error.code === 'HA_WITNESS_NOT_REGISTERED') { this.statusPending.delete(id); if (this.machin…`; these statements determine whether a failure is absorbed or rejected again.
     */
    await Promise.all(
      [...this.statusPending].map(async (id) => {
        if (!this.machines.records.has(id)) {
          this.statusPending.delete(id);
          return;
        }
        try {
          const status = await this.client!.status(this.identity(id));
          if (!status.error) delete this.errors[id];
          this.recordStatus(id, status);
        } catch (error) {
          // An authenticated absence is final for unrelated VMs. Transient
          // outages must remain retryable even after policy/enrollment removal.
          if (error instanceof AppError && error.code === 'HA_WITNESS_NOT_REGISTERED') {
            this.statusPending.delete(id);
            if (this.machines.get(id).haWitnessEnrollment) this.errors[id] = error.message;
            else delete this.errors[id];
          } else this.errors[id] = (error as Error).message;
        }
      }),
    );
  }

  /**
   * 入口 / Entry: HaHostFailover.scan.
   * 功能：采样宿主失联条件并根据见证授权决定是否执行目标副本接管。
   * Purpose: Samples host-loss conditions and uses witness authority to decide target replica promotion.
   * 设计：核验来源、目标和副本身份，先取得见证与隔离证明再启动；未确认状态继续保留栅栏记录。
   * Design: Source/target/replica checks and witness/fencing proof precede startup; unconfirmed state retains fence records.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `this.errors[vm.id]`, `this.armed[id]`, `plan`, `this.phases[id]`.
   * 拒绝 / Refusals: 条件 / conditions `!enrollment || enrollment.targetHostId !== parsed.data.targetHostId || enrollment.failureThreshold !== parsed.data.failureThr…`; `!this.client`; 异常 / errors `new AppError('来源实例见证登记与策略不一致，拒绝布防', 409)`; `new AppError('见证节点未配置', 503)`.
   * 失败处理：catch 分支执行 `this.errors[vm.id] = (error as Error).message;`; `this.armed[id] = false;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.errors[vm.id] = (error as Error).message;`; `this.armed[id] = false;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async scan() {
    if (this.closed) return;
    await this.refreshPendingStatuses();
    if (this.closed) return;
    const policies = await this.policies();
    for (const vm of this.machines.records.values()) {
      const enrollment = vm.haWitnessEnrollment;
      if (!enrollment) continue;
      const policy = policies[vm.id];
      const parsed = haFailoverOptions.safeParse(policy?.options);
      if (policy?.enabled && parsed.success && parsed.data.autoHostFailover) continue;
      try {
        await this.disarmNow(vm.id, enrollment.failureThreshold);
        delete this.errors[vm.id];
      } catch (error) {
        this.errors[vm.id] = (error as Error).message;
      }
    }
    for (const [id, policy] of Object.entries(policies)) {
      if (this.closed) return;
      const parsed = haFailoverOptions.safeParse(policy.options);
      if (!policy.enabled || !parsed.success || !parsed.data.autoHostFailover) continue;
      try {
        const enrollment = this.machines.get(id).haWitnessEnrollment;
        if (
          !enrollment ||
          enrollment.targetHostId !== parsed.data.targetHostId ||
          enrollment.failureThreshold !== parsed.data.failureThreshold
        )
          throw new AppError('来源实例见证登记与策略不一致，拒绝布防', 409);
        if (!this.client) throw new AppError('见证节点未配置', 503);
        const options = parsed.data;
        // Keep liveness independent of potentially slow peer capacity/receipt checks.
        const liveness = await this.client.heartbeat({
          ...this.identity(id),
          failureThreshold: options.failureThreshold,
        });
        this.armed[id] = liveness.armed;
        this.rememberReturn(id, options.failureThreshold, liveness.failback);
        let plan: HaWitnessPlan | null = null;
        if (this.machines.state(id) === 'running' && !this.machines.get(id).haPromotion) {
          const checked = await checkHaFailover(
            this.machines,
            this.peers,
            this.replications,
            id,
            options,
            true,
          );
          const replica = checked.replica;
          if (checked.hostPlanReady && replica?.remoteVmId && replica.sha256) {
            const snapshot = this.machines.get(id).snapshots.find((item) => item.id === replica.snapshotId);
            if (snapshot)
              plan = {
                ...this.identity(id),
                targetHostId: options.targetHostId!,
                transferId: replica.transferId,
                remoteVmId: replica.remoteVmId,
                snapshotId: replica.snapshotId,
                sha256: replica.sha256,
                snapshotAt: snapshot.createdAt,
                maxReplicaAgeMinutes: options.maxReplicaAgeMinutes,
              };
          }
        }
        if (plan) {
          // A process failure, local fence or policy change during slow peer
          // validation must not resurrect a withdrawn host-loss plan.
          const latest = (await this.policies())[id];
          const latestOptions = haFailoverOptions.safeParse(latest?.options);
          const currentVm = this.machines.get(id),
            currentEnrollment = currentVm.haWitnessEnrollment;
          if (
            this.closed ||
            !latest?.enabled ||
            !latestOptions.success ||
            !latestOptions.data.autoHostFailover ||
            latestOptions.data.targetHostId !== options.targetHostId ||
            latestOptions.data.failureThreshold !== options.failureThreshold ||
            latestOptions.data.maxReplicaAgeMinutes !== options.maxReplicaAgeMinutes ||
            !currentEnrollment ||
            currentEnrollment?.targetHostId !== options.targetHostId ||
            currentEnrollment.failureThreshold !== options.failureThreshold ||
            this.machines.state(id) !== 'running' ||
            currentVm.haPromotion
          )
            plan = null;
        }
        if (plan) {
          const result = await this.client.heartbeat({
            ...this.identity(id),
            failureThreshold: options.failureThreshold,
            plan,
          });
          this.armed[id] = result.armed;
        } else await this.disarmNow(id, options.failureThreshold);
        this.phases[id] = 'source';
        this.targetVmIds[id] = plan?.remoteVmId || '';
        delete this.errors[id];
      } catch (error) {
        this.armed[id] = false;
        this.errors[id] = (error as Error).message;
        if (this.client) {
          try {
            const status = await this.client.status(this.identity(id));
            this.recordStatus(id, status);
          } catch {
            /* The last known phase remains visible. */
          }
        }
      }
    }
  }

  /**
   * 入口 / Entry: HaHostFailover.witnessStatus.
   * 功能：在管理宿主失联接管、来源启动授权和重加入中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ configured: false, error: '见证节点未配置' }` / `{ configured: true, ...(await this.client.status(this.identity(id))) }` 供上层消费（`HaHostFailover`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaHostFailover`; this entry produces `{ configured: false, error: '见证节点未配置' }` / `{ configured: true, ...(await this.client.status(this.identity(id))) }` for its caller. Module context: Owns host-loss promotion, source startup authority and rejoin; witness confirmation prevents competing active owners.
   * 处理：通过 `this.client.status`, `this.identity` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.client.status`, `this.identity`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.client`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ configured: false, error: '见证节点未配置' }`; `{ configured: true, ...(await this.client.status(this.identity(id))) }`; `{ configured: true, error: (error as Error).message }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return { configured: true, error: (error as Error).message };`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return { configured: true, error: (error as Error).message };`; these statements determine whether a failure is absorbed or rejected again.
   */
  async witnessStatus(id: string) {
    if (!this.client) return { configured: false, error: '见证节点未配置' };
    try {
      return { configured: true, ...(await this.client.status(this.identity(id))) };
    } catch (error) {
      return { configured: true, error: (error as Error).message };
    }
  }

  /**
   * 入口 / Entry: HaHostFailover.rejoin.
   * 功能：把本层请求转交 `this.enqueue`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.enqueue` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; dataReconciled: boolean
   * 输出 / Returns: `this.enqueue(() => this.rejoinNow(id, dataReconciled))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  rejoin(id: string, dataReconciled: boolean) {
    return this.enqueue(() => this.rejoinNow(id, dataReconciled));
  }

  /**
   * 入口 / Entry: HaHostFailover.rejoinNow.
   * 功能：在管理宿主失联接管、来源启动授权和重加入中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: true, executed: true, ...result, message: result.failback === 'pending' ? '目标副本已退役，来源可重新启动；见证将确认来源应用健康后回切流量。' : resu…` 供上层消费（`HaHostFailover`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaHostFailover`; this entry produces `{ ready: true, executed: true, ...result, message: result.failback === 'pending' ? '目标副本已退役，来源可重新启动；见证将确认来源应用健康后回切流量。' : resu…` for its caller. Module context: Owns host-loss promotion, source startup authority and rejoin; witness confirmation prevents competing active owners.
   * 处理：通过 `this.machines.requireUnlocked`, `this.machines.requireStopped`, `this.client.rejoin`, `this.identity` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.requireUnlocked`, `this.machines.requireStopped`, `this.client.rejoin`, `this.identity`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `result.failback === 'pending'`; `enrollment`; `!this.statusPending.has(id)`.
   * 输入 / Inputs: id: string; dataReconciled: boolean
   * 输出 / Returns: `{ ready: true, executed: true, ...result, message: result.failback === 'pending' ? '目标副本已退役，来源可重新启动；见证将确认来源应用健康后回切流量。' : resu…`.
   * 副作用 / Effects: `this.statusPending.add`; `this.pendingReturns.set`; 更新 / updates `this.failbackPhases[id]`, `this.errors[id]`, `this.armed[id]`, `this.phases[id]`.
   * 拒绝 / Refusals: 条件 / conditions `!dataReconciled`; `!this.client`; 异常 / errors `new AppError('请先回迁目标期间的写入，或明确接受丢失目标新数据', 409)`; `new AppError('见证节点未配置', 503)`.
   * 失败处理：catch 分支执行 `this.errors[id] = (error as Error).message;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.errors[id] = (error as Error).message;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async rejoinNow(id: string, dataReconciled: boolean) {
    if (!dataReconciled) throw new AppError('请先回迁目标期间的写入，或明确接受丢失目标新数据', 409);
    this.machines.requireUnlocked(id);
    this.machines.requireStopped(id);
    if (!this.client) throw new AppError('见证节点未配置', 503);
    const result = await this.client.rejoin({ ...this.identity(id), dataReconciled: true });
    if (result.failback === 'pending') {
      // The release has already been durably accepted. A lost follow-up status
      // must not discard pending routing work or report the release as failed.
      this.statusPending.add(id);
      this.failbackPhases[id] = 'pending';
      const enrollment = this.machines.get(id).haWitnessEnrollment;
      if (enrollment) this.pendingReturns.set(id, enrollment.failureThreshold);
      try {
        this.recordStatus(id, await this.client.status(this.identity(id)));
      } catch (error) {
        this.errors[id] = (error as Error).message;
      }
    }
    this.armed[id] = false;
    this.phases[id] = 'source';
    this.recoveries[id] = false;
    if (!this.statusPending.has(id)) delete this.errors[id];
    return {
      ready: true,
      executed: true,
      ...result,
      message:
        result.failback === 'pending'
          ? '目标副本已退役，来源可重新启动；见证将确认来源应用健康后回切流量。'
          : result.failback === 'completed'
            ? '目标副本已退役，流量已确认指向来源实例。'
            : '见证节点确认目标副本已退役，来源可重新启动；来源健康后请恢复流量。',
    };
  }

  /**
   * 入口 / Entry: HaHostFailover.close.
   * 功能：在管理宿主失联接管、来源启动授权和重加入中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`HaHostFailover`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HaHostFailover`; this entry produces `void` for its caller. Module context: Owns host-loss promotion, source startup authority and rejoin; witness confirmation prevents competing active owners.
   * 处理：通过 `this.unregisterStart`, `clearInterval`, `this.keepalivePending.catch`, `this.work.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.unregisterStart`, `clearInterval`, `this.keepalivePending.catch`, `this.work.catch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.client`; `!vm.haWitnessEnrollment`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `clearInterval`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `console.error(`实例 ${vm.id} 的见证关闭心跳失败：`, (error as Error).message);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `console.error(`实例 ${vm.id} 的见证关闭心跳失败：`, (error as Error).message);`; these statements determine whether a failure is absorbed or rejected again.
   */
  async close() {
    this.closed = true;
    this.unregisterStart?.();
    clearInterval(this.timer);
    clearInterval(this.keepaliveTimer);
    await this.keepalivePending?.catch(() => {});
    await this.work.catch(() => {});
    if (!this.client) return;
    for (const vm of this.machines.records.values()) {
      if (!vm.haWitnessEnrollment) continue;
      try {
        await this.disarmNow(vm.id, vm.haWitnessEnrollment.failureThreshold);
      } catch (error) {
        console.error(`实例 ${vm.id} 的见证关闭心跳失败：`, (error as Error).message);
      }
    }
  }
}
