/**
 * 模块职责：保存操作执行与响应阶段的持久回执，区分业务开始、结果验证和审计失败。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, opendir, open, lstat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { operationResultSchema, type OperationResult } from '../shared/contracts/operation-results.ts';
import { operationResultArchiveRequest, type OperationResultPool, type OperationResultDirectory, type OperationResultArchive } from '../shared/contracts/operation-results.ts';
import { writeStore, regularDirectory } from './local-store.ts';
import { DATA } from './paths.ts';
import { withoutOperationContext, withAuditFailureObserver } from './operation-context.ts';
import { withoutPluginAuthority } from './plugin-authority.ts';
import { withNewResourceContext } from './host-runtime/context.ts';
import { auditFailure } from './audit.ts';
import { publicApiFailure } from './api-errors.ts';
import { captureOperationCheck } from './operation-context.ts';
import { operationRefusedBeforeEffect } from './operation-execution.ts';
import { OperationResultArchiveStore, OPERATION_ARCHIVE_LIMITS, operationReceiptDigest, operationReceiptId, type OperationArchiveAuthority } from './operation-result-archive.ts';

type Receipt = OperationResult & { actorId?: string; sessionKey: string };
const receiptSchema = operationResultSchema
  .extend({ actorId: z.uuid().optional(), sessionKey: z.string().max(256) })
  .strict();
const context = new AsyncLocalStorage<Receipt>();
const failedAudit = new WeakSet<Receipt>();
export const OPERATION_RESULT_LIMITS = Object.freeze({ normal: 2000, management: 32, authentication: 64 });
const pools = Object.keys(OPERATION_RESULT_LIMITS) as OperationResultPool[];
const maxRecordBytes = 8192;
type Inventory = { records: Map<string, Receipt>; blocked: Set<string>; truncated: boolean;
  evidence: Map<string, { digest: string; archiveAvailable: boolean }> };
export function noteOperationResultActor(actorId: string) {
  const receipt = context.getStore();
  if (receipt) receipt.actorId = z.uuid().parse(actorId);
}
export function noteOperationBusinessResult(status: number) {
  const receipt = context.getStore();
  if (receipt && status >= 200 && status < 400) {
    receipt.outcome = 'succeeded';
    receipt.responseStatus = status;
  }
}
export function noteOperationBusinessStarted() {
  const receipt = context.getStore();
  if (receipt) {
    receipt.outcome = 'unknown';
    receipt.executed = true;
  }
}
export function noteOperationResponseValidated() {
  const receipt = context.getStore();
  if (receipt) receipt.responseValidated = true;
}
/** Durable receipts contain outcome metadata, never request bodies, credentials or response payloads. */
export class OperationResults {
  private active = new Set<string>();
  private inventories = new Map<OperationResultPool, Inventory>();
  private locations = new Map<string, OperationResultPool>();
  private queue: Promise<unknown> = Promise.resolve();
  private archives: OperationResultArchiveStore;
  constructor(private directory = join(DATA, 'operation-results')) {
    this.archives = new OperationResultArchiveStore(join(directory, 'archives'));
  }
  private poolDirectory(pool: OperationResultPool) {
    return pool === 'normal' ? this.directory : join(this.directory, pool);
  }
  private file(id: string, pool: OperationResultPool = 'normal') {
    return join(this.poolDirectory(pool), operationReceiptId(id) + '.json');
  }
  private async save(receipt: Receipt) {
    const snapshot = receiptSchema.parse({ ...receipt });
    if (Buffer.byteLength(JSON.stringify(snapshot, null, 2), 'utf8') > maxRecordBytes)
      throw new AppError('操作结果记录超过字节上限', 503, 'OPERATION_RESULT_UNAVAILABLE');
    await withoutOperationContext(() =>
      withoutPluginAuthority(() =>
        withNewResourceContext({ owner: 'core:operation-results' }, () =>
          writeStore(this.file(snapshot.correlationId, this.locations.get(snapshot.correlationId)), snapshot),
        ),
      ),
    );
    const inventory = this.inventories.get(this.locations.get(snapshot.correlationId) || 'normal');
    inventory?.records.set(snapshot.correlationId, snapshot);
    inventory?.evidence.set(snapshot.correlationId, {
      digest: operationReceiptDigest(Buffer.from(JSON.stringify(snapshot, null, 2))), archiveAvailable: true,
    });
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => {}).then(work);
    this.queue = result;
    return result;
  }
  private async load(pool: OperationResultPool = 'normal') {
    const cached = this.inventories.get(pool);
    if (cached) return cached;
    const directory = this.poolDirectory(pool), maxRecords = OPERATION_RESULT_LIMITS[pool];
    await regularDirectory(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const inventory = new Map<string, Receipt>();
    const blocked = new Set<string>();
    const evidence: Inventory['evidence'] = new Map();
    let scanned = 0, truncated = false;
    const ids: string[] = [];
    for await (const entry of await opendir(directory)) {
      if (++scanned > maxRecords * 2 + 3) { truncated = true; break; }
      if (!/^[a-f0-9-]{36}\.json$/.test(entry.name)) continue;
      if (ids.length >= maxRecords * 2) { truncated = true; break; }
      const id = entry.name.slice(0, -5);
      if (!z.uuid().safeParse(id).success) continue;
      ids.push(id);
    }
    const readEntry = async (id: string) => {
      try {
        inventory.set(id, await this.read(id, pool, true, (raw) =>
          evidence.set(id, { digest: operationReceiptDigest(raw), archiveAvailable: true })));
      } catch {
        blocked.add(id);
        if (!evidence.has(id)) {
          try {
            const raw = await this.raw(id, pool, true);
            evidence.set(id, { digest: operationReceiptDigest(raw), archiveAvailable: true });
          } catch {
            evidence.set(id, { digest: operationReceiptDigest(Buffer.from(id + ':unavailable')), archiveAvailable: false });
          }
        }
      }
    };
    // Independent bounded reads avoid turning a full receipt directory into a
    // long serial-I/O admission delay. Keep at most 32 file handles in flight.
    for (let offset = 0; offset < ids.length; offset += 32)
      await Promise.all(ids.slice(offset, offset + 32).map(readEntry));
    // 无效记录仍占用容量并保留原文；正常操作继续执行，但不信任或删除未确认结果。
    const loaded = { records: inventory, blocked, truncated, evidence };
    this.inventories.set(pool, loaded);
    return loaded;
  }
  private async read(id: string, pool: OperationResultPool = 'normal', directoryChecked = false,
    observeRaw?: (raw: Buffer) => void): Promise<Receipt> {
    id = operationReceiptId(id);
    if (!directoryChecked) await regularDirectory(this.poolDirectory(pool));
    const file = this.file(id, pool),
      info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxRecordBytes)
      throw new AppError('操作结果记录不可用', 503, 'OPERATION_RESULT_UNAVAILABLE');
    const handle = await open(file, 'r');
    try {
      const buffer = Buffer.alloc(maxRecordBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > maxRecordBytes)
        throw new AppError('操作结果记录不可用', 503, 'OPERATION_RESULT_UNAVAILABLE');
      const raw = buffer.subarray(0, bytesRead);
      observeRaw?.(raw);
      const receipt = receiptSchema.parse(JSON.parse(raw.toString('utf8')));
      if (receipt.correlationId !== id)
        throw new AppError('操作结果记录标识不一致', 503, 'OPERATION_RESULT_UNAVAILABLE');
      return receipt;
    } finally {
      await handle.close();
    }
  }
  async start(correlationId: string, operationId: string, sessionKey: string, actorId?: string,
    options: { pool?: OperationResultPool; management?: boolean } = {}) {
    correlationId = operationReceiptId(correlationId);
    return this.serial(async () => {
      const pool = options.pool || (options.management ? 'management' : 'normal');
      const state = await this.load(pool), inventory = state.records, maxRecords = OPERATION_RESULT_LIMITS[pool];
      if (state.truncated) throw new AppError('操作結果目录超过可诊断上限，请先归档', 503, 'OPERATION_RESULTS_FULL');
      if (inventory.size + state.blocked.size >= maxRecords) {
        const terminal = [...inventory.values()]
          .filter(
            (item) =>
              !this.active.has(item.correlationId) &&
              (item.outcome === 'succeeded' || item.outcome === 'failed'),
          )
          .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
        for (const item of terminal.slice(0, Math.max(0, inventory.size + state.blocked.size - Math.floor(maxRecords / 2)))) {
          await unlink(this.file(item.correlationId, pool));
          inventory.delete(item.correlationId);
          state.evidence.delete(item.correlationId);
          this.locations.delete(item.correlationId);
        }
        if (inventory.size + state.blocked.size >= maxRecords)
          throw new AppError('未确认操作结果达到目录上限', 503, 'OPERATION_RESULTS_FULL');
      }
      const receipt: Receipt = {
        correlationId,
        operationId,
        sessionKey,
        ...(actorId ? { actorId } : {}),
        outcome: 'pending',
        executed: false,
        startedAt: new Date().toISOString(),
        responseValidated: false,
        auditRecorded: false,
        delivery: 'pending',
      };
      for (const candidate of pools) {
        const existing = await lstat(this.file(correlationId, candidate)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return undefined;
        });
        if (existing) throw new AppError('操作结果标识已存在', 409, 'OPERATION_RESULT_CONFLICT');
      }
      if (await this.archives.read(correlationId))
        throw new AppError('操作结果标识已经归档', 409, 'OPERATION_RESULT_CONFLICT');
      this.locations.set(correlationId, pool);
      try { await this.save(receipt); }
      catch (error) { this.locations.delete(correlationId); throw error; }
      this.active.add(correlationId);
      return receipt;
    });
  }
  run<T>(receipt: Receipt, work: () => T) {
    return withAuditFailureObserver(() => failedAudit.add(receipt), () => context.run(receipt, work));
  }
  /** 业务执行前先持久化开始标志；进程中断后以 unknown 保留可能已产生效果的证据。 */
  async begin(receipt: Receipt) {
    receipt.outcome = 'unknown';
    receipt.executed = true;
    try {
      await this.serial(() => this.save(receipt));
    } catch {
      receipt.outcome = 'failed';
      receipt.executed = false;
      throw new AppError('无法持久化操作开始标志', 503, 'OPERATION_RESULT_UNAVAILABLE');
    }
  }
  queryable(receipt: Receipt) {
    return !!receipt.actorId || receipt.sessionKey === 'local-owner';
  }
  auditFailed(receipt: Receipt) { return failedAudit.has(receipt); }
  /** 捕获路径显式传入 failed，因为 JavaScript 也能 throw undefined，不能仅凭错误值判断失败。 */
  async finish(receipt: Receipt, error?: unknown, sent?: boolean, retainActive = false, failed = error !== undefined) {
    receipt.finishedAt = new Date().toISOString();
    if (failed && receipt.outcome !== 'succeeded' && operationRefusedBeforeEffect(error, receipt.operationId)) {
      receipt.outcome = 'failed';
      receipt.executed = false;
    }
    if (receipt.outcome === 'pending') receipt.outcome = failed ? 'failed' : 'unknown';
    receipt.auditRecorded =
      !failedAudit.has(receipt) && !auditFailure(error) && !(error instanceof AppError && error.code === 'AUDIT_UNAVAILABLE');
    receipt.delivery = sent === undefined ? 'pending' : sent ? 'sent' : 'failed';
    if (failed) receipt.errorCode = publicApiFailure(error, receipt.correlationId).dto.code;
    try {
      await this.serial(() => this.save(receipt));
    } finally {
      if (!retainActive) this.active.delete(receipt.correlationId);
    }
    return this.public(receipt);
  }
  private public(receipt: Receipt): OperationResult {
    const { actorId: _actor, sessionKey: _session, ...result } = receipt;
    return result;
  }
  private async raw(id: string, pool: OperationResultPool, directoryChecked = false) {
    if (!directoryChecked) await regularDirectory(this.poolDirectory(pool));
    const info = await lstat(this.file(id, pool));
    if (!info.isFile() || info.isSymbolicLink() || info.size > OPERATION_ARCHIVE_LIMITS.maxRecordBytes)
      throw new AppError('原回执类型或大小无法安全归档，证据已保留', 503, 'OPERATION_ARCHIVE_UNAVAILABLE');
    const handle = await open(this.file(id, pool), 'r');
    try {
      const buffer = Buffer.alloc(OPERATION_ARCHIVE_LIMITS.maxRecordBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > OPERATION_ARCHIVE_LIMITS.maxRecordBytes)
        throw new AppError('原回执超过归档字节上限', 503, 'OPERATION_ARCHIVE_UNAVAILABLE');
      return buffer.subarray(0, bytesRead);
    } finally { await handle.close(); }
  }
  /** Owner-only HTTP management view. Account/session fields are never published. */
  diagnostics(): Promise<OperationResultDirectory> {
    const check = captureOperationCheck();
    return this.serial(async () => {
      await check();
      const archive = await this.archives.diagnostics();
      const records: OperationResultDirectory['records'] = [];
      const summaries: OperationResultDirectory['pools'] = [];
      for (const pool of pools) {
        this.inventories.delete(pool);
        let inventory: Inventory;
        try { inventory = await this.load(pool); }
        catch {
          summaries.push({ pool, maxRecords: OPERATION_RESULT_LIMITS[pool], recordCount: 0,
            blockedCount: 0, truncated: false, full: true, state: 'degraded', code: 'OPERATION_RESULT_UNAVAILABLE' });
          continue;
        }
        summaries.push({ pool, maxRecords: OPERATION_RESULT_LIMITS[pool],
          recordCount: inventory.records.size + inventory.blocked.size,
          blockedCount: inventory.blocked.size, truncated: inventory.truncated,
          full: inventory.truncated || inventory.records.size + inventory.blocked.size >= OPERATION_RESULT_LIMITS[pool], state: 'healthy' });
        for (const id of [...inventory.records.keys(), ...inventory.blocked]) {
          const receipt = inventory.records.get(id), evidence = inventory.evidence.get(id)!;
          records.push({ correlationId: id, pool,
            digest: evidence.digest,
            state: receipt ? 'receipt' : 'invalid', active: this.active.has(id),
            archiveAvailable: evidence.archiveAvailable && !this.active.has(id) && !archive.full,
            ...(receipt ? { operationId: receipt.operationId,
              outcome: !this.active.has(id) && !receipt.finishedAt ? 'unknown' as const : receipt.outcome,
              executed: receipt.executed } : {}),
            ...(!evidence.archiveAvailable ? { errorCode: 'OPERATION_ARCHIVE_UNAVAILABLE' } : {}),
          });
        }
      }
      await check();
      return { version: 1, pools: summaries, records, archive };
    });
  }
  /** Explicit archival is its own durable, idempotent management transaction.
   * The HTTP adapter must enforce owner admission and audit it, but must not
   * allocate a fresh receipt: this is also the recovery path for full pools.
   * Archival acknowledges uncertainty without claiming success or failure. */
  archive(input: unknown, authority: OperationArchiveAuthority): Promise<OperationResultArchive> {
    const parsed = operationResultArchiveRequest.parse(input), check = captureOperationCheck();
    const request = { ...parsed, correlationId: operationReceiptId(parsed.correlationId) };
    return this.serial(async () => {
      await check();
      if (authority.role !== 'owner' || !['account', 'local-owner'].includes(authority.sessionKey) ||
          (authority.sessionKey === 'account' && !z.uuid().safeParse(authority.actorId).success))
        throw new AppError('仅管理员可归档操作结果', 403, 'OPERATION_RESULT_FORBIDDEN');
      if (this.active.has(request.correlationId))
        throw new AppError('操作仍在执行，不能归档', 409, 'OPERATION_RESULT_ACTIVE');
      let pool: OperationResultPool | undefined, raw: Buffer | undefined;
      for (const candidate of pools) {
        try { raw = await this.raw(request.correlationId, candidate); pool = candidate; break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      if (!raw || !pool) {
        const prior = await this.archives.read(request.correlationId);
        if (!prior) throw new AppError('操作结果不存在', 404, 'OPERATION_RESULT_NOT_FOUND');
        if (prior.digest !== request.digest) throw new AppError('归档摘要已变化', 409, 'OPERATION_RESULT_STALE');
        await check();
        return { correlationId: prior.correlationId, pool: prior.pool, digest: prior.digest,
          archivedAt: prior.archivedAt, reason: prior.reason, capacityReleased: true };
      }
      if (operationReceiptDigest(raw) !== request.digest)
        throw new AppError('原回执已变化，请刷新后重新确认', 409, 'OPERATION_RESULT_STALE');
      const archived = await withoutPluginAuthority(() =>
        withNewResourceContext({ owner: 'core:operation-results' }, () =>
          this.archives.preserve(request.correlationId, pool!, raw!, request.reason, authority, check)));
      // Recheck both authority and original bytes after durable evidence publication.
      // If either changed, keep both copies for an explicit, reviewed retry.
      await check();
      if (operationReceiptDigest(await this.raw(request.correlationId, pool)) !== request.digest)
        throw new AppError('归档期间原回执已变化，原文件保留', 409, 'OPERATION_RESULT_STALE');
      await check();
      await unlink(this.file(request.correlationId, pool));
      this.inventories.delete(pool);
      this.locations.delete(request.correlationId);
      return { correlationId: archived.correlationId, pool: archived.pool, digest: archived.digest,
        archivedAt: archived.archivedAt, reason: archived.reason, capacityReleased: true };
    });
  }
  async get(id: string, sessionKey: string, actorId?: string) {
    id = operationReceiptId(id);
    let receipt: Receipt;
    try {
      let found: Receipt | undefined;
      for (const pool of pools) {
        try { found = await this.read(id, pool); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      if (!found) {
        const archived = await this.archives.read(id);
        if (archived) found = receiptSchema.parse(JSON.parse(Buffer.from(archived.raw, 'base64').toString('utf8')));
      }
      if (!found) throw new AppError('操作结果不存在', 404, 'OPERATION_RESULT_NOT_FOUND');
      if (found.correlationId !== id)
        throw new AppError('归档原回执标识不一致', 503, 'OPERATION_RESULT_UNAVAILABLE');
      receipt = found;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new AppError('操作结果不存在', 404, 'OPERATION_RESULT_NOT_FOUND');
      if (error instanceof AppError) throw error;
      throw new AppError('操作结果记录不可用', 503, 'OPERATION_RESULT_UNAVAILABLE');
    }
    if (receipt.actorId ? receipt.actorId !== actorId : receipt.sessionKey !== sessionKey)
      throw new AppError('当前会话无权查询此操作结果', 403, 'OPERATION_RESULT_FORBIDDEN');
    if (!this.active.has(id))
      return this.public({
        ...receipt,
        ...(!receipt.finishedAt ? { outcome: 'unknown' as const } : {}),
        ...(receipt.delivery === 'pending' ? { delivery: 'unknown' as const } : {}),
      });
    return this.public(receipt);
  }
}
