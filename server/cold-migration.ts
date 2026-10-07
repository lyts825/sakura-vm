/**
 * 模块职责：执行停机复制及维护排空，保存传输票据；重试先查询目标回执，保留来源实例。
 * Module purpose: Runs stopped-VM copying and maintenance draining with durable transfer tickets; retries query target receipts and retain the source.
 */
import type { BundlesV1, HostPeersV1 } from './service-contracts/v1.ts';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';

import type { MigrationFingerprint } from '../shared/contracts/vm.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { createSchema } from '../shared/contracts/vm.ts';
import { DATA } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import { recoveryOriginSchema, domainRecoveryTicketSchema, type DomainRecoveryTicket } from '../shared/contracts/domain-recovery.ts';
import { captureRecoveryOrigin, recoveryTicketRevision } from './recovery-origin.ts';
import { readRecoveryJson, invalidRecoveryTicket } from './domain-recovery-files.ts';
import { captureOperationCheck } from './operation-context.ts';

export const coldMigrationInput = z.object({
  peerId: z.uuid(),
  targetName: createSchema.shape.name,
  confirmSourceRemoval: z.boolean().default(false),
  startTarget: z.boolean().default(false),
}).strict();
type Input = z.infer<typeof coldMigrationInput>;
export const maintenanceDrainInput = z.object({
  peerId: z.uuid(), confirmSourceRemoval: z.boolean().default(false),
  targetNames: z.record(z.uuid(), createSchema.shape.name).default({}),
}).strict();

const fingerprintSchema = z.object({
  recordHash: z.string().regex(/^[a-f0-9]{64}$/),
  diskSize: z.number().int().nonnegative(), diskMtimeMs: z.number().nonnegative(),
}).strict();
const queueEntry = z.object({
  vmId: z.uuid(), transferId: z.uuid(), peerId: z.uuid(),
  targetName: createSchema.shape.name, fingerprint: fingerprintSchema,
  status: z.enum(['queued', 'transferring', 'copied', 'moved', 'review']),
  remoteVmId: z.uuid().optional(), error: z.string().max(500).optional(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  origin: recoveryOriginSchema.optional(),
}).strict();
const queueSchema = z.object({ version: z.literal(1), entries: z.array(queueEntry).max(128) }).strict()
  .refine(queue => new Set(queue.entries.map(entry => entry.transferId)).size === queue.entries.length,
    '冷迁移原传输票据重复');
type Queue = z.infer<typeof queueSchema>;
/**
 * 入口 / Entry: recoveryTicket.
 * 功能：在执行停机复制及维护排空中，执行此领域的具体处理步骤并返回其结果；本入口产生 `({ id: entry.transferId + '@' + recoveryTicketRevision({ vmId: entry.vmId, peerId: entry.peerId, targetName: entry.targetName…` 供上层消费（`cold-migration.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `cold-migration.ts`; this entry produces `({ id: entry.transferId + '@' + recoveryTicketRevision({ vmId: entry.vmId, peerId: entry.peerId, targetName: entry.targetName…` for its caller. Module context: Runs stopped-VM copying and maintenance draining with durable transfer tickets; retries query target receipts and retain the source.
 * 处理：通过 `recoveryTicketRevision`, `inline.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `recoveryTicketRevision`, `inline.includes`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: entry: Queue['entries'][number]
 * 输出 / Returns: DomainRecoveryTicket；结果来自 / values from `({ id: entry.transferId + '@' + recoveryTicketRevision({ vmId: entry.vmId, peerId: entry.peerId, targetName: entry.targetName…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const recoveryTicket = (entry: Queue['entries'][number]): DomainRecoveryTicket => ({
  id: entry.transferId + '@' + recoveryTicketRevision({ vmId: entry.vmId, peerId: entry.peerId,
    targetName: entry.targetName, fingerprint: entry.fingerprint, origin: entry.origin }),
  revision: recoveryTicketRevision(entry), vmId: entry.vmId, origin: entry.origin,
  state: ['copied', 'moved'].includes(entry.status) && !entry.error ? 'resolved' : 'pending', available: false,
  error: ['copied', 'moved'].includes(entry.status) ? entry.error : undefined,
});
/**
 * 入口 / Entry: discoverColdMigrationRecoveryTickets.
 * 功能：在执行停机复制及维护排空中，执行此领域的具体处理步骤并返回其结果；本入口产生 `raw === undefined ? [] : queueSchema.parse(raw).entries.map(recoveryTicket)` / `[invalidRecoveryTicket(file, 'unknown', error)]` 供上层消费（`cold-migration.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `cold-migration.ts`; this entry produces `raw === undefined ? [] : queueSchema.parse(raw).entries.map(recoveryTicket)` / `[invalidRecoveryTicket(file, 'unknown', error)]` for its caller. Module context: Runs stopped-VM copying and maintenance draining with durable transfer tickets; retries query target receipts and retain the source.
 * 处理：通过 `readRecoveryJson`, `queueSchema.parse().entries.map`, `queueSchema.parse`, `invalidRecoveryTicket` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `readRecoveryJson`, `queueSchema.parse().entries.map`, `queueSchema.parse`, `invalidRecoveryTicket`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: file: default=join(DATA, 'cold-migrations.json')
 * 输出 / Returns: Promise<DomainRecoveryTicket[]>；结果来自 / values from `raw === undefined ? [] : queueSchema.parse(raw).entries.map(recoveryTicket)`; `[invalidRecoveryTicket(file, 'unknown', error)]`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `return [invalidRecoveryTicket(file, 'unknown', error)];`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return [invalidRecoveryTicket(file, 'unknown', error)];`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function discoverColdMigrationRecoveryTickets(file = join(DATA, 'cold-migrations.json')): Promise<DomainRecoveryTicket[]> {
  try {
    const raw = await readRecoveryJson(file, 1024 * 1024);
    return raw === undefined ? [] : queueSchema.parse(raw).entries.map(recoveryTicket);
  } catch (error) { return [invalidRecoveryTicket(file, 'unknown', error)]; }
}

/**
 * 入口 / Entry: sameFingerprint.
 * 功能：从当前输入或状态计算 `a.recordHash === b.recordHash && a.diskSize === b.diskSize && a.diskMtimeMs === b.diskMtimeMs`，供调用方后续验证或使用。
 * Purpose: Computes `a.recordHash === b.recordHash && a.diskSize === b.diskSize && a.diskMtimeMs === b.diskMtimeMs` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: a: MigrationFingerprint; b: MigrationFingerprint
 * 输出 / Returns: `a.recordHash === b.recordHash && a.diskSize === b.diskSize && a.diskMtimeMs === b.diskMtimeMs`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const sameFingerprint = (a: MigrationFingerprint, b: MigrationFingerprint) =>
  a.recordHash === b.recordHash && a.diskSize === b.diskSize && a.diskMtimeMs === b.diskMtimeMs;

export class ColdMigrations {
  private queue?: Queue;
  private writes: Promise<unknown> = Promise.resolve();
  private activeRuns = new Set<string>();
  private draining = false;
  /**
   * 入口 / Entry: ColdMigrations.constructor.
   * 功能：建立 ColdMigrations 的执行停机复制及维护排空上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ColdMigrations context for this module's responsibility: Runs stopped-VM copying and maintenance draining with durable transfer tickets; retries query target receipts and retain the source. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; bundles: BundlesV1; peers: HostPeersV1; file: default=join(DATA, 'cold-migrations.json')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines, private bundles: BundlesV1, private peers: HostPeersV1,
    private file = join(DATA, 'cold-migrations.json')) {}

  /**
   * 入口 / Entry: ColdMigrations.init.
   * 功能：在执行停机复制及维护排空中，初始化并核对当前领域状态；处理结果记录到 `this.queue`（`ColdMigrations`）。
   * Purpose: Initializes and verifies current domain state in `ColdMigrations`; the outcome is recorded in `this.queue`. Module context: Runs stopped-VM copying and maintenance draining with durable transfer tickets; retries query target receipts and retain the source.
   * 处理：通过 `queueSchema.parse`, `readStore`, `this.queue.entries.some`, `this.change` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `queueSchema.parse`, `readStore`, `this.queue.entries.some`, `this.change`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.queue.entries.some((entry) => entry.status === 'transferring')`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.queue`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    this.queue = queueSchema.parse(await readStore(this.file, () => ({ version: 1, entries: [] })));
    if (this.queue.entries.some((entry) => entry.status === 'transferring'))
      await this.change((queue) => {
        for (const entry of queue.entries) if (entry.status === 'transferring') {
          entry.status = 'review';
          entry.error = '服务重启中断传输；可用相同目标重试，先查询目标回执';
          entry.updatedAt = new Date().toISOString();
        }
      });
  }

  /**
   * 入口 / Entry: ColdMigrations.view.
   * 功能：在执行停机复制及维护排空中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ enabled: true, entries: this.queue!.entries.slice(-128).reverse().map(({ fingerprint, ...entry }) => entry) }` 供上层消费（`ColdMigrations`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ColdMigrations`; this entry produces `{ enabled: true, entries: this.queue!.entries.slice(-128).reverse().map(({ fingerprint, ...entry }) => entry) }` for its caller. Module context: Runs stopped-VM copying and maintenance draining with durable transfer tickets; retries query target receipts and retain the source.
   * 处理：通过 `inline.entries.slice().reverse().map`, `inline.entries.slice().reverse`, `inline.entries.slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.entries.slice().reverse().map`, `inline.entries.slice().reverse`, `inline.entries.slice`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ enabled: true, entries: this.queue!.entries.slice(-128).reverse().map(({ fingerprint, ...entry }) => entry) }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view() {
    return { enabled: true, entries: this.queue!.entries.slice(-128).reverse().map(({ fingerprint, ...entry }) => entry) };
  }
  /**
   * 入口 / Entry: ColdMigrations.recoveryTickets.
   * 功能：从当前输入或状态计算 `(this.queue?.entries || []).map(entry => ({ ...recoveryTicket(entry), available: !this.activeRuns.has(entry.vmId) && !this.dr…`，供调用方后续验证或使用。
   * Purpose: Computes `(this.queue?.entries || []).map(entry => ({ ...recoveryTicket(entry), available: !this.activeRuns.has(entry.vmId) && !this.dr…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<DomainRecoveryTicket[]>；结果来自 / values from `(this.queue?.entries || []).map(entry => ({ ...recoveryTicket(entry), available: !this.activeRuns.has(entry.vmId) && !this.dr…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async recoveryTickets(): Promise<DomainRecoveryTicket[]> {
    return (this.queue?.entries || []).map(entry => ({ ...recoveryTicket(entry),
      available: !this.activeRuns.has(entry.vmId) && !this.draining &&
        this.machines.records.has(entry.vmId) && ['queued', 'review'].includes(entry.status),
    }));
  }
  /**
   * 入口 / Entry: ColdMigrations.recoverTicket.
   * 功能：在执行停机复制及维护排空中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ColdMigrations`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ColdMigrations`; the calls and state transitions below complete the operation. Module context: Runs stopped-VM copying and maintenance draining with durable transfer tickets; retries query target receipts and retain the source.
   * 处理：通过 `domainRecoveryTicketSchema.parse`, `captureOperationCheck`, `this.activeRuns.has`, `this.activeRuns.add` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `domainRecoveryTicketSchema.parse`, `captureOperationCheck`, `this.activeRuns.has`, `this.activeRuns.add`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: raw: DomainRecoveryTicket
   * 输出 / Returns: Promise<void>.
   * 副作用 / Effects: `this.activeRuns.add`; `this.activeRuns.delete`.
   * 拒绝 / Refusals: 条件 / conditions `this.activeRuns.has(ticket.vmId) || this.draining`; `!entry || entry.vmId !== ticket.vmId || recoveryTicketRevision(entry) !== ticket.revision || !['queued', 'review'].includes(e…`; `result.sourceRemoved || !confirmed || confirmed.status !== 'copied' || !confirmed.remoteVmId || !this.machines.records.has(ti…`; 异常 / errors `new AppError('原迁移流程仍在运行', 409, 'DOMAIN_RECOVERY_ACTIVE')`; `new AppError('原冷迁移票据已变化', 409, 'RECOVERY_STALE')`.
   * 收尾：退出 try 区域时始终执行 `this.activeRuns.delete(ticket.vmId);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.activeRuns.delete(ticket.vmId);`; these steps also apply to exceptional exits.
   */
  async recoverTicket(raw: DomainRecoveryTicket): Promise<void> {
    const ticket = domainRecoveryTicketSchema.parse(raw);
    const check = captureOperationCheck();
    if (this.activeRuns.has(ticket.vmId) || this.draining)
      throw new AppError('原迁移流程仍在运行', 409, 'DOMAIN_RECOVERY_ACTIVE');
    this.activeRuns.add(ticket.vmId);
    try {
      await check();
      const entry = this.queue?.entries.find(item => recoveryTicket(item).id === ticket.id);
      if (!entry || entry.vmId !== ticket.vmId || recoveryTicketRevision(entry) !== ticket.revision ||
          !['queued', 'review'].includes(entry.status))
        throw new AppError('原冷迁移票据已变化', 409, 'RECOVERY_STALE');
      // Reuse the original transfer/target receipt. Recovery never authorizes source deletion or target startup.
      const result = await this.runOne(ticket.vmId, { peerId: entry.peerId, targetName: entry.targetName,
        confirmSourceRemoval: false, startTarget: false }, new AbortController().signal,
        { transferId: entry.transferId, revision: ticket.revision }, check);
      const confirmed = this.queue!.entries.find(item => recoveryTicket(item).id === ticket.id);
      if (result.sourceRemoved || !confirmed || confirmed.status !== 'copied' || !confirmed.remoteVmId ||
          !this.machines.records.has(ticket.vmId))
        throw new AppError('原冷迁移领域尚未确认保留源实例的复制', 503, 'RECOVERY_CLEANUP_PENDING');
    } finally { this.activeRuns.delete(ticket.vmId); }
  }

  /**
   * 入口 / Entry: ColdMigrations.change.
   * 功能：在执行停机复制及维护排空中，执行此领域的具体处理步骤并返回其结果；本入口产生 `operation` 供上层消费（`ColdMigrations`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ColdMigrations`; this entry produces `operation` for its caller. Module context: Runs stopped-VM copying and maintenance draining with durable transfer tickets; retries query target receipts and retain the source.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: edit: (queue: Queue) => T
   * 输出 / Returns: Promise<T>；结果来自 / values from `operation`.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async change<T>(edit: (queue: Queue) => T): Promise<T> {
    /**
     * 入口 / Entry: ColdMigrations.change.callback@118.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.writes.catch().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.writes.catch().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `result`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.queue`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const operation = this.writes.catch(() => {}).then(async () => {
      const next = structuredClone(this.queue!);
      const result = edit(next);
      await writeStore(this.file, next);
      this.queue = next;
      return result;
    });
    this.writes = operation;
    return operation;
  }

  /**
   * 入口 / Entry: ColdMigrations.target.
   * 功能：在执行停机复制及维护排空中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ peer, candidate }` 供上层消费（`ColdMigrations`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ColdMigrations`; this entry produces `{ peer, candidate }` for its caller. Module context: Runs stopped-VM copying and maintenance draining with durable transfer tickets; retries query target receipts and retain the source.
   * 处理：通过 `this.machines.get`, `this.machines.requireStopped`, `this.peers.view().outbound.find`, `this.peers.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.requireStopped`, `this.peers.view().outbound.find`, `this.peers.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: Input; requireCapacity: default=true
   * 输出 / Returns: `{ peer, candidate }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!peer`; `!candidate?.status || candidate.reasons.some((reason) => reason.startsWith('连接失败') || reason.startsWith('没有 90 秒')) || (requi…`; `candidate.status.platform !== local.platform || candidate.status.arch !== local.arch`; 异常 / errors `new AppError('目标主机未配对或已移除', 404)`; `new AppError(`目标主机当前不可选：${candidate?.reasons.join('；') || '没有有效观测'}`, 409)`.
   */
  private async target(id: string, input: Input, requireCapacity = true) {
    const vm = this.machines.get(id);
    this.machines.requireStopped(id);
    const peer = this.peers.view().outbound.find((item) => item.id === input.peerId);
    if (!peer) throw new AppError('目标主机未配对或已移除', 404);
    const scored = await this.peers.score({ cpus: vm.cpus, memoryMiB: vm.memoryMiB });
    const candidate = scored.candidates.find((item) => item.id === peer.remoteId && item.source === 'peer');
    if (!candidate?.status || candidate.reasons.some((reason) =>
        reason.startsWith('连接失败') || reason.startsWith('没有 90 秒')) ||
        (requireCapacity && !candidate.eligible))
      throw new AppError(`目标主机当前不可选：${candidate?.reasons.join('；') || '没有有效观测'}`, 409);
    const local = await this.peers.status();
    if (candidate.status.platform !== local.platform || candidate.status.arch !== local.arch)
      throw new AppError('目标主机平台或架构与源主机不一致', 409);
    return { peer, candidate };
  }

  /**
   * 入口 / Entry: ColdMigrations.existingReceipt.
   * 功能：在执行停机复制及维护排空中，执行此领域的具体处理步骤并返回其结果；本入口产生 `null` / `receipt` 供上层消费（`ColdMigrations`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ColdMigrations`; this entry produces `null` / `receipt` for its caller. Module context: Runs stopped-VM copying and maintenance draining with durable transfer tickets; retries query target receipts and retain the source.
   * 处理：通过 `this.peers.importStatus` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.peers.importStatus`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!prior`.
   * 输入 / Inputs: prior: Queue['entries'][number] | undefined; peerId: string; targetName: string
   * 输出 / Returns: `null`; `receipt`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `receipt && (receipt.name !== targetName || (prior.remoteVmId && receipt.id !== prior.remoteVmId))`; 异常 / errors `new AppError('目标主机回执与迁移队列不一致，保留源实例', 409)`.
   */
  private async existingReceipt(prior: Queue['entries'][number] | undefined,
    peerId: string, targetName: string) {
    if (!prior) return null;
    const receipt = await this.peers.importStatus(peerId, prior.transferId);
    if (receipt && (receipt.name !== targetName ||
        (prior.remoteVmId && receipt.id !== prior.remoteVmId)))
      throw new AppError('目标主机回执与迁移队列不一致，保留源实例', 409);
    return receipt;
  }

  /**
   * 入口 / Entry: ColdMigrations.preview.
   * 功能：在执行停机复制及维护排空中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: false, executed: false, reason: '请选择已配对目标主机，填写目标实例名称与源实例移除确认。', queue: this.queue!.entries.filter((item) => item.vmI…` / `{ ready: false, executed: false, reason: '启动目标前必须明确确认移除源实例，避免两端同时写入。', queue: this.queue!.entries.filter((item) => item.vmId …` 供上层消费（`ColdMigrations`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ColdMigrations`; this entry produces `{ ready: false, executed: false, reason: '请选择已配对目标主机，填写目标实例名称与源实例移除确认。', queue: this.queue!.entries.filter((item) => item.vmI…` / `{ ready: false, executed: false, reason: '启动目标前必须明确确认移除源实例，避免两端同时写入。', queue: this.queue!.entries.filter((item) => item.vmId …` for its caller. Module context: Runs stopped-VM copying and maintenance draining with durable transfer tickets; retries query target receipts and retain the source.
   * 处理：通过 `coldMigrationInput.safeParse`, `inline.entries.filter().slice`, `inline.entries.filter`, `inline.entries.findLast` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `coldMigrationInput.safeParse`, `inline.entries.filter().slice`, `inline.entries.filter`, `inline.entries.findLast`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!parsed.success`; `parsed.data.startTarget && !parsed.data.confirmSourceRemoval`.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `{ ready: false, executed: false, reason: '请选择已配对目标主机，填写目标实例名称与源实例移除确认。', queue: this.queue!.entries.filter((item) => item.vmI…`; `{ ready: false, executed: false, reason: '启动目标前必须明确确认移除源实例，避免两端同时写入。', queue: this.queue!.entries.filter((item) => item.vmId …`; `{ ready: true, executed: false, target: { id: peer.id, name: peer.name, hostId: peer.remoteId, score: candidate.score }, fing…`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `parsed.data.startTarget && !receipt`; `parsed.data.startTarget`; `!receipt?.sha256`; 异常 / errors `new AppError('请先完成一次保留源实例的复制并复核目标，再请求启动目标', 409)`; `new AppError('目标导入回执缺少磁盘校验值', 409)`.
   * 失败处理：catch 分支执行 `return { ready: false, executed: false, reason: (error as Error).message, queue: this.queue!.entries.filter((item) => item.vm…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return { ready: false, executed: false, reason: (error as Error).message, queue: this.queue!.entries.filter((item) => item.vm…`; these statements determine whether a failure is absorbed or rejected again.
   */
  async preview(id: string, input: unknown) {
    const parsed = coldMigrationInput.safeParse(input);
    if (!parsed.success)
      return { ready: false, executed: false,
        reason: '请选择已配对目标主机，填写目标实例名称与源实例移除确认。',
        queue: this.queue!.entries.filter((item) => item.vmId === id).slice(-8) };
    if (parsed.data.startTarget && !parsed.data.confirmSourceRemoval)
      return { ready: false, executed: false,
        reason: '启动目标前必须明确确认移除源实例，避免两端同时写入。',
        queue: this.queue!.entries.filter((item) => item.vmId === id).slice(-8) };
    try {
      const prior = this.queue!.entries.findLast((entry) => entry.vmId === id &&
        entry.peerId === parsed.data.peerId && entry.targetName === parsed.data.targetName &&
        entry.status !== 'moved');
      const receipt = await this.existingReceipt(prior, parsed.data.peerId,
        parsed.data.targetName);
      if (parsed.data.startTarget && !receipt)
        throw new AppError('请先完成一次保留源实例的复制并复核目标，再请求启动目标', 409);
      if (parsed.data.startTarget) {
        if (!receipt?.sha256) throw new AppError('目标导入回执缺少磁盘校验值', 409);
        await this.peers.checkImportActivation(parsed.data.peerId, {
          transferId: prior!.transferId, remoteVmId: receipt.id, sha256: receipt.sha256,
        });
      }
      const { peer, candidate } = await this.target(id, parsed.data,
        !receipt || parsed.data.startTarget);
      const fingerprint = await this.machines.migrationFingerprint(id);
      if (prior && !sameFingerprint(prior.fingerprint, fingerprint))
        throw new AppError('源实例与之前的迁移队列记录不同；请改用新的目标名称重新迁移', 409);
      return { ready: true, executed: false, target: { id: peer.id, name: peer.name,
        hostId: peer.remoteId, score: candidate.score }, fingerprint,
        sourceRemovalRequested: parsed.data.confirmSourceRemoval,
        targetStartRequested: parsed.data.startTarget,
        queue: this.queue!.entries.filter((item) => item.vmId === id).slice(-8),
        message: '先校验并导入完整实例包；只有目标回执有效、源实例未变化且明确确认移除时才删除源实例。' };
    } catch (error) {
      return { ready: false, executed: false, reason: (error as Error).message,
        queue: this.queue!.entries.filter((item) => item.vmId === id).slice(-8) };
    }
  }

  /**
   * 入口 / Entry: ColdMigrations.run.
   * 功能：在执行停机复制及维护排空中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await this.runOne(id, input, signal)` 供上层消费（`ColdMigrations`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ColdMigrations`; this entry produces `await this.runOne(id, input, signal)` for its caller. Module context: Runs stopped-VM copying and maintenance draining with durable transfer tickets; retries query target receipts and retain the source.
   * 处理：通过 `this.activeRuns.has`, `this.activeRuns.add`, `this.runOne`, `this.activeRuns.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.activeRuns.has`, `this.activeRuns.add`, `this.runOne`, `this.activeRuns.delete`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal
   * 输出 / Returns: `await this.runOne(id, input, signal)`.
   * 副作用 / Effects: `this.activeRuns.add`; `this.activeRuns.delete`.
   * 拒绝 / Refusals: 条件 / conditions `this.activeRuns.has(id)`; 异常 / errors `new AppError('此实例已有迁移任务正在进行', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.activeRuns.delete(id);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.activeRuns.delete(id);`; these steps also apply to exceptional exits.
   */
  async run(id: string, input: unknown, signal: AbortSignal) {
    if (this.activeRuns.has(id)) throw new AppError('此实例已有迁移任务正在进行', 409);
    this.activeRuns.add(id);
    try { return await this.runOne(id, input, signal); }
    finally { this.activeRuns.delete(id); }
  }

  /**
   * 入口 / Entry: ColdMigrations.runOne.
   * 功能：向已配对主机传输停止实例并核对目标导入与激活回执。
   * Purpose: Transfers a stopped VM to a paired host and verifies target import/activation receipts.
   * 设计：原传输身份在重试中复用，先查询远端回执；未确认目标完成时不删除或替换来源。
   * Design: Retries reuse original transfer identity and query remote receipts first; unconfirmed target completion preserves the source.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal; expected: { transferId: string; revision: string } optional; check: default=captureOperationCheck()
   * 输出 / Returns: `{ ready: true, executed: true, phase: 'copied', transferId, sourceVmId: id, remoteVmId: receipt.id, targetHostId: peer.remote…`; `{ ready: true, executed: true, phase: 'moved', transferId, sourceVmId: id, remoteVmId: receipt.id, targetHostId: peer.remoteI…`.
   * 副作用 / Effects: `update`; `this.peers.upload`; `this.machines.delete`; `update().catch`; 更新 / updates `queuePersisted`, `targetStart`.
   * 拒绝 / Refusals: 条件 / conditions `options.startTarget && !options.confirmSourceRemoval`; `expected && (!prior || prior.transferId !== expected.transferId || recoveryTicketRevision(prior) !== expected.revision)`; `prior && !sameFingerprint(prior.fingerprint, fingerprint)`; 异常 / errors `new AppError('启动目标前必须明确确认移除源实例，避免两端同时写入', 409)`; `new AppError('原冷迁移票据不再是此目标的当前传输', 409, 'RECOVERY_STALE')`.
   * 失败处理：catch 分支执行 `if (this.machines.records.has(id)) await update('review', prior?.remoteVmId, (error as Error).message).catch(() => {});`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (this.machines.records.has(id)) await update('review', prior?.remoteVmId, (error as Error).message).catch(() => {});`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async runOne(id: string, input: unknown, signal: AbortSignal,
    expected?: { transferId: string; revision: string }, check = captureOperationCheck()) {
    const options = coldMigrationInput.parse(input);
    await check();
    if (options.startTarget && !options.confirmSourceRemoval)
      throw new AppError('启动目标前必须明确确认移除源实例，避免两端同时写入', 409);
    signal.throwIfAborted();
    const fingerprint = await this.machines.migrationFingerprint(id);
    const prior = this.queue!.entries.findLast((entry) => entry.vmId === id &&
      entry.peerId === options.peerId && entry.targetName === options.targetName &&
      entry.status !== 'moved');
    if (expected && (!prior || prior.transferId !== expected.transferId ||
        recoveryTicketRevision(prior) !== expected.revision))
      throw new AppError('原冷迁移票据不再是此目标的当前传输', 409, 'RECOVERY_STALE');
    if (prior && !sameFingerprint(prior.fingerprint, fingerprint))
      throw new AppError('源实例与之前的迁移队列记录不同；请改用新的目标名称重新迁移', 409);
    const existing = await this.existingReceipt(prior, options.peerId, options.targetName);
    if (options.startTarget && !existing)
      throw new AppError('请先完成一次保留源实例的复制并复核目标，再请求启动目标', 409);
    const { peer } = await this.target(id, options, !existing || options.startTarget);
    await check();
    const transferId = prior?.transferId || randomUUID();
    if (!prior) await this.change((queue) => {
      while (queue.entries.length >= 128) {
        const completed = queue.entries.findIndex((item) => item.status === 'moved');
        if (completed < 0) throw new AppError('迁移队列已达到上限', 409);
        queue.entries.splice(completed, 1);
      }
      queue.entries.push({ vmId: id, transferId, peerId: options.peerId,
        targetName: options.targetName, fingerprint, status: 'queued',
        origin: captureRecoveryOrigin(),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });
    /**
     * 入口 / Entry: ColdMigrations.runOne.callback@238.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.change）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.change).
     * 输入 / Inputs: queue
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `entry.status`, `entry.updatedAt`, `entry.remoteVmId`, `entry.error`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    /**
     * 入口 / Entry: ColdMigrations.runOne.update.
     * 功能：把本层请求转交 `this.change`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.change` and propagates the provider result or rejection.
     * 输入 / Inputs: status: Queue['entries'][number]['status']; remoteVmId: string optional; error: string optional
     * 输出 / Returns: `this.change((queue) => { const entry = queue.entries.find((item) => item.transferId === transferId)!; entry.status = status; …`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const update = (status: Queue['entries'][number]['status'], remoteVmId?: string,
      error?: string) => this.change((queue) => {
      const entry = queue.entries.find((item) => item.transferId === transferId)!;
      entry.status = status;
      entry.updatedAt = new Date().toISOString();
      if (remoteVmId) entry.remoteVmId = remoteVmId;
      if (error) entry.error = error.slice(0, 500);
      else delete entry.error;
    });
    try {
      await update('transferring', prior?.remoteVmId);
      const receipt = await this.peers.upload(options.peerId, transferId, options.targetName,
        (target, uploadSignal) => this.bundles.export(id, target, () => {}, uploadSignal), signal);
      signal.throwIfAborted();
      await check();
      if (receipt.name !== options.targetName ||
          (prior?.remoteVmId && receipt.id !== prior.remoteVmId))
        throw new AppError('目标主机回执与迁移队列不一致，保留源实例', 409);
      if (!sameFingerprint(fingerprint, await this.machines.migrationFingerprint(id))) {
        await update('review', receipt.id, '源实例在传输期间变化，保留源实例');
        throw new AppError('源实例在传输期间变化，目标副本已保留；请人工核对', 409);
      }
      await update('copied', receipt.id);
      if (!options.confirmSourceRemoval)
        return { ready: true, executed: true, phase: 'copied', transferId,
          sourceVmId: id, remoteVmId: receipt.id, targetHostId: peer.remoteId,
          sourceRemoved: false,
          message: '目标已导入并校验；源实例仍在。确认目标可用后重试并勾选移除源实例。' };
      const confirmed = await this.peers.importStatus(options.peerId, transferId);
      if (confirmed?.id !== receipt.id || confirmed.name !== options.targetName)
        throw new AppError('目标主机回执与导入结果不一致，保留源实例', 409);
      const activation = options.startTarget ? {
        transferId, remoteVmId: receipt.id, sha256: confirmed.sha256 || '',
      } : null;
      if (activation) {
        if (!/^[a-f0-9]{64}$/.test(activation.sha256) ||
            receipt.sha256 !== activation.sha256)
          throw new AppError('目标导入回执缺少一致的磁盘校验值，保留源实例', 409);
        await this.peers.checkImportActivation(options.peerId, activation);
      }
      signal.throwIfAborted();
      await check();
      await this.machines.delete(id, fingerprint);
      let queuePersisted = true;
      try { await update('moved', receipt.id); }
      catch { queuePersisted = false; }
      let targetStart: Awaited<ReturnType<HostPeersV1['activateImport']>> | undefined;
      if (activation) {
        try { targetStart = await this.peers.activateImport(options.peerId, activation); }
        catch (error) {
          const message = `源实例已移除，但目标启动未确认：${(error as Error).message}`;
          await update('moved', receipt.id, message).catch(() => {});
          throw new AppError(message, 502);
        }
      }
      return { ready: true, executed: true, phase: 'moved', transferId,
        sourceVmId: id, remoteVmId: receipt.id, targetHostId: peer.remoteId,
        sourceRemoved: true, queuePersisted,
        ...(targetStart ? { targetStart,
          message: '源实例已移除，目标主机接受启动请求；请检查目标客户机健康与服务入口。' } : {}) };
    } catch (error) {
      if (this.machines.records.has(id))
        await update('review', prior?.remoteVmId, (error as Error).message).catch(() => {});
      throw error;
    }
  }

  /**
   * 入口 / Entry: ColdMigrations.previewDrain.
   * 功能：在执行停机复制及维护排空中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: false, executed: false, reason: '请选择已配对目标主机，并填写源实例移除确认。', machines: [] }` / `{ ready: false, executed: false, reason: '目标名称映射包含本机不存在的实例 ID', machines: [] }` 供上层消费（`ColdMigrations`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ColdMigrations`; this entry produces `{ ready: false, executed: false, reason: '请选择已配对目标主机，并填写源实例移除确认。', machines: [] }` / `{ ready: false, executed: false, reason: '目标名称映射包含本机不存在的实例 ID', machines: [] }` for its caller. Module context: Runs stopped-VM copying and maintenance draining with durable transfer tickets; retries query target receipts and retain the source.
   * 处理：通过 `maintenanceDrainInput.safeParse`, `inline.sort`, `this.machines.records.keys`, `ids.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `maintenanceDrainInput.safeParse`, `inline.sort`, `this.machines.records.keys`, `ids.map`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!parsed.success`; `Object.keys(parsed.data.targetNames).some((id) => !ids.includes(id))`; `new Set(names).size !== names.length`.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `{ ready: false, executed: false, reason: '请选择已配对目标主机，并填写源实例移除确认。', machines: [] }`; `{ ready: false, executed: false, reason: '目标名称映射包含本机不存在的实例 ID', machines: [] }`; `{ ready: false, executed: false, reason: '同一批次不能为多个实例使用相同目标名称', machines: [] }`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `machines.push`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `machines.push({ id, name, targetName, ready: false, reason: (error as Error).message });`; `continue;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `machines.push({ id, name, targetName, ready: false, reason: (error as Error).message });`; `continue;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async previewDrain(input: unknown) {
    const parsed = maintenanceDrainInput.safeParse(input);
    if (!parsed.success) return { ready: false, executed: false,
      reason: '请选择已配对目标主机，并填写源实例移除确认。', machines: [] };
    const ids = [...this.machines.records.keys()].sort();
    if (Object.keys(parsed.data.targetNames).some((id) => !ids.includes(id)))
      return { ready: false, executed: false,
        reason: '目标名称映射包含本机不存在的实例 ID', machines: [] };
    const names = ids.map((id) => parsed.data.targetNames[id] || this.machines.get(id).name);
    if (new Set(names).size !== names.length)
      return { ready: false, executed: false,
        reason: '同一批次不能为多个实例使用相同目标名称', machines: [] };
    const machines = [];
    for (const id of ids) {
      const name = this.machines.get(id).name;
      const targetName = parsed.data.targetNames[id] || name;
      const options = { peerId: parsed.data.peerId,
        confirmSourceRemoval: parsed.data.confirmSourceRemoval, targetName };
      const entry = this.queue!.entries.findLast((item) => item.vmId === id &&
        item.peerId === options.peerId && item.targetName === targetName && item.status !== 'moved');
      if (parsed.data.confirmSourceRemoval &&
          (entry?.status !== 'copied' || !entry.remoteVmId)) {
        machines.push({ id, name, targetName, ready: false,
          reason: '尚无已确认的目标副本，请先复制整个批次' });
        continue;
      }
      if (parsed.data.confirmSourceRemoval) {
        try {
          if (!await this.existingReceipt(entry, options.peerId, targetName)) {
            machines.push({ id, name, targetName, ready: false,
              reason: '目标副本回执已失效，保留源实例' });
            continue;
          }
        } catch (error) {
          machines.push({ id, name, targetName, ready: false, reason: (error as Error).message });
          continue;
        }
      }
      const result = await this.preview(id, options);
      machines.push({ id, name, targetName, ready: result.ready,
        ...(result.ready ? { remoteVmId: entry?.remoteVmId } : { reason: result.reason }) });
    }
    const ready = machines.every((item) => item.ready);
    return { ready, executed: false, machines,
      ...(ready ? { message: parsed.data.confirmSourceRemoval
        ? '所有当前实例已有目标副本；执行后逐台复核并移除源实例。'
        : '执行后逐台复制当前停止实例，保留所有源实例供目标验证。' }
        : { reason: '部分实例未停止、目标不可用或缺少已确认副本' }) };
  }

  /**
   * 入口 / Entry: ColdMigrations.runDrain.
   * 功能：在执行停机复制及维护排空中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: true, executed: true, phase: options.confirmSourceRemoval ? 'moved' : 'copied', completed, remainingSourceVms: this.…` 供上层消费（`ColdMigrations`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ColdMigrations`; this entry produces `{ ready: true, executed: true, phase: options.confirmSourceRemoval ? 'moved' : 'copied', completed, remainingSourceVms: this.…` for its caller. Module context: Runs stopped-VM copying and maintenance draining with durable transfer tickets; retries query target receipts and retain the source.
   * 处理：通过 `maintenanceDrainInput.parse`, `signal.throwIfAborted`, `this.previewDrain`, `preview.machines.filter().map().join().slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `maintenanceDrainInput.parse`, `signal.throwIfAborted`, `this.previewDrain`, `preview.machines.filter().map().join().slice`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown; signal: AbortSignal
   * 输出 / Returns: `{ ready: true, executed: true, phase: options.confirmSourceRemoval ? 'moved' : 'copied', completed, remainingSourceVms: this.…`.
   * 副作用 / Effects: `completed.push`; 更新 / updates `this.draining`.
   * 拒绝 / Refusals: 条件 / conditions `this.draining`; `!preview.ready`; 异常 / errors `new AppError('已有主机排空任务正在进行', 409)`; `new AppError(preview.machines .filter((item) => !item.ready).map((item) => `${item.name}：${'reason' in item ? item.reason : '…`.
   * 收尾：退出 try 区域时始终执行 `this.draining = false;`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.draining = false;`; these steps also apply to exceptional exits.
   */
  async runDrain(input: unknown, signal: AbortSignal) {
    const options = maintenanceDrainInput.parse(input);
    if (this.draining) throw new AppError('已有主机排空任务正在进行', 409);
    this.draining = true;
    try {
      signal.throwIfAborted();
      const preview = await this.previewDrain(options);
      if (!preview.ready) throw new AppError(preview.machines
        .filter((item) => !item.ready).map((item) => `${item.name}：${'reason' in item
          ? item.reason : '检查失败'}`).join('；').slice(0, 500) ||
        ('reason' in preview ? preview.reason : '主机排空检查失败'), 409);
      const completed = [];
      for (const vm of preview.machines) {
        signal.throwIfAborted();
        const result = await this.run(vm.id, { peerId: options.peerId,
          confirmSourceRemoval: options.confirmSourceRemoval,
          targetName: vm.targetName }, signal);
        completed.push({ sourceVmId: vm.id, name: vm.name, targetName: vm.targetName,
          remoteVmId: result.remoteVmId,
          sourceRemoved: result.sourceRemoved });
      }
      return { ready: true, executed: true,
        phase: options.confirmSourceRemoval ? 'moved' : 'copied', completed,
        remainingSourceVms: this.machines.records.size,
        message: options.confirmSourceRemoval
          ? '批次已逐台复核并移除源实例；若有新建实例，请再次检查。'
          : '当前实例已复制到目标，源实例仍保留；验证目标后再次执行并确认移除。' };
    } finally { this.draining = false; }
  }
}
