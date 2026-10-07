/**
 * 模块职责：校验并保留操作结果档案，以原文摘要标识回执，归档失败时保护原证据。
 * Module purpose: Verifies/preserves operation archives by original receipt digest, protecting evidence when archival fails.
 */
import { createHash } from 'node:crypto';
import { mkdir, lstat, open, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { operationResultArchiveRequest, operationResultPoolSchema, type OperationResultPool, type OperationResultDirectory } from '../shared/contracts/operation-results.ts';
import { writeStore, regularDirectory } from './local-store.ts';

export const OPERATION_ARCHIVE_LIMITS = Object.freeze({
  maxRecords: 4096, maxBytes: 64 * 1024 * 1024, maxRecordBytes: 64 * 1024,
});
const envelopeBytes = OPERATION_ARCHIVE_LIMITS.maxRecordBytes * 2;
const archiveTemporaryName = /^([a-f0-9-]{36})\.json\.([a-f0-9-]{36})\.tmp$/;
const authoritySchema = z.discriminatedUnion('sessionKey', [
  z.object({ role: z.literal('owner'), sessionKey: z.literal('account'), actorId: z.uuid() }).strict(),
  z.object({ role: z.literal('owner'), sessionKey: z.literal('local-owner') }).strict(),
]);
export type OperationArchiveAuthority = z.infer<typeof authoritySchema>;
const envelopeSchema = z.object({
  version: z.literal(1), correlationId: z.uuid(), pool: operationResultPoolSchema,
  digest: operationResultArchiveRequest.shape.digest, archivedAt: z.iso.datetime(),
  reason: operationResultArchiveRequest.shape.reason,
  authority: authoritySchema, raw: z.string().max(OPERATION_ARCHIVE_LIMITS.maxRecordBytes * 2),
}).strict();
export type ArchivedOperation = z.infer<typeof envelopeSchema>;
/**
 * 入口 / Entry: operationReceiptDigest.
 * 功能：在校验并保留操作结果档案中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(raw).digest('hex')` 供上层消费（`operation-result-archive.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-result-archive.ts`; this entry produces `createHash('sha256').update(raw).digest('hex')` for its caller. Module context: Verifies/preserves operation archives by original receipt digest, protecting evidence when archival fails.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: raw: Buffer
 * 输出 / Returns: `createHash('sha256').update(raw).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const operationReceiptDigest = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
/** A single identity spelling is required on case-insensitive filesystems. */
/**
 * 入口 / Entry: operationReceiptId.
 * 功能：在校验并保留操作结果档案中，执行此领域的具体处理步骤并返回其结果；本入口产生 `z.uuid().parse(id).toLowerCase()` 供上层消费（`operation-result-archive.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-result-archive.ts`; this entry produces `z.uuid().parse(id).toLowerCase()` for its caller. Module context: Verifies/preserves operation archives by original receipt digest, protecting evidence when archival fails.
 * 处理：通过 `z.uuid().parse().toLowerCase`, `z.uuid().parse`, `z.uuid` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `z.uuid().parse().toLowerCase`, `z.uuid().parse`, `z.uuid`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string
 * 输出 / Returns: `z.uuid().parse(id).toLowerCase()`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const operationReceiptId = (id: string) => z.uuid().parse(id).toLowerCase();

/** Archives are never expired automatically: a full archive is an operator-visible
 * storage boundary. Interrupted metadata temporaries remain untrusted evidence
 * and reserve capacity even if incomplete. Only a committed, validated envelope
 * permits a subsequent unlink, so interruption can be retried explicitly. */
export class OperationResultArchiveStore {
  /**
   * 入口 / Entry: OperationResultArchiveStore.constructor.
   * 功能：建立 OperationResultArchiveStore 的校验并保留操作结果档案上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the OperationResultArchiveStore context for this module's responsibility: Verifies/preserves operation archives by original receipt digest, protecting evidence when archival fails. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: directory: string
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private directory: string) {}
  /**
   * 入口 / Entry: OperationResultArchiveStore.file.
   * 功能：在校验并保留操作结果档案中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(this.directory, operationReceiptId(id) + '.json')` 供上层消费（`OperationResultArchiveStore`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationResultArchiveStore`; this entry produces `join(this.directory, operationReceiptId(id) + '.json')` for its caller. Module context: Verifies/preserves operation archives by original receipt digest, protecting evidence when archival fails.
   * 处理：通过 `join`, `operationReceiptId` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `operationReceiptId`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `join(this.directory, operationReceiptId(id) + '.json')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  file(id: string) { return join(this.directory, operationReceiptId(id) + '.json'); }
  /**
   * 入口 / Entry: OperationResultArchiveStore.read.
   * 功能：在校验并保留操作结果档案中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `void` / `archived` 供上层消费（`OperationResultArchiveStore`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `OperationResultArchiveStore`; this entry produces `void` / `archived` for its caller. Module context: Verifies/preserves operation archives by original receipt digest, protecting evidence when archival fails.
   * 处理：通过 `operationReceiptId`, `regularDirectory`, `this.file`, `lstat().catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `operationReceiptId`, `regularDirectory`, `this.file`, `lstat().catch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!directoryChecked`; `!info`.
   * 输入 / Inputs: id: string; directoryChecked: default=false
   * 输出 / Returns: Promise<ArchivedOperation | undefined>；结果来自 / values from `void`; `archived`.
   * 副作用 / Effects: `handle.close`; 更新 / updates `id`.
   * 拒绝 / Refusals: 条件 / conditions `!info.isFile() || info.isSymbolicLink() || info.size > envelopeBytes`; `bytesRead > envelopeBytes`; `archived.correlationId !== id || contents.length > OPERATION_ARCHIVE_LIMITS.maxRecordBytes || contents.toString('base64') !==…`; 异常 / errors `new AppError('操作结果档案不可用，证据未修改', 503, 'OPERATION_ARCHIVE_UNAVAILABLE')`; `new Error('oversized archive')`.
   * 收尾：退出 try 区域时始终执行 `await handle.close();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `await handle.close();`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `throw new AppError('操作结果档案校验失败，证据未修改', 503, 'OPERATION_ARCHIVE_UNAVAILABLE');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('操作结果档案校验失败，证据未修改', 503, 'OPERATION_ARCHIVE_UNAVAILABLE');`; these statements determine whether a failure is absorbed or rejected again.
   */
  async read(id: string, directoryChecked = false): Promise<ArchivedOperation | undefined> {
    id = operationReceiptId(id);
    if (!directoryChecked) await regularDirectory(this.directory);
    const file = this.file(id);
    const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (!info) return;
    if (!info.isFile() || info.isSymbolicLink() || info.size > envelopeBytes)
      throw new AppError('操作结果档案不可用，证据未修改', 503, 'OPERATION_ARCHIVE_UNAVAILABLE');
    const handle = await open(file, 'r');
    try {
      const raw = Buffer.alloc(envelopeBytes + 1);
      const { bytesRead } = await handle.read(raw, 0, raw.length, 0);
      if (bytesRead > envelopeBytes) throw new Error('oversized archive');
      const archived = envelopeSchema.parse(JSON.parse(raw.subarray(0, bytesRead).toString('utf8')));
      const contents = Buffer.from(archived.raw, 'base64');
      if (archived.correlationId !== id || contents.length > OPERATION_ARCHIVE_LIMITS.maxRecordBytes ||
          contents.toString('base64') !== archived.raw || operationReceiptDigest(contents) !== archived.digest)
        throw new Error('archive identity or digest mismatch');
      return archived;
    } catch {
      throw new AppError('操作结果档案校验失败，证据未修改', 503, 'OPERATION_ARCHIVE_UNAVAILABLE');
    } finally { await handle.close(); }
  }
  /**
   * 入口 / Entry: OperationResultArchiveStore.diagnostics.
   * 功能：在校验并保留操作结果档案中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ recordCount, bytes, ...OPERATION_ARCHIVE_LIMITS, full: true, state: 'degraded' as const, code: 'OPERATION_ARCHIVES_FULL' }` / `{ recordCount, bytes, ...OPERATION_ARCHIVE_LIMITS, full: true, state: 'degraded' as const, code: code || 'OPERATION_ARCHIVES_…` 供上层消费（`OperationResultArchiveStore`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `OperationResultArchiveStore`; this entry produces `{ recordCount, bytes, ...OPERATION_ARCHIVE_LIMITS, full: true, state: 'degraded' as const, code: 'OPERATION_ARCHIVES_FULL' }` / `{ recordCount, bytes, ...OPERATION_ARCHIVE_LIMITS, full: true, state: 'degraded' as const, code: code || 'OPERATION_ARCHIVES_…` for its caller. Module context: Verifies/preserves operation archives by original receipt digest, protecting evidence when archival fails.
   * 处理：通过 `regularDirectory`, `opendir().catch`, `opendir`, `names.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `regularDirectory`, `opendir().catch`, `opendir`, `names.push`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `entries`; `++recordCount > OPERATION_ARCHIVE_LIMITS.maxRecords`; `item.status === 'fulfilled'`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<OperationResultDirectory['archive']>；结果来自 / values from `{ recordCount, bytes, ...OPERATION_ARCHIVE_LIMITS, full: true, state: 'degraded' as const, code: 'OPERATION_ARCHIVES_FULL' }`; `{ recordCount, bytes, ...OPERATION_ARCHIVE_LIMITS, full: true, state: 'degraded' as const, code: code || 'OPERATION_ARCHIVES_…`; `{ recordCount, bytes, ...OPERATION_ARCHIVE_LIMITS, full: recordCount >= OPERATION_ARCHIVE_LIMITS.maxRecords || bytes >= OPERA…`.
   * 副作用 / Effects: `names.push`; 更新 / updates `offset`, `bytes`, `code`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return { recordCount, bytes, ...OPERATION_ARCHIVE_LIMITS, full: true, state: 'degraded' as const, code: 'OPERATION_ARCHIVE_UN…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return { recordCount, bytes, ...OPERATION_ARCHIVE_LIMITS, full: true, state: 'degraded' as const, code: 'OPERATION_ARCHIVE_UN…`; these statements determine whether a failure is absorbed or rejected again.
   */
  async diagnostics(): Promise<OperationResultDirectory['archive']> {
    // Both committed archives and retained interrupted writes consume these
    // limits; repeated interruptions cannot grow an unaccounted evidence pool.
    let recordCount = 0, bytes = 0;
    try {
      await regularDirectory(this.directory);
      const names: string[] = [];
      const entries = await opendir(this.directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      });
      // Diagnostics never create storage before an archive's authority recheck.
      if (entries) for await (const entry of entries) {
        if (++recordCount > OPERATION_ARCHIVE_LIMITS.maxRecords)
          return { recordCount, bytes, ...OPERATION_ARCHIVE_LIMITS, full: true,
            state: 'degraded' as const, code: 'OPERATION_ARCHIVES_FULL' };
        names.push(entry.name);
      }
      for (let offset = 0; offset < names.length; offset += 32) {
        /**
         * 入口 / Entry: OperationResultArchiveStore.diagnostics.callback@85.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（names.slice().map）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (names.slice().map).
         * 输入 / Inputs: name
         * 输出 / Returns: `info.size`.
         * 副作用 / Effects: `archiveTemporaryName.exec`.
         * 拒绝 / Refusals: 条件 / conditions `(!/^[a-f0-9-]{36}\.json$/.test(name) && !isTemporary) || !info.isFile() || info.isSymbolicLink()`; `info.size > envelopeBytes`; 异常 / errors `new AppError('档案目录项无效', 503, 'OPERATION_ARCHIVE_UNAVAILABLE')`; `new AppError('档案记录超过容量', 503, 'OPERATION_ARCHIVES_FULL')`.
         */
        const inspected = await Promise.allSettled(names.slice(offset, offset + 32).map(async (name) => {
          const info = await lstat(join(this.directory, name));
          const temporary = archiveTemporaryName.exec(name);
          const isTemporary = !!temporary && z.uuid().safeParse(temporary[1]).success &&
            z.uuid().safeParse(temporary[2]).success;
          if ((!/^[a-f0-9-]{36}\.json$/.test(name) && !isTemporary) || !info.isFile() || info.isSymbolicLink())
            throw new AppError('档案目录项无效', 503, 'OPERATION_ARCHIVE_UNAVAILABLE');
          if (info.size > envelopeBytes)
            throw new AppError('档案记录超过容量', 503, 'OPERATION_ARCHIVES_FULL');
          // A killed write may leave any prefix of an envelope. Keep and count
          // these bytes; never publish or trust them, including on explicit retry.
          if (!isTemporary) await this.read(name.slice(0, -5), true);
          return info.size;
        }));
        let code: string | undefined;
        for (const item of inspected) {
          if (item.status === 'fulfilled') bytes += item.value;
          else code ||= item.reason instanceof AppError ? item.reason.code : 'OPERATION_ARCHIVE_UNAVAILABLE';
        }
        if (code || bytes > OPERATION_ARCHIVE_LIMITS.maxBytes)
          return { recordCount, bytes, ...OPERATION_ARCHIVE_LIMITS, full: true,
            state: 'degraded' as const, code: code || 'OPERATION_ARCHIVES_FULL' };
      }
      return { recordCount, bytes, ...OPERATION_ARCHIVE_LIMITS,
        full: recordCount >= OPERATION_ARCHIVE_LIMITS.maxRecords || bytes >= OPERATION_ARCHIVE_LIMITS.maxBytes,
        state: 'healthy' as const };
    } catch {
      return { recordCount, bytes, ...OPERATION_ARCHIVE_LIMITS, full: true,
        state: 'degraded' as const, code: 'OPERATION_ARCHIVE_UNAVAILABLE' };
    }
  }
  /**
   * 入口 / Entry: OperationResultArchiveStore.preserve.
   * 功能：在校验并保留操作结果档案中，执行此领域的具体处理步骤并返回其结果；本入口产生 `existing` / `archived` 供上层消费（`OperationResultArchiveStore`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationResultArchiveStore`; this entry produces `existing` / `archived` for its caller. Module context: Verifies/preserves operation archives by original receipt digest, protecting evidence when archival fails.
   * 处理：通过 `operationReceiptId`, `authoritySchema.parse`, `operationReceiptDigest`, `this.read` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `operationReceiptId`, `authoritySchema.parse`, `operationReceiptDigest`, `this.read`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; pool: OperationResultPool; raw: Buffer; reason: ArchivedOperation['reason']; authority: OperationArchiveAuthority; check: () => Promise<void>
   * 输出 / Returns: `existing`; `archived`.
   * 副作用 / Effects: `mkdir`; `writeStore`; 更新 / updates `id`.
   * 拒绝 / Refusals: 条件 / conditions `existing`; `existing.pool !== pool || existing.digest !== digest`; `raw.length > OPERATION_ARCHIVE_LIMITS.maxRecordBytes || inventory.state !== 'healthy' || inventory.recordCount >= OPERATION_A…`; 异常 / errors `new AppError('归档标识已被不同证据占用', 409, 'OPERATION_ARCHIVE_CONFLICT')`; `new AppError('操作结果档案容量不足，原证据已保留；请先导出保管并迁移旧档案', 503, inventory.code || 'OPERATION_ARCHIVES_FULL')`.
   */
  async preserve(id: string, pool: OperationResultPool, raw: Buffer,
    reason: ArchivedOperation['reason'], authority: OperationArchiveAuthority, check: () => Promise<void>) {
    id = operationReceiptId(id);
    authoritySchema.parse(authority);
    const digest = operationReceiptDigest(raw);
    const existing = await this.read(id);
    if (existing) {
      if (existing.pool !== pool || existing.digest !== digest)
        throw new AppError('归档标识已被不同证据占用', 409, 'OPERATION_ARCHIVE_CONFLICT');
      return existing;
    }
    const archived = envelopeSchema.parse({ version: 1, correlationId: id, pool, digest,
      archivedAt: new Date().toISOString(), reason, authority, raw: raw.toString('base64') });
    const size = Buffer.byteLength(JSON.stringify(archived, null, 2));
    const inventory = await this.diagnostics();
    if (raw.length > OPERATION_ARCHIVE_LIMITS.maxRecordBytes || inventory.state !== 'healthy' ||
        inventory.recordCount >= OPERATION_ARCHIVE_LIMITS.maxRecords ||
        inventory.bytes + size > OPERATION_ARCHIVE_LIMITS.maxBytes)
      throw new AppError('操作结果档案容量不足，原证据已保留；请先导出保管并迁移旧档案', 503,
        inventory.code || 'OPERATION_ARCHIVES_FULL');
    await check();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeStore(this.file(id), archived);
    return archived;
  }
}
