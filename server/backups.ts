/**
 * 模块职责：执行备份、下载、保留策略及发布恢复；先确认新备份发布，再清理此前有效副本。
 * Module purpose: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
 */
import type { BundlesV1, SecretsV1, StorageRuntimeV1 } from './service-contracts/v1.ts';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, open } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { finished } from 'node:stream/promises';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA, vmDir } from './paths.ts';
import { checkedId } from '../shared/paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { MAX_BUNDLE_MANIFEST } from './bundles.ts';
import { decodeTrustedBootArchive } from './trusted-boot-archive.ts';
import { Jobs } from './jobs.ts';
import { Secrets, secretName } from './secrets.ts';
import { fileHash, regularDirectory } from './local-store.ts';
import { metadataFile } from './metadata-store.ts';
import { StorageRuntime, storageRuntime, type StorageLease } from './storage-runtime.ts';
import { encryptFile, withDecrypted, passwordSchema } from './encrypted-backups.ts';
import { inMaintenance } from './automation-policy.ts';
import { backupBlocks } from './backup-blocks.ts';
import { Writable } from 'node:stream';
import { backupPublication, backupPublicationSchema } from './backup-journal.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';
import { captureRecoveryOrigin, recoveryTicketRevision } from './recovery-origin.ts';
import { readRecoveryJson, recoveryDirectories, invalidRecoveryTicket } from './domain-recovery-files.ts';
import { domainRecoveryProofSchema, domainRecoveryTicketSchema, type DomainRecoveryProof, type DomainRecoveryTicket } from '../shared/contracts/domain-recovery.ts';

export const backupPolicySchema = z
  .object({
    enabled: z.boolean().default(false),
    intervalHours: z.number().int().min(1).max(720).default(24),
    keep: z.number().int().min(1).max(30).default(7),
    maxGiB: z.number().min(1).max(512).default(32),
    lockDays: z.number().int().min(0).max(3650).optional(),
    deduplicate: z.boolean().optional(),
    bandwidthMiBps: z
      .number()
      .min(0)
      .max(10240)
      .refine((value) => value === 0 || value >= 0.1)
      .optional(),
    directory: z
      .string()
      .max(4096)
      .refine((v) => !v || isAbsolute(v), '需要本机绝对目录')
      .optional(),
    passwordSecret: secretName.optional(),
  })
  .strict()
  .refine(
    (value) => !value.deduplicate || (!value.directory && !value.passwordSecret),
    '块级去重仅用于本机未加密备份；请清空外部目录和加密密码引用',
  );
export type BackupPolicy = z.infer<typeof backupPolicySchema>;
export type BackupRecord = {
  id: string;
  createdAt: string;
  bytes: number;
  checksum: string;
  verifiedAt?: string;
  error?: string;
  directory?: string;
  encrypted?: boolean;
  passwordSecret?: string;
  retainUntil?: string;
  storage?: 'blocks';
};
type BackupState = { policy: BackupPolicy; items: BackupRecord[]; lastSuccess?: string; recoveryReceipts?: DomainRecoveryProof[] };
/** Publication journals survive process loss; discover them even when the backups plugin is disabled. */
/**
 * 入口 / Entry: discoverBackupRecoveryTickets.
 * 功能：在执行备份、下载、保留策略及发布恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `[invalidRecoveryTicket(root, 'unknown', error)]` / `[...tickets, invalidRecoveryTicket(root, 'unknown', '备份恢复扫描超过累计上限')]` 供上层消费（`backups.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `backups.ts`; this entry produces `[invalidRecoveryTicket(root, 'unknown', error)]` / `[...tickets, invalidRecoveryTicket(root, 'unknown', '备份恢复扫描超过累计上限')]` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
 * 处理：通过 `join`, `recoveryDirectories`, `invalidRecoveryTicket`, `tickets.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `join`, `recoveryDirectories`, `invalidRecoveryTicket`, `tickets.push`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `(reads += 3) > 4096 || tickets.length >= 3071`; `raw !== undefined && raw !== null`; `!tickets.some(ticket => ticket.vmId === vmId && ticket.id === proof.id)`.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Promise<DomainRecoveryTicket[]>；结果来自 / values from `[invalidRecoveryTicket(root, 'unknown', error)]`; `[...tickets, invalidRecoveryTicket(root, 'unknown', '备份恢复扫描超过累计上限')]`; `tickets`.
 * 副作用 / Effects: `tickets.push`; 更新 / updates `ids`, `reads`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `return [invalidRecoveryTicket(root, 'unknown', error)];`; `tickets.push(invalidRecoveryTicket(join(root, vmId), vmId, error));`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return [invalidRecoveryTicket(root, 'unknown', error)];`; `tickets.push(invalidRecoveryTicket(join(root, vmId), vmId, error));`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function discoverBackupRecoveryTickets(): Promise<DomainRecoveryTicket[]> {
  const tickets: DomainRecoveryTicket[] = [];
  let reads = 0;
  const root = join(DATA, 'backups');
  let ids: string[];
  try { ids = await recoveryDirectories(root, value => z.uuid().safeParse(value).success); }
  catch (error) { return [invalidRecoveryTicket(root, 'unknown', error)]; }
  for (const vmId of ids) {
    if ((reads += 3) > 4096 || tickets.length >= 3071)
      return [...tickets, invalidRecoveryTicket(root, 'unknown', '备份恢复扫描超过累计上限')];
    const publicationFile = join(root, vmId, 'publication.json'), indexFile = join(root, vmId, 'index.json');
    try { await recoveryDirectories(join(root, vmId), () => false); }
    catch (error) { tickets.push(invalidRecoveryTicket(join(root, vmId), vmId, error)); continue; }
    try {
      const raw = await readRecoveryJson(publicationFile);
      if (raw !== undefined && raw !== null) {
        const journal = backupPublicationSchema.parse(raw);
        tickets.push({ id: journal.id, revision: recoveryTicketRevision(journal), vmId,
          origin: journal.origin, state: 'pending', available: false });
      }
    } catch (error) { tickets.push(invalidRecoveryTicket(publicationFile, vmId, error)); }
    try {
      const index = await readRecoveryJson(indexFile);
      const proofs = z.object({ recoveryReceipts: z.array(domainRecoveryProofSchema).max(256).optional() })
        .passthrough().parse(index || {}).recoveryReceipts || [];
      for (const proof of proofs) if (!tickets.some(ticket => ticket.vmId === vmId && ticket.id === proof.id)) {
        if (tickets.length >= 3071)
          return [...tickets, invalidRecoveryTicket(root, 'unknown', '备份恢复扫描超过累计上限')];
        tickets.push({ id: proof.id, revision: proof.revision, vmId, origin: proof.origin,
          state: 'resolved', available: false });
      }
    } catch (error) { tickets.push(invalidRecoveryTicket(indexFile, vmId, error)); }
  }
  return tickets;
}
export type BackupDownload =
  | { type: 'file'; path: string; name: string }
  | {
      type: 'stream';
      name: string;
      bytes: number;
      /**
       * 签名 / Signature: BackupDownload.write.
       * 功能：为执行备份、下载、保留策略及发布恢复声明 write 的输入与结果契约，所属容器为 BackupDownload。
       * Purpose: Declares the input/result contract for write in BackupDownload. Module responsibility: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
       * 输入 / Inputs: output: Writable; signal: AbortSignal
       * 输出 / Returns: Promise<void>.
       * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
       * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
       */
      write: (output: Writable, signal: AbortSignal) => Promise<void>;
    };
/**
 * 入口 / Entry: verifyBackup.
 * 功能：在执行备份、下载、保留策略及发布恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `verifyBackupContents(file, signal)` / `storageRuntime.run( { owner: 'core:backup-verify', taskId: 'backup-verify:' + randomUUID(), label: 'Verify backup contents', …` 供上层消费（`backups.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `backups.ts`; this entry produces `verifyBackupContents(file, signal)` / `storageRuntime.run( { owner: 'core:backup-verify', taskId: 'backup-verify:' + randomUUID(), label: 'Verify backup contents', …` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
 * 处理：通过 `lease.assertActive`, `verifyBackupContents`, `storageRuntime.run`, `randomUUID` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `lease.assertActive`, `verifyBackupContents`, `storageRuntime.run`, `randomUUID`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `lease`.
 * 输入 / Inputs: file: string; signal: AbortSignal; lease: StorageLease optional
 * 输出 / Returns: `verifyBackupContents(file, signal)`; `storageRuntime.run( { owner: 'core:backup-verify', taskId: 'backup-verify:' + randomUUID(), label: 'Verify backup contents', …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function verifyBackup(file: string, signal: AbortSignal, lease?: StorageLease) {
  if (lease) {
    lease.assertActive();
    return verifyBackupContents(file, signal);
  }
  return storageRuntime.run(
    {
      owner: 'core:backup-verify',
      taskId: 'backup-verify:' + randomUUID(),
      label: 'Verify backup contents',
      mode: 'read',
      paths: [file],
      signal,
      buffers: 2 * MAX_BUNDLE_MANIFEST + 256 * 1024,
      files: 2,
    },
    () => verifyBackupContents(file, signal),
  );
}
/**
 * 入口 / Entry: verifyBackupContents.
 * 功能：在执行备份、下载、保留策略及发布恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `whole.digest('hex')` 供上层消费（`backups.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `backups.ts`; this entry produces `whole.digest('hex')` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
 * 处理：通过 `signal.throwIfAborted`, `open`, `readExactly`, `prefix.subarray().toString` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `open`, `readExactly`, `prefix.subarray().toString`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `metadata.trustedBoot`.
 * 输入 / Inputs: file: string; signal: AbortSignal
 * 输出 / Returns: `whole.digest('hex')`.
 * 副作用 / Effects: `handle.close`; `createHash`; `createReadStream`; `hash.update`; `disk.destroy`; 更新 / updates `length`, `expected`.
 * 拒绝 / Refusals: 条件 / conditions `prefix.subarray(0, 8).toString() !== 'SAKURA01'`; `length < 2 || length > MAX_BUNDLE_MANIFEST`; `!/^[a-f0-9]{64}$/.test(expected)`; 异常 / errors `new AppError('备份文件格式错误')`; `new AppError('备份清单长度错误')`.
 * 收尾：退出 try 区域时始终执行 `await handle.close();`; `disk.destroy();`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `await handle.close();`; `disk.destroy();`; these steps also apply to exceptional exits.
 */
async function verifyBackupContents(file: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const handle = await open(file, 'r');
  let length: number, expected: string;
  try {
    /**
     * 入口 / Entry: verifyBackupContents.readExactly.
     * 功能：在执行备份、下载、保留策略及发布恢复中，读取或核对领域状态并构造调用方可消费的结果；完成下述调用及状态处理（`backups.ts`）。
     * Purpose: Reads/verifies domain state and constructs a caller-facing result in `backups.ts`; the calls and state transitions below complete the operation. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
     * 处理：通过 `signal.throwIfAborted`, `handle.read` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `handle.read`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: buffer: Buffer; position: number
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `offset`.
     * 拒绝 / Refusals: 条件 / conditions `!bytesRead`; 异常 / errors `new AppError('备份清单被截断')`.
     */
    const readExactly = async (buffer: Buffer, position: number) => {
      let offset = 0;
      while (offset < buffer.length) {
        signal.throwIfAborted();
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, position + offset);
        if (!bytesRead) throw new AppError('备份清单被截断');
        offset += bytesRead;
      }
    };
    const prefix = Buffer.alloc(12);
    await readExactly(prefix, 0);
    if (prefix.subarray(0, 8).toString() !== 'SAKURA01') throw new AppError('备份文件格式错误');
    length = prefix.readUInt32BE(8);
    if (length < 2 || length > MAX_BUNDLE_MANIFEST) throw new AppError('备份清单长度错误');
    const manifest = Buffer.alloc(length);
    await readExactly(manifest, 12);
    const metadata = JSON.parse(manifest.toString());
    expected = metadata.sha256;
    if (!/^[a-f0-9]{64}$/.test(expected)) throw new AppError('备份校验信息错误');
    if (metadata.trustedBoot) decodeTrustedBootArchive(metadata.trustedBoot);
  } finally {
    await handle.close();
  }
  const hash = createHash('sha256');
  const disk = createReadStream(file, { start: 12 + length, signal });
  try {
    for await (const chunk of disk) {
      signal.throwIfAborted();
      hash.update(chunk);
    }
  } finally {
    disk.destroy();
    await finished(disk).catch(() => {});
  }
  if (hash.digest('hex') !== expected) throw new AppError('备份磁盘校验失败');
  const whole = createHash('sha256');
  const bytes = createReadStream(file, { signal });
  try {
    for await (const chunk of bytes) whole.update(chunk);
  } finally {
    bytes.destroy();
    await finished(bytes).catch(() => {});
  }
  return whole.digest('hex');
}
export class Backups {
  jobs = new Jobs('backups');
  private schedule: ScheduleHandle;
  private closed = false;
  private attempts = new Map<string, number>();
  private recovery = new Map<string, Promise<void>>();
  private activePublication = new Set<string>();
  private cleanupErrors = new Map<string, unknown>();
  /**
   * 入口 / Entry: Backups.recoveryTickets.
   * 功能：在执行备份、下载、保留策略及发布恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(await discoverBackupRecoveryTickets()).map(ticket => ({ ...ticket, available: !ticket.error && ticket.state === 'pending' &&…` 供上层消费（`Backups`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Backups`; this entry produces `(await discoverBackupRecoveryTickets()).map(ticket => ({ ...ticket, available: !ticket.error && ticket.state === 'pending' &&…` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `inline.map`, `discoverBackupRecoveryTickets` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.map`, `discoverBackupRecoveryTickets`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<DomainRecoveryTicket[]>；结果来自 / values from `(await discoverBackupRecoveryTickets()).map(ticket => ({ ...ticket, available: !ticket.error && ticket.state === 'pending' &&…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async recoveryTickets(): Promise<DomainRecoveryTicket[]> {
    return (await discoverBackupRecoveryTickets()).map(ticket => ({ ...ticket,
      available: !ticket.error && ticket.state === 'pending' && !this.closed && this.machines.records.has(ticket.vmId) &&
        !this.activePublication.has(ticket.vmId) && this.jobs.view(ticket.vmId)?.status !== 'running',
    }));
  }
  /**
   * 入口 / Entry: Backups.recoverTicket.
   * 功能：在执行备份、下载、保留策略及发布恢复中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Backups`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Backups`; the calls and state transitions below complete the operation. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `domainRecoveryTicketSchema.parse`, `this.machines.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `domainRecoveryTicketSchema.parse`, `this.machines.locked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: raw: DomainRecoveryTicket
   * 输出 / Returns: Promise<void>.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async recoverTicket(raw: DomainRecoveryTicket): Promise<void> {
    const ticket = domainRecoveryTicketSchema.parse(raw);
    /**
     * 入口 / Entry: Backups.recoverTicket.callback@202.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.recovery.delete`.
     * 拒绝 / Refusals: 条件 / conditions `this.closed || this.activePublication.has(ticket.vmId) || this.jobs.view(ticket.vmId)?.status === 'running'`; `!journal || journal.id !== ticket.id || recoveryTicketRevision(journal) !== ticket.revision`; `(await this.publication(ticket.vmId).read()).value !== null || !proof`; 异常 / errors `new AppError('原备份发布流程仍在运行或正在关闭', 409, 'DOMAIN_RECOVERY_ACTIVE')`; `new AppError('原备份发布票据已变化', 409, 'RECOVERY_STALE')`.
     */
    await this.machines.locked(`backups:${ticket.vmId}`, async () => {
      if (this.closed || this.activePublication.has(ticket.vmId) || this.jobs.view(ticket.vmId)?.status === 'running')
        throw new AppError('原备份发布流程仍在运行或正在关闭', 409, 'DOMAIN_RECOVERY_ACTIVE');
      this.machines.get(ticket.vmId);
      const journal = (await this.publication(ticket.vmId).read()).value;
      if (!journal || journal.id !== ticket.id || recoveryTicketRevision(journal) !== ticket.revision)
        throw new AppError('原备份发布票据已变化', 409, 'RECOVERY_STALE');
      // A rejected cached attempt is not its cleanup authority. Retry the same verified domain journal.
      await this.recovery.get(ticket.vmId)?.catch(() => {});
      this.recovery.delete(ticket.vmId);
      await this.reconcile(ticket.vmId, ticket.revision);
      // Original storage leases are not reconstructed or released by this journal recovery.
      // Their own cleanup receipt still governs any live pending budget.
      const proof = (await this.metadata(ticket.vmId).read()).value.recoveryReceipts?.find(item =>
        item.id === ticket.id && item.revision === ticket.revision);
      if ((await this.publication(ticket.vmId).read()).value !== null || !proof)
        throw new AppError('原备份领域尚未确认恢复', 503, 'RECOVERY_CLEANUP_PENDING');
    });
  }
  /**
   * 入口 / Entry: Backups.failedCleanup.
   * 功能：在执行备份、下载、保留策略及发布恢复中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Backups`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Backups`; the calls and state transitions below complete the operation. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `this.cleanupErrors.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.cleanupErrors.set`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `(error as { code?: string }).code === 'STORAGE_CLEANUP_PENDING'`.
   * 输入 / Inputs: id: string; error: unknown
   * 输出 / Returns: never.
   * 副作用 / Effects: `this.cleanupErrors.set`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   */
  private failedCleanup(id: string, error: unknown): never {
    if ((error as { code?: string }).code === 'STORAGE_CLEANUP_PENDING') this.cleanupErrors.set(id, error);
    throw error;
  }
  /**
   * 入口 / Entry: Backups.constructor.
   * 功能：建立 Backups 的执行备份、下载、保留策略及发布恢复上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Backups context for this module's responsibility: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; bundles: BundlesV1; secrets: SecretsV1 default=new Secrets(machines); storage: StorageRuntimeV1 default=storageRuntime
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `scheduler.register`; 更新 / updates `this.schedule`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    private machines: Machines,
    private bundles: BundlesV1,
    private secrets: SecretsV1 = new Secrets(machines),
    private storage: StorageRuntimeV1 = storageRuntime,
  ) {
    this.schedule = scheduler.register({
      owner: 'core:backups',
      label: 'Scheduled backup policies',
      intervalMs: 60_000,
      overlap: 'skip',
      catchUp: 'once',
      /**
       * 入口 / Entry: Backups.constructor.run.
       * 功能：锁定停止实例并登记备份任务，导出实例包、按策略加密或分块并执行保留规则。
       * Purpose: Locks a stopped VM and registers bundle export, optional encryption/chunking and retention work.
       * 设计：新副本验证后先写发布日志和索引，再清理旧副本；暂存和预算退出需真实确认，失败日志继续提供恢复依据。
       * Design: Verified new copies publish journal/index before old-copy pruning; staging/budget closure requires confirmation and failures retain recovery evidence.
       * 输入 / Inputs: { signal }
       * 输出 / Returns: `this.tick(Date.now(), signal)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      run: ({ signal }) => this.tick(Date.now(), signal),
    });
  }
  /**
   * 入口 / Entry: Backups.directory.
   * 功能：在执行备份、下载、保留策略及发布恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(DATA, 'backups', checkedId(id))` 供上层消费（`Backups`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Backups`; this entry produces `join(DATA, 'backups', checkedId(id))` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `join`, `checkedId` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `checkedId`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `join(DATA, 'backups', checkedId(id))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private directory(id: string) {
    return join(DATA, 'backups', checkedId(id));
  }
  /**
   * 入口 / Entry: Backups.file.
   * 功能：在执行备份、下载、保留策略及发布恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join( directory ? join(directory, 'sakura-backups', checkedId(id)) : this.directory(id), checkedId(backupId) + (encrypted ? '…` 供上层消费（`Backups`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Backups`; this entry produces `join( directory ? join(directory, 'sakura-backups', checkedId(id)) : this.directory(id), checkedId(backupId) + (encrypted ? '…` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `join`, `checkedId`, `this.directory` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `checkedId`, `this.directory`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; backupId: string; directory: string optional; encrypted: default=false
   * 输出 / Returns: `join( directory ? join(directory, 'sakura-backups', checkedId(id)) : this.directory(id), checkedId(backupId) + (encrypted ? '…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private file(id: string, backupId: string, directory?: string, encrypted = false) {
    return join(
      directory ? join(directory, 'sakura-backups', checkedId(id)) : this.directory(id),
      checkedId(backupId) + (encrypted ? '.sakura.enc' : '.sakura'),
    );
  }
  /**
   * 入口 / Entry: Backups.recordFile.
   * 功能：把本层请求转交 `this.file`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.file` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; item: BackupRecord
   * 输出 / Returns: `this.file(id, item.id, item.directory, item.encrypted)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private recordFile(id: string, item: BackupRecord) {
    return this.file(id, item.id, item.directory, item.encrypted);
  }
  /**
   * 入口 / Entry: Backups.removeFile.
   * 功能：在执行备份、下载、保留策略及发布恢复中，结束、撤销或清理本次拥有的领域资源；本入口产生 `item.storage === 'blocks' ? backupBlocks().remove(id, item.id) : rm(this.recordFile(id, item), { force: true })` 供上层消费（`Backups`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Backups`; this entry produces `item.storage === 'blocks' ? backupBlocks().remove(id, item.id) : rm(this.recordFile(id, item), { force: true })` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `backupBlocks().remove`, `backupBlocks`, `rm`, `this.recordFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `backupBlocks().remove`, `backupBlocks`, `rm`, `this.recordFile`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; item: BackupRecord
   * 输出 / Returns: `item.storage === 'blocks' ? backupBlocks().remove(id, item.id) : rm(this.recordFile(id, item), { force: true })`.
   * 副作用 / Effects: `rm`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private removeFile(id: string, item: BackupRecord) {
    return item.storage === 'blocks'
      ? backupBlocks().remove(id, item.id)
      : rm(this.recordFile(id, item), { force: true });
  }
  /**
   * 入口 / Entry: Backups.downloadable.
   * 功能：在执行备份、下载、保留策略及发布恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ type: 'stream', name: `${this.machines.get(id).name}-${item.id}.sakura`, bytes: manifest.bytes, write: (output: Writable, s…` / `{ type: 'file', path: this.recordFile(id, item), name: `${this.machines.get(id).name}-${item.id}${item.encrypted ? '.sakura.e…` 供上层消费（`Backups`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Backups`; this entry produces `{ type: 'stream', name: `${this.machines.get(id).name}-${item.id}.sakura`, bytes: manifest.bytes, write: (output: Writable, s…` / `{ type: 'file', path: this.recordFile(id, item), name: `${this.machines.get(id).name}-${item.id}${item.encrypted ? '.sakura.e…` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `this.state`, `state.items.find`, `this.blockManifest`, `this.machines.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.state`, `state.items.find`, `this.blockManifest`, `this.machines.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `item.storage === 'blocks'`.
   * 输入 / Inputs: id: string; backupId: string
   * 输出 / Returns: Promise<BackupDownload>；结果来自 / values from `{ type: 'stream', name: `${this.machines.get(id).name}-${item.id}.sakura`, bytes: manifest.bytes, write: (output: Writable, s…`; `{ type: 'file', path: this.recordFile(id, item), name: `${this.machines.get(id).name}-${item.id}${item.encrypted ? '.sakura.e…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!item`; 异常 / errors `new AppError('备份不存在', 404)`.
   */
  async downloadable(id: string, backupId: string): Promise<BackupDownload> {
    const state = await this.state(id),
      item = state.items.find((v) => v.id === checkedId(backupId));
    if (!item) throw new AppError('备份不存在', 404);
    if (item.storage === 'blocks') {
      const manifest = await this.blockManifest(id, item);
      return {
        type: 'stream',
        name: `${this.machines.get(id).name}-${item.id}.sakura`,
        bytes: manifest.bytes,
        /**
         * 入口 / Entry: Backups.downloadable.write.
         * 功能：在执行备份、下载、保留策略及发布恢复中，校验并提交领域状态变更；本入口产生 `this.storage.run( { owner: 'core:backups', taskId: 'backup-download:' + randomUUID(), label: 'Stream content blocks', mode: '…` 供上层消费（`Backups`）。
         * Purpose: Validates and commits a domain state change in `Backups`; this entry produces `this.storage.run( { owner: 'core:backups', taskId: 'backup-download:' + randomUUID(), label: 'Stream content blocks', mode: '…` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
         * 处理：通过 `this.storage.run`, `randomUUID` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `this.storage.run`, `randomUUID`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: output: Writable; signal: AbortSignal
         * 输出 / Returns: `this.storage.run( { owner: 'core:backups', taskId: 'backup-download:' + randomUUID(), label: 'Stream content blocks', mode: '…`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        write: (output: Writable, signal: AbortSignal) =>
          this.storage.run(
            {
              owner: 'core:backups',
              taskId: 'backup-download:' + randomUUID(),
              label: 'Stream content blocks',
              mode: 'read',
              transfer: 'outbound',
              paths: [DATA],
              signal,
              buffers: 36 * 1024 ** 2,
              files: 4,
            },
            async () => {
              try {
                await backupBlocks().writeTo(id, item.id, item.checksum, output, signal);
              } finally {
                if (!output.writableFinished) output.destroy();
                await finished(output).catch(() => {});
              }
            },
          ),
      };
    }
    return {
      type: 'file',
      path: this.recordFile(id, item),
      name: `${this.machines.get(id).name}-${item.id}${item.encrypted ? '.sakura.enc' : '.sakura'}`,
    };
  }
  /**
   * 入口 / Entry: Backups.plain.
   * 功能：在执行备份、下载、保留策略及发布恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `backupBlocks().withFile(id, item.id, item.checksum, signal, work, lease.cleanupPending)` / `work(file)` 供上层消费（`Backups`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Backups`; this entry produces `backupBlocks().withFile(id, item.id, item.checksum, signal, work, lease.cleanupPending)` / `work(file)` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `backupBlocks().withFile`, `backupBlocks`, `this.recordFile`, `work` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `backupBlocks().withFile`, `backupBlocks`, `this.recordFile`, `work`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!item.encrypted`.
   * 输入 / Inputs: id: string; item: BackupRecord; password: string | undefined; signal: AbortSignal; work: (file: string) => Promise<T>; lease: StorageLease
   * 输出 / Returns: `backupBlocks().withFile(id, item.id, item.checksum, signal, work, lease.cleanupPending)`; `work(file)`; `withDecrypted(file, value, work, signal, lease.cleanupPending, lease)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `item.storage === 'blocks'`; `item.encrypted`; `!value`; 异常 / errors `new AppError('加密备份不能使用块存储')`; `new AppError('请输入这份备份的加密密码')`.
   */
  private async plain<T>(
    id: string,
    item: BackupRecord,
    password: string | undefined,
    signal: AbortSignal,
    work: (file: string) => Promise<T>,
    lease: StorageLease,
  ) {
    if (item.storage === 'blocks') {
      if (item.encrypted) throw new AppError('加密备份不能使用块存储');
      return backupBlocks().withFile(id, item.id, item.checksum, signal, work, lease.cleanupPending);
    }
    const file = this.recordFile(id, item);
    if (!item.encrypted) return work(file);
    const value = password || (item.passwordSecret ? await this.secrets.value(id, item.passwordSecret) : '');
    if (!value) throw new AppError('请输入这份备份的加密密码');
    return withDecrypted(file, value, work, signal, lease.cleanupPending, lease);
  }
  /**
   * 入口 / Entry: Backups.withReadBudget.
   * 功能：在执行备份、下载、保留策略及发布恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.storage .run( { owner: 'core:backups', taskId: 'backup-read:' + randomUUID(), label: restore ? 'Verify and restore backu…` 供上层消费（`Backups`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Backups`; this entry produces `this.storage .run( { owner: 'core:backups', taskId: 'backup-read:' + randomUUID(), label: restore ? 'Verify and restore backu…` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `this.recordFile`, `this.blockManifest`, `stat`, `this.storage.run().catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.recordFile`, `this.blockManifest`, `stat`, `this.storage.run().catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; item: BackupRecord; signal: AbortSignal; work: (lease: StorageLease) => Promise<T>; restore: default=false; extraBuffers: default=0; writes: default=false; writePaths: readonly string[] default=[]
   * 输出 / Returns: `this.storage .run( { owner: 'core:backups', taskId: 'backup-read:' + randomUUID(), label: restore ? 'Verify and restore backu…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 129 * 1024 ** 3`; 异常 / errors `new AppError('备份文件大小无效')`.
   */
  private async withReadBudget<T>(
    id: string,
    item: BackupRecord,
    signal: AbortSignal,
    work: (lease: StorageLease) => Promise<T>,
    restore = false,
    extraBuffers = 0,
    writes = false,
    writePaths: readonly string[] = [],
  ) {
    const file = this.recordFile(id, item);
    const bytes =
      item.storage === 'blocks'
        ? (await this.blockManifest(id, item, signal)).bytes
        : (await stat(file)).size;
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 129 * 1024 ** 3)
      throw new AppError('备份文件大小无效');
    const materialized = !!item.encrypted || item.storage === 'blocks';
    return this.storage
      .run(
        {
          owner: 'core:backups',
          taskId: 'backup-read:' + randomUUID(),
          label: restore ? 'Verify and restore backup' : 'Read and verify backup',
          mode: materialized || restore || writes ? 'write' : 'read',
          paths: [file, DATA, ...writePaths],
          signal,
          buffers:
            (item.storage === 'blocks' ? 36 * 1024 ** 2 : 2 * MAX_BUNDLE_MANIFEST + 4 * 1024 ** 2) +
            extraBuffers,
          files: 8,
          dynamicTemporary: [DATA, ...writePaths],
          temporary: [{ path: DATA, bytes: bytes * ((materialized ? 1 : 0) + (restore ? 2 : 0)) }],
        },
        work,
      )
      .catch((error) => this.failedCleanup(id, error));
  }
  /**
   * 入口 / Entry: Backups.blockManifest.
   * 功能：在执行备份、下载、保留策略及发布恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.storage.run( { owner: 'core:backup-manifest', taskId: 'backup-manifest:' + randomUUID(), label: 'Read content block mani…` 供上层消费（`Backups`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Backups`; this entry produces `this.storage.run( { owner: 'core:backup-manifest', taskId: 'backup-manifest:' + randomUUID(), label: 'Read content block mani…` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `this.storage.run`, `randomUUID` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.storage.run`, `randomUUID`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; item: BackupRecord; signal: AbortSignal optional
   * 输出 / Returns: `this.storage.run( { owner: 'core:backup-manifest', taskId: 'backup-manifest:' + randomUUID(), label: 'Read content block mani…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private blockManifest(id: string, item: BackupRecord, signal?: AbortSignal) {
    return this.storage.run(
      {
        owner: 'core:backup-manifest',
        taskId: 'backup-manifest:' + randomUUID(),
        label: 'Read content block manifest',
        mode: 'read',
        paths: [DATA],
        signal,
        buffers: 32 * 1024 ** 2,
        files: 1,
      },
      () => backupBlocks().read(id, item.id, item.checksum),
    );
  }
  /**
   * 入口 / Entry: Backups.state.
   * 功能：在执行备份、下载、保留策略及发布恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(await this.metadata(id).read()).value` 供上层消费（`Backups`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Backups`; this entry produces `(await this.metadata(id).read()).value` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `this.machines.get`, `this.cleanupErrors.has`, `this.cleanupErrors.get`, `this.activePublication.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.cleanupErrors.has`, `this.cleanupErrors.get`, `this.activePublication.has`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.closed && !this.activePublication.has(id) && this.jobs.view(id)?.status !== 'running'`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<BackupState>；结果来自 / values from `(await this.metadata(id).read()).value`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.cleanupErrors.has(id)`; 异常 / errors `this.cleanupErrors.get(id)`.
   */
  private async state(id: string): Promise<BackupState> {
    this.machines.get(id);
    if (this.cleanupErrors.has(id)) throw this.cleanupErrors.get(id);
    if (!this.closed && !this.activePublication.has(id) && this.jobs.view(id)?.status !== 'running')
      await this.reconcile(id);
    return (await this.metadata(id).read()).value;
  }
  /**
   * 入口 / Entry: Backups.publication.
   * 功能：在执行备份、下载、保留策略及发布恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `backupPublication(join(this.directory(id), 'publication.json'))` 供上层消费（`Backups`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Backups`; this entry produces `backupPublication(join(this.directory(id), 'publication.json'))` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `backupPublication`, `join`, `this.directory` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `backupPublication`, `join`, `this.directory`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `backupPublication(join(this.directory(id), 'publication.json'))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private publication(id: string) {
    return backupPublication(join(this.directory(id), 'publication.json'));
  }
  /** Reconcile only exact, previously verified identities; never replay an export. */
  /**
   * 入口 / Entry: Backups.reconcile.
   * 功能：按原发布日志核验文件或内容块，补齐备份索引并处理已声明的旧副本清理。
   * Purpose: Reconciles files/blocks against the original publication journal, repairs indexing and cleans declared obsolete copies.
   * 设计：恢复依据原修订和摘要；文件缺失不等于发布成功，索引与文件不符保留日志，清理失败标记原租约待恢复。
   * Design: Recovery uses original revisions/digests; absence is not success, mismatched index/files retain journals, and failed cleanup retains the lease.
   * 输入 / Inputs: id: string; expectedRevision: string optional
   * 输出 / Returns: Promise<void>；结果来自 / values from `existing`; `task`.
   * 副作用 / Effects: `this.recovery.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private reconcile(id: string, expectedRevision?: string): Promise<void> {
    const existing = this.recovery.get(id);
    if (existing) return existing;
    /**
     * 入口 / Entry: Backups.reconcile.callback@382.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `expectedRevision && expectedRevision !== revision`; 异常 / errors `new AppError('原备份发布票据已变化', 409, 'RECOVERY_STALE')`.
     */
    const task = (async () => {
      const journal = this.publication(id),
        entry = (await journal.read()).value;
      if (!entry) return;
      const revision = recoveryTicketRevision(entry);
      if (expectedRevision && expectedRevision !== revision)
        throw new AppError('原备份发布票据已变化', 409, 'RECOVERY_STALE');
      const file = this.file(id, entry.id, entry.directory, entry.encrypted);
      /**
       * 入口 / Entry: Backups.reconcile.callback@400.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.storage.run）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.storage.run).
       * 输入 / Inputs: lease
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `backupBlocks().writeTo`; `this.metadata().update`; `rm`; 更新 / updates `published`.
       * 拒绝 / Refusals: 条件 / conditions `entry.record`; `entry.record.storage === 'blocks'`; `(await stat(file)).size !== entry.record.bytes || (await fileHash(file)) !== entry.record.checksum`; 异常 / errors `new AppError( '已发布的备份块无法验证：' + (error as Error).message, 409, 'BACKUP_RECOVERY_REQUIRED', )`; `new AppError('中断备份的已发布文件与日志校验值不符', 409, 'BACKUP_RECOVERY_REQUIRED')`.
       * 失败处理：catch 分支执行 `throw error;`; `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `throw error;`; `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; these statements determine whether a failure is absorbed or rejected again.
       */
      await this.storage.run(
        {
          owner: 'core:backup-recovery',
          taskId: 'backup-recovery:' + id,
          label: 'Reconcile interrupted backup publication',
          mode: 'write',
          paths: [DATA, file, ...entry.obsolete.map((item) => this.recordFile(id, item))],
          buffers: 36 * 1024 ** 2,
          files: 8,
        },
        async (lease) => {
          try {
            if (entry.record) {
              let published = true;
              try {
                if (entry.record.storage === 'blocks') {
                  await backupBlocks().read(id, entry.id, entry.record.checksum);
                  try {
                    await backupBlocks().writeTo(
                      id,
                      entry.id,
                      entry.record.checksum,
                      new Writable({
                        /**
                         * 入口 / Entry: Backups.reconcile.write.
                         * 功能：在执行备份、下载、保留策略及发布恢复中，校验并提交领域状态变更；完成下述调用及状态处理（`Backups`）。
                         * Purpose: Validates and commits a domain state change in `Backups`; the calls and state transitions below complete the operation. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
                         * 处理：通过 `done` 协调依赖；下列分支决定是否继续、返回或拒绝。
                         * Processing: Coordinates its dependencies through `done`; the branches below determine continuation, return or refusal.
                         * 输入 / Inputs: _chunk; _encoding; done
                         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
                         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
                         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                         */
                        write(_chunk, _encoding, done) {
                          done();
                        },
                      }),
                      new AbortController().signal,
                    );
                  } catch (error) {
                    throw new AppError(
                      '已发布的备份块无法验证：' + (error as Error).message,
                      409,
                      'BACKUP_RECOVERY_REQUIRED',
                    );
                  }
                } else if (
                  (await stat(file)).size !== entry.record.bytes ||
                  (await fileHash(file)) !== entry.record.checksum
                )
                  throw new AppError('中断备份的已发布文件与日志校验值不符', 409, 'BACKUP_RECOVERY_REQUIRED');
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                published = false;
              }
              const saved = (await this.metadata(id).read()).value.items.find((item) => item.id === entry.id);
              if (saved && (!published || saved.checksum !== entry.record.checksum))
                throw new AppError(
                  '备份索引与中断发布日志不一致，需要人工检查',
                  409,
                  'BACKUP_RECOVERY_REQUIRED',
                );
              if (published && !saved)
                await this.metadata(id).update((state) => {
                  state.items.unshift(entry.record!);
                  if (!state.lastSuccess || state.lastSuccess < entry.record!.createdAt)
                    state.lastSuccess = entry.record!.createdAt;
                });
            }
            for (const old of entry.obsolete) {
              const current = (await this.metadata(id).read()).value.items.find((item) => item.id === old.id);
              if (
                current &&
                (current.checksum !== old.checksum ||
                  current.directory !== old.directory ||
                  current.storage !== old.storage)
              )
                throw new AppError('待清理备份身份已变化', 409, 'BACKUP_RECOVERY_REQUIRED');
              if (backupLocked(current || old)) continue;
              await this.metadata(id).update((state) => {
                state.items = state.items.filter((item) => item.id !== old.id);
              });
              try {
                await this.removeFile(id, old);
              } catch (error) {
                lease.cleanupPending(error);
                throw error;
              }
            }
            const cleanup = await Promise.allSettled([
              rm(file + '.part', { force: true }),
              rm(file + '.plain.part', { force: true }),
            ]);
            const failure = cleanup.find((result) => result.status === 'rejected');
            if (failure?.status === 'rejected') {
              lease.cleanupPending(failure.reason);
              throw failure.reason;
            }
            await this.metadata(id).update(state => {
              const receipts = (state.recoveryReceipts || []).filter(proof => proof.id !== entry.id);
              receipts.push({ id: entry.id, revision, origin: entry.origin, confirmedAt: new Date().toISOString() });
              state.recoveryReceipts = receipts.slice(-256);
            });
            await journal.remove();
          } catch (error) {
            throw error;
          }
        },
      );
    })();
    this.recovery.set(id, task);
    void task.then(
      () => {
        this.recovery.delete(id);
      },
      () => {
        /* Preserve one failed recovery until restart. */
      },
    );
    return task;
  }
  /**
   * 入口 / Entry: Backups.metadata.
   * 功能：在执行备份、下载、保留策略及发布恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `metadataFile<BackupState>(join(this.directory(id), 'index.json'), () => ({ policy: backupPolicySchema.parse({}), items: [], }…` 供上层消费（`Backups`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Backups`; this entry produces `metadataFile<BackupState>(join(this.directory(id), 'index.json'), () => ({ policy: backupPolicySchema.parse({}), items: [], }…` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `metadataFile`, `join`, `this.directory` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `metadataFile`, `join`, `this.directory`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `metadataFile<BackupState>(join(this.directory(id), 'index.json'), () => ({ policy: backupPolicySchema.parse({}), items: [], }…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private metadata(id: string) {
    return metadataFile<BackupState>(join(this.directory(id), 'index.json'), () => ({
      policy: backupPolicySchema.parse({}),
      items: [],
    }));
  }
  /**
   * 入口 / Entry: Backups.saveState.
   * 功能：在执行备份、下载、保留策略及发布恢复中，校验并提交领域状态变更；完成下述调用及状态处理（`Backups`）。
   * Purpose: Validates and commits a domain state change in `Backups`; the calls and state transitions below complete the operation. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `this.metadata().replace`, `this.metadata` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.metadata().replace`, `this.metadata`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; state: BackupState
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.metadata().replace`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async saveState(id: string, state: BackupState) {
    await this.metadata(id).replace(state);
  }
  /**
   * 入口 / Entry: Backups.view.
   * 功能：在执行备份、下载、保留策略及发布恢复中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ ...state, bytes: state.items.reduce((sum, v) => sum + v.bytes, 0), job: this.jobs.view(id), waitingForShutdown: state.polic…` 供上层消费（`Backups`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Backups`; this entry produces `{ ...state, bytes: state.items.reduce((sum, v) => sum + v.bytes, 0), job: this.jobs.view(id), waitingForShutdown: state.polic…` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `this.state`, `state.items.reduce`, `this.jobs.view`, `this.machines.live.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.state`, `state.items.reduce`, `this.jobs.view`, `this.machines.live.has`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ ...state, bytes: state.items.reduce((sum, v) => sum + v.bytes, 0), job: this.jobs.view(id), waitingForShutdown: state.polic…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id: string) {
    const state = await this.state(id);
    return {
      ...state,
      bytes: state.items.reduce((sum, v) => sum + v.bytes, 0),
      job: this.jobs.view(id),
      waitingForShutdown: state.policy.enabled && this.machines.live.has(id),
      maintenance: await inMaintenance(id),
    };
  }
  /**
   * 入口 / Entry: Backups.policy.
   * 功能：把本层请求转交 `this.machines.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.machines.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; value: unknown
   * 输出 / Returns: `this.machines.locked(`backups:${id}`, async () => { if (this.jobs.view(id)?.status === 'running') throw new AppError('请等待备份操作…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async policy(id: string, value: unknown) {
    /**
     * 入口 / Entry: Backups.policy.callback@521.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `state`.
     * 副作用 / Effects: `this.saveState`; 更新 / updates `state.policy`.
     * 拒绝 / Refusals: 条件 / conditions `this.jobs.view(id)?.status === 'running'`; 异常 / errors `new AppError('请等待备份操作完成', 409)`.
     */
    return this.machines.locked(`backups:${id}`, async () => {
      if (this.jobs.view(id)?.status === 'running') throw new AppError('请等待备份操作完成', 409);
      const state = await this.state(id);
      state.policy = backupPolicySchema.parse(value);
      if (state.policy.directory) await regularDirectory(state.policy.directory);
      if (state.policy.passwordSecret)
        passwordSchema.parse(await this.secrets.value(id, state.policy.passwordSecret));
      await this.saveState(id, state);
      return state;
    });
  }
  /**
   * 入口 / Entry: Backups.tick.
   * 功能：在执行备份、下载、保留策略及发布恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`Backups`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Backups`; this entry produces `void` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `this.machines.records.keys`, `this.machines.live.has`, `this.jobs.view`, `inMaintenance` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.records.keys`, `this.machines.live.has`, `this.jobs.view`, `inMaintenance`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `signal?.aborted`; `this.closed || this.machines.live.has(id) || this.jobs.view(id)?.status === 'running'`; `await inMaintenance(id, now)`.
   * 输入 / Inputs: now: default=Date.now(); signal: AbortSignal optional
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.attempts.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 ，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute ; these statements determine whether a failure is absorbed or rejected again.
   */
  async tick(now = Date.now(), signal?: AbortSignal) {
    for (const id of this.machines.records.keys()) {
      if (signal?.aborted) return;
      if (this.closed || this.machines.live.has(id) || this.jobs.view(id)?.status === 'running') continue;
      try {
        if (await inMaintenance(id, now)) continue;
        const state = await this.state(id);
        if (
          state.policy.enabled &&
          now - (this.attempts.get(id) || 0) > 300000 &&
          (!state.lastSuccess || now - Date.parse(state.lastSuccess) >= state.policy.intervalHours * 3600000)
        ) {
          this.attempts.set(id, now);
          await this.run(id);
        }
      } catch {
        /* Per-machine failures are surfaced by the task history. */
      }
    }
  }
  /**
   * 入口 / Entry: Backups.run.
   * 功能：锁定停止实例并登记备份任务，导出实例包、按策略加密或分块并执行保留规则。
   * Purpose: Locks a stopped VM and registers bundle export, optional encryption/chunking and retention work.
   * 设计：新副本验证后先写发布日志和索引，再清理旧副本；暂存和预算退出需真实确认，失败日志继续提供恢复依据。
   * Design: Verified new copies publish journal/index before old-copy pruning; staging/budget closure requires confirmation and failures retain recovery evidence.
   * 输入 / Inputs: id: string; password: string optional
   * 输出 / Returns: `this.machines.locked(`backups:${id}`, async () => { this.machines.requireStopped(id); const state = await this.state(id); con…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async run(id: string, password?: string) {
    /**
     * 入口 / Entry: Backups.run.callback@553.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.jobs.start( id, async (log, signal, update) => { const backupId = randomUUID(), encrypted = !!encryptionPassword, file =…`.
     * 副作用 / Effects: `this.jobs.start`.
     * 拒绝 / Refusals: 条件 / conditions `encryptionPassword && state.policy.deduplicate`; 异常 / errors `new AppError('加密备份不支持内容去重，请先关闭块级去重策略')`.
     */
    return this.machines.locked(`backups:${id}`, async () => {
      this.machines.requireStopped(id);
      const state = await this.state(id);
      const encryptionPassword =
        password ||
        (state.policy.passwordSecret ? await this.secrets.value(id, state.policy.passwordSecret) : undefined);
      if (encryptionPassword) passwordSchema.parse(encryptionPassword);
      if (encryptionPassword && state.policy.deduplicate)
        throw new AppError('加密备份不支持内容去重，请先关闭块级去重策略');
      if (state.policy.directory) await regularDirectory(state.policy.directory);
      /**
       * 入口 / Entry: Backups.run.callback@565.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
       * 输入 / Inputs: log; signal; update
       * 输出 / Returns: `this.bundles .withExportBudget( id, signal, async (diskBytes, exportFile) => { const bundleBytes = Math.min(32 * 1024 ** 3, d…`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      return this.jobs.start(
        id,
        async (log, signal, update) => {
          const backupId = randomUUID(),
            encrypted = !!encryptionPassword,
            file = this.file(id, backupId, state.policy.directory, encrypted),
            temp = file + '.part',
            plainTemp = file + '.plain.part';
          /**
           * 入口 / Entry: Backups.run.callback@575.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.bundles.withExportBudget）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.bundles.withExportBudget).
           * 输入 / Inputs: diskBytes; exportFile
           * 输出 / Returns: `this.storage.run( { owner: 'core:backups', taskId: 'backup:' + backupId, label: 'Create and verify backup', mode: 'write', pa…`.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          return this.bundles
            .withExportBudget(
              id,
              signal,
              async (diskBytes, exportFile) => {
                const bundleBytes = Math.min(32 * 1024 ** 3, diskBytes + MAX_BUNDLE_MANIFEST + 12);
                /**
                 * 入口 / Entry: Backups.run.callback@610.
                 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.storage.run）。
                 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.storage.run).
                 * 输入 / Inputs: lease
                 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
                 * 副作用 / Effects: `mkdir`; `journal.replace`; `update`; `createWriteStream`; `output.destroy`; 更新 / updates `prepared`, `state.lastSuccess`, `state.items`, `completed`.
                 * 拒绝 / Refusals: 条件 / conditions `bytes > state.policy.maxGiB * 1024 ** 3`; `failed.length`; 异常 / errors `new AppError('单个备份超过容量上限，请提高备份容量限制')`; `error`.
                 * 收尾：退出 try 区域时始终执行 `const removed = await Promise.allSettled([ rm(temp, { force: true }), rm(plainTemp, { force: true }), ]);`; `const failed = removed .filter((item) => item.status === 'rejected') .map((item) => item.reason);`；这些步骤也适用于异常退出。
                 * Finalization: Leaving the try region always executes `const removed = await Promise.allSettled([ rm(temp, { force: true }), rm(plainTemp, { force: true }), ]);`; `const failed = removed .filter((item) => item.status === 'rejected') .map((item) => item.reason);`; these steps also apply to exceptional exits.
                 * 失败处理：catch 分支执行 `throw error;`; `lease.cleanupPending(error);`，是否吞掉错误或重新拒绝由这些语句决定。
                 * Failure handling: Catch paths execute `throw error;`; `lease.cleanupPending(error);`; these statements determine whether a failure is absorbed or rejected again.
                 */
                return this.storage.run(
                  {
                    owner: 'core:backups',
                    taskId: 'backup:' + backupId,
                    label: 'Create and verify backup',
                    mode: 'write',
                    paths: [join(vmDir(id), 'disk.qcow2'), file, DATA],
                    buffers: 2 * MAX_BUNDLE_MANIFEST + 4 * 1024 ** 2,
                    files: 8,
                    signal,
                    temporaryPhases: [
                      [
                        { path: DATA, bytes: diskBytes },
                        { path: file, bytes: bundleBytes },
                      ],
                      ...(encrypted
                        ? [
                            [
                              { path: DATA, bytes: bundleBytes },
                              { path: file, bytes: 2 * bundleBytes + 52 },
                            ],
                          ]
                        : []),
                      ...(state.policy.deduplicate
                        ? [
                            [
                              { path: DATA, bytes: bundleBytes },
                              { path: file, bytes: bundleBytes },
                            ],
                          ]
                        : []),
                    ],
                  },
                  async (lease) => {
                    await mkdir(this.directory(id), { recursive: true });
                    if (state.policy.directory)
                      await mkdir(join(state.policy.directory, 'sakura-backups', id), { recursive: true });
                    let prepared = false,
                      completed = false;
                    const journal = this.publication(id);
                    await journal.replace({
                      version: 1,
                      id: backupId,
                      encrypted,
                      directory: state.policy.directory || undefined,
                      deduplicate: !!state.policy.deduplicate,
                      obsolete: [],
                      origin: captureRecoveryOrigin([lease.id]),
                    });
                    try {
                      log('正在生成独立备份包…\n');
                      update('导出磁盘', 10);
                      const output = createWriteStream(encrypted ? plainTemp : temp, {
                        flags: 'wx',
                        mode: 0o600,
                      });
                      output.on('error', () => {});
                      try {
                        await exportFile(
                          output,
                          () => {},
                          (state.policy.bandwidthMiBps || 0) * 1024 ** 2,
                          lease.cleanupPending,
                        );
                      } finally {
                        output.destroy();
                        await finished(output).catch(() => {});
                      }
                      signal.throwIfAborted();
                      update('校验备份', 80);
                      await verifyBackup(encrypted ? plainTemp : temp, signal, lease);
                      if (encrypted) {
                        update('加密备份', 90);
                        await encryptFile(plainTemp, temp, encryptionPassword!, signal, lease);
                        await withDecrypted(
                          temp,
                          encryptionPassword!,
                          (plain) => verifyBackup(plain, signal, lease),
                          signal,
                          lease.cleanupPending,
                          lease,
                        );
                      }
                      const checksum = await fileHash(temp, signal),
                        bytes = (await stat(temp)).size;
                      if (bytes > state.policy.maxGiB * 1024 ** 3)
                        throw new AppError('单个备份超过容量上限，请提高备份容量限制');
                      signal.throwIfAborted();
                      const record: BackupRecord = {
                        id: backupId,
                        bytes,
                        checksum,
                        createdAt: new Date().toISOString(),
                        verifiedAt: new Date().toISOString(),
                        directory: state.policy.directory || undefined,
                        encrypted,
                        ...(state.policy.deduplicate ? { storage: 'blocks' as const } : {}),
                        passwordSecret: encrypted && !password ? state.policy.passwordSecret : undefined,
                        retainUntil: state.policy.lockDays
                          ? new Date(Date.now() + state.policy.lockDays * 86400000).toISOString()
                          : undefined,
                      };
                      await journal.update((entry) => {
                        entry!.record = record;
                      });
                      prepared = true;
                      if (state.policy.deduplicate) {
                        update('校验并复用内容块', 95);
                        await backupBlocks().pack(id, backupId, temp, checksum, signal, lease.cleanupPending);
                      } else await rename(temp, file);
                      state.items.unshift(record);
                      state.lastSuccess = record.createdAt;
                      // Publish the verified backup before pruning any previous good copy.
                      await this.saveState(id, state);
                      while (
                        state.items.length > state.policy.keep ||
                        state.items.reduce((sum, v) => sum + v.bytes, 0) > state.policy.maxGiB * 1024 ** 3
                      ) {
                        const old = state.items.findLast(
                          (item) => item.id !== backupId && !backupLocked(item),
                        );
                        if (!old) {
                          log('保留期内的备份受到保护，暂时超过份数或总容量上限；到期后再清理。\n');
                          break;
                        }
                        await journal.update((entry) => {
                          entry!.obsolete.push(old);
                        });
                        state.items = state.items.filter((item) => item.id !== old.id);
                        await this.saveState(id, state);
                        try {
                          await this.removeFile(id, old);
                        } catch (error) {
                          lease.cleanupPending(error);
                          throw error;
                        }
                        await journal.update((entry) => {
                          entry!.obsolete = entry!.obsolete.filter((item) => item.id !== old.id);
                        });
                      }
                      log(`备份已完成并校验，保留 ${state.items.length} 份。\n`);
                      completed = true;
                    } catch (error) {
                      // A verified publication survives index-write failure; its durable
                      // journal lets the next controller reconcile rather than regenerate.
                      throw error;
                    } finally {
                      const removed = await Promise.allSettled([
                        rm(temp, { force: true }),
                        rm(plainTemp, { force: true }),
                      ]);
                      const failed = removed
                        .filter((item) => item.status === 'rejected')
                        .map((item) => item.reason);
                      if (failed.length) {
                        const error = new AggregateError(
                          failed,
                          'Backup temporary-file cleanup is not confirmed',
                        );
                        lease.cleanupPending(error);
                        throw error;
                      }
                      if ((completed || !prepared) && !lease.pendingCleanup) await journal.remove();
                    }
                  },
                );
              },
              this.storage,
            )
            .catch((error) => this.failedCleanup(id, error));
        },
        {
          title: encryptionPassword ? '创建加密备份' : '创建备份',
          vmId: id,
          action: encryptionPassword ? undefined : 'run',
        },
      );
    });
  }
  /**
   * 入口 / Entry: Backups.operate.
   * 功能：执行备份恢复、删除或相关管理动作，核对实例状态、备份身份及保留约束。
   * Purpose: Executes backup restore/delete/management actions after VM, backup identity and retention checks.
   * 设计：修改与下载共同遵循原备份锁及验证入口；删除和恢复前不以名称代替文件摘要及完整记录。
   * Design: Mutation/download share original backup locks and verification; names do not replace file digests and complete records.
   * 输入 / Inputs: id: string; backupId: string; action: 'verify' | 'restore' | 'delete'; name: string optional; password: string optional
   * 输出 / Returns: `this.machines.locked(`backups:${id}`, async () => { if (this.jobs.view(id)?.status === 'running') throw new AppError('请等待备份操作…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async operate(
    id: string,
    backupId: string,
    action: 'verify' | 'restore' | 'delete',
    name?: string,
    password?: string,
  ) {
    /**
     * 入口 / Entry: Backups.operate.callback@763.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `await this.storage .run( { owner: 'core:backup-delete', taskId: 'backup-delete:' + id, label: 'Remove selected backup', mode:…`; `this.jobs.start( id, async (log, signal) => { return this.withReadBudget( id, item, signal, async (lease) => { try { if ( ite…`.
     * 副作用 / Effects: `this.activePublication.add`; `this.activePublication.delete`; `this.jobs.start`.
     * 拒绝 / Refusals: 条件 / conditions `this.jobs.view(id)?.status === 'running'`; `!item`; `action === 'delete'`; 异常 / errors `new AppError('请等待备份操作完成', 409)`; `new AppError('备份不存在', 404)`.
     * 收尾：退出 try 区域时始终执行 `this.activePublication.delete(id);`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `this.activePublication.delete(id);`; these steps also apply to exceptional exits.
     */
    return this.machines.locked(`backups:${id}`, async () => {
      if (this.jobs.view(id)?.status === 'running') throw new AppError('请等待备份操作完成', 409);
      const state = await this.state(id),
        item = state.items.find((v) => v.id === backupId);
      if (!item) throw new AppError('备份不存在', 404);
      if (action === 'delete') {
        if (backupLocked(item))
          throw new AppError('备份在保留锁定期内，不能删除：' + item.retainUntil, 423, 'BACKUP_LOCKED');
        this.activePublication.add(id);
        try {
          /**
           * 入口 / Entry: Backups.operate.callback@784.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.storage.run）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.storage.run).
           * 输入 / Inputs: lease
           * 输出 / Returns: `{ ok: true }`.
           * 副作用 / Effects: `journal.replace`; `this.saveState`; 更新 / updates `state.items`.
           * 拒绝 / Refusals: 异常 / errors `error`.
           * 失败处理：catch 分支执行 `lease.cleanupPending(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
           * Failure handling: Catch paths execute `lease.cleanupPending(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
           */
          return await this.storage
            .run(
              {
                owner: 'core:backup-delete',
                taskId: 'backup-delete:' + id,
                label: 'Remove selected backup',
                mode: 'write',
                paths: [DATA, this.recordFile(id, item)],
                buffers: 65536,
                files: 2,
              },
              async (lease) => {
                const journal = this.publication(id);
                await journal.replace({
                  version: 1,
                  id: randomUUID(),
                  encrypted: false,
                  deduplicate: false,
                  obsolete: [item],
                });
                state.items = state.items.filter((v) => v !== item);
                await this.saveState(id, state);
                try {
                  await this.removeFile(id, item);
                } catch (error) {
                  lease.cleanupPending(error);
                  throw error;
                }
                await journal.remove();
                return { ok: true };
              },
            )
            .catch((error) => this.failedCleanup(id, error));
        } finally {
          this.activePublication.delete(id);
        }
      }
      if (action === 'restore' && !/^[a-z][a-z0-9-]{0,31}$/.test(name || ''))
        throw new AppError('请输入新实例名称');
      /**
       * 入口 / Entry: Backups.operate.callback@814.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
       * 输入 / Inputs: log; signal
       * 输出 / Returns: `this.withReadBudget( id, item, signal, async (lease) => { try { if ( item.storage !== 'blocks' && (await fileHash(this.record…`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      return this.jobs.start(
        id,
        async (log, signal) => {
          /**
           * 入口 / Entry: Backups.operate.callback@819.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.withReadBudget）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.withReadBudget).
           * 输入 / Inputs: lease
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: `this.saveState`; 更新 / updates `item.error`.
           * 拒绝 / Refusals: 条件 / conditions `item.storage !== 'blocks' && (await fileHash(this.recordFile(id, item), signal)) !== item.checksum`; 异常 / errors `new AppError('备份包与记录的校验值不符')`; `error`.
           * 失败处理：catch 分支执行 `item.error = (error as Error).message;`; `await this.saveState(id, state);`，是否吞掉错误或重新拒绝由这些语句决定。
           * Failure handling: Catch paths execute `item.error = (error as Error).message;`; `await this.saveState(id, state);`; these statements determine whether a failure is absorbed or rejected again.
           */
          return this.withReadBudget(
            id,
            item,
            signal,
            async (lease) => {
              try {
                if (
                  item.storage !== 'blocks' &&
                  (await fileHash(this.recordFile(id, item), signal)) !== item.checksum
                )
                  throw new AppError('备份包与记录的校验值不符');
                /**
                 * 入口 / Entry: Backups.operate.callback@831.
                 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.plain）。
                 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.plain).
                 * 输入 / Inputs: file
                 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
                 * 副作用 / Effects: `this.saveState`; `createReadStream`; `source.destroy`; 更新 / updates `item.verifiedAt`.
                 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                 * 收尾：退出 try 区域时始终执行 `source.destroy();`; `await finished(source).catch(() => {});`；这些步骤也适用于异常退出。
                 * Finalization: Leaving the try region always executes `source.destroy();`; `await finished(source).catch(() => {});`; these steps also apply to exceptional exits.
                 */
                await this.plain(
                  id,
                  item,
                  password,
                  signal,
                  async (file) => {
                    await verifyBackup(file, signal, lease);
                    item.verifiedAt = new Date().toISOString();
                    delete item.error;
                    await this.saveState(id, state);
                    log('备份完整性校验通过。\n');
                    if (action === 'restore') {
                      const source = createReadStream(file, { signal });
                      try {
                        const vm = await this.bundles.import(
                          name!,
                          source,
                          signal,
                          undefined,
                          undefined,
                          lease.cleanupPending,
                          lease,
                        );
                        log(`已恢复为新实例 ${vm.name}。\n`);
                      } finally {
                        source.destroy();
                        await finished(source).catch(() => {});
                      }
                    }
                  },
                  lease,
                );
              } catch (error) {
                item.error = (error as Error).message;
                await this.saveState(id, state);
                throw error;
              }
            },
            action === 'restore',
          );
        },
        { title: action === 'verify' ? '校验备份' : '恢复备份为新实例', vmId: id },
      );
    });
  }
  /** Keep the selected backup and its content blocks stable throughout a reader's operation. */
  /**
   * 入口 / Entry: Backups.withVerifiedFile.
   * 功能：在执行备份、下载、保留策略及发布恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.machines.locked(`backups:${id}`, async () => { signal.throwIfAborted(); if (this.jobs.view(id)?.status === 'running') th…` 供上层消费（`Backups`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Backups`; this entry produces `this.machines.locked(`backups:${id}`, async () => { signal.throwIfAborted(); if (this.jobs.view(id)?.status === 'running') th…` for its caller. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `this.machines.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.locked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; backupId: string; password: string | undefined; signal: AbortSignal; work: (file: string, lease: StorageLease, sourceFile: string) => Promise<T>; options: { extraBuffers?: number; writes?: boolean; writePaths?: readonly string[] } default={}
   * 输出 / Returns: `this.machines.locked(`backups:${id}`, async () => { signal.throwIfAborted(); if (this.jobs.view(id)?.status === 'running') th…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; 异常 / errors `new AppError('备份服务正在关闭', 503)`.
   */
  async withVerifiedFile<T>(
    id: string,
    backupId: string,
    password: string | undefined,
    signal: AbortSignal,
    work: (file: string, lease: StorageLease, sourceFile: string) => Promise<T>,
    options: { extraBuffers?: number; writes?: boolean; writePaths?: readonly string[] } = {},
  ) {
    if (this.closed) throw new AppError('备份服务正在关闭', 503);
    /**
     * 入口 / Entry: Backups.withVerifiedFile.callback@881.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.withReadBudget( id, item, signal, async (lease) => { if ( item.storage !== 'blocks' && (await fileHash(this.recordFile(i…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `this.jobs.view(id)?.status === 'running'`; `!item`; 异常 / errors `new AppError('请等待备份操作完成', 409)`; `new AppError('备份不存在', 404)`.
     */
    return this.machines.locked(`backups:${id}`, async () => {
      signal.throwIfAborted();
      if (this.jobs.view(id)?.status === 'running') throw new AppError('请等待备份操作完成', 409);
      const state = await this.state(id),
        item = state.items.find((value) => value.id === checkedId(backupId));
      if (!item) throw new AppError('备份不存在', 404);
      /**
       * 入口 / Entry: Backups.withVerifiedFile.callback@891.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.withReadBudget）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.withReadBudget).
       * 输入 / Inputs: lease
       * 输出 / Returns: `this.plain( id, item, password, signal, async (file) => { const checksum = await verifyBackup(file, signal, lease); if (!item…`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `item.storage !== 'blocks' && (await fileHash(this.recordFile(id, item), signal)) !== item.checksum`; 异常 / errors `new AppError('备份包与记录的校验值不符')`.
       */
      return this.withReadBudget(
        id,
        item,
        signal,
        async (lease) => {
          if (
            item.storage !== 'blocks' &&
            (await fileHash(this.recordFile(id, item), signal)) !== item.checksum
          )
            throw new AppError('备份包与记录的校验值不符');
          /**
           * 入口 / Entry: Backups.withVerifiedFile.callback@902.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.plain）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.plain).
           * 输入 / Inputs: file
           * 输出 / Returns: `work(file, lease, item.storage === 'blocks' ? file : this.recordFile(id, item))`.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 拒绝 / Refusals: 条件 / conditions `!item.encrypted && checksum !== item.checksum`; 异常 / errors `new AppError('备份包与记录的校验值不符')`.
           */
          return this.plain(
            id,
            item,
            password,
            signal,
            async (file) => {
              const checksum = await verifyBackup(file, signal, lease);
              if (!item.encrypted && checksum !== item.checksum)
                throw new AppError('备份包与记录的校验值不符');
              signal.throwIfAborted();
              this.machines.requireUnlocked(id);
              return work(file, lease, item.storage === 'blocks' ? file : this.recordFile(id, item));
            },
            lease,
          );
        },
        false,
        options.extraBuffers || 0,
        options.writes ?? true,
        options.writePaths,
      );
    });
  }
  /**
   * 入口 / Entry: Backups.close.
   * 功能：在执行备份、下载、保留策略及发布恢复中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`Backups`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Backups`; the outcome is recorded in `this.closed`. Module context: Runs backups, downloads, retention and publication recovery; publishes a verified new copy before pruning previous good copies.
   * 处理：通过 `this.schedule.close`, `this.jobs.close`, `Promise.allSettled`, `this.recovery.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.schedule.close`, `this.jobs.close`, `Promise.allSettled`, `this.recovery.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.schedule.close`; `this.jobs.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    await this.schedule.close();
    await this.jobs.close();
    await Promise.allSettled(this.recovery.values());
  }
}

/**
 * 入口 / Entry: backupLocked.
 * 功能：从当前输入或状态计算 `( !!item.retainUntil && (!Number.isFinite(Date.parse(item.retainUntil)) || Date.parse(item.retainUntil) > now) )`，供调用方后续验证或使用。
 * Purpose: Computes `( !!item.retainUntil && (!Number.isFinite(Date.parse(item.retainUntil)) || Date.parse(item.retainUntil) > now) )` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: item: Pick<BackupRecord, 'retainUntil'>; now: default=Date.now()
 * 输出 / Returns: `( !!item.retainUntil && (!Number.isFinite(Date.parse(item.retainUntil)) || Date.parse(item.retainUntil) > now) )`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function backupLocked(item: Pick<BackupRecord, 'retainUntil'>, now = Date.now()) {
  return (
    !!item.retainUntil &&
    (!Number.isFinite(Date.parse(item.retainUntil)) || Date.parse(item.retainUntil) > now)
  );
}
