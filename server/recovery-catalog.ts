/**
 * 模块职责：聚合领域恢复来源和持久索引，重试或重建前核对原记录摘要与当前领域证据。
 * Module purpose: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
 */
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, open, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import {
  recoveryBinding,
  recoveryRecord,
  recoveryRequest,
  recoveryRebuildRequest,
  type RecoveryBinding,
  type RecoveryRecord,
  type RecoveryView,
  type RecoveryDiagnostics,
  type RecoveryCatalogView,
} from '../shared/contracts/recovery.ts';
import { fileHash, writeStore } from './local-store.ts';
import { withNewResourceContext, withResourceContext } from './host-runtime/context.ts';
import { captureOperationCheck, withoutOperationContext } from './operation-context.ts';
import { withoutPluginAuthority } from './plugin-authority.ts';

export type RecoveryCandidate = {
  binding: RecoveryBinding;
  /** Revision of the original domain ticket, included in the management compare-and-swap. */
  ticketRevision?: string;
  error?: string;
  resourceIds: string[];
  actions: readonly { id: string; title: string }[];
};
export type RecoverySource = {
  id: string;
  /**
   * 签名 / Signature: RecoverySource.discover.
   * 功能：为聚合领域恢复来源和持久索引声明 discover 的输入与结果契约，所属容器为 RecoverySource。
   * Purpose: Declares the input/result contract for discover in RecoverySource. Module responsibility: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<RecoveryCandidate[]> | RecoveryCandidate[].
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  discover(): Promise<RecoveryCandidate[]> | RecoveryCandidate[];
  /** Must confirm the original domain ticket. This directory has no budget release capability. */
  /**
   * 签名 / Signature: RecoverySource.recover.
   * 功能：为聚合领域恢复来源和持久索引声明 recover 的输入与结果契约，所属容器为 RecoverySource。
   * Purpose: Declares the input/result contract for recover in RecoverySource. Module responsibility: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
   * 输入 / Inputs: candidate: RecoveryCandidate; action: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  recover?(candidate: RecoveryCandidate, action: string): Promise<void>;
  /**
   * 签名 / Signature: RecoverySource.confirmed.
   * 功能：为聚合领域恢复来源和持久索引声明 confirmed 的输入与结果契约，所属容器为 RecoverySource。
   * Purpose: Declares the input/result contract for confirmed in RecoverySource. Module responsibility: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
   * 输入 / Inputs: record: RecoveryRecord
   * 输出 / Returns: boolean | Promise<boolean>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  confirmed?(record: RecoveryRecord): boolean | Promise<boolean>;
};
/**
 * 入口 / Entry: checksum.
 * 功能：在聚合领域恢复来源和持久索引中，核对调用资格、输入或资源归属；本入口产生 `createHash('sha256').update(JSON.stringify(value)).digest('hex')` 供上层消费（`recovery-catalog.ts`）。
 * Purpose: Checks admission, input or resource ownership in `recovery-catalog.ts`; this entry produces `createHash('sha256').update(JSON.stringify(value)).digest('hex')` for its caller. Module context: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: unknown
 * 输出 / Returns: string；结果来自 / values from `createHash('sha256').update(JSON.stringify(value)).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const checksum = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/**
 * 入口 / Entry: control.
 * 功能：把本层请求转交 `withoutOperationContext`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `withoutOperationContext` and propagates the provider result or rejection.
 * 输入 / Inputs: work: () => T
 * 输出 / Returns: T；结果来自 / values from `withoutOperationContext(() => withoutPluginAuthority(() => withNewResourceContext({ owner: 'core:recovery' }, work)), )`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const control = <T>(work:
/**
 * 中文功能：在恢复控制上下文执行并返回泛型结果的同步工作。
 * English: Synchronous work executing in recovery-control context and returning its generic result.
 * 所属 / Owner: control.work.
 * 输入 / Inputs: 无显式参数 / no explicit parameters.
 * 结果 / Result: `T`.
 */
() => T): T =>
  withoutOperationContext(() =>
    withoutPluginAuthority(() => withNewResourceContext({ owner: 'core:recovery' }, work)),
  );
export const RECOVERY_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxRecords: 4096,
  resolvedRetention: 256,
});
const envelope = z
  .object({
    version: z.literal(1),
    records: z.array(recoveryRecord).max(RECOVERY_LIMITS.maxRecords),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

/** A durable index of domain receipts, not a replacement for their cleanup authority. */
export class RecoveryCatalog {
  private sources = new Map<string, RecoverySource>();
  private records = new Map<string, RecoveryRecord>();
  private candidates = new Map<string, RecoveryCandidate>();
  private queue: Promise<unknown> = Promise.resolve();
  private initialized = false;
  private lastSaved?: string;
  private closed = false;
  private closing?: Promise<void>;
  private fault?: { code: string; message: string };
  private sourceFailures: string[] = [];
  private quarantineFile?: string;
  private revision = randomUUID();
  /**
   * 入口 / Entry: RecoveryCatalog.constructor.
   * 功能：建立 RecoveryCatalog 的聚合领域恢复来源和持久索引上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the RecoveryCatalog context for this module's responsibility: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: file: string; activeResources: () => readonly { id: string }[]
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private file: string,
    private activeResources: () => readonly { id: string }[],
  ) {}
  /**
   * 入口 / Entry: RecoveryCatalog.register.
   * 功能：在聚合领域恢复来源和持久索引中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`RecoveryCatalog`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RecoveryCatalog`; the calls and state transitions below complete the operation. Module context: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
   * 处理：通过 `this.sources.has`, `this.sources.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.sources.has`, `this.sources.set`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: source: RecoverySource
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.sources.set`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.sources.has(source.id)`; `source.recover && !source.confirmed`; 异常 / errors `new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED')`; `new Error('重复恢复领域：' + source.id)`.
   */
  register(source: RecoverySource) {
    if (this.closed) throw new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED');
    if (this.sources.has(source.id)) throw new Error('重复恢复领域：' + source.id);
    if (source.recover && !source.confirmed)
      throw new Error('可执行恢复领域必须提供原票据确认：' + source.id);
    this.sources.set(source.id, source);
  }
  /**
   * 入口 / Entry: RecoveryCatalog.init.
   * 功能：在聚合领域恢复来源和持久索引中，初始化并核对当前领域状态；处理结果记录到 `this.records`, `this.initialized`（`RecoveryCatalog`）。
   * Purpose: Initializes and verifies current domain state in `RecoveryCatalog`; the outcome is recorded in `this.records`, `this.initialized`. Module context: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
   * 处理：通过 `lstat().catch`, `lstat`, `info.isFile`, `info.isSymbolicLink` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `lstat().catch`, `lstat`, `info.isFile`, `info.isSymbolicLink`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `loaded.set`; 更新 / updates `saved`, `this.records`, `this.initialized`.
   * 拒绝 / Refusals: 条件 / conditions `info`; `!info.isFile() || info.isSymbolicLink() || info.size > RECOVERY_LIMITS.maxBytes`; `bytes.byteLength > RECOVERY_LIMITS.maxBytes`; 异常 / errors `new AppError('恢复目录类型或大小无效', 503, 'RECOVERY_CORRUPT')`; `new AppError('恢复目录超过读取容量', 503, 'RECOVERY_CORRUPT')`.
   * 失败处理：catch 分支执行 `this.degrade(error);`; `throw new AppError('恢复目录 JSON 损坏', 503, 'RECOVERY_CORRUPT');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.degrade(error);`; `throw new AppError('恢复目录 JSON 损坏', 503, 'RECOVERY_CORRUPT');`; these statements determine whether a failure is absorbed or rejected again.
   */
  async init() {
    try {
      const info = await lstat(this.file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      });
      if (info) {
        if (!info.isFile() || info.isSymbolicLink() || info.size > RECOVERY_LIMITS.maxBytes)
          throw new AppError('恢复目录类型或大小无效', 503, 'RECOVERY_CORRUPT');
        const bytes = await readFile(this.file);
        if (bytes.byteLength > RECOVERY_LIMITS.maxBytes)
          throw new AppError('恢复目录超过读取容量', 503, 'RECOVERY_CORRUPT');
        let saved: unknown;
        try {
          saved = JSON.parse(bytes.toString('utf8'));
        } catch {
          throw new AppError('恢复目录 JSON 损坏', 503, 'RECOVERY_CORRUPT');
        }
        const parsed = envelope.safeParse(saved);
        if (!parsed.success || checksum(parsed.data.records) !== parsed.data.digest)
          throw new AppError('恢复目录校验失败', 503, 'RECOVERY_CORRUPT');
        const loaded = new Map<string, RecoveryRecord>();
        for (const record of parsed.data.records) {
          if (record.id !== checksum(record.binding) || loaded.has(record.id))
            throw new AppError('恢复记录身份不匹配', 503, 'RECOVERY_CORRUPT');
          loaded.set(record.id, record.state === 'attempting' ? { ...record, state: 'pending' } : record);
        }
        this.records = loaded;
      }
    } catch (error) {
      this.degrade(error);
    }
    this.initialized = true;
    await this.refresh();
  }
  /**
   * 入口 / Entry: RecoveryCatalog.degrade.
   * 功能：在聚合领域恢复来源和持久索引中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.fault`（`RecoveryCatalog`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RecoveryCatalog`; the outcome is recorded in `this.fault`. Module context: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
   * 输入 / Inputs: error: unknown
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.fault`.
   */
  private degrade(error: unknown) {
    const code = error instanceof AppError ? error.code : undefined;
    this.fault ||= {
      code: code || 'RECOVERY_STORAGE_UNAVAILABLE',
      message:
        code === 'RECOVERY_CAPACITY'
          ? '恢复目录容量不足，未覆盖原文件；请先通过所属服务处理待恢复票据。'
          : code === 'RECOVERY_SOURCE_UNAVAILABLE'
            ? '部分原领域无法完成核验，目录只读；请恢复领域服务后重建。'
            : '恢复目录不可用，原文件已保留；可隔离原文件并根据原领域票据重建。',
    };
  }
  /**
   * 入口 / Entry: RecoveryCatalog.diagnostics.
   * 功能：在聚合领域恢复来源和持久索引中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ state: this.fault ? 'degraded' : 'healthy', ...this.fault, revision: checksum({ revision: this.revision, fault: this.fault,…` 供上层消费（`RecoveryCatalog`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `RecoveryCatalog`; this entry produces `{ state: this.fault ? 'degraded' : 'healthy', ...this.fault, revision: checksum({ revision: this.revision, fault: this.fault,…` for its caller. Module context: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
   * 处理：通过 `checksum`, `this.sources.keys` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `checksum`, `this.sources.keys`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: RecoveryDiagnostics；结果来自 / values from `{ state: this.fault ? 'degraded' : 'healthy', ...this.fault, revision: checksum({ revision: this.revision, fault: this.fault,…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  diagnostics(): RecoveryDiagnostics {
    return {
      state: this.fault ? 'degraded' : 'healthy',
      ...this.fault,
      revision: checksum({
        revision: this.revision,
        fault: this.fault,
        sources: [...this.sources.keys()],
        sourceFailures: this.sourceFailures,
        saved: this.lastSaved,
      }),
      ...RECOVERY_LIMITS,
      recordCount: this.records.size,
      sourceFailures: [...this.sourceFailures],
      quarantineFile: this.quarantineFile,
    };
  }
  /**
   * 入口 / Entry: RecoveryCatalog.assertHealthy.
   * 功能：在聚合领域恢复来源和持久索引中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`RecoveryCatalog`）。
   * Purpose: Checks admission, input or resource ownership in `RecoveryCatalog`; the calls and state transitions below complete the operation. Module context: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.fault`; 异常 / errors `new AppError('恢复目录处于只读降级状态，请先诊断并重建', 503, 'RECOVERY_DEGRADED')`.
   */
  private assertHealthy() {
    if (this.fault) throw new AppError('恢复目录处于只读降级状态，请先诊断并重建', 503, 'RECOVERY_DEGRADED');
  }
  /**
   * 入口 / Entry: RecoveryCatalog.serial.
   * 功能：在聚合领域恢复来源和持久索引中，执行此领域的具体处理步骤并返回其结果；本入口产生 `pending` 供上层消费（`RecoveryCatalog`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RecoveryCatalog`; this entry produces `pending` for its caller. Module context: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
   * 处理：通过 `this.queue.catch().then`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.queue.catch().then`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `pending`.
   * 副作用 / Effects: 更新 / updates `this.queue`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>) {
    const pending = this.queue.catch(() => {}).then(work);
    this.queue = pending;
    return pending;
  }
  /**
   * 入口 / Entry: RecoveryCatalog.publication.
   * 功能：在聚合领域恢复来源和持久索引中，执行此领域的具体处理步骤并返回其结果；本入口产生 `value` 供上层消费（`RecoveryCatalog`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RecoveryCatalog`; this entry produces `value` for its caller. Module context: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
   * 处理：通过 `inline.filter().sort`, `inline.filter`, `this.records.values`, `resolved.slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.filter().sort`, `inline.filter`, `this.records.values`, `resolved.slice`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `value`.
   * 副作用 / Effects: `this.records.delete`.
   * 拒绝 / Refusals: 条件 / conditions `records.length > RECOVERY_LIMITS.maxRecords || Buffer.byteLength(JSON.stringify(value, null, 2)) > RECOVERY_LIMITS.maxBytes`; 异常 / errors `new AppError('恢复目录达到持久容量上限', 503, 'RECOVERY_CAPACITY')`.
   */
  private publication() {
    const resolved = [...this.records.values()]
      .filter((record) => record.state === 'resolved')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    for (const record of resolved.slice(RECOVERY_LIMITS.resolvedRetention)) this.records.delete(record.id);
    const records = [...this.records.values()];
    const digest = checksum(records);
    const value = { version: 1 as const, records, digest };
    // writeStore uses this exact UTF-8 representation. A published file must be readable next boot.
    if (
      records.length > RECOVERY_LIMITS.maxRecords ||
      Buffer.byteLength(JSON.stringify(value, null, 2)) > RECOVERY_LIMITS.maxBytes
    )
      throw new AppError('恢复目录达到持久容量上限', 503, 'RECOVERY_CAPACITY');
    envelope.parse(value);
    return value;
  }
  /**
   * 入口 / Entry: RecoveryCatalog.save.
   * 功能：在聚合领域恢复来源和持久索引中，校验并提交领域状态变更；本入口产生 `void` 供上层消费（`RecoveryCatalog`）。
   * Purpose: Validates and commits a domain state change in `RecoveryCatalog`; this entry produces `void` for its caller. Module context: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
   * 处理：通过 `this.publication`, `control` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.publication`, `control`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.lastSaved === digest`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `this.lastSaved`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save() {
    const value = this.publication(),
      { digest } = value;
    if (this.lastSaved === digest) return;
    // Publication is a cleanup receipt. Request revocation cannot invalidate already completed cleanup.
    await control(() => writeStore(this.file, value));
    this.lastSaved = digest;
  }
  /**
   * 入口 / Entry: RecoveryCatalog.discover.
   * 功能：读取所有登记领域的原恢复票据，合并索引状态并限制保留记录数量。
   * Purpose: Reads registered domains' original recovery tickets, merges catalogue state and bounds retained records.
   * 设计：领域证据决定 resolved，缺失票据不能推断成功；重复身份、摘要变化及扫描上限保留可诊断异常。
   * Design: Domain evidence determines resolution, not absence; duplicates/digest changes/discovery bounds remain diagnosable.
   * 输入 / Inputs: readonly: default=false
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `next.delete`; `sizes.delete`; `sizes.set`; `next.set`; `current.set`; 更新 / updates `this.sourceFailures`, `bytes`, `this.records`, `this.candidates`.
   * 拒绝 / Refusals: 条件 / conditions `!this.initialized`; `binding.domain !== source.id`; `!terminal`; 异常 / errors `new Error('恢复目录尚未初始化')`; `new Error('恢复领域声明不匹配')`.
   * 失败处理：catch 分支执行 `this.sourceFailures.push(source.id);`; `if (error instanceof AppError && error.code === 'RECOVERY_CAPACITY') throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.sourceFailures.push(source.id);`; `if (error instanceof AppError && error.code === 'RECOVERY_CAPACITY') throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async discover(readonly = false) {
    if (!this.initialized) throw new Error('恢复目录尚未初始化');
    const current = new Map<string, RecoveryCandidate>();
    const next = new Map([...this.records].map(([id, record]) => [id, structuredClone(record)]));
    const resolved = [...next.values()]
      .filter((record) => record.state === 'resolved')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    for (const record of resolved.slice(RECOVERY_LIMITS.resolvedRetention)) next.delete(record.id);
    this.sourceFailures = [];
    // Keep memory bounded too: indented record bytes are the same bytes used by writeStore.
    /**
     * 入口 / Entry: RecoveryCatalog.discover.recordBytes.
     * 功能：从当前输入或状态计算 `Buffer.byteLength(JSON.stringify(record, null, 2).replace(/^/gm, ' ')) + 2`，供调用方后续验证或使用。
     * Purpose: Computes `Buffer.byteLength(JSON.stringify(record, null, 2).replace(/^/gm, ' ')) + 2` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: record: RecoveryRecord
     * 输出 / Returns: `Buffer.byteLength(JSON.stringify(record, null, 2).replace(/^/gm, ' ')) + 2`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    const recordBytes = (record: RecoveryRecord) =>
      Buffer.byteLength(JSON.stringify(record, null, 2).replace(/^/gm, '    ')) + 2;
    const sizes = new Map([...next].map(([id, record]) => [id, recordBytes(record)]));
    let bytes = [...sizes.values()].reduce((sum, value) => sum + value, 160);
    for (const source of this.sources.values()) {
      try {
        for (const candidate of await source.discover()) {
          const binding = recoveryBinding.parse(candidate.binding);
          if (binding.domain !== source.id) throw new Error('恢复领域声明不匹配');
          const id = checksum(binding),
            prior = next.get(id),
            now = new Date().toISOString();
          const resourceIds = [...new Set(candidate.resourceIds)].sort();
          const ticketRevision = recoveryRecord.shape.ticketRevision.parse(candidate.ticketRevision);
          const discoveryError = recoveryRecord.shape.discoveryError.parse(candidate.error);
          const normalized = { ...candidate, binding, resourceIds };
          const changed =
            !prior ||
            prior.state === 'resolved' ||
            JSON.stringify(prior.resourceIds) !== JSON.stringify(resourceIds) ||
            prior.ticketRevision !== ticketRevision ||
            prior.discoveryError !== discoveryError;
          const record = recoveryRecord.parse(
            prior
              ? {
                  ...prior,
                  resourceIds,
                  ticketRevision,
                  discoveryError,
                  state: prior.state === 'resolved' ? 'pending' : prior.state,
                  updatedAt: changed ? now : prior.updatedAt,
                }
              : {
                  id,
                  binding,
                  ticketRevision,
                  resourceIds,
                  state: 'pending',
                  firstSeenAt: now,
                  updatedAt: now,
                  attempts: 0,
                  discoveryError,
                },
          );
          const size = recordBytes(record),
            delta = size - (sizes.get(id) || 0);
          while (
            next.size + (prior ? 0 : 1) > RECOVERY_LIMITS.maxRecords ||
            bytes + delta > RECOVERY_LIMITS.maxBytes
          ) {
            const terminal = [...next.values()]
              .filter((value) => value.state === 'resolved' && value.id !== id)
              .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
            if (!terminal) throw new AppError('恢复目录达到持久容量上限', 503, 'RECOVERY_CAPACITY');
            bytes -= sizes.get(terminal.id) || 0;
            sizes.delete(terminal.id);
            next.delete(terminal.id);
          }
          bytes += delta;
          sizes.set(id, size);
          next.set(id, record);
          current.set(id, normalized);
        }
      } catch (error) {
        this.sourceFailures.push(source.id);
        if (error instanceof AppError && error.code === 'RECOVERY_CAPACITY') throw error;
      }
    }
    if (this.sourceFailures.length) throw new AppError('原领域发现失败', 503, 'RECOVERY_SOURCE_UNAVAILABLE');
    this.records = next;
    this.candidates = current;
    if (readonly) return;
    const active = new Set(this.activeResources().map((resource) => resource.id));
    for (const record of this.records.values()) {
      if (
        record.state === 'resolved' ||
        current.has(record.id) ||
        record.resourceIds.some((id) => active.has(id))
      )
        continue;
      if (await this.sources.get(record.binding.domain)?.confirmed?.(record)) {
        record.state = 'resolved';
        record.error = undefined;
        record.updatedAt = new Date().toISOString();
      }
    }
    await this.save();
  }
  /**
   * 入口 / Entry: RecoveryCatalog.refresh.
   * 功能：在聚合领域恢复来源和持久索引中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Promise.reject(new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED'))` / `this.serial(async () => { try { await this.discover(!!this.fault); } catch (error) { this.degrade(error); } return this.view(…` 供上层消费（`RecoveryCatalog`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RecoveryCatalog`; this entry produces `Promise.reject(new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED'))` / `this.serial(async () => { try { await this.discover(!!this.fault); } catch (error) { this.degrade(error); } return this.view(…` for its caller. Module context: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
   * 处理：通过 `Promise.reject`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.reject`, `this.serial`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `Promise.reject(new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED'))`; `this.serial(async () => { try { await this.discover(!!this.fault); } catch (error) { this.degrade(error); } return this.view(…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  refresh() {
    if (this.closed) return Promise.reject(new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED'));
    return this.serial(async () => {
      try {
        await this.discover(!!this.fault);
      } catch (error) {
        this.degrade(error);
      }
      return this.view();
    });
  }
  /**
   * 入口 / Entry: RecoveryCatalog.view.
   * 功能：在聚合领域恢复来源和持久索引中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `[...this.records.values()].map((record) => { const candidate = this.candidates.get(record.id), source = this.sources.get(reco…` 供上层消费（`RecoveryCatalog`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `RecoveryCatalog`; this entry produces `[...this.records.values()].map((record) => { const candidate = this.candidates.get(record.id), source = this.sources.get(reco…` for its caller. Module context: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
   * 处理：通过 `inline.map`, `this.records.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.map`, `this.records.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: RecoveryView[]；结果来自 / values from `[...this.records.values()].map((record) => { const candidate = this.candidates.get(record.id), source = this.sources.get(reco…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(): RecoveryView[] {
    /**
     * 入口 / Entry: RecoveryCatalog.view.callback@291.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline.map）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline.map).
     * 输入 / Inputs: record
     * 输出 / Returns: `{ ...structuredClone(record), error: record.error || record.discoveryError, digest: checksum(record), available, actions: ava…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return [...this.records.values()].map((record) => {
      const candidate = this.candidates.get(record.id),
        source = this.sources.get(record.binding.domain);
      const available =
        !this.fault &&
        record.state !== 'resolved' &&
        !!candidate &&
        !!source?.recover &&
        candidate.actions.length > 0;
      return {
        ...structuredClone(record),
        error: record.error || record.discoveryError,
        digest: checksum(record),
        available,
        actions: available ? candidate!.actions.map((action) => ({ ...action })) : [],
      };
    });
  }
  /**
   * 入口 / Entry: RecoveryCatalog.retry.
   * 功能：在聚合领域恢复来源和持久索引中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Promise.reject(new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED'))` / `this.serial(async () => { if (this.closed) throw new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED'); this.assertHealthy(); awai…` 供上层消费（`RecoveryCatalog`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RecoveryCatalog`; this entry produces `Promise.reject(new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED'))` / `this.serial(async () => { if (this.closed) throw new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED'); this.assertHealthy(); awai…` for its caller. Module context: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
   * 处理：通过 `Promise.reject`, `recoveryRequest.parse`, `captureOperationCheck`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.reject`, `recoveryRequest.parse`, `captureOperationCheck`, `this.serial`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `Promise.reject(new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED'))`; `this.serial(async () => { if (this.closed) throw new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED'); this.assertHealthy(); awai…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  retry(input: unknown) {
    if (this.closed) return Promise.reject(new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED'));
    const request = recoveryRequest.parse(input);
    const check = captureOperationCheck();
    /**
     * 入口 / Entry: RecoveryCatalog.retry.callback@313.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view().find((item) => item.id === record.id)!`.
     * 副作用 / Effects: `this.save`; 更新 / updates `record.state`, `record.updatedAt`, `record.error`.
     * 拒绝 / Refusals: 条件 / conditions `this.closed`; `!record || !candidate || record.state === 'resolved'`; `checksum(record) !== request.digest`; 异常 / errors `new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED')`; `error`.
     * 失败处理：catch 分支执行 `this.degrade(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `this.degrade(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.serial(async () => {
      if (this.closed) throw new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED');
      this.assertHealthy();
      await check();
      try {
        await this.discover();
      } catch (error) {
        this.degrade(error);
        throw error;
      }
      const record = this.records.get(request.id),
        candidate = this.candidates.get(request.id);
      if (!record || !candidate || record.state === 'resolved')
        throw new AppError('原恢复票据当前不可用', 409, 'RECOVERY_UNAVAILABLE');
      if (checksum(record) !== request.digest)
        throw new AppError('恢复记录已变化，请刷新后重试', 409, 'RECOVERY_STALE');
      const source = this.sources.get(record.binding.domain)!;
      if (!source.recover || !candidate.actions.some((action) => action.id === request.action))
        throw new AppError('领域未提供此恢复动作', 403, 'RECOVERY_ACTION_DENIED');
      await check();
      record.state = 'attempting';
      record.attempts++;
      record.updatedAt = new Date().toISOString();
      try {
        await this.save();
      } catch (error) {
        this.degrade(error);
        throw error;
      }
      try {
        await check();
        // Domain retries can perform new work (for example, re-copying a migration).
        // Keep request revocation active; only original domain cleanup receipts may detach from it.
        await withResourceContext({ ...record.binding, recoveryId: record.id }, () =>
          source.recover!(candidate, request.action),
        );
        // A successful callback alone is insufficient while original resources remain registered.
        const active = new Set(this.activeResources().map((resource) => resource.id));
        if (record.resourceIds.some((id) => active.has(id)) || !(await source.confirmed?.(record)))
          throw new AppError('原资源尚未确认核销', 503, 'RECOVERY_CLEANUP_PENDING');
        record.state = 'resolved';
        record.error = undefined;
      } catch (error) {
        record.state = 'pending';
        record.error = String(error).slice(0, 1024);
        record.updatedAt = new Date().toISOString();
        try {
          await this.save();
        } catch (storageError) {
          this.degrade(storageError);
        }
        throw error;
      }
      record.updatedAt = new Date().toISOString();
      try {
        await this.save();
      } catch (error) {
        this.degrade(error);
        throw error;
      }
      return this.view().find((item) => item.id === record.id)!;
    });
  }
  /** Rebuild only the index. Domain budgets, original receipts and VM fences are never modified here. */
  /**
   * 入口 / Entry: RecoveryCatalog.rebuild.
   * 功能：在聚合领域恢复来源和持久索引中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { if (this.closed) throw new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED'); if (!this.initialized) thr…` 供上层消费（`RecoveryCatalog`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RecoveryCatalog`; this entry produces `this.serial(async () => { if (this.closed) throw new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED'); if (!this.initialized) thr…` for its caller. Module context: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
   * 处理：通过 `recoveryRebuildRequest.parse`, `captureOperationCheck`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `recoveryRebuildRequest.parse`, `captureOperationCheck`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<RecoveryCatalogView>；结果来自 / values from `this.serial(async () => { if (this.closed) throw new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED'); if (!this.initialized) thr…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  rebuild(input: unknown): Promise<RecoveryCatalogView> {
    const request = recoveryRebuildRequest.parse(input),
      check = captureOperationCheck();
    /**
     * 入口 / Entry: RecoveryCatalog.rebuild.callback@380.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ version: 1, records: this.view(), diagnostics: this.diagnostics() }`.
     * 副作用 / Effects: `backup.close`; 更新 / updates `this.quarantineFile`, `this.lastSaved`, `this.fault`, `this.revision`.
     * 拒绝 / Refusals: 条件 / conditions `this.closed`; `!this.initialized`; `request.revision !== this.diagnostics().revision`; 异常 / errors `new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED')`; `new AppError('恢复目录尚未初始化', 503, 'RECOVERY_UNAVAILABLE')`.
     * 收尾：退出 try 区域时始终执行 `await backup.close();`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `await backup.close();`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `this.degrade(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `this.degrade(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.serial(async () => {
      if (this.closed) throw new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED');
      if (!this.initialized) throw new AppError('恢复目录尚未初始化', 503, 'RECOVERY_UNAVAILABLE');
      await check();
      if (request.revision !== this.diagnostics().revision)
        throw new AppError('目录诊断已变化，请刷新后重试', 409, 'RECOVERY_STALE');
      try {
        // A discovery-only pass cannot resolve a receipt, even if a source claims confirmation.
        await this.discover(true);
        const value = this.publication();
        await check();
        const info = await lstat(this.file).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return undefined;
        });
        if (info) {
          if (!info.isFile() || info.isSymbolicLink())
            throw new AppError('恢复目录路径必须是普通文件，请先修复路径', 503, 'RECOVERY_CORRUPT');
          const isolated = this.file + '.quarantine-' + randomUUID();
          await control(() => copyFile(this.file, isolated, constants.COPYFILE_EXCL));
          this.quarantineFile = basename(isolated);
          const backup = await open(isolated, 'r+');
          try {
            await backup.sync();
          } finally {
            await backup.close();
          }
          // Detect changes during copying. The data-directory owner excludes other controllers;
          // operators must keep arbitrary external writers stopped throughout rebuilding.
          if ((await fileHash(isolated)) !== (await fileHash(this.file)))
            throw new AppError('隔离期间目录发生变化，原文件未覆盖', 409, 'RECOVERY_STALE');
        }
        await check();
        await control(() => writeStore(this.file, value));
        this.lastSaved = value.digest;
        this.fault = undefined;
        this.revision = randomUUID();
        return { version: 1, records: this.view(), diagnostics: this.diagnostics() };
      } catch (error) {
        this.degrade(error);
        throw error;
      }
    });
  }
  /**
   * 入口 / Entry: RecoveryCatalog.close.
   * 功能：在聚合领域恢复来源和持久索引中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.closing` / `pending` 供上层消费（`RecoveryCatalog`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `RecoveryCatalog`; this entry produces `this.closing` / `pending` for its caller. Module context: Aggregates domain recovery sources and durable indexes, checking original digests/current evidence before retry or rebuild.
   * 处理：通过 `this.serial`, `pending.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.serial`, `pending.catch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closing`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>；结果来自 / values from `this.closing`; `pending`.
   * 副作用 / Effects: 更新 / updates `this.closed`, `this.closing`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    /**
     * 入口 / Entry: RecoveryCatalog.close.callback@427.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `this.initialized`; 异常 / errors `error`.
     * 失败处理：catch 分支执行 `this.degrade(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `this.degrade(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    const pending = this.serial(async () => {
      if (this.initialized) {
        // A diagnosed read-only index owns no native resources. Shutdown must not turn its known
        // storage fault into a fictitious cleanup lease, or attempt to overwrite the evidence.
        if (this.fault) return;
        try {
          await control(() => this.discover());
        } catch (error) {
          this.degrade(error);
          throw error;
        }
      }
    });
    this.closing = pending;
    void pending.catch(() => {
      if (this.closing === pending) this.closing = undefined;
    });
    return pending;
  }
}
