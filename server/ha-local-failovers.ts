/**
 * 模块职责：处理本机实例故障接管，执行前重新核对策略及见证撤防结果。
 * Module purpose: Handles local VM failover, rechecking policies and witness disarm confirmation before promotion.
 */
import type { HaFailureMonitorV1, HostPeersV1, SnapshotReplicationsV1 } from './service-contracts/v1.ts';
import { AppError } from '../shared/errors.ts';
import { checkHaFailover, haFailoverOptions } from './ha-failover.ts';

import type { VmAccess as Machines } from './vm-access.ts';

type Policy = { enabled: boolean; options: unknown };
const INTERVAL_MS = 15_000;

/** Only promotes a replica after this service has observed its own QEMU process exit. */
export class HaLocalFailovers {
  private timer?: ReturnType<typeof setInterval>;
  private work = Promise.resolve();
  private closed = false;
  private errors: Record<string, string> = {};
  private observedLive = new Set<string>();
  /**
   * 入口 / Entry: HaLocalFailovers.witnessDisarm.
   * 功能：向调用者提供 `this.dependencies.disarmWitness` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.dependencies.disarmWitness` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.dependencies.disarmWitness`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private get witnessDisarm() {
    return this.dependencies.disarmWitness;
  }

  /**
   * 入口 / Entry: HaLocalFailovers.constructor.
   * 功能：建立 HaLocalFailovers 的处理本机实例故障接管上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the HaLocalFailovers context for this module's responsibility: Handles local VM failover, rechecking policies and witness disarm confirmation before promotion. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; monitor: HaFailureMonitorV1; peers: HostPeersV1; replications: SnapshotReplicationsV1; policies: () => Promise<Record<string, Policy>>; allowed: () => boolean default=() => true; dependencies: { disarmWitness?: (id: string, failureThreshold: number) => Promise<void> } default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private monitor: HaFailureMonitorV1,
    private peers: HostPeersV1,
    private replications: SnapshotReplicationsV1,
    private policies: () => Promise<Record<string, Policy>>,
    private allowed: () => boolean = () => true,
    private dependencies: {
    /**
     * 签名 / Signature: HaLocalFailovers.constructor.disarmWitness.
     * 功能：为处理本机实例故障接管声明 disarmWitness 的输入与结果契约，所属容器为 HaLocalFailovers.constructor。
     * Purpose: Declares the input/result contract for disarmWitness in HaLocalFailovers.constructor. Module responsibility: Handles local VM failover, rechecking policies and witness disarm confirmation before promotion.
     * 输入 / Inputs: id: string; failureThreshold: number
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    disarmWitness?: (id: string, failureThreshold: number) => Promise<void> } = {},
  ) {}

  /**
   * 入口 / Entry: HaLocalFailovers.disarmWitness.
   * 功能：在处理本机实例故障接管中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HaLocalFailovers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaLocalFailovers`; this entry produces `void` for its caller. Module context: Handles local VM failover, rechecking policies and witness disarm confirmation before promotion.
   * 处理：通过 `this.machines.get`, `this.witnessDisarm` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.witnessDisarm`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!enrollment`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.witnessDisarm`; 异常 / errors `new AppError('见证撤防校验不可用，不能执行本机故障接管', 503, 'HA_WITNESS_UNAVAILABLE')`.
   */
  private async disarmWitness(id: string) {
    const enrollment = this.machines.get(id).haWitnessEnrollment;
    if (!enrollment) return;
    if (!this.witnessDisarm)
      throw new AppError('见证撤防校验不可用，不能执行本机故障接管', 503, 'HA_WITNESS_UNAVAILABLE');
    await this.witnessDisarm(id, enrollment.failureThreshold);
  }

  /**
   * 入口 / Entry: HaLocalFailovers.requireAttemptAuthority.
   * 功能：在处理本机实例故障接管中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`HaLocalFailovers`）。
   * Purpose: Checks admission, input or resource ownership in `HaLocalFailovers`; the calls and state transitions below complete the operation. Module context: Handles local VM failover, rechecking policies and witness disarm confirmation before promotion.
   * 处理：通过 `this.policies`, `haFailoverOptions.safeParse`, `this.allowed`, `this.machines.live.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.policies`, `haFailoverOptions.safeParse`, `this.allowed`, `this.machines.live.has`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; targetHostId: string; firstFence: default=false
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.observedLive.has`.
   * 拒绝 / Refusals: 条件 / conditions `!latest?.enabled || !parsed.success || !parsed.data.autoProcessFailover || parsed.data.targetHostId !== targetHostId`; `this.closed || !this.allowed() || this.machines.live.has(id) || (firstFence && (!this.observedLive.has(id) || !this.monitor.v…`; 异常 / errors `new AppError('接管策略已变化，取消接管', 409)`; `new AppError('来源实例故障状态已变化，取消接管', 409)`.
   */
  private async requireAttemptAuthority(id: string, targetHostId: string, firstFence = false) {
    const latest = (await this.policies())[id];
    const parsed = haFailoverOptions.safeParse(latest?.options);
    if (
      !latest?.enabled ||
      !parsed.success ||
      !parsed.data.autoProcessFailover ||
      parsed.data.targetHostId !== targetHostId
    )
      throw new AppError('接管策略已变化，取消接管', 409);
    if (
      this.closed ||
      !this.allowed() ||
      this.machines.live.has(id) ||
      (firstFence && (!this.observedLive.has(id) || !this.monitor.view(id)?.suspected))
    )
      throw new AppError('来源实例故障状态已变化，取消接管', 409);
    this.machines.requireStopped(id);
  }

  /**
   * 入口 / Entry: HaLocalFailovers.init.
   * 功能：在处理本机实例故障接管中，初始化并核对当前领域状态；处理结果记录到 `this.timer`（`HaLocalFailovers`）。
   * Purpose: Initializes and verifies current domain state in `HaLocalFailovers`; the outcome is recorded in `this.timer`. Module context: Handles local VM failover, rechecking policies and witness disarm confirmation before promotion.
   * 处理：通过 `this.machines.on`, `this.observeLive`, `this.sample`, `setInterval` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.on`, `this.observeLive`, `this.sample`, `setInterval`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.observeLive`; `setInterval`; 更新 / updates `this.timer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    this.machines.on('change', this.observeLive);
    this.observeLive();
    await this.sample();
    this.timer = setInterval(
      () => void this.sample().catch((error) => console.error('本机 QEMU 故障接管扫描失败：', error)),
      INTERVAL_MS,
    );
    this.timer.unref();
  }

  /**
   * 入口 / Entry: HaLocalFailovers.observeLive.
   * 功能：在处理本机实例故障接管中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HaLocalFailovers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaLocalFailovers`; the calls and state transitions below complete the operation. Module context: Handles local VM failover, rechecking policies and witness disarm confirmation before promotion.
   * 处理：通过 `this.machines.live.keys`, `this.machines.state`, `this.observedLive.add` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.live.keys`, `this.machines.state`, `this.observedLive.add`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.machines.state(id) === 'running'`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.observedLive.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private observeLive = () => {
    for (const id of this.machines.live.keys())
      if (this.machines.state(id) === 'running') this.observedLive.add(id);
  };

  /**
   * 入口 / Entry: HaLocalFailovers.view.
   * 功能：从当前输入或状态计算 `{ error: this.errors[id] || null }`，供调用方后续验证或使用。
   * Purpose: Computes `{ error: this.errors[id] || null }` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ error: this.errors[id] || null }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  view(id: string) {
    return { error: this.errors[id] || null };
  }
  /**
   * 入口 / Entry: HaLocalFailovers.hasObservedLive.
   * 功能：从当前输入或状态计算 `this.observedLive.has(id)`，供调用方后续验证或使用。
   * Purpose: Computes `this.observedLive.has(id)` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.observedLive.has(id)`.
   * 副作用 / Effects: `this.observedLive.has`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  hasObservedLive(id: string) {
    return this.observedLive.has(id);
  }

  /**
   * 入口 / Entry: HaLocalFailovers.sample.
   * 功能：在处理本机实例故障接管中，执行此领域的具体处理步骤并返回其结果；本入口产生 `current` 供上层消费（`HaLocalFailovers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaLocalFailovers`; this entry produces `current` for its caller. Module context: Handles local VM failover, rechecking policies and witness disarm confirmation before promotion.
   * 处理：通过 `this.work.catch().then`, `this.work.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.work.catch().then`, `this.work.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `current`.
   * 副作用 / Effects: 更新 / updates `this.work`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  sample() {
    const current = this.work.catch(() => {}).then(() => this.scan());
    this.work = current;
    return current;
  }

  /**
   * 入口 / Entry: HaLocalFailovers.rejoin.
   * 功能：在处理本机实例故障接管中，执行此领域的具体处理步骤并返回其结果；本入口产生 `current` 供上层消费（`HaLocalFailovers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaLocalFailovers`; this entry produces `current` for its caller. Module context: Handles local VM failover, rechecking policies and witness disarm confirmation before promotion.
   * 处理：通过 `this.work.catch().then`, `this.work.catch`, `current.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.work.catch().then`, `this.work.catch`, `current.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; dataReconciled: boolean
   * 输出 / Returns: `current`.
   * 副作用 / Effects: 更新 / updates `this.work`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  rejoin(id: string, dataReconciled: boolean) {
    /**
     * 入口 / Entry: HaLocalFailovers.rejoin.callback@94.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.work.catch().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.work.catch().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ ready: true, executed: true, retiredRemoteVmId: promotion.remoteVmId, message: '目标副本已持久封锁，来源实例的启动栅栏已解除。', }`.
     * 副作用 / Effects: `this.machines.releaseHaPromotion`.
     * 拒绝 / Refusals: 条件 / conditions `this.closed || !this.allowed()`; `!dataReconciled`; `!promotion`; 异常 / errors `new AppError('故障接管服务当前不可用', 503)`; `new AppError('请先回迁目标期间的写入数据，或明确接受丢失目标新数据', 409)`.
     */
    const current = this.work
      .catch(() => {})
      .then(async () => {
        if (this.closed || !this.allowed()) throw new AppError('故障接管服务当前不可用', 503);
        if (!dataReconciled) throw new AppError('请先回迁目标期间的写入数据，或明确接受丢失目标新数据', 409);
        this.machines.requireUnlocked(id);
        const promotion = this.machines.get(id).haPromotion;
        if (!promotion) throw new AppError('来源实例没有故障接管栅栏', 409);
        this.machines.requireStopped(id);
        await this.peers.retireReplica(promotion.peerId, {
          transferId: promotion.transferId,
          remoteVmId: promotion.remoteVmId,
          sha256: promotion.sha256,
          sourceVmId: id,
          snapshotId: promotion.snapshotId,
        });
        await this.monitor.reconfigure(id);
        await this.machines.releaseHaPromotion(id, promotion.transferId);
        delete this.errors[id];
        return {
          ready: true,
          executed: true,
          retiredRemoteVmId: promotion.remoteVmId,
          message: '目标副本已持久封锁，来源实例的启动栅栏已解除。',
        };
      });
    this.work = current.then(
      () => {},
      () => {},
    );
    return current;
  }

  /**
   * 入口 / Entry: HaLocalFailovers.scan.
   * 功能：在处理本机实例故障接管中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HaLocalFailovers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaLocalFailovers`; this entry produces `void` for its caller. Module context: Handles local VM failover, rechecking policies and witness disarm confirmation before promotion.
   * 处理：通过 `this.allowed`, `this.policies`, `haFailoverOptions.safeParse`, `this.attempt` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.allowed`, `this.policies`, `haFailoverOptions.safeParse`, `this.attempt`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || !this.allowed()`; `this.closed || !this.allowed() || !policy.enabled`; `!options.success || !options.data.autoProcessFailover`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `this.errors[id]`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `this.errors[id] = (error as Error).message;`; `console.error(`实例 ${id} 的本机故障接管失败：`, error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.errors[id] = (error as Error).message;`; `console.error(`实例 ${id} 的本机故障接管失败：`, error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async scan() {
    if (this.closed || !this.allowed()) return;
    const policies = await this.policies();
    for (const [id, policy] of Object.entries(policies)) {
      if (this.closed || !this.allowed() || !policy.enabled) continue;
      const options = haFailoverOptions.safeParse(policy.options);
      if (!options.success || !options.data.autoProcessFailover) continue;
      try {
        await this.attempt(id, policy);
        delete this.errors[id];
      } catch (error) {
        this.errors[id] = (error as Error).message;
        console.error(`实例 ${id} 的本机故障接管失败：`, error);
      }
    }
  }

  /**
   * 入口 / Entry: HaLocalFailovers.attempt.
   * 功能：执行符合当前策略的本机故障接管，核对见证撤防及所选副本。
   * Purpose: Performs eligible local failover after current policy, witness-disarm and selected-replica checks.
   * 设计：异步检查后重读原策略，策略变化取消；清理与接管按原身份推进，避免旧观察接管新实例。
   * Design: Policies are re-read after asynchronous checks and changes cancel; original identities prevent stale observations promoting a replacement VM.
   * 输入 / Inputs: id: string; policy: Policy
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.observedLive.has`; `this.machines.updateHaPromotion`; 更新 / updates `promotion`.
   * 拒绝 / Refusals: 条件 / conditions `retrying`; `this.machines.get(id).haPromotion?.transferId !== promotion.transferId`; `result.status !== 'running'`; 异常 / errors `new AppError('来源实例接管栅栏已变化，取消接管', 409)`; `new AppError(`故障副本当前为 ${result.status}，尚未接管`, 409)`.
   * 失败处理：catch 分支执行 `await this.machines.updateHaPromotion(id, promotion.transferId, { status: 'fenced', error: (error as Error).message.slice(0, …`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await this.machines.updateHaPromotion(id, promotion.transferId, { status: 'fenced', error: (error as Error).message.slice(0, …`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async attempt(id: string, policy: Policy) {
    const vm = this.machines.get(id);
    if (vm.haPromotion?.status === 'accepted') return;
    if (this.machines.live.has(id)) return;
    let promotion = vm.haPromotion;
    const retrying = !!promotion;
    if (!promotion) {
      if (!this.observedLive.has(id) || !this.monitor.view(id)?.suspected) return;
      this.machines.requireUnlocked(id);
      const checked = await checkHaFailover(
        this.machines,
        this.peers,
        this.replications,
        id,
        policy.options,
        policy.enabled,
        undefined,
        true,
        true,
      );
      const replica = checked.replica;
      if (!checked.localProcessReady || !replica?.remoteVmId || !replica.sha256) return;
      if (this.closed || !this.allowed()) return;
      const at = new Date().toISOString();
      promotion = await this.machines.fenceForHa(
        id,
        {
          peerId: replica.peerId,
          targetHostId: checked.policy.targetHostId!,
          transferId: replica.transferId,
          remoteVmId: replica.remoteVmId,
          snapshotId: replica.snapshotId,
          sha256: replica.sha256,
          fencedAt: at,
          status: 'fenced',
          updatedAt: at,
        },
        async () => {
          await this.requireAttemptAuthority(id, checked.policy.targetHostId!, true);
          await this.disarmWitness(id);
          await this.requireAttemptAuthority(id, checked.policy.targetHostId!, true);
        },
      );
    }
    const input = {
      transferId: promotion.transferId,
      remoteVmId: promotion.remoteVmId,
      sha256: promotion.sha256,
      sourceVmId: id,
      snapshotId: promotion.snapshotId,
    };
    try {
      if (this.closed || !this.allowed()) return;
      if (retrying) {
        await this.disarmWitness(id);
        await this.requireAttemptAuthority(id, promotion.targetHostId);
        if (this.machines.get(id).haPromotion?.transferId !== promotion.transferId)
          throw new AppError('来源实例接管栅栏已变化，取消接管', 409);
      }
      const target = await this.peers.checkReplicaActivation(promotion.peerId, input);
      await this.requireAttemptAuthority(id, promotion.targetHostId);
      if (this.machines.get(id).haPromotion?.transferId !== promotion.transferId)
        throw new AppError('来源实例接管栅栏已变化，取消接管', 409);
      const result =
        target.status === 'stopped' ? await this.peers.activateReplica(promotion.peerId, input) : target;
      if (result.status === 'starting') {
        if (promotion.error)
          await this.machines.updateHaPromotion(id, promotion.transferId, {
            status: 'fenced',
            error: undefined,
          });
        return;
      }
      if (result.status !== 'running') throw new AppError(`故障副本当前为 ${result.status}，尚未接管`, 409);
      await this.machines.updateHaPromotion(id, promotion.transferId, {
        status: 'accepted',
        error: undefined,
      });
    } catch (error) {
      await this.machines.updateHaPromotion(id, promotion.transferId, {
        status: 'fenced',
        error: (error as Error).message.slice(0, 500),
      });
      throw error;
    }
  }

  /**
   * 入口 / Entry: HaLocalFailovers.close.
   * 功能：在处理本机实例故障接管中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`HaLocalFailovers`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HaLocalFailovers`; the outcome is recorded in `this.closed`. Module context: Handles local VM failover, rechecking policies and witness disarm confirmation before promotion.
   * 处理：通过 `clearInterval`, `this.machines.off`, `this.work.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `clearInterval`, `this.machines.off`, `this.work.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `clearInterval`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.machines.off('change', this.observeLive);
    await this.work.catch(() => {});
  }
}
