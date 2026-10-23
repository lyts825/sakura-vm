/**
 * 模块职责：保存操作执行与响应阶段的持久回执，区分业务开始、结果验证和审计失败。
 * Module purpose: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
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
import { withoutOperationContext, withAuditFailureObserver, withOperationReceipt } from './operation-context.ts';
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
/**
 * 入口 / Entry: noteOperationResultActor.
 * 功能：在保存操作执行与响应阶段的持久回执中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `receipt.actorId`（`operation-results.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-results.ts`; the outcome is recorded in `receipt.actorId`. Module context: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
 * 处理：通过 `context.getStore`, `z.uuid().parse`, `z.uuid` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `context.getStore`, `z.uuid().parse`, `z.uuid`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `receipt`.
 * 输入 / Inputs: actorId: string
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 更新 / updates `receipt.actorId`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function noteOperationResultActor(actorId: string) {
  const receipt = context.getStore();
  if (receipt) receipt.actorId = z.uuid().parse(actorId);
}
/**
 * 入口 / Entry: noteOperationBusinessResult.
 * 功能：在保存操作执行与响应阶段的持久回执中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `receipt.outcome`, `receipt.responseStatus`（`operation-results.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-results.ts`; the outcome is recorded in `receipt.outcome`, `receipt.responseStatus`. Module context: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
 * 处理：通过 `context.getStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `context.getStore`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `receipt && status >= 200 && status < 400`.
 * 输入 / Inputs: status: number
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 更新 / updates `receipt.outcome`, `receipt.responseStatus`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function noteOperationBusinessResult(status: number) {
  const receipt = context.getStore();
  if (receipt && status >= 200 && status < 400) {
    receipt.outcome = 'succeeded';
    receipt.responseStatus = status;
  }
}
/**
 * 入口 / Entry: noteOperationBusinessStarted.
 * 功能：在保存操作执行与响应阶段的持久回执中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `receipt.outcome`, `receipt.executed`（`operation-results.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-results.ts`; the outcome is recorded in `receipt.outcome`, `receipt.executed`. Module context: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
 * 处理：通过 `context.getStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `context.getStore`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `receipt`.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 更新 / updates `receipt.outcome`, `receipt.executed`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function noteOperationBusinessStarted() {
  const receipt = context.getStore();
  if (receipt) {
    receipt.outcome = 'unknown';
    receipt.executed = true;
  }
}
/**
 * 入口 / Entry: noteOperationResponseValidated.
 * 功能：在保存操作执行与响应阶段的持久回执中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `receipt.responseValidated`（`operation-results.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-results.ts`; the outcome is recorded in `receipt.responseValidated`. Module context: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
 * 处理：通过 `context.getStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `context.getStore`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `receipt`.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 更新 / updates `receipt.responseValidated`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
  /**
   * 入口 / Entry: OperationResults.constructor.
   * 功能：建立 OperationResults 的保存操作执行与响应阶段的持久回执上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the OperationResults context for this module's responsibility: Persists execution/response receipts, distinguishing business admission, response validation and audit failures. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: directory: default=join(DATA, 'operation-results')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.archives`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private directory = join(DATA, 'operation-results')) {
    this.archives = new OperationResultArchiveStore(join(directory, 'archives'));
  }
  /**
   * 入口 / Entry: OperationResults.poolDirectory.
   * 功能：从当前输入或状态计算 `pool === 'normal' ? this.directory : join(this.directory, pool)`，供调用方后续验证或使用。
   * Purpose: Computes `pool === 'normal' ? this.directory : join(this.directory, pool)` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: pool: OperationResultPool
   * 输出 / Returns: `pool === 'normal' ? this.directory : join(this.directory, pool)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private poolDirectory(pool: OperationResultPool) {
    return pool === 'normal' ? this.directory : join(this.directory, pool);
  }
  /**
   * 入口 / Entry: OperationResults.file.
   * 功能：在保存操作执行与响应阶段的持久回执中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(this.poolDirectory(pool), operationReceiptId(id) + '.json')` 供上层消费（`OperationResults`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationResults`; this entry produces `join(this.poolDirectory(pool), operationReceiptId(id) + '.json')` for its caller. Module context: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
   * 处理：通过 `join`, `this.poolDirectory`, `operationReceiptId` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `this.poolDirectory`, `operationReceiptId`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; pool: OperationResultPool default='normal'
   * 输出 / Returns: `join(this.poolDirectory(pool), operationReceiptId(id) + '.json')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private file(id: string, pool: OperationResultPool = 'normal') {
    return join(this.poolDirectory(pool), operationReceiptId(id) + '.json');
  }
  /**
   * 入口 / Entry: OperationResults.save.
   * 功能：在保存操作执行与响应阶段的持久回执中，校验并提交领域状态变更；完成下述调用及状态处理（`OperationResults`）。
   * Purpose: Validates and commits a domain state change in `OperationResults`; the calls and state transitions below complete the operation. Module context: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
   * 处理：通过 `receiptSchema.parse`, `withoutOperationContext`, `this.inventories.get`, `this.locations.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `receiptSchema.parse`, `withoutOperationContext`, `this.inventories.get`, `this.locations.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: receipt: Receipt
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `inventory.records.set`; `inventory.evidence.set`.
   * 拒绝 / Refusals: 条件 / conditions `Buffer.byteLength(JSON.stringify(snapshot, null, 2), 'utf8') > maxRecordBytes`; 异常 / errors `new AppError('操作结果记录超过字节上限', 503, 'OPERATION_RESULT_UNAVAILABLE')`.
   */
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
  /**
   * 入口 / Entry: OperationResults.serial.
   * 功能：在保存操作执行与响应阶段的持久回执中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`OperationResults`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationResults`; this entry produces `result` for its caller. Module context: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
   * 处理：通过 `this.queue.catch().then`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.queue.catch().then`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `result`.
   * 副作用 / Effects: 更新 / updates `this.queue`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => {}).then(work);
    this.queue = result;
    return result;
  }
  /**
   * 入口 / Entry: OperationResults.load.
   * 功能：在保存操作执行与响应阶段的持久回执中，执行此领域的具体处理步骤并返回其结果；本入口产生 `cached` / `loaded` 供上层消费（`OperationResults`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationResults`; this entry produces `cached` / `loaded` for its caller. Module context: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
   * 处理：通过 `this.inventories.get`, `this.poolDirectory`, `regularDirectory`, `mkdir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.inventories.get`, `this.poolDirectory`, `regularDirectory`, `mkdir`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `cached`; `++scanned > maxRecords * 2 + 3`; `!/^[a-f0-9-]{36}\.json$/.test(entry.name)`.
   * 输入 / Inputs: pool: OperationResultPool default='normal'
   * 输出 / Returns: `cached`; `loaded`.
   * 副作用 / Effects: `mkdir`; `ids.push`; `this.inventories.set`; 更新 / updates `truncated`, `offset`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
    /**
     * 入口 / Entry: OperationResults.load.readEntry.
     * 功能：在保存操作执行与响应阶段的持久回执中，读取或核对领域状态并构造调用方可消费的结果；完成下述调用及状态处理（`OperationResults`）。
     * Purpose: Reads/verifies domain state and constructs a caller-facing result in `OperationResults`; the calls and state transitions below complete the operation. Module context: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
     * 处理：通过 `inventory.set`, `this.read`, `blocked.add`, `evidence.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `inventory.set`, `this.read`, `blocked.add`, `evidence.has`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `!evidence.has(id)`.
     * 输入 / Inputs: id: string
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `inventory.set`; `blocked.add`; `evidence.set`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 失败处理：catch 分支执行 `blocked.add(id);`; `if (!evidence.has(id)) { try { const raw = await this.raw(id, pool, true); evidence.set(id, { digest: operationReceiptDigest(…`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `blocked.add(id);`; `if (!evidence.has(id)) { try { const raw = await this.raw(id, pool, true); evidence.set(id, { digest: operationReceiptDigest(…`; these statements determine whether a failure is absorbed or rejected again.
     */
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
  /**
   * 入口 / Entry: OperationResults.read.
   * 功能：在保存操作执行与响应阶段的持久回执中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `receipt` 供上层消费（`OperationResults`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `OperationResults`; this entry produces `receipt` for its caller. Module context: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
   * 处理：通过 `operationReceiptId`, `regularDirectory`, `this.poolDirectory`, `this.file` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `operationReceiptId`, `regularDirectory`, `this.poolDirectory`, `this.file`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!directoryChecked`.
   * 输入 / Inputs: id: string; pool: OperationResultPool default='normal'; directoryChecked: default=false; observeRaw: (raw: Buffer) => void optional
   * 输出 / Returns: Promise<Receipt>；结果来自 / values from `receipt`.
   * 副作用 / Effects: `observeRaw`; `handle.close`; 更新 / updates `id`.
   * 拒绝 / Refusals: 条件 / conditions `!info.isFile() || info.isSymbolicLink() || info.size > maxRecordBytes`; `bytesRead > maxRecordBytes`; `receipt.correlationId !== id`; 异常 / errors `new AppError('操作结果记录不可用', 503, 'OPERATION_RESULT_UNAVAILABLE')`; `new AppError('操作结果记录标识不一致', 503, 'OPERATION_RESULT_UNAVAILABLE')`.
   * 收尾：退出 try 区域时始终执行 `await handle.close();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `await handle.close();`; these steps also apply to exceptional exits.
   */
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
  /**
   * 入口 / Entry: OperationResults.start.
   * 功能：在保存操作执行与响应阶段的持久回执中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { const pool = options.pool || (options.management ? 'management' : 'normal'); const state = await th…` 供上层消费（`OperationResults`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationResults`; this entry produces `this.serial(async () => { const pool = options.pool || (options.management ? 'management' : 'normal'); const state = await th…` for its caller. Module context: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
   * 处理：通过 `operationReceiptId`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `operationReceiptId`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: correlationId: string; operationId: string; sessionKey: string; actorId: string optional; options: { pool?: OperationResultPool; management?: boolean } default={}
   * 输出 / Returns: `this.serial(async () => { const pool = options.pool || (options.management ? 'management' : 'normal'); const state = await th…`.
   * 副作用 / Effects: 更新 / updates `correlationId`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async start(correlationId: string, operationId: string, sessionKey: string, actorId?: string,
    options: { pool?: OperationResultPool; management?: boolean } = {}) {
    correlationId = operationReceiptId(correlationId);
    /**
     * 入口 / Entry: OperationResults.start.callback@164.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `receipt`.
     * 副作用 / Effects: `unlink`; `inventory.delete`; `state.evidence.delete`; `this.locations.delete`; `this.locations.set`.
     * 拒绝 / Refusals: 条件 / conditions `state.truncated`; `inventory.size + state.blocked.size >= maxRecords`; `existing`; 异常 / errors `new AppError('操作結果目录超过可诊断上限，请先归档', 503, 'OPERATION_RESULTS_FULL')`; `new AppError('未确认操作结果达到目录上限', 503, 'OPERATION_RESULTS_FULL')`.
     * 失败处理：catch 分支执行 `this.locations.delete(correlationId);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `this.locations.delete(correlationId);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
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
  /**
   * 入口 / Entry: OperationResults.run.
   * 功能：把本层请求转交 `withAuditFailureObserver`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `withAuditFailureObserver` and propagates the provider result or rejection.
   * 输入 / Inputs: receipt: Receipt; work: () => T
   * 输出 / Returns: `withAuditFailureObserver(() => failedAudit.add(receipt), () => context.run(receipt, work))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  run<T>(receipt: Receipt, work: () => T) {
    return withAuditFailureObserver(() => failedAudit.add(receipt),
      () => withOperationReceipt(receipt.correlationId, () => context.run(receipt, work)));
  }
  /** 业务执行前先持久化开始标志；进程中断后以 unknown 保留可能已产生效果的证据。 */
  /**
   * 入口 / Entry: OperationResults.begin.
   * 功能：在保存操作执行与响应阶段的持久回执中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `receipt.outcome`, `receipt.executed`（`OperationResults`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationResults`; the outcome is recorded in `receipt.outcome`, `receipt.executed`. Module context: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
   * 处理：通过 `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: receipt: Receipt
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `receipt.outcome`, `receipt.executed`.
   * 拒绝 / Refusals: 异常 / errors `new AppError('无法持久化操作开始标志', 503, 'OPERATION_RESULT_UNAVAILABLE')`.
   * 失败处理：catch 分支执行 `receipt.outcome = 'failed';`; `receipt.executed = false;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `receipt.outcome = 'failed';`; `receipt.executed = false;`; these statements determine whether a failure is absorbed or rejected again.
   */
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
  /**
   * 入口 / Entry: OperationResults.queryable.
   * 功能：从当前输入或状态计算 `!!receipt.actorId || receipt.sessionKey === 'local-owner'`，供调用方后续验证或使用。
   * Purpose: Computes `!!receipt.actorId || receipt.sessionKey === 'local-owner'` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: receipt: Receipt
   * 输出 / Returns: `!!receipt.actorId || receipt.sessionKey === 'local-owner'`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  queryable(receipt: Receipt) {
    return !!receipt.actorId || receipt.sessionKey === 'local-owner';
  }
  /**
   * 入口 / Entry: OperationResults.auditFailed.
   * 功能：从当前输入或状态计算 `failedAudit.has(receipt)`，供调用方后续验证或使用。
   * Purpose: Computes `failedAudit.has(receipt)` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: receipt: Receipt
   * 输出 / Returns: `failedAudit.has(receipt)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  auditFailed(receipt: Receipt) { return failedAudit.has(receipt); }
  /** 捕获路径显式传入 failed，因为 JavaScript 也能 throw undefined，不能仅凭错误值判断失败。 */
  /**
   * 入口 / Entry: OperationResults.finish.
   * 功能：在保存操作执行与响应阶段的持久回执中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.public(receipt)` 供上层消费（`OperationResults`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationResults`; this entry produces `this.public(receipt)` for its caller. Module context: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
   * 处理：通过 `operationRefusedBeforeEffect`, `failedAudit.has`, `auditFailure`, `publicApiFailure` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `operationRefusedBeforeEffect`, `failedAudit.has`, `auditFailure`, `publicApiFailure`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `failed && receipt.outcome !== 'succeeded' && operationRefusedBeforeEffect(error, receipt.operationId…`; `receipt.outcome === 'pending'`; `failed`.
   * 输入 / Inputs: receipt: Receipt; error: unknown optional; sent: boolean optional; retainActive: default=false; failed: default=error !== undefined
   * 输出 / Returns: `this.public(receipt)`.
   * 副作用 / Effects: `this.active.delete`; 更新 / updates `receipt.finishedAt`, `receipt.outcome`, `receipt.executed`, `receipt.auditRecorded`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `if (!retainActive) this.active.delete(receipt.correlationId);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `if (!retainActive) this.active.delete(receipt.correlationId);`; these steps also apply to exceptional exits.
   */
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
  /**
   * 入口 / Entry: OperationResults.public.
   * 功能：从当前输入或状态计算 `result`，供调用方后续验证或使用。
   * Purpose: Computes `result` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: receipt: Receipt
   * 输出 / Returns: OperationResult；结果来自 / values from `result`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private public(receipt: Receipt): OperationResult {
    const { actorId: _actor, sessionKey: _session, ...result } = receipt;
    return result;
  }
  /**
   * 入口 / Entry: OperationResults.raw.
   * 功能：在保存操作执行与响应阶段的持久回执中，执行此领域的具体处理步骤并返回其结果；本入口产生 `buffer.subarray(0, bytesRead)` 供上层消费（`OperationResults`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationResults`; this entry produces `buffer.subarray(0, bytesRead)` for its caller. Module context: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
   * 处理：通过 `regularDirectory`, `this.poolDirectory`, `lstat`, `this.file` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `regularDirectory`, `this.poolDirectory`, `lstat`, `this.file`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!directoryChecked`.
   * 输入 / Inputs: id: string; pool: OperationResultPool; directoryChecked: default=false
   * 输出 / Returns: `buffer.subarray(0, bytesRead)`.
   * 副作用 / Effects: `handle.close`.
   * 拒绝 / Refusals: 条件 / conditions `!info.isFile() || info.isSymbolicLink() || info.size > OPERATION_ARCHIVE_LIMITS.maxRecordBytes`; `bytesRead > OPERATION_ARCHIVE_LIMITS.maxRecordBytes`; 异常 / errors `new AppError('原回执类型或大小无法安全归档，证据已保留', 503, 'OPERATION_ARCHIVE_UNAVAILABLE')`; `new AppError('原回执超过归档字节上限', 503, 'OPERATION_ARCHIVE_UNAVAILABLE')`.
   * 收尾：退出 try 区域时始终执行 `await handle.close();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `await handle.close();`; these steps also apply to exceptional exits.
   */
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
  /**
   * 入口 / Entry: OperationResults.diagnostics.
   * 功能：在保存操作执行与响应阶段的持久回执中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `this.serial(async () => { await check(); const archive = await this.archives.diagnostics(); const records: OperationResultDir…` 供上层消费（`OperationResults`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `OperationResults`; this entry produces `this.serial(async () => { await check(); const archive = await this.archives.diagnostics(); const records: OperationResultDir…` for its caller. Module context: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
   * 处理：通过 `captureOperationCheck`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `captureOperationCheck`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<OperationResultDirectory>；结果来自 / values from `this.serial(async () => { await check(); const archive = await this.archives.diagnostics(); const records: OperationResultDir…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  diagnostics(): Promise<OperationResultDirectory> {
    const check = captureOperationCheck();
    /**
     * 入口 / Entry: OperationResults.diagnostics.callback@272.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ version: 1, pools: summaries, records, archive }`.
     * 副作用 / Effects: `this.inventories.delete`; `summaries.push`; `records.push`; 更新 / updates `inventory`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 失败处理：catch 分支执行 `summaries.push({ pool, maxRecords: OPERATION_RESULT_LIMITS[pool], recordCount: 0, blockedCount: 0, truncated: false, full: tr…`; `continue;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `summaries.push({ pool, maxRecords: OPERATION_RESULT_LIMITS[pool], recordCount: 0, blockedCount: 0, truncated: false, full: tr…`; `continue;`; these statements determine whether a failure is absorbed or rejected again.
     */
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
  /**
   * 入口 / Entry: OperationResults.archive.
   * 功能：在保存操作执行与响应阶段的持久回执中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { await check(); if (authority.role !== 'owner' || !['account', 'local-owner'].includes(authority.ses…` 供上层消费（`OperationResults`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationResults`; this entry produces `this.serial(async () => { await check(); if (authority.role !== 'owner' || !['account', 'local-owner'].includes(authority.ses…` for its caller. Module context: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
   * 处理：通过 `operationResultArchiveRequest.parse`, `captureOperationCheck`, `operationReceiptId`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `operationResultArchiveRequest.parse`, `captureOperationCheck`, `operationReceiptId`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown; authority: OperationArchiveAuthority
   * 输出 / Returns: Promise<OperationResultArchive>；结果来自 / values from `this.serial(async () => { await check(); if (authority.role !== 'owner' || !['account', 'local-owner'].includes(authority.ses…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  archive(input: unknown, authority: OperationArchiveAuthority): Promise<OperationResultArchive> {
    const parsed = operationResultArchiveRequest.parse(input), check = captureOperationCheck();
    const request = { ...parsed, correlationId: operationReceiptId(parsed.correlationId) };
    /**
     * 入口 / Entry: OperationResults.archive.callback@314.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ correlationId: prior.correlationId, pool: prior.pool, digest: prior.digest, archivedAt: prior.archivedAt, reason: prior.rea…`; `{ correlationId: archived.correlationId, pool: archived.pool, digest: archived.digest, archivedAt: archived.archivedAt, reaso…`.
     * 副作用 / Effects: `unlink`; `this.inventories.delete`; `this.locations.delete`; 更新 / updates `raw`, `pool`.
     * 拒绝 / Refusals: 条件 / conditions `authority.role !== 'owner' || !['account', 'local-owner'].includes(authority.sessionKey) || (authority.sessionKey === 'accoun…`; `this.active.has(request.correlationId)`; `(error as NodeJS.ErrnoException).code !== 'ENOENT'`; 异常 / errors `new AppError('仅管理员可归档操作结果', 403, 'OPERATION_RESULT_FORBIDDEN')`; `new AppError('操作仍在执行，不能归档', 409, 'OPERATION_RESULT_ACTIVE')`.
     * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
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
  /**
   * 入口 / Entry: OperationResults.get.
   * 功能：在保存操作执行与响应阶段的持久回执中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `this.public({ ...receipt, ...(!receipt.finishedAt ? { outcome: 'unknown' as const } : {}), ...(receipt.delivery === 'pending'…` / `this.public(receipt)` 供上层消费（`OperationResults`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `OperationResults`; this entry produces `this.public({ ...receipt, ...(!receipt.finishedAt ? { outcome: 'unknown' as const } : {}), ...(receipt.delivery === 'pending'…` / `this.public(receipt)` for its caller. Module context: Persists execution/response receipts, distinguishing business admission, response validation and audit failures.
   * 处理：通过 `operationReceiptId`, `this.read`, `this.archives.read`, `receiptSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `operationReceiptId`, `this.read`, `this.archives.read`, `receiptSchema.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!found`; `archived`; `!this.active.has(id)`.
   * 输入 / Inputs: id: string; sessionKey: string; actorId: string optional
   * 输出 / Returns: `this.public({ ...receipt, ...(!receipt.finishedAt ? { outcome: 'unknown' as const } : {}), ...(receipt.delivery === 'pending'…`; `this.public(receipt)`.
   * 副作用 / Effects: 更新 / updates `id`, `found`, `receipt`.
   * 拒绝 / Refusals: 条件 / conditions `(error as NodeJS.ErrnoException).code !== 'ENOENT'`; `!found`; `found.correlationId !== id`; 异常 / errors `error`; `new AppError('操作结果不存在', 404, 'OPERATION_RESULT_NOT_FOUND')`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError('操作结果不存在', 404, 'OPERATION_RESULT_NOT_FOUND');`; `if (error instanceof AppError) throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError('操作结果不存在', 404, 'OPERATION_RESULT_NOT_FOUND');`; `if (error instanceof AppError) throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
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
