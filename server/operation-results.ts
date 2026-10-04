import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, opendir, open, lstat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { operationResultSchema, type OperationResult } from '../shared/contracts/operation-results.ts';
import { writeStore } from './local-store.ts';
import { DATA } from './paths.ts';
import { withoutOperationContext, withAuditFailureObserver } from './operation-context.ts';
import { withoutPluginAuthority } from './plugin-authority.ts';
import { withNewResourceContext } from './host-runtime/context.ts';
import { auditFailure } from './audit.ts';
import { publicApiFailure } from './api-errors.ts';

type Receipt = OperationResult & { actorId?: string; sessionKey: string };
const receiptSchema = operationResultSchema
  .extend({ actorId: z.uuid().optional(), sessionKey: z.string().max(256) })
  .strict();
const context = new AsyncLocalStorage<Receipt>();
const failedAudit = new WeakSet<Receipt>();
const maxRecords = 2000,
  maxRecordBytes = 8192;
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
  private inventory?: Map<string, Receipt>;
  private blocked = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory = join(DATA, 'operation-results')) {}
  private file(id: string) {
    return join(this.directory, z.uuid().parse(id) + '.json');
  }
  private async save(receipt: Receipt) {
    const snapshot = receiptSchema.parse({ ...receipt });
    if (Buffer.byteLength(JSON.stringify(snapshot, null, 2), 'utf8') > maxRecordBytes)
      throw new AppError('操作结果记录超过字节上限', 503, 'OPERATION_RESULT_UNAVAILABLE');
    await withoutOperationContext(() =>
      withoutPluginAuthority(() =>
        withNewResourceContext({ owner: 'core:operation-results' }, () =>
          writeStore(this.file(snapshot.correlationId), snapshot),
        ),
      ),
    );
    this.inventory?.set(snapshot.correlationId, snapshot);
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => {}).then(work);
    this.queue = result;
    return result;
  }
  private async load() {
    if (this.inventory) return this.inventory;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const inventory = new Map<string, Receipt>();
    const blocked = new Set<string>();
    let scanned = 0;
    for await (const entry of await opendir(this.directory)) {
      if (++scanned > maxRecords * 2)
        throw new AppError('操作结果目录条目超过上限', 503, 'OPERATION_RESULTS_FULL');
      if (!/^[a-f0-9-]{36}\.json$/.test(entry.name)) continue;
      if (inventory.size + blocked.size >= maxRecords)
        throw new AppError('操作结果目录记录超过上限', 503, 'OPERATION_RESULTS_FULL');
      const id = entry.name.slice(0, -5);
      try {
        inventory.set(id, await this.read(id));
      } catch {
        blocked.add(id);
      }
    }
    // Invalid records reserve capacity and remain untouched; healthy operations
    // continue without trusting or deleting an unconfirmed outcome.
    this.blocked = blocked;
    this.inventory = inventory;
    return inventory;
  }
  private async read(id: string): Promise<Receipt> {
    const file = this.file(id),
      info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxRecordBytes)
      throw new AppError('操作结果记录不可用', 503, 'OPERATION_RESULT_UNAVAILABLE');
    const handle = await open(file, 'r');
    try {
      const buffer = Buffer.alloc(maxRecordBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > maxRecordBytes)
        throw new AppError('操作结果记录不可用', 503, 'OPERATION_RESULT_UNAVAILABLE');
      const receipt = receiptSchema.parse(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')));
      if (receipt.correlationId !== id)
        throw new AppError('操作结果记录标识不一致', 503, 'OPERATION_RESULT_UNAVAILABLE');
      return receipt;
    } finally {
      await handle.close();
    }
  }
  async start(correlationId: string, operationId: string, sessionKey: string, actorId?: string) {
    return this.serial(async () => {
      const inventory = await this.load();
      if (inventory.size + this.blocked.size >= maxRecords) {
        const terminal = [...inventory.values()]
          .filter(
            (item) =>
              !this.active.has(item.correlationId) &&
              (item.outcome === 'succeeded' || item.outcome === 'failed'),
          )
          .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
        for (const item of terminal.slice(0, Math.max(0, inventory.size + this.blocked.size - 1000))) {
          await unlink(this.file(item.correlationId));
          inventory.delete(item.correlationId);
        }
        if (inventory.size + this.blocked.size >= maxRecords)
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
      await this.save(receipt);
      this.active.add(correlationId);
      return receipt;
    });
  }
  run<T>(receipt: Receipt, work: () => T) {
    return withAuditFailureObserver(() => failedAudit.add(receipt), () => context.run(receipt, work));
  }
  /** Commit execution admission before invoking any business code. */
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
  /** Catch paths pass failed explicitly because JavaScript can throw undefined. */
  async finish(receipt: Receipt, error?: unknown, sent?: boolean, retainActive = false, failed = error !== undefined) {
    receipt.finishedAt = new Date().toISOString();
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
  async get(id: string, sessionKey: string, actorId?: string) {
    let receipt: Receipt;
    try {
      receipt = await this.read(id);
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
