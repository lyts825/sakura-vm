/**
 * 模块职责：管理在线迁移目标的准备、完成与终止，使用装配层提供的核验端口确认状态。
 * Module purpose: Owns incoming live-migration preparation/completion/abort, using assembly-provided verification ports.
 */
import type { HostPeersV1 } from './service-contracts/v1.ts';
import { setTimeout as delay } from 'node:timers/promises';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { type VMConfig, type VMRecord } from '../shared/contracts/vm.ts';
import { freePort, qmp } from './qmp.ts';
import type { LiveMigrationProjects } from './live-migration-projects.ts';
import { pluginAuthority } from './plugin-authority.ts';
import { vmHostIdentity } from './vm-reference.ts';

type TargetPort = {
  /**
   * 签名 / Signature: TargetPort.bindSession.
   * 功能：为管理在线迁移目标的准备、完成与终止声明 bindSession 的输入与结果契约，所属容器为 TargetPort。
   * Purpose: Declares the input/result contract for bindSession in TargetPort. Module responsibility: Owns incoming live-migration preparation/completion/abort, using assembly-provided verification ports.
   * 输入 / Inputs: id: string; receipt: unknown
   * 输出 / Returns: Promise<unknown>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  bindSession(id: string, receipt: unknown): Promise<unknown>;
  /**
   * 签名 / Signature: TargetPort.recover.
   * 功能：为管理在线迁移目标的准备、完成与终止声明 recover 的输入与结果契约，所属容器为 TargetPort。
   * Purpose: Declares the input/result contract for recover in TargetPort. Module responsibility: Owns incoming live-migration preparation/completion/abort, using assembly-provided verification ports.
   * 输入 / Inputs: id: string; sessionId: string
   * 输出 / Returns: Promise<unknown>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  recover(id: string, sessionId: string): Promise<unknown>;
  /**
   * 签名 / Signature: TargetPort.authenticated.
   * 功能：为管理在线迁移目标的准备、完成与终止声明 authenticated 的输入与结果契约，所属容器为 TargetPort。
   * Purpose: Declares the input/result contract for authenticated in TargetPort. Module responsibility: Owns incoming live-migration preparation/completion/abort, using assembly-provided verification ports.
   * 输入 / Inputs: input: object
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  authenticated?(input: object): boolean;
};
const targetPorts = new WeakMap<object, TargetPort>();
/**
 * 入口 / Entry: registerLiveMigrationTargetPort.
 * 功能：在管理在线迁移目标的准备、完成与终止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `() => { if (targetPorts.get(owner) === port) targetPorts.delete(owner); }` 供上层消费（`live-migration-receiver.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `live-migration-receiver.ts`; this entry produces `() => { if (targetPorts.get(owner) === port) targetPorts.delete(owner); }` for its caller. Module context: Owns incoming live-migration preparation/completion/abort, using assembly-provided verification ports.
 * 处理：通过 `pluginAuthority`, `vmHostIdentity`, `targetPorts.has`, `targetPorts.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `pluginAuthority`, `vmHostIdentity`, `targetPorts.has`, `targetPorts.set`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: owner: object; port: TargetPort
 * 输出 / Returns: `() => { if (targetPorts.get(owner) === port) targetPorts.delete(owner); }`.
 * 副作用 / Effects: `targetPorts.set`.
 * 拒绝 / Refusals: 条件 / conditions `pluginAuthority() || vmHostIdentity(owner) !== owner`; `targetPorts.has(owner)`; 异常 / errors `new AppError('迁移目标核验端口仅允许系统装配', 403, 'LIVE_MIGRATION_SYSTEM_ONLY')`; `new Error('在线迁移目标端口已装配')`.
 */
export function registerLiveMigrationTargetPort(owner: object, port: TargetPort) {
  if (pluginAuthority() || vmHostIdentity(owner) !== owner)
    throw new AppError('迁移目标核验端口仅允许系统装配', 403, 'LIVE_MIGRATION_SYSTEM_ONLY');
  if (targetPorts.has(owner)) throw new Error('在线迁移目标端口已装配');
  targetPorts.set(owner, port);
  return () => { if (targetPorts.get(owner) === port) targetPorts.delete(owner); };
}

type PrepareInput = { requesterId: string; transferId: string; sourceVmId: string;
  config: VMConfig; key: string; seed: Buffer; projects?: LiveMigrationProjects;
  completionProtocol?: 1;
  organization?: VMRecord['organization'] };

export class LiveMigrationReceiver {
  private finalizing = new Set<string>();
  private preparing = new Set<string>();
  private target: TargetPort | undefined;
  /**
   * 入口 / Entry: LiveMigrationReceiver.constructor.
   * 功能：建立 LiveMigrationReceiver 的管理在线迁移目标的准备、完成与终止上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the LiveMigrationReceiver context for this module's responsibility: Owns incoming live-migration preparation/completion/abort, using assembly-provided verification ports. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; peers: HostPeersV1; requireAvailable: () => void default=() => {}; query: typeof qmp default=qmp
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.target`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private machines: Machines, private peers: HostPeersV1,
    private requireAvailable: () => void = () => {}, private query: typeof qmp = qmp) {
    const owner = vmHostIdentity(machines);
    this.target = targetPorts.get(owner);
    // Direct host owners used by local coordinators have the same private port; VmAccess does not expose it.
    if (!this.target && !pluginAuthority() && owner === machines) {
      const native = machines as unknown as {
        bindIncomingSession?: TargetPort['bindSession']; recoverIncoming?: TargetPort['recover'];
      };
      if (native.bindIncomingSession && native.recoverIncoming) this.target = {
        /**
         * 入口 / Entry: LiveMigrationReceiver.constructor.bindSession.
         * 功能：把本层请求转交 `inline`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `inline` and propagates the provider result or rejection.
         * 输入 / Inputs: id; receipt
         * 输出 / Returns: `native.bindIncomingSession!(id, receipt)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        bindSession: (id, receipt) => native.bindIncomingSession!(id, receipt),
        /**
         * 入口 / Entry: LiveMigrationReceiver.constructor.recover.
         * 功能：把本层请求转交 `inline`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `inline` and propagates the provider result or rejection.
         * 输入 / Inputs: id; sessionId
         * 输出 / Returns: `native.recoverIncoming!(id, sessionId)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        recover: (id, sessionId) => native.recoverIncoming!(id, sessionId),
      };
    }
  }

  /**
   * 入口 / Entry: LiveMigrationReceiver.prepare.
   * 功能：在管理在线迁移目标的准备、完成与终止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await this.prepareTarget(input)` 供上层消费（`LiveMigrationReceiver`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LiveMigrationReceiver`; this entry produces `await this.prepareTarget(input)` for its caller. Module context: Owns incoming live-migration preparation/completion/abort, using assembly-provided verification ports.
   * 处理：通过 `this.requireAvailable`, `this.preparing.has`, `this.preparing.add`, `this.prepareTarget` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.requireAvailable`, `this.preparing.has`, `this.preparing.add`, `this.prepareTarget`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: PrepareInput
   * 输出 / Returns: `await this.prepareTarget(input)`.
   * 副作用 / Effects: `this.preparing.add`; `this.preparing.delete`.
   * 拒绝 / Refusals: 条件 / conditions `this.preparing.has(identity)`; 异常 / errors `new AppError('原在线迁移目标正在准备，请重试原迁移请求', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.preparing.delete(identity);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.preparing.delete(identity);`; these steps also apply to exceptional exits.
   */
  async prepare(input: PrepareInput) {
    this.requireAvailable();
    const identity = `${input.requesterId}:${input.transferId}`;
    if (this.preparing.has(identity)) throw new AppError('原在线迁移目标正在准备，请重试原迁移请求', 409);
    this.preparing.add(identity);
    try { return await this.prepareTarget(input); }
    finally { this.preparing.delete(identity); }
  }

  /**
   * 入口 / Entry: LiveMigrationReceiver.prepareTarget.
   * 功能：在管理在线迁移目标的准备、完成与终止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `previous` / `receipt` 供上层消费（`LiveMigrationReceiver`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LiveMigrationReceiver`; this entry produces `previous` / `receipt` for its caller. Module context: Owns incoming live-migration preparation/completion/abort, using assembly-provided verification ports.
   * 处理：通过 `inline.find`, `this.machines.records.values`, `this.machines.createIncomingTarget`, `this.requireAvailable` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.find`, `this.machines.records.values`, `this.machines.createIncomingTarget`, `this.requireAvailable`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `previous && this.machines.live.has(created.id) && this.peers.matchesMigrationSession(previous.sessio…`; `previous`; `!this.machines.live.has(created.id)`.
   * 输入 / Inputs: input: PrepareInput
   * 输出 / Returns: `previous`; `receipt`.
   * 副作用 / Effects: `this.machines.createIncomingTarget`; `this.peers.closeMigrationSession`; `this.machines.startIncoming`; `this.peers.registerMigrationSession`; `this.machines.stop().catch`; 更新 / updates `ready`, `sessionId`.
   * 拒绝 / Refusals: 条件 / conditions `created.liveMigrationOrigin?.status !== 'prepared'`; `!live`; `this.machines.live.get(created.id) !== live`; 异常 / errors `new AppError('原迁移目标已接收状态，请重入原切换恢复流程', 409)`; `new AppError('目标 QEMU 未启动', 502)`.
   * 失败处理：catch 分支执行 `if (sessionId) this.peers.closeMigrationSession(sessionId);`; `if (!existing) { await this.machines.stop(created.id, true).catch(() => {}); await this.machines.delete(created.id).catch(() …`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (sessionId) this.peers.closeMigrationSession(sessionId);`; `if (!existing) { await this.machines.stop(created.id, true).catch(() => {}); await this.machines.delete(created.id).catch(() …`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async prepareTarget(input: PrepareInput) {
    const existing = [...this.machines.records.values()].find(vm =>
      vm.liveMigrationOrigin?.sourceHostId === input.requesterId &&
      vm.liveMigrationOrigin.transferId === input.transferId);
    const created = await this.machines.createIncomingTarget(input.config,
      { key: input.key, seed: input.seed }, {
        sourceHostId: input.requesterId, sourceVmId: input.sourceVmId,
        transferId: input.transferId,
        ...(input.completionProtocol ? { completionProtocol: input.completionProtocol } : {}),
      }, input.projects, input.organization);
    let sessionId: string | undefined;
    try {
      this.requireAvailable();
      if (created.liveMigrationOrigin?.status !== 'prepared')
        throw new AppError('原迁移目标已接收状态，请重入原切换恢复流程', 409);
      const previous = created.liveMigrationOrigin.prepareReceipt;
      if (previous && this.machines.live.has(created.id) &&
          this.peers.matchesMigrationSession(previous.sessionId, input.requesterId, created.id, input.transferId))
        return previous;
      if (previous) this.peers.closeMigrationSession(previous.sessionId);
      if (!this.machines.live.has(created.id)) await this.machines.startIncoming(created.id);
      const live = this.machines.live.get(created.id);
      if (!live) throw new AppError('目标 QEMU 未启动', 502);
      const deadline = Date.now() + 15_000;
      let ready = false;
      while (Date.now() < deadline) {
        this.requireAvailable();
        if (this.machines.live.get(created.id) !== live)
          throw new AppError('目标 QEMU 已退出', 502);
        try {
          const state = await this.query(live.qmpPort, 'query-status', undefined, 1000) as
            { running?: boolean; status?: string };
          if (state.running !== false || !['inmigrate', 'prelaunch'].includes(state.status || ''))
            throw new AppError('目标 QEMU 未保持迁移等待状态', 502);
          ready = true;
          break;
        } catch (error) {
          if (error instanceof AppError) throw error;
          await delay(100);
        }
      }
      if (!ready) throw new AppError('目标 QMP 启动超时', 502);
      const blocks = await this.query(live.qmpPort, 'query-block') as Array<{
        device?: string; inserted?: { ro?: boolean; 'node-name'?: string;
          image?: { 'virtual-size'?: number } } }>;
      if (!Array.isArray(blocks)) throw new AppError('目标 QEMU 未返回磁盘列表', 502);
      const writable = blocks.filter((block) => block.inserted?.ro === false);
      const disk = writable[0];
      const targetDiskNode = disk?.inserted?.['node-name'];
      if (writable.length !== 1 || disk.device !== 'sakura-disk' ||
          typeof targetDiskNode !== 'string' ||
          disk.inserted?.image?.['virtual-size'] !== input.config.diskGiB * 1024 ** 3)
        throw new AppError('目标 QEMU 磁盘与迁移配置不匹配', 502);
      const [diskPort, statePort] = await Promise.all([freePort(), freePort()]);
      if (diskPort === statePort) throw new AppError('目标迁移端口冲突', 502);
      this.requireAvailable();
      sessionId = this.peers.registerMigrationSession(input.requesterId, {
        disk: diskPort, state: statePort, qmp: live.qmpPort, targetDiskNode,
        targetVmId: created.id, transferId: input.transferId,
        ...(previous ? { sessionId: previous.sessionId } : {}),
      });
      const receipt = { targetVmId: created.id, sessionId, targetDiskNode,
        diskPort, statePort, ...(input.completionProtocol ? { completionProtocol: input.completionProtocol } : {}) };
      if (!this.target) throw new AppError('原迁移目标持久核验端口尚未装配', 503);
      await this.target.bindSession(created.id, receipt);
      return receipt;
    } catch (error) {
      if (sessionId) this.peers.closeMigrationSession(sessionId);
      if (!existing) {
        await this.machines.stop(created.id, true).catch(() => {});
        await this.machines.delete(created.id).catch(() => {});
      }
      throw error;
    }
  }

  /**
   * 入口 / Entry: LiveMigrationReceiver.status.
   * 功能：在管理在线迁移目标的准备、完成与终止中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ targetVmId: vm.id, status: this.machines.state(vm.id), originStatus: origin.status, ...(origin.completionProtocol === 1 && …` 供上层消费（`LiveMigrationReceiver`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `LiveMigrationReceiver`; this entry produces `{ targetVmId: vm.id, status: this.machines.state(vm.id), originStatus: origin.status, ...(origin.completionProtocol === 1 && …` for its caller. Module context: Owns incoming live-migration preparation/completion/abort, using assembly-provided verification ports.
   * 处理：通过 `this.requireAvailable`, `this.machines.get`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.requireAvailable`, `this.machines.get`, `this.machines.state`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: { requesterId: string; transferId: string; targetVmId: string }
   * 输出 / Returns: `{ targetVmId: vm.id, status: this.machines.state(vm.id), originStatus: origin.status, ...(origin.completionProtocol === 1 && …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!origin || origin.sourceHostId !== input.requesterId || origin.transferId !== input.transferId`; 异常 / errors `new AppError('在线迁移目标身份不匹配', 409)`.
   */
  status(input: { requesterId: string; transferId: string; targetVmId: string }) {
    this.requireAvailable();
    const vm = this.machines.get(input.targetVmId);
    const origin = vm.liveMigrationOrigin;
    if (!origin || origin.sourceHostId !== input.requesterId ||
        origin.transferId !== input.transferId)
      throw new AppError('在线迁移目标身份不匹配', 409);
    return { targetVmId: vm.id, status: this.machines.state(vm.id),
      originStatus: origin.status,
      ...(origin.completionProtocol === 1 && origin.sessionId && origin.projectsDigest ? {
        sourceHostId: origin.sourceHostId, sourceVmId: origin.sourceVmId, transferId: origin.transferId,
        sessionId: origin.sessionId, projectsDigest: origin.projectsDigest,
      } : {}) };
  }

  /** A running label alone is insufficient: verify this exact target QEMU and recheck origin after I/O. */
  /**
   * 入口 / Entry: LiveMigrationReceiver.verifiedStatus.
   * 功能：在管理在线迁移目标的准备、完成与终止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `before` / `{ ...after, targetVerifiedAt: new Date().toISOString() }` 供上层消费（`LiveMigrationReceiver`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LiveMigrationReceiver`; this entry produces `before` / `{ ...after, targetVerifiedAt: new Date().toISOString() }` for its caller. Module context: Owns incoming live-migration preparation/completion/abort, using assembly-provided verification ports.
   * 处理：通过 `this.status`, `this.machines.live.get`, `this.query`, `this.requireAvailable` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.status`, `this.machines.live.get`, `this.query`, `this.requireAvailable`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `before.status !== 'running' || !before.sessionId`.
   * 输入 / Inputs: input: { requesterId: string; transferId: string; targetVmId: string }
   * 输出 / Returns: `before`; `{ ...after, targetVerifiedAt: new Date().toISOString() }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!live`; `this.machines.live.get(input.targetVmId) !== live || after.sessionId !== before.sessionId || after.sourceVmId !== before.sour…`; 异常 / errors `new AppError('目标原进程不可用', 409)`; `new AppError('目标原迁移进程尚未确认运行', 409)`.
   */
  async verifiedStatus(input: { requesterId: string; transferId: string; targetVmId: string }) {
    const before = this.status(input);
    if (before.status !== 'running' || !before.sessionId) return before;
    const live = this.machines.live.get(input.targetVmId);
    if (!live) throw new AppError('目标原进程不可用', 409);
    const state = await this.query(live.qmpPort, 'query-status') as { running?: boolean; status?: string };
    this.requireAvailable();
    const after = this.status(input);
    if (this.machines.live.get(input.targetVmId) !== live || after.sessionId !== before.sessionId ||
      after.sourceVmId !== before.sourceVmId || after.projectsDigest !== before.projectsDigest ||
      state.running !== true || state.status !== 'running' || after.status !== 'running')
      throw new AppError('目标原迁移进程尚未确认运行', 409);
    return { ...after, targetVerifiedAt: new Date().toISOString() };
  }

  /**
   * 入口 / Entry: LiveMigrationReceiver.complete.
   * 功能：在管理在线迁移目标的准备、完成与终止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.verifiedStatus(input)` 供上层消费（`LiveMigrationReceiver`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LiveMigrationReceiver`; this entry produces `this.verifiedStatus(input)` for its caller. Module context: Owns incoming live-migration preparation/completion/abort, using assembly-provided verification ports.
   * 处理：通过 `this.requireAvailable`, `this.target.authenticated`, `this.finalizing.has`, `this.finalizing.add` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.requireAvailable`, `this.target.authenticated`, `this.finalizing.has`, `this.finalizing.add`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `before.originStatus === 'prepared' && input.sourceStopped === true && this.target`; `state.running === false`.
   * 输入 / Inputs: input: { requesterId: string; transferId: string; targetVmId: string; sessionId: string; sou…
   * 输出 / Returns: `this.verifiedStatus(input)`.
   * 副作用 / Effects: `this.finalizing.add`; `this.peers.closeMigrationSession`; `this.finalizing.delete`.
   * 拒绝 / Refusals: 条件 / conditions `input.sourceStopped && !this.target?.authenticated?.(input)`; `this.finalizing.has(input.targetVmId)`; `durable?.sessionId && durable.sessionId !== input.sessionId`; 异常 / errors `new AppError('目标冷恢复仅允许已认证的原迁移同伴入口', 403, 'LIVE_MIGRATION_SYSTEM_ONLY')`; `new AppError('目标实例正在完成在线迁移操作', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.finalizing.delete(input.targetVmId);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.finalizing.delete(input.targetVmId);`; these steps also apply to exceptional exits.
   */
  async complete(input: { requesterId: string; transferId: string;
    targetVmId: string; sessionId: string; sourceStopped?: true }) {
    this.requireAvailable();
    if (input.sourceStopped && !this.target?.authenticated?.(input))
      throw new AppError('目标冷恢复仅允许已认证的原迁移同伴入口', 403, 'LIVE_MIGRATION_SYSTEM_ONLY');
    if (this.finalizing.has(input.targetVmId))
      throw new AppError('目标实例正在完成在线迁移操作', 409);
    this.finalizing.add(input.targetVmId);
    try {
      const before = this.status(input);
      const durable = this.machines.get(input.targetVmId).liveMigrationOrigin;
      if (durable?.sessionId && durable.sessionId !== input.sessionId)
        throw new AppError('原在线迁移会话已变化', 409);
      if (!this.machines.live?.has(input.targetVmId) && input.sourceStopped === true) {
        if (!this.target) throw new AppError('原迁移目标恢复端口尚未装配', 503);
        await this.target.recover(input.targetVmId, input.sessionId);
        return this.verifiedStatus(input);
      }
      if (before.originStatus === 'prepared' && input.sourceStopped === true && this.target) {
        const live = this.machines.live.get(input.targetVmId)!;
        const state = await this.query(live.qmpPort, 'query-status') as { running?: boolean };
        if (state.running === false) {
          await this.target.recover(input.targetVmId, input.sessionId);
          return this.verifiedStatus(input);
        }
      }
      if (before.originStatus !== 'prepared') {
        if (before.sessionId && before.sessionId !== input.sessionId)
          throw new AppError('原在线迁移会话已变化', 409);
        return this.verifiedStatus(input);
      }
      if (!this.peers.matchesMigrationSession(input.sessionId, input.requesterId,
        input.targetVmId, input.transferId) &&
          !(input.sourceStopped === true && durable?.sessionId === input.sessionId))
        throw new AppError('在线迁移会话与目标实例不匹配', 409);
      await this.machines.completeIncoming(input.targetVmId, undefined, input.sessionId);
      this.peers.closeMigrationSession(input.sessionId);
      return this.verifiedStatus(input);
    } finally { this.finalizing.delete(input.targetVmId); }
  }

  /**
   * 入口 / Entry: LiveMigrationReceiver.abort.
   * 功能：在管理在线迁移目标的准备、完成与终止中，结束、撤销或清理本次拥有的领域资源；本入口产生 `{ targetVmId: input.targetVmId, aborted: true as const }` 供上层消费（`LiveMigrationReceiver`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `LiveMigrationReceiver`; this entry produces `{ targetVmId: input.targetVmId, aborted: true as const }` for its caller. Module context: Owns incoming live-migration preparation/completion/abort, using assembly-provided verification ports.
   * 处理：通过 `this.requireAvailable`, `this.finalizing.has`, `this.finalizing.add`, `this.status` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.requireAvailable`, `this.finalizing.has`, `this.finalizing.add`, `this.status`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: { requesterId: string; transferId: string; targetVmId: string; sessionId: string; sou…
   * 输出 / Returns: `{ targetVmId: input.targetVmId, aborted: true as const }`.
   * 副作用 / Effects: `this.finalizing.add`; `this.peers.closeMigrationSession`; `this.machines.stop`; `this.machines.delete`; `this.finalizing.delete`.
   * 拒绝 / Refusals: 条件 / conditions `this.finalizing.has(input.targetVmId)`; `before.originStatus !== 'prepared'`; `!this.peers.matchesMigrationSession(input.sessionId, input.requesterId, input.targetVmId, input.transferId) && this.machines.…`; 异常 / errors `new AppError('目标实例正在完成在线迁移操作', 409)`; `new AppError('目标实例已接收迁移，不能取消', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.finalizing.delete(input.targetVmId);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.finalizing.delete(input.targetVmId);`; these steps also apply to exceptional exits.
   */
  async abort(input: { requesterId: string; transferId: string;
    targetVmId: string; sessionId: string; sourceRunning: true }) {
    this.requireAvailable();
    if (this.finalizing.has(input.targetVmId))
      throw new AppError('目标实例正在完成在线迁移操作', 409);
    this.finalizing.add(input.targetVmId);
    try {
      const before = this.status(input);
      if (before.originStatus !== 'prepared')
        throw new AppError('目标实例已接收迁移，不能取消', 409);
      if (!this.peers.matchesMigrationSession(input.sessionId, input.requesterId,
        input.targetVmId, input.transferId) &&
          this.machines.get(input.targetVmId).liveMigrationOrigin?.sessionId !== input.sessionId)
        throw new AppError('在线迁移会话与目标实例不匹配', 409);
      // Revoke all active migration streams before checking whether the receiver
      // can still run; a late QEMU switchover must never race target deletion.
      this.peers.closeMigrationSession(input.sessionId);
      const live = this.machines.live.get(input.targetVmId);
      if (live) {
        const state = await this.query(live.qmpPort, 'query-status') as { running?: boolean };
        if (state.running !== false)
          throw new AppError('目标 QEMU 状态不确定，保留目标实例', 409);
      }
      await this.machines.stop(input.targetVmId, true);
      await this.machines.delete(input.targetVmId);
      return { targetVmId: input.targetVmId, aborted: true as const };
    } finally { this.finalizing.delete(input.targetVmId); }
  }
}
