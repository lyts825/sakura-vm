/**
 * 模块职责：记录操作跨度与带校验封印的审计日志；读取时核对完整性，结束记录保留原操作身份。
 * Module purpose: Records operation spans and sealed audit logs; validates integrity on read and retains original identities for terminal records.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readFile, stat, writeFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { z, ZodError } from 'zod';
import { DATA } from './paths.ts';
import { AppError } from '../shared/errors.ts';
import { readStore, writeStore } from './local-store.ts';
import { resourceContext, withResourceContext, withNewResourceContext } from './host-runtime/context.ts';
import { withoutOperationContext, reportAuditFailure } from './operation-context.ts';
import { withoutPluginAuthority } from './plugin-authority.ts';
import { runtimeTimings } from './runtime-timings.ts';

const hex = z.string().regex(/^[a-f0-9]{64}$/);
const eventSchema = z
  .object({
    time: z.iso.datetime(),
    kind: z.enum(['request', 'job', 'connection']),
    phase: z.enum(['start', 'end']),
    traceId: z.string().regex(/^[a-f0-9]{32}$/),
    spanId: z.string().regex(/^[a-f0-9]{16}$/),
    parentSpanId: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .optional(),
    name: z.string().min(1).max(200),
    vmId: z.uuid().optional(),
    projectId: z.string().max(32).optional(),
    status: z.number().int().min(0).max(599).optional(),
    jobId: z.uuid().optional(),
    actorId: z.uuid().optional(),
    pluginId: z.string().min(1).max(200).optional(),
    pluginInstanceId: z.string().min(1).max(200).optional(),
    pluginGeneration: z.string().min(1).max(200).optional(),
    operationId: z.string().min(1).max(200).optional(),
    recoveryId: z.string().min(1).max(200).optional(),
    durationMs: z.number().nonnegative().optional(),
  })
  .strict();
const recordSchema = z
  .object({ sequence: z.number().int().positive(), previous: hex, event: eventSchema, hash: hex })
  .strict();
export type AuditEvent = z.infer<typeof eventSchema>;
export type AuditRecord = z.infer<typeof recordSchema>;
type TraceContext = Pick<AuditEvent, 'traceId' | 'spanId' | 'parentSpanId'>;
const context = new AsyncLocalStorage<TraceContext>();
const auditFailures = new WeakMap<object, unknown>();
/** Preserve the original business exception even when its end record cannot be written. */
/**
 * 入口 / Entry: auditFailure.
 * 功能：从当前输入或状态计算 `error !== null && typeof error === 'object' ? auditFailures.get(error) : undefined`，供调用方后续验证或使用。
 * Purpose: Computes `error !== null && typeof error === 'object' ? auditFailures.get(error) : undefined` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: error: unknown
 * 输出 / Returns: `error !== null && typeof error === 'object' ? auditFailures.get(error) : undefined`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const auditFailure = (error: unknown) => error !== null && typeof error === 'object'
  ? auditFailures.get(error) : undefined;
/**
 * 入口 / Entry: withoutAuditParent.
 * 功能：把本层请求转交 `context.exit`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `context.exit` and propagates the provider result or rejection.
 * 输入 / Inputs: work: () => T
 * 输出 / Returns: T；结果来自 / values from `context.exit(work)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function withoutAuditParent<T>(work: () => T): T { return context.exit(work); }
const zero = '0'.repeat(64);

export class AuditLog {
  private queue: Promise<unknown> = Promise.resolve();
  private key?: Buffer;
  private cached?: { sequence: number; hash: string; bytes: number; mtime: number };
  /**
   * 入口 / Entry: AuditLog.constructor.
   * 功能：建立 AuditLog 的记录操作跨度与带校验封印的审计日志上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the AuditLog context for this module's responsibility: Records operation spans and sealed audit logs; validates integrity on read and retains original identities for terminal records. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: directory: default=join(DATA, 'audit')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private directory = join(DATA, 'audit')) {}
  /**
   * 入口 / Entry: AuditLog.file.
   * 功能：把本层请求转交 `join`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `join` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `join(this.directory, 'events.jsonl')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private file() {
    return join(this.directory, 'events.jsonl');
  }
  /**
   * 入口 / Entry: AuditLog.secret.
   * 功能：在记录操作跨度与带校验封印的审计日志中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.key` 供上层消费（`AuditLog`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AuditLog`; this entry produces `this.key` for its caller. Module context: Records operation spans and sealed audit logs; validates integrity on read and retains original identities for terminal records.
   * 处理：通过 `mkdir`, `join`, `readFile`, `stat().catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `mkdir`, `join`, `readFile`, `stat().catch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.key`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.key`.
   * 副作用 / Effects: `mkdir`; `writeFile`; 更新 / updates `this.key`.
   * 拒绝 / Refusals: 条件 / conditions `(error as NodeJS.ErrnoException).code !== 'ENOENT'`; `(await stat(this.file()).catch(() => null)) || (await stat(join(this.directory, 'seal.json')).catch(() => null))`; `this.key.length !== 32`; 异常 / errors `error`; `new AppError('审计密钥缺失，请从备份恢复')`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; `if ( (await stat(this.file()).catch(() => null)) || (await stat(join(this.directory, 'seal.json')).catch(() => null)) ) throw…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; `if ( (await stat(this.file()).catch(() => null)) || (await stat(join(this.directory, 'seal.json')).catch(() => null)) ) throw…`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async secret() {
    if (this.key) return this.key;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, 'key');
    try {
      this.key = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (
        (await stat(this.file()).catch(() => null)) ||
        (await stat(join(this.directory, 'seal.json')).catch(() => null))
      )
        throw new AppError('审计密钥缺失，请从备份恢复');
      await writeFile(path, randomBytes(32), { flag: 'wx', mode: 0o600, flush: true });
      this.key = await readFile(path);
    }
    if (this.key.length !== 32) throw new AppError('审计校验密钥损坏');
    return this.key;
  }
  /**
   * 入口 / Entry: AuditLog.signature.
   * 功能：在记录操作跨度与带校验封印的审计日志中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHmac('sha256', await this.secret()) .update(JSON.stringify(value)) .digest('hex')` 供上层消费（`AuditLog`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AuditLog`; this entry produces `createHmac('sha256', await this.secret()) .update(JSON.stringify(value)) .digest('hex')` for its caller. Module context: Records operation spans and sealed audit logs; validates integrity on read and retains original identities for terminal records.
   * 处理：通过 `createHmac().update().digest`, `createHmac().update`, `createHmac`, `this.secret` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `createHmac().update().digest`, `createHmac().update`, `createHmac`, `this.secret`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: value: unknown
   * 输出 / Returns: `createHmac('sha256', await this.secret()) .update(JSON.stringify(value)) .digest('hex')`.
   * 副作用 / Effects: `createHmac().update().digest`; `createHmac().update`; `createHmac`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async signature(value: unknown) {
    return createHmac('sha256', await this.secret())
      .update(JSON.stringify(value))
      .digest('hex');
  }
  /**
   * 入口 / Entry: AuditLog.seal.
   * 功能：在记录操作跨度与带校验封印的审计日志中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`AuditLog`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AuditLog`; the calls and state transitions below complete the operation. Module context: Records operation spans and sealed audit logs; validates integrity on read and retains original identities for terminal records.
   * 处理：通过 `writeStore`, `join`, `this.signature` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `writeStore`, `join`, `this.signature`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: sequence: number; hash: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async seal(sequence: number, hash: string) {
    await writeStore(join(this.directory, 'seal.json'), {
      sequence,
      hash,
      mac: await this.signature(['seal', sequence, hash]),
    });
  }
  /**
   * 入口 / Entry: AuditLog.serial.
   * 功能：在记录操作跨度与带校验封印的审计日志中，执行此领域的具体处理步骤并返回其结果；本入口产生 `next` 供上层消费（`AuditLog`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AuditLog`; this entry produces `next` for its caller. Module context: Records operation spans and sealed audit logs; validates integrity on read and retains original identities for terminal records.
   * 处理：通过 `this.queue.catch().then`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.queue.catch().then`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `next`.
   * 副作用 / Effects: 更新 / updates `this.queue`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(work);
    this.queue = next;
    return next;
  }
  /**
   * 入口 / Entry: AuditLog.scan.
   * 功能：在记录操作跨度与带校验封印的审计日志中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ valid: true as const, sequence, hash, records, bytes: info?.size || 0 }` 供上层消费（`AuditLog`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AuditLog`; this entry produces `{ valid: true as const, sequence, hash, records, bytes: info?.size || 0 }` for its caller. Module context: Records operation spans and sealed audit logs; validates integrity on read and retains original identities for terminal records.
   * 处理：通过 `this.secret`, `stat().catch`, `stat`, `this.file` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.secret`, `stat().catch`, `stat`, `this.file`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `anchor?.sequence === sequence`; `pinned?.sequence === sequence`; `limit && (!vmId || entry.event.vmId === vmId)`.
   * 输入 / Inputs: limit: number; vmId: string optional; pinned: { sequence: number; hash: string } optional
   * 输出 / Returns: `{ valid: true as const, sequence, hash, records, bytes: info?.size || 0 }`.
   * 副作用 / Effects: `handle.close`; `createReadStream`; `createInterface`; `records.push`; `records.shift`; 更新 / updates `sequence`, `hash`, `anchored`, `pinnedMatch`.
   * 拒绝 / Refusals: 条件 / conditions `info && (!info.isFile() || info.size > 128 * 1024 ** 2)`; `anchor && (anchor.mac !== (await this.signature(['seal', anchor.sequence, anchor.hash])) || !Number.isSafeInteger(anchor.sequ…`; `info`; 异常 / errors `new AppError('审计日志类型或大小超过限制')`; `new AppError('审计封印校验失败')`.
   * 收尾：退出 try 区域时始终执行 `await handle.close();`; `lines.close();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `await handle.close();`; `lines.close();`; these steps also apply to exceptional exits.
   */
  private async scan(limit: number, vmId?: string,
    pinned?: { sequence: number; hash: string }) {
    await this.secret();
    const info = await stat(this.file()).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isFile() || info.size > 128 * 1024 ** 2))
      throw new AppError('审计日志类型或大小超过限制');
    const anchor = await readStore<{ sequence: number; hash: string; mac: string } | null>(
      join(this.directory, 'seal.json'),
      () => null,
    );
    if (
      anchor &&
      (anchor.mac !== (await this.signature(['seal', anchor.sequence, anchor.hash])) ||
        !Number.isSafeInteger(anchor.sequence) ||
        anchor.sequence < 0)
    )
      throw new AppError('审计封印校验失败');
    let sequence = 0,
      hash = zero,
      anchored = !anchor || (anchor.sequence === 0 && anchor.hash === zero),
      pinnedMatch = !pinned || (pinned.sequence === 0 && pinned.hash === zero);
    const records: AuditRecord[] = [];
    if (info) {
      if (info.size) {
        const handle = await open(this.file(), 'r');
        try {
          const last = Buffer.alloc(1);
          await handle.read(last, 0, 1, info.size - 1);
          if (last[0] !== 10) throw new AppError('审计日志最后一条记录截断');
        } finally {
          await handle.close();
        }
      }
      const input = createReadStream(this.file()),
        lines = createInterface({ input, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (!line || line.length > 8192) throw new AppError('审计记录截断或超过长度限制');
          const entry = recordSchema.parse(JSON.parse(line));
          if (
            entry.sequence !== sequence + 1 ||
            entry.previous !== hash ||
            entry.hash !== (await this.signature([entry.sequence, entry.previous, entry.event]))
          )
            throw new AppError('审计日志链校验失败：第 ' + (sequence + 1) + ' 条');
          sequence = entry.sequence;
          hash = entry.hash;
          if (anchor?.sequence === sequence) anchored = anchor.hash === hash;
          if (pinned?.sequence === sequence) pinnedMatch = pinned.hash === hash;
          if (limit && (!vmId || entry.event.vmId === vmId)) {
            records.push(entry);
            if (records.length > limit) records.shift();
          }
        }
      } finally {
        lines.close();
        input.destroy();
      }
    }
    if (!anchored || (anchor && anchor.sequence > sequence) || (sequence && !anchor))
      throw new AppError('审计日志被截断或缺少封印');
    if (!pinnedMatch) throw new AppError('本地审计链不包含远程锚点摘要');
    // A complete authenticated append may survive a crash before its seal write.
    this.cached = { sequence, hash, bytes: info?.size || 0, mtime: info?.mtimeMs || 0 };
    return { valid: true as const, sequence, hash, records, bytes: info?.size || 0 };
  }
  /**
   * 入口 / Entry: AuditLog.read.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: limit: default=200; vmId: string optional; pinned: { sequence: number; hash: string } optional
   * 输出 / Returns: `this.serial(async () => { try { return await this.scan(Math.max(0, Math.min(2000, limit)), vmId, pinned); } catch (error) { t…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async read(limit = 200, vmId?: string, pinned?: { sequence: number; hash: string }) {
    return this.serial(async () => {
      try {
        return await this.scan(Math.max(0, Math.min(2000, limit)), vmId, pinned);
      } catch (error) {
        this.cached = undefined;
        return { valid: false as const, records: [], error: '审计日志校验失败，请检查本机审计存储' };
      }
    });
  }
  /**
   * 入口 / Entry: AuditLog.record.
   * 功能：在记录操作跨度与带校验封印的审计日志中，执行此领域的具体处理步骤并返回其结果；本入口产生 `runtimeTimings.measure(event.kind === 'job' ? 'job' : 'http', 'audit', () => withoutOperationContext(() => withoutPluginAutho…` 供上层消费（`AuditLog`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AuditLog`; this entry produces `runtimeTimings.measure(event.kind === 'job' ? 'job' : 'http', 'audit', () => withoutOperationContext(() => withoutPluginAutho…` for its caller. Module context: Records operation spans and sealed audit logs; validates integrity on read and retains original identities for terminal records.
   * 处理：通过 `eventSchema.parse`, `runtimeTimings.measure` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `eventSchema.parse`, `runtimeTimings.measure`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: value: AuditEvent
   * 输出 / Returns: `runtimeTimings.measure(event.kind === 'job' ? 'job' : 'http', 'audit', () => withoutOperationContext(() => withoutPluginAutho…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  record(value: AuditEvent) {
    const event = eventSchema.parse(value);
    // Identities were captured before the operation. Its durable end record must
    // survive a successful logout or another operation revoking its own authority.
    /**
     * 入口 / Entry: AuditLog.record.callback@188.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `entry`.
     * 副作用 / Effects: 更新 / updates `this.cached`.
     * 拒绝 / Refusals: 条件 / conditions `this.cached!.bytes > 128 * 1024 ** 2 - 8192`; 异常 / errors `new AppError('审计存储已达到 128 MiB 上限，请归档后维护数据目录')`; `new AppError('审计写入失败：' + (error as Error).message, 503, 'AUDIT_UNAVAILABLE')`.
     * 失败处理：catch 分支执行 `this.cached = undefined;`; `throw new AppError('审计写入失败：' + (error as Error).message, 503, 'AUDIT_UNAVAILABLE');`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `this.cached = undefined;`; `throw new AppError('审计写入失败：' + (error as Error).message, 503, 'AUDIT_UNAVAILABLE');`; these statements determine whether a failure is absorbed or rejected again.
     */
    return runtimeTimings.measure(event.kind === 'job' ? 'job' : 'http', 'audit', () =>
      withoutOperationContext(() => withoutPluginAuthority(() =>
        withNewResourceContext({ owner: 'core:audit' }, () => this.serial(
        /**
         * 中文功能：在串行写入中复核审计缓存，构造前序哈希和签名链，追加并封印记录后更新缓存；失败清空缓存并返回 503。
         * English: Rechecks the audit cache during serialized writing, builds the prior-hash/signature chain, appends/seals the record and updates cache; failure clears cache and reports 503.
         * 所属 / Owner: AuditLog.record.
         * 输入 / Inputs: 无显式参数 / no explicit parameters.
         */
        async () => {
      try {
        const info = await stat(this.file()).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        });
        if (
          !this.cached ||
          (info?.size || 0) !== this.cached.bytes ||
          (info?.mtimeMs || 0) !== this.cached.mtime
        )
          await this.scan(0);
        const previous = this.cached!.hash,
          sequence = this.cached!.sequence + 1;
        if (this.cached!.bytes > 128 * 1024 ** 2 - 8192)
          throw new AppError('审计存储已达到 128 MiB 上限，请归档后维护数据目录');
        if (sequence === 1) await this.seal(0, zero);
        const entry: AuditRecord = {
          sequence,
          previous,
          event,
          hash: await this.signature([sequence, previous, event]),
        };
        await appendFile(this.file(), JSON.stringify(entry) + '\n', { mode: 0o600, flush: true });
        await this.seal(sequence, entry.hash);
        const saved = await stat(this.file());
        this.cached = { sequence, hash: entry.hash, bytes: saved.size, mtime: saved.mtimeMs };
        return entry;
      } catch (error) {
        this.cached = undefined;
        throw new AppError('审计写入失败：' + (error as Error).message, 503, 'AUDIT_UNAVAILABLE');
      }
    })))));
  }
  /**
   * 入口 / Entry: AuditLog.span.
   * 功能：在记录操作跨度与带校验封印的审计日志中，执行此领域的具体处理步骤并返回其结果；本入口产生 `context.run(span, async () => { let code = 500; let businessFailure: unknown; let failed = false; try { const result = await …` 供上层消费（`AuditLog`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AuditLog`; this entry produces `context.run(span, async () => { let code = 500; let businessFailure: unknown; let failed = false; try { const result = await …` for its caller. Module context: Records operation spans and sealed audit logs; validates integrity on read and retains original identities for terminal records.
   * 处理：通过 `context.getStore`, `resourceContext`, `performance.now`, `randomBytes().toString` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `context.getStore`, `resourceContext`, `performance.now`, `randomBytes().toString`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: event: Pick<AuditEvent, 'kind' | 'name' | 'vmId' | 'projectId' | 'jobId' | 'actorId' | 'plug…; work: () => Promise<T>; status: () => number default=() => 200
   * 输出 / Returns: `context.run(span, async () => { let code = 500; let businessFailure: unknown; let failed = false; try { const result = await …`.
   * 副作用 / Effects: 更新 / updates `event`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `reportAuditFailure();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `reportAuditFailure();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async span<T>(
    event: Pick<AuditEvent, 'kind' | 'name' | 'vmId' | 'projectId' | 'jobId' | 'actorId' |
      'pluginId' | 'pluginInstanceId' | 'pluginGeneration' | 'operationId' | 'recoveryId'>,
    work: () => Promise<T>,
    status: () => number = () => 200,
  ) {
    const parent = context.getStore();
    const identity = resourceContext();
    event = {
      actorId: identity?.actorId, vmId: identity?.vmId, projectId: identity?.projectId,
      jobId: identity?.jobId,
      pluginId: identity?.pluginId, pluginInstanceId: identity?.pluginInstanceId,
      pluginGeneration: identity?.pluginGeneration, operationId: identity?.operationId,
      recoveryId: identity?.recoveryId, ...event,
    };
    const started = performance.now();
    const span: TraceContext = {
      traceId: parent?.traceId || randomBytes(16).toString('hex'),
      spanId: randomBytes(8).toString('hex'),
      ...(parent ? { parentSpanId: parent.spanId } : {}),
    };
    try { await this.record({ ...event, ...span, time: new Date().toISOString(), phase: 'start' }); }
    catch (error) { reportAuditFailure(); throw error; }
    /**
     * 入口 / Entry: AuditLog.span.callback@245.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（context.run）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (context.run).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `result`.
     * 副作用 / Effects: `auditFailures.set`; 更新 / updates `code`, `failed`, `businessFailure`.
     * 拒绝 / Refusals: 条件 / conditions `!failed`; 异常 / errors `error`.
     * 收尾：退出 try 区域时始终执行 `try { await this.record({ ...event, ...span, time: new Date().toISOString(), phase: 'end', status: code, durationMs: Math.max…`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `try { await this.record({ ...event, ...span, time: new Date().toISOString(), phase: 'end', status: code, durationMs: Math.max…`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `failed = true;`; `businessFailure = error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `failed = true;`; `businessFailure = error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return context.run(span, async () => {
      let code = 500;
      let businessFailure: unknown;
      let failed = false;
      try {
        const result = await withResourceContext({
          traceId: span.traceId, spanId: span.spanId, actorId: event.actorId,
          vmId: event.vmId, projectId: event.projectId, jobId: event.jobId,
        }, work);
        code = status();
        return result;
      } catch (error) {
        failed = true;
        businessFailure = error;
        code =
          error instanceof AppError
            ? error.status
            : error instanceof ZodError
              ? 400
              : error instanceof Error && error.name === 'AbortError'
                ? 499
                : 500;
        throw error;
      } finally {
        try {
          await this.record({ ...event, ...span, time: new Date().toISOString(), phase: 'end', status: code,
            durationMs: Math.max(0, performance.now() - started) });
        } catch (error) {
          reportAuditFailure();
          if (!failed) throw error;
          if (businessFailure !== null && typeof businessFailure === 'object') {
            auditFailures.set(businessFailure, error);
            try {
              if (Object.isExtensible(businessFailure)) Object.defineProperty(businessFailure, 'auditFailure', {
                value: error, configurable: true, enumerable: false,
              });
            } catch { /* The WeakMap remains authoritative for frozen or pre-existing properties. */ }
          }
        }
      }
    });
  }
  /**
   * 入口 / Entry: AuditLog.close.
   * 功能：在记录操作跨度与带校验封印的审计日志中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`AuditLog`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `AuditLog`; the calls and state transitions below complete the operation. Module context: Records operation spans and sealed audit logs; validates integrity on read and retains original identities for terminal records.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  async close() {
    await this.queue;
  }
}

let current: AuditLog | undefined;
/**
 * 入口 / Entry: hostAudit.
 * 功能：在记录操作跨度与带校验封印的审计日志中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(current ||= new AuditLog())` 供上层消费（`audit.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `audit.ts`; this entry produces `(current ||= new AuditLog())` for its caller. Module context: Records operation spans and sealed audit logs; validates integrity on read and retains original identities for terminal records.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `(current ||= new AuditLog())`.
 * 副作用 / Effects: 更新 / updates `current`.
 */
export function hostAudit() {
  return (current ||= new AuditLog());
}
/**
 * 入口 / Entry: traceExport.
 * 功能：在记录操作跨度与带校验封印的审计日志中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ resourceSpans: [ { resource: { attributes: [{ key: 'service.name', value: { stringValue: 'sakura' } }] }, scopeSpans: [{ sc…` 供上层消费（`audit.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `audit.ts`; this entry produces `{ resourceSpans: [ { resource: { attributes: [{ key: 'service.name', value: { stringValue: 'sakura' } }] }, scopeSpans: [{ sc…` for its caller. Module context: Records operation spans and sealed audit logs; validates integrity on read and retains original identities for terminal records.
 * 处理：通过 `starts.set`, `starts.get`, `spans.push`, `BigInt` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `starts.set`, `starts.get`, `spans.push`, `BigInt`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `event.phase === 'start'`; `!start`.
 * 输入 / Inputs: records: AuditRecord[]
 * 输出 / Returns: `{ resourceSpans: [ { resource: { attributes: [{ key: 'service.name', value: { stringValue: 'sakura' } }] }, scopeSpans: [{ sc…`.
 * 副作用 / Effects: `starts.set`; `starts.get`; `spans.push`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function traceExport(records: AuditRecord[]) {
  const starts = new Map<string, AuditEvent>(),
    spans: Record<string, unknown>[] = [];
  for (const record of records) {
    const event = record.event,
      key = event.traceId + ':' + event.spanId;
    if (event.phase === 'start') {
      starts.set(key, event);
      continue;
    }
    const start = starts.get(key);
    if (!start) continue;
    spans.push({
      traceId: event.traceId,
      spanId: event.spanId,
      parentSpanId: event.parentSpanId,
      name: event.name,
      kind: event.kind === 'request' ? 2 : 1,
      startTimeUnixNano: String(BigInt(Date.parse(start.time)) * 1000000n),
      endTimeUnixNano: String(BigInt(Date.parse(event.time)) * 1000000n),
      attributes: [
        { key: 'sakura.kind', value: { stringValue: event.kind } },
        ...(event.vmId ? [{ key: 'sakura.vm.id', value: { stringValue: event.vmId } }] : []),
        ...(event.jobId ? [{ key: 'sakura.job.id', value: { stringValue: event.jobId } }] : []),
        ...(['projectId', 'pluginId', 'pluginInstanceId', 'pluginGeneration', 'operationId', 'recoveryId'] as const)
          .flatMap(key => event[key] ? [{ key: 'sakura.' + key, value: { stringValue: event[key] } }] : []),
      ],
      status: { code: (event.status || 0) >= 400 ? 2 : 1 },
    });
  }
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'sakura' } }] },
        scopeSpans: [{ scope: { name: 'sakura.controller', version: '1' }, spans }],
      },
    ],
  };
}
