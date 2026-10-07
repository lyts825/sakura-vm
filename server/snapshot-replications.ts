/**
 * 模块职责：复制选定快照并保存传输状态，重启后重试先查询远端回执。
 * Module purpose: Replicates snapshots with durable transfer state; retries after restart query original remote receipts first.
 */
import type { BundlesV1, HostPeersV1 } from './service-contracts/v1.ts';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';

import type { VmSnapshotReplicationPort } from './vm-ports.ts';
import { AppError } from '../shared/errors.ts';
import { createSchema } from '../shared/contracts/vm.ts';
import { DATA } from './paths.ts';
import { MetadataStore } from './metadata-store.ts';

export const snapshotReplicationInput = z.object({
  peerId: z.uuid(), snapshotId: z.uuid(), targetName: createSchema.shape.name,
}).strict();
type Input = z.infer<typeof snapshotReplicationInput>;

const entrySchema = z.object({
  vmId: z.uuid(), snapshotId: z.uuid(), peerId: z.uuid(), transferId: z.uuid(),
  targetName: createSchema.shape.name, sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['queued', 'transferring', 'replicated', 'review']),
  remoteVmId: z.uuid().optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  error: z.string().max(500).optional(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
const storeSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema).max(128) }).strict();
type Entry = z.infer<typeof entrySchema>;
type Receipt = NonNullable<Awaited<ReturnType<HostPeersV1['importStatus']>>>;

export class SnapshotReplications {
  private state?: z.infer<typeof storeSchema>;
  private metadata: MetadataStore<z.infer<typeof storeSchema>>;
  private active = new Set<string>();
  /**
   * 入口 / Entry: SnapshotReplications.constructor.
   * 功能：建立 SnapshotReplications 的复制选定快照并保存传输状态上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the SnapshotReplications context for this module's responsibility: Replicates snapshots with durable transfer state; retries after restart query original remote receipts first. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: VmSnapshotReplicationPort; bundles: BundlesV1; peers: HostPeersV1; file: default=join(DATA, 'snapshot-replications.json')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.metadata`.
   */
  constructor(private machines: VmSnapshotReplicationPort, private bundles: BundlesV1, private peers: HostPeersV1,
    private file = join(DATA, 'snapshot-replications.json')) {
    this.metadata = new MetadataStore(file, {
    /**
     * 入口 / Entry: SnapshotReplications.constructor.fallback.
     * 功能：从当前输入或状态计算 `({ version: 1, entries: [] })`，供调用方后续验证或使用。
     * Purpose: Computes `({ version: 1, entries: [] })` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `({ version: 1, entries: [] })`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    fallback: () => ({ version: 1, entries: [] }),
      /**
       * 入口 / Entry: SnapshotReplications.constructor.parse.
       * 功能：把本层请求转交 `storeSchema.parse`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `storeSchema.parse` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `storeSchema.parse(value)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      parse: (value) => storeSchema.parse(value) });
  }

  /**
   * 入口 / Entry: SnapshotReplications.init.
   * 功能：在复制选定快照并保存传输状态中，初始化并核对当前领域状态；处理结果记录到 `this.state`（`SnapshotReplications`）。
   * Purpose: Initializes and verifies current domain state in `SnapshotReplications`; the outcome is recorded in `this.state`. Module context: Replicates snapshots with durable transfer state; retries after restart query original remote receipts first.
   * 处理：通过 `this.metadata.read`, `this.state.entries.some`, `this.change` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.metadata.read`, `this.state.entries.some`, `this.change`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.state.entries.some((entry) => entry.status === 'transferring')`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.state`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    this.state = (await this.metadata.read()).value;
    if (this.state.entries.some((entry) => entry.status === 'transferring'))
      await this.change((state) => {
        for (const entry of state.entries) if (entry.status === 'transferring') {
          entry.status = 'review';
          entry.error = '服务重启中断复制；重试将先查询目标回执';
          entry.updatedAt = new Date().toISOString();
        }
      });
  }

  /**
   * 入口 / Entry: SnapshotReplications.view.
   * 功能：从当前输入或状态计算 `{ enabled: true, entries: [...this.state!.entries].reverse() }`，供调用方后续验证或使用。
   * Purpose: Computes `{ enabled: true, entries: [...this.state!.entries].reverse() }` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ enabled: true, entries: [...this.state!.entries].reverse() }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view() {
    return { enabled: true, entries: [...this.state!.entries].reverse() };
  }

  /**
   * 入口 / Entry: SnapshotReplications.change.
   * 功能：在复制选定快照并保存传输状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `committed.result` 供上层消费（`SnapshotReplications`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SnapshotReplications`; this entry produces `committed.result` for its caller. Module context: Replicates snapshots with durable transfer state; retries after restart query original remote receipts first.
   * 处理：通过 `this.metadata.update` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.metadata.update`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: edit: (state: z.infer<typeof storeSchema>) => T
   * 输出 / Returns: `committed.result`.
   * 副作用 / Effects: `this.metadata.update`; 更新 / updates `this.state`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async change<T>(edit: (state: z.infer<typeof storeSchema>) => T) {
    const committed = await this.metadata.update(edit);
    this.state = committed.value;
    return committed.result;
  }

  /**
   * 入口 / Entry: SnapshotReplications.source.
   * 功能：把本层请求转交 `this.machines.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.machines.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; snapshotId: string
   * 输出 / Returns: `this.machines.locked(id, async () => { this.machines.requireStopped(id); const vm = this.machines.get(id); const snapshot = v…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async source(id: string, snapshotId: string) {
    /**
     * 入口 / Entry: SnapshotReplications.source.callback@65.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ vm, snapshot, fingerprint }`.
     * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
     * 拒绝 / Refusals: 条件 / conditions `!snapshot`; 异常 / errors `new AppError('快照不存在', 404)`.
     */
    return this.machines.locked(id, async () => {
      this.machines.requireStopped(id);
      const vm = this.machines.get(id);
      const snapshot = vm.snapshots.find((item) => item.id === snapshotId);
      if (!snapshot) throw new AppError('快照不存在', 404);
      const identity = await this.machines.snapshotIdentity(id, snapshotId);
      const fingerprint = createHash('sha256').update(JSON.stringify({
        snapshot: { id: snapshot.id, createdAt: snapshot.createdAt,
          diskGiB: snapshot.diskGiB, pendingResize: snapshot.pendingResize },
        config: { memoryMiB: vm.memoryMiB, cpus: vm.cpus, accelerator: vm.accelerator,
          distro: vm.distro, architecture: vm.architecture,
          template: vm.template, hardware: vm.hardware,
          firmware: vm.firmware },
        key: identity.key, seed: identity.seed.toString('base64'),
      })).digest('hex');
      return { vm, snapshot, fingerprint };
    });
  }

  /**
   * 入口 / Entry: SnapshotReplications.prior.
   * 功能：把本层请求转交 `inline.entries.findLast`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `inline.entries.findLast` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; input: Input
   * 输出 / Returns: `this.state!.entries.findLast((entry) => entry.vmId === id && entry.snapshotId === input.snapshotId && entry.peerId === input.…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private prior(id: string, input: Input) {
    return this.state!.entries.findLast((entry) => entry.vmId === id &&
      entry.snapshotId === input.snapshotId && entry.peerId === input.peerId &&
      entry.targetName === input.targetName);
  }

  /**
   * 入口 / Entry: SnapshotReplications.checkReceipt.
   * 功能：在复制选定快照并保存传输状态中，核对调用资格、输入或资源归属；本入口产生 `receipt` 供上层消费（`SnapshotReplications`）。
   * Purpose: Checks admission, input or resource ownership in `SnapshotReplications`; this entry produces `receipt` for its caller. Module context: Replicates snapshots with durable transfer state; retries after restart query original remote receipts first.
   * 输入 / Inputs: receipt: Receipt | null; id: string; input: Input; prior: Entry optional
   * 输出 / Returns: `receipt`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `receipt && (receipt.name !== input.targetName || receipt.sourceVmId !== id || receipt.snapshotId !== input.snapshotId || !rec…`; `!receipt && prior?.remoteVmId`; 异常 / errors `new AppError('目标快照副本回执与来源、名称或校验值不一致', 409)`; `new AppError('目标快照副本已失效；请使用新的目标名称重新复制', 409)`.
   */
  private checkReceipt(receipt: Receipt | null, id: string, input: Input,
    prior?: Entry) {
    if (receipt && (receipt.name !== input.targetName || receipt.sourceVmId !== id ||
        receipt.snapshotId !== input.snapshotId || !receipt.sha256 ||
        (prior?.remoteVmId && receipt.id !== prior.remoteVmId) ||
        (prior?.sha256 && receipt.sha256 !== prior.sha256) ||
        (prior?.sourceSha256 && receipt.sha256 !== prior.sourceSha256)))
      throw new AppError('目标快照副本回执与来源、名称或校验值不一致', 409);
    if (!receipt && prior?.remoteVmId)
      throw new AppError('目标快照副本已失效；请使用新的目标名称重新复制', 409);
    return receipt;
  }

  /**
   * 入口 / Entry: SnapshotReplications.target.
   * 功能：在复制选定快照并保存传输状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `peer` 供上层消费（`SnapshotReplications`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SnapshotReplications`; this entry produces `peer` for its caller. Module context: Replicates snapshots with durable transfer state; retries after restart query original remote receipts first.
   * 处理：通过 `this.machines.get`, `this.peers.view().outbound.find`, `this.peers.view`, `this.peers.score` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.peers.view().outbound.find`, `this.peers.view`, `this.peers.score`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; peerId: string; requireCapacity: boolean
   * 输出 / Returns: `peer`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!peer`; `!candidate?.status || candidate.reasons.some((reason) => reason.startsWith('连接失败') || reason.startsWith('没有 90 秒')) || (requi…`; `candidate.status.platform !== local.platform || candidate.status.arch !== local.arch`; 异常 / errors `new AppError('目标主机未配对或已移除', 404)`; `new AppError(`目标主机当前不可选：${candidate?.reasons.join('；') || '没有有效观测'}`, 409)`.
   */
  private async target(id: string, peerId: string, requireCapacity: boolean) {
    const vm = this.machines.get(id);
    const peer = this.peers.view().outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('目标主机未配对或已移除', 404);
    const scored = await this.peers.score({ cpus: vm.cpus, memoryMiB: vm.memoryMiB });
    const candidate = scored.candidates.find((item) => item.id === peer.remoteId &&
      item.source === 'peer');
    if (!candidate?.status || candidate.reasons.some((reason) =>
        reason.startsWith('连接失败') || reason.startsWith('没有 90 秒')) ||
        (requireCapacity && !candidate.eligible))
      throw new AppError(`目标主机当前不可选：${candidate?.reasons.join('；') || '没有有效观测'}`, 409);
    const local = await this.peers.status();
    if (candidate.status.platform !== local.platform || candidate.status.arch !== local.arch)
      throw new AppError('目标主机平台或架构与源主机不一致', 409);
    return peer;
  }

  /**
   * 入口 / Entry: SnapshotReplications.preview.
   * 功能：在复制选定快照并保存传输状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: false, executed: false, reason: '请选择快照、已配对目标主机并填写目标副本名称。' }` / `{ ready: true, executed: false, snapshot: { id: source.snapshot.id, name: source.snapshot.name, createdAt: source.snapshot.cr…` 供上层消费（`SnapshotReplications`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SnapshotReplications`; this entry produces `{ ready: false, executed: false, reason: '请选择快照、已配对目标主机并填写目标副本名称。' }` / `{ ready: true, executed: false, snapshot: { id: source.snapshot.id, name: source.snapshot.name, createdAt: source.snapshot.cr…` for its caller. Module context: Replicates snapshots with durable transfer state; retries after restart query original remote receipts first.
   * 处理：通过 `snapshotReplicationInput.safeParse`, `this.source`, `this.prior`, `this.checkReceipt` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `snapshotReplicationInput.safeParse`, `this.source`, `this.prior`, `this.checkReceipt`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!parsed.success`.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `{ ready: false, executed: false, reason: '请选择快照、已配对目标主机并填写目标副本名称。' }`; `{ ready: true, executed: false, snapshot: { id: source.snapshot.id, name: source.snapshot.name, createdAt: source.snapshot.cr…`; `{ ready: false, executed: false, reason: (error as Error).message }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `prior && prior.sourceFingerprint !== source.fingerprint`; 异常 / errors `new AppError('快照来源配置已变化；请使用新的目标名称重新复制', 409)`.
   * 失败处理：catch 分支执行 `return { ready: false, executed: false, reason: (error as Error).message };`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return { ready: false, executed: false, reason: (error as Error).message };`; these statements determine whether a failure is absorbed or rejected again.
   */
  async preview(id: string, input: unknown) {
    const parsed = snapshotReplicationInput.safeParse(input);
    if (!parsed.success) return { ready: false, executed: false,
      reason: '请选择快照、已配对目标主机并填写目标副本名称。' };
    try {
      const source = await this.source(id, parsed.data.snapshotId);
      const prior = this.prior(id, parsed.data);
      if (prior && prior.sourceFingerprint !== source.fingerprint)
        throw new AppError('快照来源配置已变化；请使用新的目标名称重新复制', 409);
      const receipt = prior ? this.checkReceipt(await this.peers.importStatus(
        parsed.data.peerId, prior.transferId), id, parsed.data, prior) : null;
      const peer = await this.target(id, parsed.data.peerId, !receipt);
      return { ready: true, executed: false, snapshot: {
        id: source.snapshot.id, name: source.snapshot.name,
        createdAt: source.snapshot.createdAt },
        target: { id: peer.id, hostId: peer.remoteId, name: peer.name },
        existingRemoteVmId: receipt?.id, existingSha256: receipt?.sha256,
        message: '选定历史快照将作为目标主机上的独立可启动实例导入；来源快照和实例保持不变。' };
    } catch (error) {
      return { ready: false, executed: false, reason: (error as Error).message };
    }
  }

  /**
   * 入口 / Entry: SnapshotReplications.run.
   * 功能：在复制选定快照并保存传输状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await this.runOne(id, options, signal)` 供上层消费（`SnapshotReplications`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SnapshotReplications`; this entry produces `await this.runOne(id, options, signal)` for its caller. Module context: Replicates snapshots with durable transfer state; retries after restart query original remote receipts first.
   * 处理：通过 `snapshotReplicationInput.parse`, `this.active.has`, `this.active.add`, `this.runOne` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `snapshotReplicationInput.parse`, `this.active.has`, `this.active.add`, `this.runOne`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal
   * 输出 / Returns: `await this.runOne(id, options, signal)`.
   * 副作用 / Effects: `this.active.add`; `this.active.delete`.
   * 拒绝 / Refusals: 条件 / conditions `this.active.has(key)`; 异常 / errors `new AppError('此快照复制任务仍在进行', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.active.delete(key);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.active.delete(key);`; these steps also apply to exceptional exits.
   */
  async run(id: string, input: unknown, signal: AbortSignal) {
    const options = snapshotReplicationInput.parse(input);
    const key = `${id}:${options.snapshotId}:${options.peerId}:${options.targetName}`;
    if (this.active.has(key)) throw new AppError('此快照复制任务仍在进行', 409);
    this.active.add(key);
    try { return await this.runOne(id, options, signal); }
    finally { this.active.delete(key); }
  }

  /**
   * 入口 / Entry: SnapshotReplications.runOne.
   * 功能：在复制选定快照并保存传输状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: true, executed: true, transferId, sourceVmId: id, snapshotId: options.snapshotId, remoteVmId: receipt.id, targetHost…` 供上层消费（`SnapshotReplications`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SnapshotReplications`; this entry produces `{ ready: true, executed: true, transferId, sourceVmId: id, snapshotId: options.snapshotId, remoteVmId: receipt.id, targetHost…` for its caller. Module context: Replicates snapshots with durable transfer state; retries after restart query original remote receipts first.
   * 处理：通过 `signal.throwIfAborted`, `this.source`, `this.prior`, `this.checkReceipt` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.source`, `this.prior`, `this.checkReceipt`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!prior`.
   * 输入 / Inputs: id: string; options: Input; signal: AbortSignal
   * 输出 / Returns: `{ ready: true, executed: true, transferId, sourceVmId: id, snapshotId: options.snapshotId, remoteVmId: receipt.id, targetHost…`.
   * 副作用 / Effects: `update`; `this.peers.upload`; `update().catch`; 更新 / updates `receipt`.
   * 拒绝 / Refusals: 条件 / conditions `prior && prior.sourceFingerprint !== source.fingerprint`; `localSha && receipt.sha256 !== localSha`; `(await this.source(id, options.snapshotId)).fingerprint !== source.fingerprint`; 异常 / errors `new AppError('快照来源配置已变化；请使用新的目标名称重新复制', 409)`; `new AppError('目标副本校验值与来源快照导出结果不一致', 409)`.
   * 失败处理：catch 分支执行 `await update('review', receipt || existing || undefined, (error as Error).message) .catch(() => {});`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await update('review', receipt || existing || undefined, (error as Error).message) .catch(() => {});`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async runOne(id: string, options: Input, signal: AbortSignal) {
    signal.throwIfAborted();
    const source = await this.source(id, options.snapshotId);
    const prior = this.prior(id, options);
    if (prior && prior.sourceFingerprint !== source.fingerprint)
      throw new AppError('快照来源配置已变化；请使用新的目标名称重新复制', 409);
    const existing = prior ? this.checkReceipt(await this.peers.importStatus(
      options.peerId, prior.transferId), id, options, prior) : null;
    const peer = await this.target(id, options.peerId, !existing);
    const transferId = prior?.transferId || randomUUID();
    if (!prior) await this.change((state) => {
      while (state.entries.length >= 128) {
        const finished = state.entries.findIndex((entry) => entry.status === 'replicated');
        if (finished < 0) throw new AppError('快照复制队列已达到上限', 409);
        state.entries.splice(finished, 1);
      }
      state.entries.push({ vmId: id, snapshotId: options.snapshotId,
        peerId: options.peerId, transferId, targetName: options.targetName,
        sourceFingerprint: source.fingerprint, status: 'queued',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });
    /**
     * 入口 / Entry: SnapshotReplications.runOne.callback@174.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.change）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.change).
     * 输入 / Inputs: state
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `entry.status`, `entry.updatedAt`, `entry.remoteVmId`, `entry.sha256`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    /**
     * 入口 / Entry: SnapshotReplications.runOne.update.
     * 功能：把本层请求转交 `this.change`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.change` and propagates the provider result or rejection.
     * 输入 / Inputs: status: Entry['status']; receipt: Receipt optional; error: string optional; sourceSha256: string optional
     * 输出 / Returns: `this.change((state) => { const entry = state.entries.find((item) => item.transferId === transferId)!; entry.status = status; …`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const update = (status: Entry['status'], receipt?: Receipt, error?: string,
      sourceSha256?: string) => this.change((state) => {
      const entry = state.entries.find((item) => item.transferId === transferId)!;
      entry.status = status;
      entry.updatedAt = new Date().toISOString();
      if (receipt) { entry.remoteVmId = receipt.id; entry.sha256 = receipt.sha256; }
      if (sourceSha256) entry.sourceSha256 = sourceSha256;
      if (error) entry.error = error.slice(0, 500);
      else delete entry.error;
    });
    let receipt: Receipt | undefined;
    try {
      await update('transferring', existing || undefined);
      let localSha: string | undefined;
      receipt = await this.peers.upload(options.peerId, transferId, options.targetName,
        async (target, uploadSignal) => {
          localSha = await this.bundles.export(id, target, () => {}, uploadSignal,
            0, options.snapshotId);
          await update('transferring', undefined, undefined, localSha);
        }, signal, { sourceVmId: id, snapshotId: options.snapshotId });
      this.checkReceipt(receipt, id, options, prior);
      if (localSha && receipt.sha256 !== localSha)
        throw new AppError('目标副本校验值与来源快照导出结果不一致', 409);
      signal.throwIfAborted();
      if ((await this.source(id, options.snapshotId)).fingerprint !== source.fingerprint)
        throw new AppError('快照来源在传输期间变化，目标副本需人工复核', 409);
      await update('replicated', receipt);
      return { ready: true, executed: true, transferId, sourceVmId: id,
        snapshotId: options.snapshotId, remoteVmId: receipt.id,
        targetHostId: peer.remoteId, sha256: receipt.sha256,
        message: '历史快照已校验并作为目标主机上的独立实例导入；来源未修改。' };
    } catch (error) {
      await update('review', receipt || existing || undefined, (error as Error).message)
        .catch(() => {});
      throw error;
    }
  }
}
