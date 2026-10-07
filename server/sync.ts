/**
 * 模块职责：协调宿主与客户机双向同步、冲突和回滚，基于原文件版本与检查点验证变更。
 * Module purpose: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
 */
import type { ProjectCatalogV1 } from './service-contracts/v1.ts';
import { projectMetadataFile } from './project-catalog.ts';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, readdir, realpath, mkdir, rename, readFile, writeFile, rm, link } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep, dirname, posix } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { vmDir, VM_ROOT } from './paths.ts';
import { ftpStat, mutablePath, preserveFileMetadata } from './files.ts';
import { Jobs } from './jobs.ts';
import { domainRecoveryTicketSchema, type DomainRecoveryTicket } from '../shared/contracts/domain-recovery.ts';
import { recoveryTicketRevision } from './recovery-origin.ts';
import { readRecoveryJson, recoveryDirectories, invalidRecoveryTicket } from './domain-recovery-files.ts';
import type { VmAccess as Machines } from './vm-access.ts';

import { threeWayMerge, resolvedMerge } from '../shared/three-way-merge.ts';
import { inMaintenance, timeWindowSchema } from './automation-policy.ts';
import { withinWindow } from '../shared/time-windows.ts';
import { metadataFile, replaceMetadata } from './metadata-store.ts';
import { ByteRate } from './byte-rate.ts';
import {
  matchesSyncPattern,
  syncPattern,
  syncPolicySchema,
  syncMergeDriverSchema,
  mergeDriver,
  type SyncMergeDriver,
  policyAllows,
  pathPolicy,
  detectSyncRenames,
} from '../shared/sync-policy.ts';
import { SyncHistory, syncCheckpointSchema, type SyncSide, type SyncCheckpoint } from './sync-history.ts';
import {
  storageRuntime,
  storageGrowth,
  removeStorageTemporary,
  type StorageLease,
} from './storage-runtime.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';
import { SyncWatchers } from './sync-watch.ts';

export const syncSchema = z
  .object({
    host: z.string().max(4096),
    guest: z
      .string()
      .refine((value) => {
        try {
          mutablePath(value);
          return true;
        } catch {
          return false;
        }
      }, '需要有效的非根目录路径')
      .transform(mutablePath),
    auto: z.boolean().default(false),
    mergeText: z.boolean().optional(),
    detectRenames: z.boolean().optional(),
    rollback: z.boolean().optional(),
    watch: z.boolean().optional(),
    policies: z.array(syncPolicySchema).max(64).optional(),
    drivers: z.array(syncMergeDriverSchema).max(64).optional(),
    window: timeWindowSchema.optional(),
    bandwidthMiBps: z
      .number()
      .min(0)
      .max(10240)
      .refine((value) => value === 0 || value >= 0.1)
      .optional(),
    ignore: z.array(syncPattern).max(64).optional(),
  })
  .strict();
export type SyncConfig = z.infer<typeof syncSchema>;
const queueSchema = z
  .object({
    id: z.uuid(),
    requestedAt: z.iso.datetime(),
    attempts: z.number().int().min(0),
    nextAttemptAt: z.number().nonnegative(),
    jobId: z.uuid().optional(),
    lastError: z.string().optional(),
  })
  .strict();
export type SyncQueue = z.infer<typeof queueSchema>;
export type SyncChange = {
  path: string;
  from?: string;
  driver?: SyncMergeDriver['mode'];
  suggestedDecision?: 'skip' | 'push' | 'pull' | 'both' | 'merge';
  action:
    | 'push'
    | 'pull'
    | 'conflict'
    | 'mkdir-host'
    | 'mkdir-guest'
    | 'delete-host'
    | 'delete-guest'
    | 'rename-host'
    | 'rename-guest'
    | 'skip';
};
export type SyncPreview = { token: string; changes: SyncChange[]; unchanged: number };
export type SyncDecisions = Record<
  string,
  | 'push'
  | 'pull'
  | 'both'
  | 'skip'
  | 'merge'
  | 'manual'
  | 'delete-host'
  | 'delete-guest'
  | 'restore-host'
  | 'restore-guest'
>;
export type SyncManualMerges = Record<string, string>;

/**
 * 入口 / Entry: configuredDriver.
 * 功能：在协调宿主与客户机双向同步、冲突和回滚中，校验并提交领域状态变更；本入口产生 `null` / `{ driver: driver.mode, decision: permitted ? requested : ('skip' as const) }` 供上层消费（`sync.ts`）。
 * Purpose: Validates and commits a domain state change in `sync.ts`; this entry produces `null` / `{ driver: driver.mode, decision: permitted ? requested : ('skip' as const) }` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
 * 处理：通过 `mergeDriver`, `policyAllows` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `mergeDriver`, `policyAllows`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!driver`.
 * 输入 / Inputs: path: string; config: SyncConfig
 * 输出 / Returns: `null`; `{ driver: driver.mode, decision: permitted ? requested : ('skip' as const) }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function configuredDriver(path: string, config: SyncConfig) {
  const driver = mergeDriver(path, config.drivers);
  if (!driver) return null;
  const requested = {
    manual: 'skip',
    'keep-both': 'both',
    'prefer-host': 'push',
    'prefer-guest': 'pull',
    'merge-text': 'merge',
  }[driver.mode] as NonNullable<SyncChange['suggestedDecision']>;
  const permitted = requested === 'skip' || policyAllows(path, requested, config.policies);
  return { driver: driver.mode, decision: permitted ? requested : ('skip' as const) };
}

const SYNC_TEXT_BYTES = 1024 ** 2;
/**
 * 入口 / Entry: decodeSyncText.
 * 功能：在协调宿主与客户机双向同步、冲突和回滚中，转换协议或持久数据表示并保持调用边界；本入口产生 `new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)` 供上层消费（`sync.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `sync.ts`; this entry produces `new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
 * 处理：通过 `bytes.includes`, `TextDecoder.decode` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `bytes.includes`, `TextDecoder.decode`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: bytes: Buffer
 * 输出 / Returns: `new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `bytes.length > SYNC_TEXT_BYTES || bytes.includes(0)`; 异常 / errors `new AppError('三方同步只支持 1 MiB 以内的 UTF-8 文本')`; `new AppError('三方同步需要 UTF-8 文本')`.
 * 失败处理：catch 分支执行 `throw new AppError('三方同步需要 UTF-8 文本');`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `throw new AppError('三方同步需要 UTF-8 文本');`; these statements determine whether a failure is absorbed or rejected again.
 */
function decodeSyncText(bytes: Buffer) {
  if (bytes.length > SYNC_TEXT_BYTES || bytes.includes(0))
    throw new AppError('三方同步只支持 1 MiB 以内的 UTF-8 文本');
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new AppError('三方同步需要 UTF-8 文本');
  }
}
/**
 * 入口 / Entry: readSyncText.
 * 功能：在协调宿主与客户机双向同步、冲突和回滚中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `decodeSyncText(Buffer.concat(chunks))` 供上层消费（`sync.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `sync.ts`; this entry produces `decodeSyncText(Buffer.concat(chunks))` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
 * 处理：通过 `pipeline`, `decodeSyncText` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `pipeline`, `decodeSyncText`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: stream: Readable; signal: AbortSignal
 * 输出 / Returns: `decodeSyncText(Buffer.concat(chunks))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
async function readSyncText(stream: Readable, signal: AbortSignal) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  await pipeline(
    stream,
    new Writable({
      /**
       * 入口 / Entry: readSyncText.write.
       * 功能：在协调宿主与客户机双向同步、冲突和回滚中，校验并提交领域状态变更；完成下述调用及状态处理（`sync.ts`）。
       * Purpose: Validates and commits a domain state change in `sync.ts`; the calls and state transitions below complete the operation. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
       * 处理：通过 `done`, `chunks.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `done`, `chunks.push`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `bytes > SYNC_TEXT_BYTES`.
       * 输入 / Inputs: chunk: Buffer; _encoding; done
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `chunks.push`; 更新 / updates `bytes`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      write(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        if (bytes > SYNC_TEXT_BYTES) done(new AppError('三方同步只支持 1 MiB 以内的 UTF-8 文本'));
        else {
          chunks.push(Buffer.from(chunk));
          done();
        }
      },
    }),
    { signal },
  );
  return decodeSyncText(Buffer.concat(chunks));
}
export const ignored = matchesSyncPattern;
/**
 * 入口 / Entry: syncDirection.
 * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `'same'` / `'push'` 供上层消费（`sync.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `sync.ts`; this entry produces `'same'` / `'push'` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
 * 分支 / Branches: `host === guest`; `host && (!guest || previous === guest)`; `guest && (!host || previous === host)`.
 * 输入 / Inputs: host: string | undefined; guest: string | undefined; previous: string optional
 * 输出 / Returns: 'push' | 'pull' | 'conflict' | 'same'；结果来自 / values from `'same'`; `'push'`; `'pull'`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function syncDirection(
  host: string | undefined,
  guest: string | undefined,
  previous?: string,
): 'push' | 'pull' | 'conflict' | 'same' {
  if (host === guest) return 'same';
  if (host && (!guest || previous === guest)) return 'push';
  if (guest && (!host || previous === host)) return 'pull';
  return 'conflict';
}
const excluded = new Set(['.git', 'node_modules', '.data', '.tools', '.vendor']);
/**
 * 入口 / Entry: safeRelative.
 * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `path` 供上层消费（`sync.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `sync.ts`; this entry produces `path` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
 * 处理：通过 `path.split().some`, `path.split` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `path.split().some`, `path.split`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: path: string
 * 输出 / Returns: `path`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!path || path .split('/') .some( (p) => !p || p === '.' || p === '..' || /[\\<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) ||…`; 异常 / errors `new AppError('目录包含无法安全同步到 Windows 的文件名')`.
 */
export function safeRelative(path: string) {
  if (
    !path ||
    path
      .split('/')
      .some(
        (p) =>
          !p ||
          p === '.' ||
          p === '..' ||
          /[\\<>:"|?*\x00-\x1f]/.test(p) ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
      )
  )
    throw new AppError('目录包含无法安全同步到 Windows 的文件名');
  return path;
}
/**
 * 入口 / Entry: validateSyncPaths.
 * 功能：在协调宿主与客户机双向同步、冲突和回滚中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`sync.ts`）。
 * Purpose: Checks admission, input or resource ownership in `sync.ts`; the calls and state transitions below complete the operation. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
 * 处理：通过 `safeRelative().toLowerCase`, `safeRelative`, `names.get`, `names.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `safeRelative().toLowerCase`, `safeRelative`, `names.get`, `names.set`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: paths: Iterable<string>
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `names.set`.
 * 拒绝 / Refusals: 条件 / conditions `existing && existing !== path`; 异常 / errors `new AppError(`文件名在 Windows 上冲突，请先重命名：${existing} / ${path}`)`.
 */
export function validateSyncPaths(paths: Iterable<string>) {
  const names = new Map<string, string>();
  for (const path of paths) {
    const key = safeRelative(path).toLowerCase();
    const existing = names.get(key);
    if (existing && existing !== path)
      throw new AppError(`文件名在 Windows 上冲突，请先重命名：${existing} / ${path}`);
    names.set(key, path);
  }
}
/**
 * 入口 / Entry: hash.
 * 功能：从当前输入或状态计算 `new Promise<string>((resolve, reject) => { const digest = createHash('sha256'); let ended = false; const abort = () => stream…`，供调用方后续验证或使用。
 * Purpose: Computes `new Promise<string>((resolve, reject) => { const digest = createHash('sha256'); let ended = false; const abort = () => stream…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: stream: Readable; signal: AbortSignal
 * 输出 / Returns: `new Promise<string>((resolve, reject) => { const digest = createHash('sha256'); let ended = false; const abort = () => stream…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
async function hash(stream: Readable, signal: AbortSignal) {
  /**
   * 入口 / Entry: hash.callback@208.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
   * 输入 / Inputs: resolve; reject
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `createHash`; `signal.addEventListener`; `abort`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  return new Promise<string>((resolve, reject) => {
    const digest = createHash('sha256');
    let ended = false;
    /**
     * 入口 / Entry: hash.abort.
     * 功能：把本层请求转交 `stream.destroy`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `stream.destroy` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `stream.destroy(signal.reason)`.
     * 副作用 / Effects: `stream.destroy`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const abort = () => stream.destroy(signal.reason);
    /**
     * 入口 / Entry: hash.cleanup.
     * 功能：把本层请求转交 `signal.removeEventListener`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `signal.removeEventListener` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `signal.removeEventListener('abort', abort)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const cleanup = () => signal.removeEventListener('abort', abort);
    stream.on('data', (data: Buffer) => digest.update(data));
    stream.on('end', () => {
      ended = true;
    });
    stream.on('error', (error) => {
      cleanup();
      reject(error);
    });
    // SFTP reaches EOF before its remote close request completes. Keep SSH alive
    // and its error handler attached until that final callback has finished.
    stream.on('close', () => {
      cleanup();
      if (signal.aborted) reject(signal.reason);
      else if (ended) resolve(digest.digest('hex'));
      else reject(new AppError('文件读取未完成'));
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
/**
 * 入口 / Entry: syncRecoveryTicket.
 * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `({ id: point.id + '@' + recoveryTicketRevision({ host: point.host, guest: point.guest, state: point.state, base: point.base, …` 供上层消费（`sync.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `sync.ts`; this entry produces `({ id: point.id + '@' + recoveryTicketRevision({ host: point.host, guest: point.guest, state: point.state, base: point.base, …` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
 * 处理：通过 `recoveryTicketRevision`, `inline.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `recoveryTicketRevision`, `inline.includes`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: point: SyncCheckpoint; vmId: string; projectId: string
 * 输出 / Returns: DomainRecoveryTicket；结果来自 / values from `({ id: point.id + '@' + recoveryTicketRevision({ host: point.host, guest: point.guest, state: point.state, base: point.base, …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const syncRecoveryTicket = (point: SyncCheckpoint, vmId: string, projectId: string): DomainRecoveryTicket => ({
  id: point.id + '@' + recoveryTicketRevision({ host: point.host, guest: point.guest,
    state: point.state, base: point.base, origin: point.origin }),
  revision: recoveryTicketRevision(point), vmId, projectId, origin: point.origin,
  state: ['pending', 'failed'].includes(point.status) ? 'pending' : 'resolved', available: false,
});
/**
 * 入口 / Entry: discoverSyncRecoveryTickets.
 * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `[...tickets, invalidRecoveryTicket(VM_ROOT, 'unknown', '同步恢复实例数超过上限')]` / `capacity()` 供上层消费（`sync.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `sync.ts`; this entry produces `[...tickets, invalidRecoveryTicket(VM_ROOT, 'unknown', '同步恢复实例数超过上限')]` / `capacity()` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
 * 处理：通过 `recoveryDirectories`, `tickets.push`, `invalidRecoveryTicket`, `capacity` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `recoveryDirectories`, `tickets.push`, `invalidRecoveryTicket`, `capacity`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `ids.length > 4096`; `++reads > 4096 || tickets.length >= 3071`; `raw === undefined`.
 * 输入 / Inputs: vmIds: readonly string[] default=[]
 * 输出 / Returns: Promise<DomainRecoveryTicket[]>；结果来自 / values from `[...tickets, invalidRecoveryTicket(VM_ROOT, 'unknown', '同步恢复实例数超过上限')]`; `capacity()`; `tickets`.
 * 副作用 / Effects: `tickets.push`; `inline.exec`; 更新 / updates `ids`, `roots`, `checkpoints`.
 * 拒绝 / Refusals: 条件 / conditions `point.id !== id`; 异常 / errors `new AppError('同步恢复票据标识不匹配', 503, 'DOMAIN_RECOVERY_CORRUPT')`.
 * 失败处理：catch 分支执行 `tickets.push(invalidRecoveryTicket(VM_ROOT, 'unknown', error));`; `ids = [...vmIds];`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `tickets.push(invalidRecoveryTicket(VM_ROOT, 'unknown', error));`; `ids = [...vmIds];`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function discoverSyncRecoveryTickets(vmIds: readonly string[] = []): Promise<DomainRecoveryTicket[]> {
  const tickets: DomainRecoveryTicket[] = [];
  let reads = 0;
  /**
   * 入口 / Entry: discoverSyncRecoveryTickets.capacity.
   * 功能：从当前输入或状态计算 `[...tickets, invalidRecoveryTicket(VM_ROOT, 'unknown', '同步恢复扫描超过累计上限')]`，供调用方后续验证或使用。
   * Purpose: Computes `[...tickets, invalidRecoveryTicket(VM_ROOT, 'unknown', '同步恢复扫描超过累计上限')]` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `[...tickets, invalidRecoveryTicket(VM_ROOT, 'unknown', '同步恢复扫描超过累计上限')]`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const capacity = () => [...tickets, invalidRecoveryTicket(VM_ROOT, 'unknown', '同步恢复扫描超过累计上限')];
  let ids: string[];
  try { ids = [...new Set([...vmIds, ...await recoveryDirectories(VM_ROOT, value => z.uuid().safeParse(value).success)])]; }
  catch (error) { tickets.push(invalidRecoveryTicket(VM_ROOT, 'unknown', error)); ids = [...vmIds]; }
  if (ids.length > 4096) return [...tickets, invalidRecoveryTicket(VM_ROOT, 'unknown', '同步恢复实例数超过上限')];
  for (const vmId of ids) {
    if (++reads > 4096 || tickets.length >= 3071) return capacity();
    let roots: string[];
    try { roots = await recoveryDirectories(vmDir(vmId), value => /^sync-history(?:-[a-f0-9]{16})?\.json\.d$/.test(value), 32); }
    catch (error) { tickets.push(invalidRecoveryTicket(vmDir(vmId), vmId, error)); continue; }
    for (const name of roots) {
      if (++reads > 4096 || tickets.length >= 3071) return capacity();
      const root = join(vmDir(vmId), name), projectId = /^sync-history-([a-f0-9]{16})/.exec(name)?.[1] || 'default';
      let checkpoints: string[];
      try { checkpoints = await recoveryDirectories(root, value => z.uuid().safeParse(value).success, 64); }
      catch (error) { tickets.push(invalidRecoveryTicket(root, vmId, error, projectId)); continue; }
      for (const id of checkpoints) {
        if (++reads > 4096 || tickets.length >= 3071) return capacity();
        const file = join(root, id, 'checkpoint.json');
        try {
          await recoveryDirectories(join(root, id), () => false);
          const raw = await readRecoveryJson(file);
          if (raw === undefined) continue; // Initial capture without a published checkpoint changed no files.
          const point = syncCheckpointSchema.parse(raw);
          if (point.id !== id) throw new AppError('同步恢复票据标识不匹配', 503, 'DOMAIN_RECOVERY_CORRUPT');
          tickets.push(syncRecoveryTicket(point, vmId, projectId));
        } catch (error) { tickets.push(invalidRecoveryTicket(file, vmId, error, projectId)); }
      }
    }
  }
  return tickets;
}

export class FolderSync {
  jobs = new Jobs('sync');
  private schedule: ScheduleHandle;
  private closed = false;
  private watchers: SyncWatchers;
  private debounce?: ReturnType<typeof setTimeout>;
  /**
   * 入口 / Entry: FolderSync.onChange.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`FolderSync`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; the calls and state transitions below complete the operation. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `this.watchers.retain`, `this.machines.records.keys`, `this.machines.state`, `this.jobs.list` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.watchers.retain`, `this.machines.records.keys`, `this.machines.state`, `this.jobs.list`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.machines.state(id) !== 'running'`; `job.vmId === id && job.status === 'running'`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private onChange = () => {
    this.watchers.retain((_key, id) => this.machines.records.has(id));
    for (const id of this.machines.records.keys())
      if (this.machines.state(id) !== 'running')
        for (const job of this.jobs.list())
          if (job.vmId === id && job.status === 'running') this.jobs.cancel(job.id!);
  };
  /**
   * 入口 / Entry: FolderSync.constructor.
   * 功能：建立 FolderSync 的协调宿主与客户机双向同步、冲突和回滚上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the FolderSync context for this module's responsibility: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; projects: ProjectCatalogV1 optional
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `scheduler.register`; 更新 / updates `this.watchers`, `this.schedule`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    private machines: Machines,
    private projects?: ProjectCatalogV1,
  ) {
    this.watchers = new SyncWatchers(machines, () => {
      if (this.closed || this.debounce) return;
      this.debounce = setTimeout(() => {
        this.debounce = undefined;
        if (!this.closed) this.schedule.trigger();
      }, 500);
      this.debounce.unref();
    });
    machines.on('change', this.onChange);
    this.schedule = scheduler.register({
      owner: 'core:sync',
      label: 'Queued and watched folder sync',
      intervalMs: 15_000,
      overlap: 'coalesce',
      catchUp: 'once',
      /**
       * 入口 / Entry: FolderSync.constructor.run.
       * 功能：把本层请求转交 `this.tick`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.tick` and propagates the provider result or rejection.
       * 输入 / Inputs: { signal }
       * 输出 / Returns: `this.tick(Date.now(), signal)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      run: ({ signal }) => this.tick(Date.now(), signal),
    });
  }
  /**
   * 入口 / Entry: FolderSync.key.
   * 功能：从当前输入或状态计算 `this.projects?.key(id) || id`，供调用方后续验证或使用。
   * Purpose: Computes `this.projects?.key(id) || id` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.projects?.key(id) || id`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private key(id: string) {
    return this.projects?.key(id) || id;
  }
  /**
   * 入口 / Entry: FolderSync.file.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `projectMetadataFile(id, this.projects?.current(id) || 'default', name)` 供上层消费（`FolderSync`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; this entry produces `projectMetadataFile(id, this.projects?.current(id) || 'default', name)` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `projectMetadataFile`, `this.projects.current` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectMetadataFile`, `this.projects.current`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; name: string
   * 输出 / Returns: `projectMetadataFile(id, this.projects?.current(id) || 'default', name)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private file(id: string, name: string) {
    return projectMetadataFile(id, this.projects?.current(id) || 'default', name);
  }
  /**
   * 入口 / Entry: FolderSync.history.
   * 功能：从当前输入或状态计算 `new SyncHistory( this.file(id, 'sync-history') + '.d', this.file(id, 'sync-state'), this.file(id, 'sync-base'), )`，供调用方后续验证或使用。
   * Purpose: Computes `new SyncHistory( this.file(id, 'sync-history') + '.d', this.file(id, 'sync-state'), this.file(id, 'sync-base'), )` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `new SyncHistory( this.file(id, 'sync-history') + '.d', this.file(id, 'sync-state'), this.file(id, 'sync-base'), )`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private history(id: string) {
    return new SyncHistory(
      this.file(id, 'sync-history') + '.d',
      this.file(id, 'sync-state'),
      this.file(id, 'sync-base'),
    );
  }
  /**
   * 入口 / Entry: FolderSync.eachProject.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `action('default')` 供上层消费（`FolderSync`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; this entry produces `action('default')` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `action`, `this.projects.list`, `this.projects.inScope` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `action`, `this.projects.list`, `this.projects.inScope`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.projects`.
   * 输入 / Inputs: id: string; action: (projectId: string) => Promise<void>
   * 输出 / Returns: `action('default')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async eachProject(id: string, action: (projectId: string) => Promise<void>) {
    if (!this.projects) return action('default');
    const index = await this.projects.list(id);
    for (const project of index.projects)
      await this.projects.inScope(id, project.id, () => action(project.id));
  }
  /**
   * 入口 / Entry: FolderSync.recoveryProject.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `work()` / `this.projects.inScope(id, projectId, work)` 供上层消费（`FolderSync`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; this entry produces `work()` / `this.projects.inScope(id, projectId, work)` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `this.machines.get`, `work`, `this.projects.list`, `index.projects.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `work`, `this.projects.list`, `index.projects.some`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; projectId: string; work: () => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `work()`; `this.projects.inScope(id, projectId, work)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.projects`; `projectId !== 'default'`; `!index.projects.some(project => project.id === projectId)`; 异常 / errors `new AppError('原同步项目服务不可用', 409, 'DOMAIN_RECOVERY_UNAVAILABLE')`; `new AppError('原同步项目已变化', 409, 'RECOVERY_STALE')`.
   */
  private async recoveryProject<T>(id: string, projectId: string, work: () => Promise<T>): Promise<T> {
    this.machines.get(id);
    if (!this.projects) {
      if (projectId !== 'default') throw new AppError('原同步项目服务不可用', 409, 'DOMAIN_RECOVERY_UNAVAILABLE');
      return work();
    }
    const index = await this.projects.list(id);
    if (!index.projects.some(project => project.id === projectId))
      throw new AppError('原同步项目已变化', 409, 'RECOVERY_STALE');
    return this.projects.inScope(id, projectId, work);
  }
  /**
   * 入口 / Entry: FolderSync.recoveryTickets.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `tickets` 供上层消费（`FolderSync`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; this entry produces `tickets` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `discoverSyncRecoveryTickets`, `this.machines.records.keys`, `this.machines.records.has`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `discoverSyncRecoveryTickets`, `this.machines.records.keys`, `this.machines.records.has`, `this.machines.state`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `ticket.error || ticket.state !== 'pending' || this.closed || !this.machines.records.has(ticket.vmId)…`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<DomainRecoveryTicket[]>；结果来自 / values from `tickets`.
   * 副作用 / Effects: 更新 / updates `ticket.available`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `ticket.available = false;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `ticket.available = false;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async recoveryTickets(): Promise<DomainRecoveryTicket[]> {
    const tickets = await discoverSyncRecoveryTickets([...this.machines.records.keys()]);
    const latest = new Map<string, string | undefined>();
    for (const ticket of tickets) {
      if (ticket.error || ticket.state !== 'pending' || this.closed || !this.machines.records.has(ticket.vmId) ||
          this.machines.state(ticket.vmId) !== 'running') continue;
      const project = ticket.projectId || 'default', key = ticket.vmId + ':' + project;
      try {
        await this.recoveryProject(ticket.vmId, project, async () => {
          if (this.jobs.view(this.key(ticket.vmId))?.status === 'running') return;
          if (!latest.has(key)) latest.set(key,
            (await this.history(ticket.vmId).list()).find(point => point.status !== 'rolled-back')?.id);
          ticket.available = latest.get(key) === ticket.id.split('@')[0];
        });
      } catch { ticket.available = false; }
    }
    return tickets;
  }
  /**
   * 入口 / Entry: FolderSync.recoverTicket.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`FolderSync`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; the calls and state transitions below complete the operation. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `domainRecoveryTicketSchema.parse`, `ticket.id.split`, `this.recoveryProject` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `domainRecoveryTicketSchema.parse`, `ticket.id.split`, `this.recoveryProject`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: raw: DomainRecoveryTicket
   * 输出 / Returns: Promise<void>.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async recoverTicket(raw: DomainRecoveryTicket): Promise<void> {
    const ticket = domainRecoveryTicketSchema.parse(raw), checkpoint = ticket.id.split('@')[0];
    /**
     * 入口 / Entry: FolderSync.recoverTicket.callback@360.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.recoveryProject）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.recoveryProject).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `this.closed`; `syncRecoveryTicket(point, ticket.vmId, ticket.projectId || 'default').id !== ticket.id`; `this.jobs.get(job.id!)?.status !== 'done' || confirmed.status !== 'rolled-back' || syncRecoveryTicket(confirmed, ticket.vmId,…`; 异常 / errors `new AppError('同步领域正在关闭', 503, 'DOMAIN_RECOVERY_UNAVAILABLE')`; `new AppError('原同步恢复票据身份已变化', 409, 'RECOVERY_STALE')`.
     */
    await this.recoveryProject(ticket.vmId, ticket.projectId || 'default', async () => {
      if (this.closed) throw new AppError('同步领域正在关闭', 503, 'DOMAIN_RECOVERY_UNAVAILABLE');
      const point = await this.readHistory(ticket.vmId, () => this.history(ticket.vmId).read(checkpoint));
      if (syncRecoveryTicket(point, ticket.vmId, ticket.projectId || 'default').id !== ticket.id)
        throw new AppError('原同步恢复票据身份已变化', 409, 'RECOVERY_STALE');
      const job = await this.rollback(ticket.vmId, checkpoint, ticket.revision);
      await this.jobs.wait(this.key(ticket.vmId));
      const confirmed = await this.readHistory(ticket.vmId, () => this.history(ticket.vmId).read(checkpoint));
      if (this.jobs.get(job.id!)?.status !== 'done' || confirmed.status !== 'rolled-back' ||
          syncRecoveryTicket(confirmed, ticket.vmId, ticket.projectId || 'default').id !== ticket.id)
        throw new AppError('原同步领域尚未确认回滚', 503, 'RECOVERY_CLEANUP_PENDING');
    });
  }
  /**
   * 入口 / Entry: FolderSync.close.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`FolderSync`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `FolderSync`; the outcome is recorded in `this.closed`. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `clearTimeout`, `this.watchers.close`, `this.machines.off`, `this.schedule.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `clearTimeout`, `this.watchers.close`, `this.machines.off`, `this.schedule.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `clearTimeout`; `this.watchers.close`; `this.schedule.close`; `this.jobs.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    clearTimeout(this.debounce);
    await this.watchers.close();
    this.machines.off('change', this.onChange);
    await this.schedule.close();
    await this.jobs.close();
  }
  /**
   * 入口 / Entry: FolderSync.config.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `syncSchema.parse(JSON.parse(await readFile(this.file(id, 'sync'), 'utf8')))` / `null` 供上层消费（`FolderSync`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; this entry produces `syncSchema.parse(JSON.parse(await readFile(this.file(id, 'sync'), 'utf8')))` / `null` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `this.machines.get`, `syncSchema.parse`, `readFile`, `this.file` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `syncSchema.parse`, `readFile`, `this.file`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `(error as NodeJS.ErrnoException).code === 'ENOENT'`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<SyncConfig | null>；结果来自 / values from `syncSchema.parse(JSON.parse(await readFile(this.file(id, 'sync'), 'utf8')))`; `null`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async config(id: string): Promise<SyncConfig | null> {
    this.machines.get(id);
    try {
      return syncSchema.parse(JSON.parse(await readFile(this.file(id, 'sync'), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  /**
   * 入口 / Entry: FolderSync.save.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，校验并提交领域状态变更；本入口产生 `this.machines.locked(`sync:${this.key(id)}`, async () => { if (this.jobs.view(this.key(id))?.status === 'running') throw new …` 供上层消费（`FolderSync`）。
   * Purpose: Validates and commits a domain state change in `FolderSync`; this entry produces `this.machines.locked(`sync:${this.key(id)}`, async () => { if (this.jobs.view(this.key(id))?.status === 'running') throw new …` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `this.machines.locked`, `this.key` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.locked`, `this.key`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `this.machines.locked(`sync:${this.key(id)}`, async () => { if (this.jobs.view(this.key(id))?.status === 'running') throw new …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async save(id: string, input: unknown) {
    /**
     * 入口 / Entry: FolderSync.save.callback@391.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `config`.
     * 副作用 / Effects: `replaceMetadata`; 更新 / updates `config.host`.
     * 拒绝 / Refusals: 条件 / conditions `this.jobs.view(this.key(id))?.status === 'running'`; `config.drivers?.some((driver) => driver.mode === 'merge-text') && !config.mergeText`; `!isAbsolute(config.host)`; 异常 / errors `new AppError('请等待同步完成', 409)`; `new AppError('自动文本合并需要启用共同文本版本', 409)`.
     */
    return this.machines.locked(`sync:${this.key(id)}`, async () => {
      if (this.jobs.view(this.key(id))?.status === 'running') throw new AppError('请等待同步完成', 409);
      const config = syncSchema.parse(input);
      if (config.drivers?.some((driver) => driver.mode === 'merge-text') && !config.mergeText)
        throw new AppError('自动文本合并需要启用共同文本版本', 409);
      if (!isAbsolute(config.host)) throw new AppError('请选择 Windows 文件夹的绝对路径');
      config.host = await realpath(config.host);
      if (!(await lstat(config.host)).isDirectory()) throw new AppError('本机路径不是目录');
      this.machines.get(id);
      const previous = await this.config(id);
      const file = this.file(id, 'sync');
      await replaceMetadata(file, config);
      if (previous?.host !== config.host || previous?.guest !== config.guest) {
        await metadataFile(this.file(id, 'sync-state'), () => null).remove();
        await metadataFile(this.file(id, 'sync-base'), () => null).remove();
        await metadataFile(this.file(id, 'sync-queue'), () => null).remove();
      }
      if (!config.mergeText && previous?.mergeText)
        await metadataFile(this.file(id, 'sync-base'), () => null).remove();
      this.watchers.ensure(this.key(id), id, config);
      return config;
    });
  }
  /**
   * 入口 / Entry: FolderSync.view.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ projectId: this.projects?.current(id) || 'default', config: await this.config(id), job: this.jobs.view(this.key(id)), queue…` 供上层消费（`FolderSync`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `FolderSync`; this entry produces `{ projectId: this.projects?.current(id) || 'default', config: await this.config(id), job: this.jobs.view(this.key(id)), queue…` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `this.projects.current`, `this.config`, `this.jobs.view`, `this.key` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.projects.current`, `this.config`, `this.jobs.view`, `this.key`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ projectId: this.projects?.current(id) || 'default', config: await this.config(id), job: this.jobs.view(this.key(id)), queue…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id: string) {
    return {
      projectId: this.projects?.current(id) || 'default',
      config: await this.config(id),
      job: this.jobs.view(this.key(id)),
      queue: await this.queued(id),
      maintenance: await inMaintenance(id),
      history: await this.readHistory(id, () => this.history(id).list()),
      watching: this.watchers.view(this.key(id)),
    };
  }
  /**
   * 入口 / Entry: FolderSync.readHistory.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `storageRuntime.run( { owner: 'core:sync-history', taskId: 'sync-history:' + randomUUID(), label: 'Read synchronization recove…` 供上层消费（`FolderSync`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `FolderSync`; this entry produces `storageRuntime.run( { owner: 'core:sync-history', taskId: 'sync-history:' + randomUUID(), label: 'Read synchronization recove…` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `storageRuntime.run`, `randomUUID`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `storageRuntime.run`, `randomUUID`, `vmDir`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; work: () => Promise<T>
   * 输出 / Returns: `storageRuntime.run( { owner: 'core:sync-history', taskId: 'sync-history:' + randomUUID(), label: 'Read synchronization recove…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private readHistory<T>(id: string, work: () => Promise<T>) {
    return storageRuntime.run(
      {
        owner: 'core:sync-history',
        taskId: 'sync-history:' + randomUUID(),
        label: 'Read synchronization recovery metadata',
        mode: 'read',
        paths: [vmDir(id)],
        buffers: 36 * 1024 ** 2,
        files: 2,
      },
      work,
    );
  }
  /**
   * 入口 / Entry: FolderSync.queued.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `value === null ? null : queueSchema.parse(value)` 供上层消费（`FolderSync`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; this entry produces `value === null ? null : queueSchema.parse(value)` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `metadataFile().read`, `metadataFile`, `this.file`, `queueSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `metadataFile().read`, `metadataFile`, `this.file`, `queueSchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `value === null ? null : queueSchema.parse(value)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async queued(id: string) {
    const { value } = await metadataFile<unknown>(this.file(id, 'sync-queue'), () => null).read();
    return value === null ? null : queueSchema.parse(value);
  }
  /**
   * 入口 / Entry: FolderSync.queue.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.machines.locked(`sync:${this.key(id)}`, async () => { this.machines.get(id); const pending = await this.queued(id); if (…` 供上层消费（`FolderSync`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; this entry produces `this.machines.locked(`sync:${this.key(id)}`, async () => { this.machines.get(id); const pending = await this.queued(id); if (…` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `this.machines.locked`, `this.key` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.locked`, `this.key`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; cancel: default=false
   * 输出 / Returns: `this.machines.locked(`sync:${this.key(id)}`, async () => { this.machines.get(id); const pending = await this.queued(id); if (…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async queue(id: string, cancel = false) {
    /**
     * 入口 / Entry: FolderSync.queue.callback@444.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `null`; `pending`; `entry`.
     * 副作用 / Effects: `replaceMetadata`.
     * 拒绝 / Refusals: 条件 / conditions `!(await this.config(id))`; 异常 / errors `new AppError('请先保存同步目录')`.
     */
    return this.machines.locked(`sync:${this.key(id)}`, async () => {
      this.machines.get(id);
      const pending = await this.queued(id);
      if (cancel) {
        if (pending?.jobId) this.jobs.cancel(pending.jobId);
        await metadataFile(this.file(id, 'sync-queue'), () => null).remove();
        return null;
      }
      if (!(await this.config(id))) throw new AppError('请先保存同步目录');
      if (pending) return pending;
      const entry: SyncQueue = {
        id: randomUUID(),
        requestedAt: new Date().toISOString(),
        attempts: 0,
        nextAttemptAt: 0,
      };
      await replaceMetadata(this.file(id, 'sync-queue'), entry);
      return entry;
    });
  }
  /**
   * 入口 / Entry: FolderSync.tick.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`FolderSync`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; this entry produces `void` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `this.watchers.retain`, `this.machines.records.keys`, `this.eachProject` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.watchers.retain`, `this.machines.records.keys`, `this.eachProject`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || signal?.aborted`.
   * 输入 / Inputs: now: default=Date.now(); signal: AbortSignal optional
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 ，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute ; these statements determine whether a failure is absorbed or rejected again.
   */
  async tick(now = Date.now(), signal?: AbortSignal) {
    this.watchers.retain((_key, id) => this.machines.records.has(id));
    for (const id of this.machines.records.keys()) {
      if (this.closed || signal?.aborted) return;
      try {
        const keys = new Set<string>();
        /**
         * 入口 / Entry: FolderSync.tick.callback@470.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.eachProject）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.eachProject).
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `keys.add`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         * 失败处理：catch 分支执行 ，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute ; these statements determine whether a failure is absorbed or rejected again.
         */
        await this.eachProject(id, async () => {
          keys.add(this.key(id));
          try {
            /**
             * 入口 / Entry: FolderSync.tick.callback@473.
             * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
             * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
             * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
             * 输出 / Returns: `void`.
             * 副作用 / Effects: `replaceMetadata`; `this.watchers.started`; 更新 / updates `pending`, `pending.lastError`, `pending.nextAttemptAt`, `pending.jobId`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             * 失败处理：catch 分支执行 `pending.lastError = (error as Error).message.slice(0, 1000);`; `pending.nextAttemptAt = now + Math.min(600000, 15000 * 2 ** Math.min(6, pending.attempts));`，是否吞掉错误或重新拒绝由这些语句决定。
             * Failure handling: Catch paths execute `pending.lastError = (error as Error).message.slice(0, 1000);`; `pending.nextAttemptAt = now + Math.min(600000, 15000 * 2 ** Math.min(6, pending.attempts));`; these statements determine whether a failure is absorbed or rejected again.
             */
            await this.machines.locked(`sync:${this.key(id)}`, async () => {
              const config = await this.config(id);
              if (!config) return;
              this.watchers.ensure(this.key(id), id, config);
              let pending = await this.queued(id);
              if (pending?.jobId) {
                const job = this.jobs.get(pending.jobId);
                if (job?.status === 'running') return;
                if (job?.status === 'done') {
                  await metadataFile(this.file(id, 'sync-queue'), () => null).remove();
                  pending = null;
                } else {
                  delete pending.jobId;
                  pending.lastError = (job?.error || '同步中断，将重新比较文件后重试').slice(0, 1000);
                  pending.nextAttemptAt = now + Math.min(600000, 15000 * 2 ** Math.min(6, pending.attempts));
                  await replaceMetadata(this.file(id, 'sync-queue'), pending);
                }
              }
              if (this.jobs.view(this.key(id))?.status === 'running') return;
              if (!pending && !config.auto) return;
              if (!pending && config.watch && !this.watchers.due(this.key(id), now)) return;
              if ((await inMaintenance(id, now)) || (config.window && !withinWindow(config.window, now)))
                return;
              if (!pending) {
                pending = {
                  id: randomUUID(),
                  requestedAt: new Date(now).toISOString(),
                  attempts: 0,
                  nextAttemptAt: 0,
                };
                await replaceMetadata(this.file(id, 'sync-queue'), pending);
              }
              if (this.machines.state(id) !== 'running' || now < pending.nextAttemptAt) return;
              try {
                pending.attempts++;
                this.watchers.started(this.key(id), now);
                const job = await this.runInternal(id, 'both');
                pending.jobId = job.id;
              } catch (error) {
                pending.lastError = (error as Error).message.slice(0, 1000);
                pending.nextAttemptAt = now + Math.min(600000, 15000 * 2 ** Math.min(6, pending.attempts));
              }
              await replaceMetadata(this.file(id, 'sync-queue'), pending);
            });
          } catch {
            /* Each project retains its previous queued request on transient failures. */
          }
        });
        this.watchers.retain((key, vmId) => vmId !== id || keys.has(key));
      } catch {
        /* A manual retry exposes the error. */
      }
    }
  }
  /**
   * 入口 / Entry: FolderSync.preview.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.machines.locked(`sync:${this.key(id)}`, async () => { if (this.jobs.view(this.key(id))?.status === 'running') throw new …` 供上层消费（`FolderSync`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; this entry produces `this.machines.locked(`sync:${this.key(id)}`, async () => { if (this.jobs.view(this.key(id))?.status === 'running') throw new …` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `this.machines.locked`, `this.key` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.locked`, `this.key`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; signal: AbortSignal default=new AbortController().signal
   * 输出 / Returns: `this.machines.locked(`sync:${this.key(id)}`, async () => { if (this.jobs.view(this.key(id))?.status === 'running') throw new …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async preview(id: string, signal: AbortSignal = new AbortController().signal) {
    /**
     * 入口 / Entry: FolderSync.preview.callback@528.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.execute(id, config, 'both', () => {}, signal, true)`.
     * 副作用 / Effects: `this.execute`.
     * 拒绝 / Refusals: 条件 / conditions `this.jobs.view(this.key(id))?.status === 'running'`; `!config`; 异常 / errors `new AppError('请等待同步完成', 409)`; `new AppError('请先保存同步目录')`.
     */
    return this.machines.locked(`sync:${this.key(id)}`, async () => {
      if (this.jobs.view(this.key(id))?.status === 'running') throw new AppError('请等待同步完成', 409);
      const config = await this.config(id);
      if (!config) throw new AppError('请先保存同步目录');
      return this.execute(id, config, 'both', () => {}, signal, true);
    });
  }
  /**
   * 入口 / Entry: FolderSync.mergePreview.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.machines.locked(`sync:${this.key(id)}`, async () => { if (this.jobs.view(this.key(id))?.status === 'running') throw new …` 供上层消费（`FolderSync`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; this entry produces `this.machines.locked(`sync:${this.key(id)}`, async () => { if (this.jobs.view(this.key(id))?.status === 'running') throw new …` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `safeRelative`, `this.machines.locked`, `this.key` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `safeRelative`, `this.machines.locked`, `this.key`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; inputPath: string; token: string; signal: AbortSignal default=new AbortController().signal
   * 输出 / Returns: `this.machines.locked(`sync:${this.key(id)}`, async () => { if (this.jobs.view(this.key(id))?.status === 'running') throw new …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async mergePreview(
    id: string,
    inputPath: string,
    token: string,
    signal: AbortSignal = new AbortController().signal,
  ) {
    const name = safeRelative(inputPath);
    /**
     * 入口 / Entry: FolderSync.mergePreview.callback@542.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ path: name, token, base, ours, theirs }`.
     * 副作用 / Effects: `this.execute`; `rel.startsWith`; 更新 / updates `current`.
     * 拒绝 / Refusals: 条件 / conditions `this.jobs.view(this.key(id))?.status === 'running'`; `!config?.mergeText`; `plan.token !== token`; 异常 / errors `new AppError('请等待同步完成', 409)`; `new AppError('请先启用共同文本版本并完成一次同步', 409)`.
     */
    return this.machines.locked(`sync:${this.key(id)}`, async () => {
      if (this.jobs.view(this.key(id))?.status === 'running') throw new AppError('请等待同步完成', 409);
      const config = await this.config(id);
      if (!config?.mergeText) throw new AppError('请先启用共同文本版本并完成一次同步', 409);
      const plan = await this.execute(id, config, 'both', () => {}, signal, true);
      if (plan.token !== token) throw new AppError('预览后文件或配置已变化，请重新预览', 409);
      if (
        !plan.changes.some((change) => change.path === name && change.action === 'conflict') ||
        !policyAllows(name, 'merge', config.policies)
      )
        throw new AppError('此路径没有可合并的文本冲突', 409);
      const root = await realpath(config.host);
      if (root !== config.host) throw new AppError('本机目录位置已改变，请重新保存', 409);
      const local = resolve(root, ...name.split('/'));
      const rel = relative(root, local);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new AppError('同步路径越界');
      let current = root;
      for (const part of rel.split(sep)) {
        current = join(current, part);
        const attrs = await lstat(current);
        if (attrs.isSymbolicLink()) throw new AppError('同步不会穿过符号链接或目录联接');
      }
      if (!(await lstat(local)).isFile()) throw new AppError('Windows 冲突路径不是普通文件', 409);
      /**
       * 入口 / Entry: FolderSync.mergePreview.callback@576.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（storageRuntime.run）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (storageRuntime.run).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `{ base, ours, theirs }`.
       * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`; `createReadStream`.
       * 拒绝 / Refusals: 条件 / conditions `(await lstat(baseFile)).size > 32 * 1024 ** 2`; `typeof base !== 'string' || createHash('sha256').update(base).digest('hex') !== previous[name]`; 异常 / errors `new AppError('同步共同版本文件超过限制')`; `new AppError('没有可校验的共同版本，请重新建立同步基线', 409)`.
       */
      const { base, ours, theirs } = await storageRuntime.run(
        {
          owner: 'core:sync-merge',
          taskId: 'sync-merge:' + this.key(id),
          label: 'Read reviewed merge versions',
          mode: 'read',
          paths: [config.host, vmDir(id)],
          buffers: 36 * 1024 ** 2,
          files: 4,
          signal,
        },
        async () => {
          const stateFile = this.file(id, 'sync-state'),
            baseFile = this.file(id, 'sync-base');
          if ((await lstat(baseFile)).size > 32 * 1024 ** 2) throw new AppError('同步共同版本文件超过限制');
          const previous = JSON.parse(await readFile(stateFile, 'utf8')) as Record<string, string>;
          const bases = JSON.parse(await readFile(baseFile, 'utf8')) as Record<string, string>;
          const base = bases[name];
          if (typeof base !== 'string' || createHash('sha256').update(base).digest('hex') !== previous[name])
            throw new AppError('没有可校验的共同版本，请重新建立同步基线', 409);
          decodeSyncText(Buffer.from(base));
          const ours = await readSyncText(createReadStream(local), signal);
          /**
           * 入口 / Entry: FolderSync.mergePreview.callback@589.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.sftp）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.sftp).
           * 输入 / Inputs: ftp; transportSignal
           * 输出 / Returns: `readSyncText(ftp.createReadStream(remote), active)`.
           * 副作用 / Effects: `AbortSignal.any`; `ftp.createReadStream`; 更新 / updates `path`.
           * 拒绝 / Refusals: 条件 / conditions `!(await ftpStat(ftp, path))?.isDirectory()`; `!(await ftpStat(ftp, remote))?.isFile()`; 异常 / errors `new AppError('Linux 冲突路径包含非普通目录', 409)`; `new AppError('Linux 冲突路径不是普通文件', 409)`.
           */
          const theirs = await this.machines.sftp(
            id,
            async (ftp, transportSignal) => {
              const active = transportSignal ? AbortSignal.any([signal, transportSignal]) : signal;
              const remote = posix.join(config.guest, name);
              let path = '';
              for (const part of posix.dirname(remote).split('/').filter(Boolean)) {
                path += '/' + part;
                if (!(await ftpStat(ftp, path))?.isDirectory())
                  throw new AppError('Linux 冲突路径包含非普通目录', 409);
              }
              if (!(await ftpStat(ftp, remote))?.isFile())
                throw new AppError('Linux 冲突路径不是普通文件', 409);
              return readSyncText(ftp.createReadStream(remote), active);
            },
            signal,
          );
          return { base, ours, theirs };
        },
      );
      const after = await this.execute(id, config, 'both', () => {}, signal, true);
      if (after.token !== token) throw new AppError('读取合并内容时文件发生变化，请重新预览', 409);
      return { path: name, token, base, ours, theirs };
    });
  }
  /**
   * 入口 / Entry: FolderSync.run.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.machines.locked(`sync:${this.key(id)}`, () => this.runInternal(id, direction, token, decisions, merges), )` 供上层消费（`FolderSync`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; this entry produces `this.machines.locked(`sync:${this.key(id)}`, () => this.runInternal(id, direction, token, decisions, merges), )` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `this.machines.locked`, `this.key` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.locked`, `this.key`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; direction: 'both' | 'push' | 'pull'; token: string optional; decisions: SyncDecisions default={}; merges: SyncManualMerges default={}
   * 输出 / Returns: `this.machines.locked(`sync:${this.key(id)}`, () => this.runInternal(id, direction, token, decisions, merges), )`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async run(
    id: string,
    direction: 'both' | 'push' | 'pull',
    token?: string,
    decisions: SyncDecisions = {},
    merges: SyncManualMerges = {},
  ) {
    return this.machines.locked(`sync:${this.key(id)}`, () =>
      this.runInternal(id, direction, token, decisions, merges),
    );
  }
  /**
   * 入口 / Entry: FolderSync.rollback.
   * 功能：核对原检查点和当前双端文件版本，执行受控同步回滚。
   * Purpose: Checks original checkpoints/current two-sided versions and performs controlled rollback.
   * 设计：拒绝当前路径、项目或内容与原证明不符的覆盖；先核验恢复条目，再保存回滚终态，失败证据保留。
   * Design: Changed paths/projects/content cannot be overwritten by stale proof; entries validate before terminal publication and failure evidence remains.
   * 输入 / Inputs: id: string; checkpoint: string; expectedRevision: string optional
   * 输出 / Returns: `this.machines.locked(`sync:${this.key(id)}`, async () => { const config = await this.config(id); if (!config) throw new AppEr…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async rollback(id: string, checkpoint: string, expectedRevision?: string) {
    /**
     * 入口 / Entry: FolderSync.rollback.callback@624.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.jobs.start( this.key(id), async (log, signal) => { return storageRuntime.run( { owner: 'core:sync-rollback', taskId: 'sy…`.
     * 副作用 / Effects: `this.jobs.start`.
     * 拒绝 / Refusals: 条件 / conditions `!config`; `this.machines.state(id) !== 'running'`; `this.jobs.view(this.key(id))?.status === 'running'`; 异常 / errors `new AppError('请先保存同步目录')`; `new AppError('请先启动发行版')`.
     */
    return this.machines.locked(`sync:${this.key(id)}`, async () => {
      const config = await this.config(id);
      if (!config) throw new AppError('请先保存同步目录');
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
      if (this.jobs.view(this.key(id))?.status === 'running') throw new AppError('请等待同步完成', 409);
      const history = this.history(id);
      const original = await this.readHistory(id, () => history.read(checkpoint));
      if (expectedRevision && recoveryTicketRevision(original) !== expectedRevision)
        throw new AppError('原同步恢复票据已变化', 409, 'RECOVERY_STALE');
      /**
       * 入口 / Entry: FolderSync.rollback.callback@635.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
       * 输入 / Inputs: log; signal
       * 输出 / Returns: `storageRuntime.run( { owner: 'core:sync-rollback', taskId: 'sync:' + this.key(id), label: 'Restore synchronization checkpoint…`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      return this.jobs.start(
        this.key(id),
        async (log, signal) => {
          /**
           * 入口 / Entry: FolderSync.rollback.callback@648.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（storageRuntime.run）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (storageRuntime.run).
           * 输入 / Inputs: lease
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 拒绝 / Refusals: 条件 / conditions `root !== config.host`; 异常 / errors `new AppError('本机目录位置已改变')`.
           */
          return storageRuntime.run(
            {
              owner: 'core:sync-rollback',
              taskId: 'sync:' + this.key(id),
              label: 'Restore synchronization checkpoint',
              mode: 'write',
              paths: [config.host, vmDir(id)],
              dynamicTemporary: [config.host, vmDir(id)],
              buffers: 40 * 1024 ** 2,
              files: 16,
              signal,
            },
            async (lease) => {
              const root = await realpath(config.host);
              if (root !== config.host) throw new AppError('本机目录位置已改变');
              /**
               * 入口 / Entry: FolderSync.rollback.localPath.
               * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `file` 供上层消费（`FolderSync`）。
               * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; this entry produces `file` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
               * 处理：通过 `safeRelative().split`, `safeRelative`, `join`, `lstat().catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
               * Processing: Coordinates its dependencies through `safeRelative().split`, `safeRelative`, `join`, `lstat().catch`; the branches below determine continuation, return or refusal.
               * 输入 / Inputs: name: string
               * 输出 / Returns: `file`.
               * 副作用 / Effects: 更新 / updates `file`.
               * 拒绝 / Refusals: 条件 / conditions `info?.isSymbolicLink()`; 异常 / errors `new AppError('回滚不会穿过符号链接或目录联接')`.
               */
              const localPath = async (name: string) => {
                let file = root;
                for (const part of safeRelative(name).split('/')) {
                  file = join(file, part);
                  const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
                    if (error.code !== 'ENOENT') throw error;
                    return null;
                  });
                  if (info?.isSymbolicLink()) throw new AppError('回滚不会穿过符号链接或目录联接');
                }
                return file;
              };
              /**
               * 入口 / Entry: FolderSync.rollback.callback@665.
               * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.sftp）。
               * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.sftp).
               * 输入 / Inputs: ftp; transportSignal
               * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
               * 副作用 / Effects: `AbortSignal.any`.
               * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
               */
              await this.machines.sftp(
                id,
                async (ftp, transportSignal) => {
                  const active = transportSignal ? AbortSignal.any([signal, transportSignal]) : signal;
                  /**
                   * 入口 / Entry: FolderSync.rollback.guestPath.
                   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `target` 供上层消费（`FolderSync`）。
                   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; this entry produces `target` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
                   * 处理：通过 `posix.join`, `safeRelative`, `posix.dirname().split().filter`, `posix.dirname().split` 协调依赖；下列分支决定是否继续、返回或拒绝。
                   * Processing: Coordinates its dependencies through `posix.join`, `safeRelative`, `posix.dirname().split().filter`, `posix.dirname().split`; the branches below determine continuation, return or refusal.
                   * 分支 / Branches: `!info && create`.
                   * 输入 / Inputs: name: string; create: default=false
                   * 输出 / Returns: `target`.
                   * 副作用 / Effects: 更新 / updates `path`.
                   * 拒绝 / Refusals: 条件 / conditions `info && !info.isDirectory()`; 异常 / errors `new AppError('回滚不会穿过非普通目录：' + path)`.
                   */
                  const guestPath = async (name: string, create = false) => {
                    const target = posix.join(config.guest, safeRelative(name));
                    let path = '';
                    for (const part of posix.dirname(target).split('/').filter(Boolean)) {
                      path += '/' + part;
                      const info = await ftpStat(ftp, path);
                      if (info && !info.isDirectory()) throw new AppError('回滚不会穿过非普通目录：' + path);
                      if (!info && create)
                        await new Promise<void>((resolve, reject) =>
                          ftp.mkdir(path, (error) => (error ? reject(error) : resolve())),
                        );
                    }
                    return target;
                  };
                  /**
                   * 入口 / Entry: FolderSync.rollback.current.
                   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `null` / `hash(createReadStream(file), active)` 供上层消费（`FolderSync`）。
                   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; this entry produces `null` / `hash(createReadStream(file), active)` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
                   * 处理：通过 `active.throwIfAborted`, `localPath`, `lstat().catch`, `lstat` 协调依赖；下列分支决定是否继续、返回或拒绝。
                   * Processing: Coordinates its dependencies through `active.throwIfAborted`, `localPath`, `lstat().catch`, `lstat`; the branches below determine continuation, return or refusal.
                   * 分支 / Branches: `!info`.
                   * 输入 / Inputs: side: SyncSide; name: string
                   * 输出 / Returns: `null`; `hash(createReadStream(file), active)`; `hash(ftp.createReadStream(file), active)`.
                   * 副作用 / Effects: `createReadStream`; `ftp.createReadStream`.
                   * 拒绝 / Refusals: 条件 / conditions `side === 'host'`; `!info.isFile() || info.size > 256 * 1024 ** 2`; 异常 / errors `new AppError('回滚目标不是普通文件：' + name)`.
                   */
                  const current = async (side: SyncSide, name: string) => {
                    active.throwIfAborted();
                    if (side === 'host') {
                      const file = await localPath(name),
                        info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
                          if (error.code !== 'ENOENT') throw error;
                          return null;
                        });
                      if (!info) return null;
                      if (!info.isFile() || info.size > 256 * 1024 ** 2)
                        throw new AppError('回滚目标不是普通文件：' + name);
                      return hash(createReadStream(file), active);
                    }
                    const file = await guestPath(name),
                      info = await ftpStat(ftp, file);
                    if (!info) return null;
                    if (!info.isFile() || info.size > 256 * 1024 ** 2)
                      throw new AppError('回滚目标不是普通文件：' + name);
                    return hash(ftp.createReadStream(file), active);
                  };
                  /**
                   * 入口 / Entry: FolderSync.rollback.callback@705.
                   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（history.restore）。
                   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (history.restore).
                   * 输入 / Inputs: entry; blob; expected
                   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
                   * 副作用 / Effects: `rm`; `mkdir`; `createReadStream`; `createWriteStream`; `rename`.
                   * 拒绝 / Refusals: 条件 / conditions `(await current(entry.side, entry.path)) !== expected`; `entry.side === 'host'`; `(await hash(ftp.createReadStream(temp), active)) !== entry.before!.sha || (await current(entry.side, entry.path)) !== expecte…`; 异常 / errors `new AppError('恢复前文件已变化：' + entry.path, 409)`; `new AppError('恢复前文件变化或校验失败：' + entry.path, 409)`.
                   * 收尾：退出 try 区域时始终执行 `await removeStorageTemporary(lease, temp);`; `if (!transportSignal?.aborted) await new Promise<void>((resolve) => ftp.unlink(temp, () => resolve()));`；这些步骤也适用于异常退出。
                   * Finalization: Leaving the try region always executes `await removeStorageTemporary(lease, temp);`; `if (!transportSignal?.aborted) await new Promise<void>((resolve) => ftp.unlink(temp, () => resolve()));`; these steps also apply to exceptional exits.
                   */
                  const result = await history.restore(
                    checkpoint,
                    config,
                    current,
                    async (entry, blob, expected) => {
                      if ((await current(entry.side, entry.path)) !== expected)
                        throw new AppError('恢复前文件已变化：' + entry.path, 409);
                      if (entry.side === 'host') {
                        const target = await localPath(entry.path);
                        if (!blob) await rm(target);
                        else {
                          await mkdir(dirname(target), { recursive: true });
                          await localPath(entry.path);
                          const temp = join(dirname(target), '.sakura-restore-' + randomUUID());
                          try {
                            await pipeline(
                              createReadStream(blob),
                              storageGrowth(lease, temp, 256 * 1024 ** 2),
                              createWriteStream(temp, { flags: 'wx', mode: entry.before!.mode }),
                              { signal: active },
                            );
                            if ((await current(entry.side, entry.path)) !== expected)
                              throw new AppError('恢复前文件已变化：' + entry.path, 409);
                            await rename(temp, target);
                          } finally {
                            await removeStorageTemporary(lease, temp);
                          }
                        }
                      } else {
                        const target = await guestPath(entry.path, !!blob);
                        if (!blob)
                          await new Promise<void>((resolve, reject) =>
                            ftp.unlink(target, (error) => (error ? reject(error) : resolve())),
                          );
                        else {
                          const temp = posix.join(posix.dirname(target), '.sakura-restore-' + randomUUID());
                          try {
                            await pipeline(
                              createReadStream(blob),
                              ftp.createWriteStream(temp, { flags: 'wx', mode: entry.before!.mode }),
                              { signal: active },
                            );
                            if (entry.before!.uid !== undefined && entry.before!.gid !== undefined)
                              await new Promise<void>((resolve, reject) =>
                                ftp.chown(temp, entry.before!.uid!, entry.before!.gid!, (error) =>
                                  error ? reject(error) : resolve(),
                                ),
                              );
                            await new Promise<void>((resolve, reject) =>
                              ftp.chmod(temp, entry.before!.mode & 0o7777, (error) =>
                                error ? reject(error) : resolve(),
                              ),
                            );
                            if (
                              (await hash(ftp.createReadStream(temp), active)) !== entry.before!.sha ||
                              (await current(entry.side, entry.path)) !== expected
                            )
                              throw new AppError('恢复前文件变化或校验失败：' + entry.path, 409);
                            await new Promise<void>((resolve, reject) =>
                              ftp.ext_openssh_rename(temp, target, (error) =>
                                error ? reject(error) : resolve(),
                              ),
                            );
                          } finally {
                            if (!transportSignal?.aborted)
                              await new Promise<void>((resolve) => ftp.unlink(temp, () => resolve()));
                          }
                        }
                      }
                      log(`恢复 ${entry.side === 'host' ? 'Windows' : 'Linux'}：${entry.path}\n`);
                    },
                    active,
                  );
                  log(`已回滚 ${result.restored} 项文件变更，恢复共同版本；保留新建的空目录。\n`);
                },
                signal,
              );
            },
          );
        },
        {
          title: '同步回滚',
          vmId: id,
          projectId: this.projects?.current(id),
          action: 'rollback:' + checkpoint,
        },
      );
    });
  }
  /**
   * 入口 / Entry: FolderSync.runInternal.
   * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.jobs.start( this.key(id), async (log, signal) => { await this.execute(id, config, direction, log, signal, false, token, …` 供上层消费（`FolderSync`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; this entry produces `this.jobs.start( this.key(id), async (log, signal) => { await this.execute(id, config, direction, log, signal, false, token, …` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
   * 处理：通过 `this.config`, `this.machines.state`, `safeRelative`, `content.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.config`, `this.machines.state`, `safeRelative`, `content.includes`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; direction: 'both' | 'push' | 'pull'; token: string optional; decisions: SyncDecisions default={}; merges: SyncManualMerges default={}
   * 输出 / Returns: `this.jobs.start( this.key(id), async (log, signal) => { await this.execute(id, config, direction, log, signal, false, token, …`.
   * 副作用 / Effects: `this.jobs.start`; 更新 / updates `mergeBytes`.
   * 拒绝 / Refusals: 条件 / conditions `!config`; `this.machines.state(id) !== 'running'`; `Object.keys(decisions).length && !token`; 异常 / errors `new AppError('请先保存同步目录')`; `new AppError('请先启动发行版')`.
   */
  private async runInternal(
    id: string,
    direction: 'both' | 'push' | 'pull',
    token?: string,
    decisions: SyncDecisions = {},
    merges: SyncManualMerges = {},
  ) {
    const config = await this.config(id);
    if (!config) throw new AppError('请先保存同步目录');
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
    if (Object.keys(decisions).length && !token) throw new AppError('处理冲突前请先预览');
    const mergeEntries = Object.entries(merges);
    if (mergeEntries.length && (direction !== 'both' || !token))
      throw new AppError('手动合并需要双向同步预览', 409);
    if (mergeEntries.length > 8) throw new AppError('一次最多手动合并 8 个文件');
    let mergeBytes = 0;
    for (const [name, content] of mergeEntries) {
      safeRelative(name);
      if (decisions[name] !== 'manual' || typeof content !== 'string')
        throw new AppError('手动合并内容与冲突决策不匹配');
      mergeBytes += Buffer.byteLength(content, 'utf8');
      if (mergeBytes > SYNC_TEXT_BYTES) throw new AppError('手动合并内容合计不能超过 1 MiB');
      if (content.includes('\0') || Buffer.from(content, 'utf8').toString('utf8') !== content)
        throw new AppError('手动合并需要有效的 UTF-8 文本');
    }
    if (
      Object.entries(decisions).some(
        ([name, decision]) => decision === 'manual' && !Object.hasOwn(merges, name),
      )
    )
      throw new AppError('手动合并缺少已审阅的文本内容');
    return this.jobs.start(
      this.key(id),
      async (log, signal) => {
        await this.execute(id, config, direction, log, signal, false, token, decisions, merges);
      },
      { title: '目录同步', vmId: id, action: direction, projectId: this.projects?.current(id) },
    );
  }
  /**
   * 入口 / Entry: FolderSync.execute.
   * 功能：比较宿主与客户机清单及基线，处理删除、复制和三方文本冲突并提交新检查点。
   * Purpose: Compares host/guest manifests/baselines, performs deletes/copies/three-way merges and publishes a new checkpoint.
   * 设计：先保存可回滚原版本，每个修改前重新核对文件及父目录；暂存原子发布，失败保留检查点而不宣称两端一致。
   * Design: Rollback versions precede effects, each change rechecks files/parents and staging publishes atomically; failure retains checkpoints rather than claiming convergence.
   * 输入 / Inputs: id: string; config: SyncConfig; direction: 'both' | 'push' | 'pull'; log: (s: string) => void; signal: AbortSignal; preview: default=false; token: string optional; decisions: SyncDecisions default={}; merges: SyncManualMerges default={}; lease: StorageLease optional
   * 输出 / Returns: Promise<SyncPreview>；结果来自 / values from `storageRuntime.run( { owner: 'core:sync', taskId: 'sync:' + this.key(id), label: preview ? 'Scan synchronization files' : 'Sy…`; `plan`.
   * 副作用 / Effects: `signal.addEventListener`; `abortConnection`; `metadataFile().replace`; 更新 / updates `previous`, `bases`, `text`, `retained[name]`.
   * 拒绝 / Refusals: 条件 / conditions `root !== config.host`; `(await lstat(stateFile)).size > 32 * 1024 ** 2`; `(e as NodeJS.ErrnoException).code !== 'ENOENT'`; 异常 / errors `new AppError('本机目录位置已改变，请重新保存')`; `new AppError('同步状态文件超过限制')`.
   * 收尾：退出 try 区域时始终执行 `signal.removeEventListener('abort', abortConnection);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `signal.removeEventListener('abort', abortConnection);`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;`; `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;`; `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async execute(
    id: string,
    config: SyncConfig,
    direction: 'both' | 'push' | 'pull',
    log: (s: string) => void,
    signal: AbortSignal,
    preview = false,
    token?: string,
    decisions: SyncDecisions = {},
    merges: SyncManualMerges = {},
    lease?: StorageLease,
  ): Promise<SyncPreview> {
    if (!lease)
      return storageRuntime.run(
        {
          owner: 'core:sync',
          taskId: 'sync:' + this.key(id),
          label: preview ? 'Scan synchronization files' : 'Synchronize files with recovery checkpoint',
          mode: preview ? 'read' : 'write',
          paths: [config.host, vmDir(id)],
          dynamicTemporary: [config.host, vmDir(id)],
          buffers: 40 * 1024 ** 2,
          files: 16,
          signal,
        },
        (owned) => this.execute(id, config, direction, log, signal, preview, token, decisions, merges, owned),
      );
    lease.assertActive();
    let plan: SyncPreview = { token: '', changes: [], unchanged: 0 };
    const root = await realpath(config.host);
    if (root !== config.host) throw new AppError('本机目录位置已改变，请重新保存');
    const stateFile = this.file(id, 'sync-state');
    let previous: Record<string, string> = Object.create(null);
    try {
      if ((await lstat(stateFile)).size > 32 * 1024 ** 2) throw new AppError('同步状态文件超过限制');
      previous = Object.assign(Object.create(null), JSON.parse(await readFile(stateFile, 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const next: Record<string, string> = Object.create(null);
    let journal: Awaited<ReturnType<SyncHistory['begin']>> | undefined;
    const baseFile = this.file(id, 'sync-base');
    let bases: Record<string, string> = Object.create(null);
    if (config.mergeText) {
      try {
        if ((await lstat(baseFile)).size > 32 * 1024 ** 2) throw new AppError('同步共同版本文件超过限制');
        bases = Object.assign(Object.create(null), JSON.parse(await readFile(baseFile, 'utf8')));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    /**
     * 入口 / Entry: FolderSync.execute.digest.
     * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(value).digest('hex')` 供上层消费（`FolderSync`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; this entry produces `createHash('sha256').update(value).digest('hex')` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
     * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: value: string | Buffer
     * 输出 / Returns: `createHash('sha256').update(value).digest('hex')`.
     * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
    const rate = new ByteRate((config.bandwidthMiBps || 0) * 1024 ** 2);
    let count = 0,
      changed = 0,
      conflicts = 0;
    const hostFiles = new Map<string, string>(),
      guestFiles = new Map<string, string>();
    const hostDirs = new Set<string>(),
      guestDirs = new Set<string>();
    /**
     * 入口 / Entry: FolderSync.execute.check.
     * 功能：在协调宿主与客户机双向同步、冲突和回滚中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`FolderSync`）。
     * Purpose: Checks admission, input or resource ownership in `FolderSync`; the calls and state transitions below complete the operation. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
     * 处理：通过 `operationSignal.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `operationSignal.throwIfAborted`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: operationSignal: default=signal
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `++count > 20000`; 异常 / errors `new AppError('一次同步最多扫描 20000 个条目')`.
     */
    const check = (operationSignal = signal) => {
      operationSignal.throwIfAborted();
      if (++count > 20000) throw new AppError('一次同步最多扫描 20000 个条目');
    };
    /**
     * 入口 / Entry: FolderSync.execute.hostPath.
     * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；本入口产生 `destination` 供上层消费（`FolderSync`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; this entry produces `destination` for its caller. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
     * 处理：通过 `resolve`, `safeRelative().split`, `safeRelative`, `relative` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `resolve`, `safeRelative().split`, `safeRelative`, `relative`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: name: string
     * 输出 / Returns: `destination`.
     * 副作用 / Effects: `rel.startsWith`; 更新 / updates `current`.
     * 拒绝 / Refusals: 条件 / conditions `isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)`; `attrs?.isSymbolicLink()`; 异常 / errors `new AppError('同步路径越界')`; `new AppError('同步不会穿过符号链接或目录联接')`.
     */
    const hostPath = async (name: string) => {
      const destination = resolve(root, ...safeRelative(name).split('/'));
      const rel = relative(root, destination);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new AppError('同步路径越界');
      let current = root;
      for (const component of rel.split(sep)) {
        current = join(current, component);
        const attrs = await lstat(current).catch((e: NodeJS.ErrnoException) => {
          if (e.code !== 'ENOENT') throw e;
          return null;
        });
        if (attrs?.isSymbolicLink()) throw new AppError('同步不会穿过符号链接或目录联接');
      }
      return destination;
    };
    /**
     * 入口 / Entry: FolderSync.execute.scanHost.
     * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`FolderSync`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; the calls and state transitions below complete the operation. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
     * 处理：通过 `readdir`, `join`, `excluded.has`, `entry.name.toLowerCase` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `readdir`, `join`, `excluded.has`, `entry.name.toLowerCase`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `excluded.has(entry.name.toLowerCase()) || entry.name.toLowerCase().startsWith('.sakura-')`; `entry.isSymbolicLink()`; `ignored(name, config.ignore)`.
     * 输入 / Inputs: base: default=''
     * 输出 / Returns: Promise<void>.
     * 副作用 / Effects: `entry.name.toLowerCase().startsWith`; `hostDirs.add`; `hostFiles.set`; `createReadStream`.
     * 拒绝 / Refusals: 条件 / conditions `entry.isFile()`; `(await lstat(file)).size > 256 * 1024 ** 2`; 异常 / errors `new AppError(`${name} 超过同步单文件 256 MiB 限制`)`.
     */
    const scanHost = async (base = ''): Promise<void> => {
      for (const entry of await readdir(join(root, base), { withFileTypes: true })) {
        if (excluded.has(entry.name.toLowerCase()) || entry.name.toLowerCase().startsWith('.sakura-'))
          continue;
        check();
        if (entry.isSymbolicLink()) continue;
        const name = safeRelative(base ? base + '/' + entry.name : entry.name);
        if (ignored(name, config.ignore)) continue;
        if (entry.isDirectory()) {
          hostDirs.add(name);
          await scanHost(name);
        } else if (entry.isFile()) {
          const file = await hostPath(name);
          if ((await lstat(file)).size > 256 * 1024 ** 2)
            throw new AppError(`${name} 超过同步单文件 256 MiB 限制`);
          hostFiles.set(name, await hash(createReadStream(file), signal));
        }
      }
    };
    log('正在比较两个目录…\n');
    await scanHost();
    const connection = new AbortController();
    /**
     * 入口 / Entry: FolderSync.execute.abortConnection.
     * 功能：把本层请求转交 `connection.abort`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `connection.abort` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `connection.abort(signal.reason)`.
     * 副作用 / Effects: `connection.abort`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const abortConnection = () => connection.abort(signal.reason);
    signal.addEventListener('abort', abortConnection, { once: true });
    if (signal.aborted) abortConnection();
    try {
      /**
       * 入口 / Entry: FolderSync.execute.callback@936.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.sftp）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.sftp).
       * 输入 / Inputs: ftp; transportSignal
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `AbortSignal.any`; `renames.flatMap`; `renamed.has`; `changes.push`; `renames.map`; 更新 / updates `guestRootExists`, `plan`, `journal`, `bases[move.path]`.
       * 拒绝 / Refusals: 条件 / conditions `!attrs.isDirectory()`; `guestFiles.has(name)`; `hostFiles.has(name)`; 异常 / errors `new AppError(`目标不是普通目录：${part}`)`; `new AppError(`文件与目录冲突：${name}`)`.
       * 收尾：退出 try 区域时始终执行 `await removeStorageTemporary(lease, hostTemp);`; `if (!transportSignal?.aborted) await new Promise<void>((resolve) => ftp.unlink(guestTemp, () => resolve()));`；这些步骤也适用于异常退出。
       * Finalization: Leaving the try region always executes `await removeStorageTemporary(lease, hostTemp);`; `if (!transportSignal?.aborted) await new Promise<void>((resolve) => ftp.unlink(guestTemp, () => resolve()));`; these steps also apply to exceptional exits.
       * 失败处理：catch 分支执行 `if (!automatic) throw error;`; `conflicts++;`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `if (!automatic) throw error;`; `conflicts++;`; these statements determine whether a failure is absorbed or rejected again.
       */
      await this.machines.sftp(
        id,
        async (ftp, transportSignal) => {
          signal.removeEventListener('abort', abortConnection);
          const transferSignal = transportSignal ? AbortSignal.any([signal, transportSignal]) : signal;
          transferSignal.throwIfAborted();
          /**
           * 入口 / Entry: FolderSync.execute.ensureGuest.
           * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`FolderSync`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; the calls and state transitions below complete the operation. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
           * 处理：通过 `posix.normalize().split().filter`, `posix.normalize().split`, `posix.normalize`, `transferSignal.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `posix.normalize().split().filter`, `posix.normalize().split`, `posix.normalize`, `transferSignal.throwIfAborted`; the branches below determine continuation, return or refusal.
           * 分支 / Branches: `!attrs`.
           * 输入 / Inputs: path: string
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: 更新 / updates `current`.
           * 拒绝 / Refusals: 条件 / conditions `attrs && !attrs.isDirectory()`; 异常 / errors `new AppError(`目标不是普通目录：${current}`)`.
           */
          const ensureGuest = async (path: string) => {
            let current = '';
            for (const part of posix.normalize(path).split('/').filter(Boolean)) {
              transferSignal.throwIfAborted();
              current += '/' + part;
              const attrs = await ftpStat(ftp, current);
              if (attrs && !attrs.isDirectory()) throw new AppError(`目标不是普通目录：${current}`);
              if (!attrs)
                await new Promise<void>((res, rej) => ftp.mkdir(current, (err) => (err ? rej(err) : res())));
            }
          };
          // A preview must not create either directories or state files.
          let guestRootExists = true;
          for (const part of config.guest
            .split('/')
            .filter(Boolean)
            .map((_, i, a) => '/' + a.slice(0, i + 1).join('/'))) {
            const attrs = await ftpStat(ftp, part);
            if (!attrs) {
              guestRootExists = false;
              break;
            }
            if (!attrs.isDirectory()) throw new AppError(`目标不是普通目录：${part}`);
          }
          /**
           * 入口 / Entry: FolderSync.execute.scanGuest.
           * 功能：在协调宿主与客户机双向同步、冲突和回滚中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`FolderSync`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `FolderSync`; the calls and state transitions below complete the operation. Module context: Coordinates host/guest bidirectional sync, conflicts and rollback using original file versions/checkpoints to validate changes.
           * 处理：通过 `transferSignal.throwIfAborted`, `excluded.has`, `entry.filename.toLowerCase`, `entry.filename.toLowerCase().startsWith` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `transferSignal.throwIfAborted`, `excluded.has`, `entry.filename.toLowerCase`, `entry.filename.toLowerCase().startsWith`; the branches below determine continuation, return or refusal.
           * 分支 / Branches: `excluded.has(entry.filename.toLowerCase()) || entry.filename.toLowerCase().startsWith('.sakura-')`; `kind === 0xa000`; `ignored(name, config.ignore)`.
           * 输入 / Inputs: base: default=''
           * 输出 / Returns: Promise<void>.
           * 副作用 / Effects: `entry.filename.toLowerCase().startsWith`; `guestDirs.add`; `guestFiles.set`; `ftp.createReadStream`.
           * 拒绝 / Refusals: 条件 / conditions `kind === 0x8000`; `entry.attrs.size > 256 * 1024 ** 2`; 异常 / errors `new AppError(`${name} 超过同步单文件 256 MiB 限制`)`.
           */
          const scanGuest = async (base = ''): Promise<void> => {
            transferSignal.throwIfAborted();
            const entries = await new Promise<import('ssh2').FileEntry[]>((res, rej) =>
              ftp.readdir(posix.join(config.guest, base), (err, entries) => (err ? rej(err) : res(entries))),
            );
            for (const entry of entries) {
              if (
                excluded.has(entry.filename.toLowerCase()) ||
                entry.filename.toLowerCase().startsWith('.sakura-')
              )
                continue;
              check(transferSignal);
              const kind = entry.attrs.mode & 0xf000;
              if (kind === 0xa000) continue;
              const name = safeRelative(base ? base + '/' + entry.filename : entry.filename);
              if (ignored(name, config.ignore)) continue;
              if (kind === 0x4000) {
                guestDirs.add(name);
                await scanGuest(name);
              } else if (kind === 0x8000) {
                if (entry.attrs.size > 256 * 1024 ** 2)
                  throw new AppError(`${name} 超过同步单文件 256 MiB 限制`);
                guestFiles.set(
                  name,
                  await hash(ftp.createReadStream(posix.join(config.guest, name)), transferSignal),
                );
              }
            }
          };
          if (guestRootExists) await scanGuest();
          validateSyncPaths([...hostDirs, ...guestDirs, ...hostFiles.keys(), ...guestFiles.keys()]);
          for (const name of hostDirs)
            if (guestFiles.has(name)) throw new AppError(`文件与目录冲突：${name}`);
          for (const name of guestDirs)
            if (hostFiles.has(name)) throw new AppError(`文件与目录冲突：${name}`);
          /**
           * 入口 / Entry: FolderSync.execute.allowed.
           * 功能：把本层请求转交 `policyAllows`，沿用该实现的结果与失败路径。
           * Purpose: Delegates this request to `policyAllows` and propagates the provider result or rejection.
           * 输入 / Inputs: name: string; action: string
           * 输出 / Returns: `policyAllows(name, action, config.policies)`.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          const allowed = (name: string, action: string) => policyAllows(name, action, config.policies);
          const renames = config.detectRenames
            ? detectSyncRenames(hostFiles, guestFiles, previous).filter(
                (move) => allowed(move.from, move.action) && allowed(move.path, move.action),
              )
            : [];
          const renamed = new Set(renames.flatMap((move) => [move.from, move.path]));
          const changes: SyncChange[] = [];
          let unchanged = 0;
          for (const name of new Set([...hostFiles.keys(), ...guestFiles.keys()])) {
            if (renamed.has(name)) continue;
            const way = syncDirection(hostFiles.get(name), guestFiles.get(name), previous[name]);
            if (way === 'same') unchanged++;
            else if (
              previous[name] &&
              !hostFiles.has(name) &&
              guestFiles.has(name) &&
              previous[name] === guestFiles.get(name)
            )
              changes.push({ path: name, action: allowed(name, 'delete-guest') ? 'delete-guest' : 'skip' });
            else if (
              previous[name] &&
              hostFiles.has(name) &&
              !guestFiles.has(name) &&
              previous[name] === hostFiles.get(name)
            )
              changes.push({ path: name, action: allowed(name, 'delete-host') ? 'delete-host' : 'skip' });
            else {
              const selected = way === 'conflict' ? configuredDriver(name, config) : null;
              changes.push({
                path: name,
                action: (
                  way === 'conflict' ? allowed(name, 'push') || allowed(name, 'pull') : allowed(name, way)
                )
                  ? way
                  : 'skip',
                ...(selected ? { driver: selected.driver, suggestedDecision: selected.decision } : {}),
              });
            }
          }
          changes.push(...renames.map(({ from, path, action }) => ({ from, path, action })));
          for (const name of hostDirs)
            if (!guestDirs.has(name) && allowed(name, 'mkdir-guest'))
              changes.push({ path: name, action: 'mkdir-guest' });
          for (const name of guestDirs)
            if (!hostDirs.has(name) && allowed(name, 'mkdir-host'))
              changes.push({ path: name, action: 'mkdir-host' });
          plan = {
            token: createHash('sha256')
              .update(
                JSON.stringify([
                  config,
                  [...hostFiles].sort(),
                  [...guestFiles].sort(),
                  [...hostDirs].sort(),
                  [...guestDirs].sort(),
                  previous,
                ]),
              )
              .digest('hex'),
            changes,
            unchanged,
          };
          if (preview) return;
          if (token && token !== plan.token) throw new AppError('预览后文件或配置已变化，请重新预览', 409);
          for (const name of Object.keys(merges)) {
            if (!changes.some((change) => change.path === name && change.action === 'conflict'))
              throw new AppError('手动合并只允许处理当前预览中的冲突：' + name, 409);
            if (
              !config.mergeText ||
              !allowed(name, 'merge') ||
              typeof bases[name] !== 'string' ||
              digest(bases[name]) !== previous[name]
            )
              throw new AppError('没有可校验的共同版本或路径策略禁止合并：' + name, 409);
            decodeSyncText(Buffer.from(bases[name]));
          }
          if (config.rollback && changes.some((change) => change.action !== 'skip')) {
            log('保存同步回滚点…\n');
            /**
             * 入口 / Entry: FolderSync.execute.callback@1081.
             * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.history().begin）。
             * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.history().begin).
             * 输入 / Inputs: side; name
             * 输出 / Returns: `{ stream: createReadStream(file), mode: info.mode }`; `{ stream: ftp.createReadStream(file), mode: info.mode, uid: info.uid, gid: info.gid }`.
             * 副作用 / Effects: `createReadStream`; `ftp.createReadStream`.
             * 拒绝 / Refusals: 条件 / conditions `side === 'host'`; `!info.isFile()`; `!info?.isFile()`; 异常 / errors `new AppError('回滚源不是普通文件：' + name)`.
             */
            journal = await this.history(id).begin(
              config,
              { host: hostFiles, guest: guestFiles },
              async (side, name) => {
                if (side === 'host') {
                  const file = await hostPath(name),
                    info = await lstat(file);
                  if (!info.isFile()) throw new AppError('回滚源不是普通文件：' + name);
                  return { stream: createReadStream(file), mode: info.mode };
                }
                const file = posix.join(config.guest, name),
                  info = await ftpStat(ftp, file);
                if (!info?.isFile()) throw new AppError('回滚源不是普通文件：' + name);
                return { stream: ftp.createReadStream(file), mode: info.mode, uid: info.uid, gid: info.gid };
              },
              transferSignal,
              lease,
            );
          }
          await ensureGuest(config.guest);
          if (direction !== 'pull')
            for (const name of hostDirs) {
              if (!allowed(name, 'mkdir-guest')) continue;
              transferSignal.throwIfAborted();
              await ensureGuest(posix.join(config.guest, name));
            }
          if (direction !== 'push')
            for (const name of guestDirs) {
              if (!allowed(name, 'mkdir-host')) continue;
              transferSignal.throwIfAborted();
              await mkdir(await hostPath(name), { recursive: true });
            }
          for (const move of renames) {
            if (
              (direction === 'push' && move.action !== 'rename-guest') ||
              (direction === 'pull' && move.action !== 'rename-host')
            )
              continue;
            transferSignal.throwIfAborted();
            const side = move.action === 'rename-guest' ? 'guest' : 'host';
            await journal?.prepare([
              { side, path: move.from, after: null },
              { side, path: move.path, after: move.sha },
            ]);
            if (move.action === 'rename-guest') {
              const from = posix.join(config.guest, move.from),
                to = posix.join(config.guest, move.path);
              await ensureGuest(posix.dirname(from));
              await ensureGuest(posix.dirname(to));
              const info = await ftpStat(ftp, from);
              if (
                !info?.isFile() ||
                (await ftpStat(ftp, to)) ||
                (await hash(ftp.createReadStream(from), transferSignal)) !== move.sha ||
                (await lstat(await hostPath(move.from)).catch((error) => {
                  if (error.code !== 'ENOENT') throw error;
                  return null;
                })) ||
                (await hash(createReadStream(await hostPath(move.path)), transferSignal)) !== move.sha
              )
                throw new AppError('重命名前文件已变化，请重新预览：' + move.path, 409);
              // SFTP v3 rename fails if the destination already exists.
              await new Promise<void>((resolve, reject) =>
                ftp.rename(from, to, (error) => (error ? reject(error) : resolve())),
              );
              guestFiles.delete(move.from);
              guestFiles.set(move.path, move.sha);
            } else {
              const from = await hostPath(move.from),
                to = await hostPath(move.path);
              await mkdir(dirname(to), { recursive: true });
              await hostPath(move.path);
              if (
                (await ftpStat(ftp, posix.join(config.guest, move.from))) ||
                (await hash(createReadStream(from), transferSignal)) !== move.sha ||
                (await hash(ftp.createReadStream(posix.join(config.guest, move.path)), transferSignal)) !==
                  move.sha
              )
                throw new AppError('重命名前文件已变化，请重新预览：' + move.path, 409);
              // Hard linking gives Windows an exclusive destination; rename would overwrite it.
              await link(from, to);
              await rm(from);
              hostFiles.delete(move.from);
              hostFiles.set(move.path, move.sha);
            }
            if (bases[move.from] !== undefined) bases[move.path] = bases[move.from];
            delete bases[move.from];
            delete previous[move.from];
            previous[move.path] = move.sha;
            changed++;
            log(
              `重命名${move.action === 'rename-guest' ? ' Linux' : ' Windows'}：${move.from} → ${move.path}\n`,
            );
          }
          for (const name of new Set([...hostFiles.keys(), ...guestFiles.keys(), ...Object.keys(previous)])) {
            transferSignal.throwIfAborted();
            const hostHash = hostFiles.get(name),
              guestHash = guestFiles.get(name);
            if (hostHash === guestHash) {
              if (hostHash) next[name] = hostHash;
              continue;
            }
            if (ignored(name, config.ignore) || (!allowed(name, 'push') && !allowed(name, 'pull'))) {
              if (previous[name]) next[name] = previous[name];
              continue;
            }
            let way: 'both' | 'push' | 'pull' | 'delete-host' | 'delete-guest' | 'skip' = direction;
            if (!hostHash && guestHash && previous[name] === guestHash)
              way =
                decisions[name] === 'delete-guest'
                  ? 'delete-guest'
                  : decisions[name] === 'restore-host' || direction === 'pull'
                    ? 'pull'
                    : 'skip';
            if (hostHash && !guestHash && previous[name] === hostHash)
              way =
                decisions[name] === 'delete-host'
                  ? 'delete-host'
                  : decisions[name] === 'restore-guest' || direction === 'push'
                    ? 'push'
                    : 'skip';
            if (!hostHash && !guestHash) continue;
            if (way === 'both') {
              if (hostHash && !guestHash) way = 'push';
              else if (guestHash && !hostHash) way = 'pull';
              else if (previous[name] && previous[name] === guestHash) way = 'push';
              else if (previous[name] && previous[name] === hostHash) way = 'pull';
              else {
                const selected = configuredDriver(name, config);
                const automatic = !Object.hasOwn(decisions, name) && !!selected;
                const decision = Object.hasOwn(decisions, name) ? decisions[name] : selected?.decision;
                const requested =
                  decision === 'restore-host' ? 'pull' : decision === 'restore-guest' ? 'push' : decision;
                if (requested && requested !== 'skip' && !allowed(name, requested))
                  throw new AppError('路径策略禁止此同步方向：' + name, 409);
                if (decision === 'merge' || decision === 'manual') {
                  const base = bases[name];
                  if (!config.mergeText || typeof base !== 'string' || digest(base) !== previous[name]) {
                    if (automatic) {
                      conflicts++;
                      if (previous[name]) next[name] = previous[name];
                      log('自动文本合并缺少共同版本，保留两端：' + name + '\n');
                      continue;
                    }
                    throw new AppError('没有可校验的共同版本，请先启用文本版本保存并完成一次同步：' + name);
                  }
                  const local = await hostPath(name),
                    remote = posix.join(config.guest, name);
                  const attrs = await ftpStat(ftp, remote),
                    localAttrs = await lstat(local);
                  if (!attrs?.isFile() || attrs.size > 1024 ** 2 || localAttrs.size > 1024 ** 2) {
                    if (automatic) {
                      conflicts++;
                      next[name] = previous[name];
                      log('自动文本合并不支持此文件，保留两端：' + name + '\n');
                      continue;
                    }
                    throw new AppError('三方同步只支持 1 MiB 以内的普通文件');
                  }
                  const ours = await readFile(local),
                    chunks: Buffer[] = [];
                  let bytes = 0;
                  /**
                   * 入口 / Entry: FolderSync.execute.callback@1240.
                   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.sftp）。
                   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.sftp).
                   * 输入 / Inputs: resolve; reject
                   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
                   * 副作用 / Effects: `ftp.createReadStream`; `transferSignal.addEventListener`; `abort`.
                   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                   */
                  await new Promise<void>((resolve, reject) => {
                    const stream = ftp.createReadStream(remote);
                    let ended = false;
                    /**
                     * 入口 / Entry: FolderSync.execute.abort.
                     * 功能：把本层请求转交 `stream.destroy`，沿用该实现的结果与失败路径。
                     * Purpose: Delegates this request to `stream.destroy` and propagates the provider result or rejection.
                     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
                     * 输出 / Returns: `stream.destroy(transferSignal.reason)`.
                     * 副作用 / Effects: `stream.destroy`.
                     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                     */
                    const abort = () => stream.destroy(transferSignal.reason);
                    /**
                     * 入口 / Entry: FolderSync.execute.cleanup.
                     * 功能：把本层请求转交 `transferSignal.removeEventListener`，沿用该实现的结果与失败路径。
                     * Purpose: Delegates this request to `transferSignal.removeEventListener` and propagates the provider result or rejection.
                     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
                     * 输出 / Returns: `transferSignal.removeEventListener('abort', abort)`.
                     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
                     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                     */
                    const cleanup = () => transferSignal.removeEventListener('abort', abort);
                    stream.on('data', (chunk: Buffer) => {
                      bytes += chunk.length;
                      if (bytes > 1024 ** 2) stream.destroy(new AppError('远端文本超过 1 MiB'));
                      else chunks.push(Buffer.from(chunk));
                    });
                    stream.once('end', () => {
                      ended = true;
                    });
                    stream.once('error', (error: Error) => {
                      cleanup();
                      reject(error);
                    });
                    stream.once('close', () => {
                      cleanup();
                      if (transferSignal.aborted) reject(transferSignal.reason);
                      else if (ended) resolve();
                      else reject(new AppError('文本读取未完成'));
                    });
                    transferSignal.addEventListener('abort', abort, { once: true });
                    if (transferSignal.aborted) abort();
                  });
                  const theirs = Buffer.concat(chunks);
                  if (digest(ours) !== hostHash || digest(theirs) !== guestHash)
                    throw new AppError('合并期间文件发生变化，请重新预览', 409);
                  let oursText: string, theirsText: string;
                  try {
                    oursText = decodeSyncText(ours);
                    theirsText = decodeSyncText(theirs);
                  } catch (error) {
                    if (!automatic) throw error;
                    conflicts++;
                    next[name] = previous[name];
                    log('自动文本合并遇到二进制文件，保留两端：' + name + '\n');
                    continue;
                  }
                  const parts = threeWayMerge(base, oursText, theirsText);
                  if (decision === 'merge' && parts.some((part) => part.kind === 'conflict')) {
                    conflicts++;
                    next[name] = previous[name];
                    log('三方合并存在重叠修改，保留两端供手动处理：' + name + '\n');
                    continue;
                  }
                  const merged = Buffer.from(decision === 'manual' ? merges[name] : resolvedMerge(parts, {}));
                  await journal?.prepare([
                    { side: 'host', path: name, after: digest(merged) },
                    { side: 'guest', path: name, after: digest(merged) },
                  ]);
                  const hostTemp = join(dirname(local), '.sakura-sync-' + randomUUID());
                  const guestTemp = posix.join(posix.dirname(remote), '.sakura-sync-' + randomUUID());
                  try {
                    await lease.reserveTemporary(hostTemp, merged.length);
                    await writeFile(hostTemp, merged, { flag: 'wx', mode: localAttrs.mode });
                    await pipeline(
                      Readable.from([merged]),
                      rate.stream(transferSignal),
                      ftp.createWriteStream(guestTemp, { flags: 'wx', mode: attrs.mode }),
                      { signal: transferSignal },
                    );
                    await preserveFileMetadata(ftp, guestTemp, attrs);
                    const mode = pathPolicy(name, config.policies)?.guestMode;
                    if (mode)
                      await new Promise<void>((resolve, reject) =>
                        ftp.chmod(guestTemp, parseInt(mode, 8), (error) =>
                          error ? reject(error) : resolve(),
                        ),
                      );
                    if (
                      (await hash(ftp.createReadStream(guestTemp), transferSignal)) !== digest(merged) ||
                      (await hash(ftp.createReadStream(remote), transferSignal)) !== guestHash ||
                      (await hash(createReadStream(await hostPath(name)), transferSignal)) !== hostHash
                    )
                      throw new AppError('合并提交前文件变化或校验失败，已保留原文件', 409);
                    transferSignal.throwIfAborted();
                    await new Promise<void>((resolve, reject) =>
                      ftp.ext_openssh_rename(guestTemp, remote, (error) =>
                        error ? reject(error) : resolve(),
                      ),
                    );
                    try {
                      await rename(hostTemp, local);
                    } catch (error) {
                      log('Linux 端已保存合并内容，Windows 端保留原文件，请重新预览：' + name + '\n');
                      throw error;
                    }
                    next[name] = digest(merged);
                    bases[name] = merged.toString('utf8');
                    changed++;
                    log('已完成三方文本合并：' + name + '\n');
                  } finally {
                    await removeStorageTemporary(lease, hostTemp);
                    if (!transportSignal?.aborted)
                      await new Promise<void>((resolve) => ftp.unlink(guestTemp, () => resolve()));
                  }
                  continue;
                }
                if (decision === 'push' || decision === 'pull') way = decision;
                else if (decision === 'both') {
                  const backup = `${name}.linux-conflict-${randomUUID().slice(0, 8)}`;
                  const localBackup = await hostPath(backup),
                    remoteBackup = posix.join(config.guest, backup);
                  const remoteOriginal = posix.join(config.guest, name);
                  if (!allowed(backup, 'push') || !allowed(backup, 'pull'))
                    throw new AppError('冲突副本路径受同步策略限制：' + backup);
                  const originalMetadata = await ftpStat(ftp, remoteOriginal);
                  if (!originalMetadata?.isFile()) throw new AppError('冲突文件已变化，请重新预览：' + name);
                  await journal?.prepare([
                    { side: 'host', path: backup, after: guestHash! },
                    { side: 'guest', path: backup, after: guestHash! },
                  ]);
                  const temp = join(dirname(localBackup), '.sakura-sync-' + randomUUID());
                  try {
                    await pipeline(
                      ftp.createReadStream(remoteOriginal),
                      rate.stream(transferSignal),
                      storageGrowth(lease, temp, 256 * 1024 ** 2),
                      createWriteStream(temp, { flags: 'wx' }),
                      { signal: transferSignal },
                    );
                    if ((await hash(createReadStream(temp), transferSignal)) !== guestHash)
                      throw new AppError(`文件在同步中改变：${name}`);
                    // Exclusive creation preserves any existing conflict copies.
                    await pipeline(
                      createReadStream(temp),
                      rate.stream(transferSignal),
                      ftp.createWriteStream(remoteBackup, { flags: 'wx', mode: 0o644 }),
                      { signal: transferSignal },
                    );
                    await preserveFileMetadata(ftp, remoteBackup, originalMetadata);
                    const backupMode =
                      pathPolicy(backup, config.policies)?.guestMode ||
                      pathPolicy(name, config.policies)?.guestMode;
                    if (backupMode)
                      await new Promise<void>((resolve, reject) =>
                        ftp.chmod(remoteBackup, parseInt(backupMode, 8), (error) =>
                          error ? reject(error) : resolve(),
                        ),
                      );
                    transferSignal.throwIfAborted();
                    await link(temp, localBackup);
                    next[backup] = guestHash!;
                    log(`Linux 版本另存为 ${backup}\n`);
                  } finally {
                    await removeStorageTemporary(lease, temp);
                  }
                  way = 'push';
                } else {
                  conflicts++;
                  if (previous[name]) next[name] = previous[name];
                  log(`冲突，保留两边：${name}\n`);
                  continue;
                }
              }
            }
            const local = await hostPath(name),
              remote = posix.join(config.guest, name);
            if (!allowed(name, way)) {
              if (previous[name]) next[name] = previous[name];
              log('路径策略跳过：' + name + '\n');
              continue;
            }
            if (way === 'delete-guest' && !hostHash && guestHash) {
              await journal?.prepare([{ side: 'guest', path: name, after: null }]);
              await ensureGuest(posix.dirname(remote));
              const info = await ftpStat(ftp, remote);
              if (!info?.isFile() || (await hash(ftp.createReadStream(remote), transferSignal)) !== guestHash)
                throw new AppError('删除前 Linux 文件已变化：' + name, 409);
              await new Promise<void>((resolve, reject) =>
                ftp.unlink(posix.join(config.guest, name), (error) => (error ? reject(error) : resolve())),
              );
              delete next[name];
            } else if (way === 'delete-host' && hostHash && !guestHash) {
              await journal?.prepare([{ side: 'host', path: name, after: null }]);
              if ((await hash(createReadStream(await hostPath(name)), transferSignal)) !== hostHash)
                throw new AppError('删除前 Windows 文件已变化：' + name, 409);
              await rm(local);
              delete next[name];
            } else if (way === 'push' && hostHash) {
              await journal?.prepare([{ side: 'guest', path: name, after: hostHash }]);
              await ensureGuest(posix.dirname(remote));
              const attrs = await ftpStat(ftp, remote);
              if (attrs && !attrs.isFile()) throw new AppError(`目标不是普通文件：${remote}`);
              const temp = posix.join(posix.dirname(remote), '.sakura-sync-' + randomUUID());
              try {
                await pipeline(
                  createReadStream(local),
                  rate.stream(transferSignal),
                  ftp.createWriteStream(temp, { flags: 'wx', mode: attrs?.mode || 0o644 }),
                  { signal: transferSignal },
                );
                const uploaded = await hash(ftp.createReadStream(temp), transferSignal);
                if (uploaded !== hostHash) throw new AppError(`文件在同步中改变，请重试：${name}`);
                if (attrs) await preserveFileMetadata(ftp, temp, attrs);
                const mode = pathPolicy(name, config.policies)?.guestMode;
                if (mode)
                  await new Promise<void>((resolve, reject) =>
                    ftp.chmod(temp, parseInt(mode, 8), (error) => (error ? reject(error) : resolve())),
                  );
                const current = await ftpStat(ftp, remote);
                if (
                  (current ? await hash(ftp.createReadStream(remote), transferSignal) : undefined) !==
                  guestHash
                )
                  throw new AppError(`目标在同步中改变，已保留原文件：${name}`);
                transferSignal.throwIfAborted();
                await new Promise<void>((res, rej) =>
                  ftp.ext_openssh_rename(temp, remote, (err) => (err ? rej(err) : res())),
                );
                next[name] = hostHash;
              } finally {
                if (!transportSignal?.aborted)
                  await new Promise<void>((res) => ftp.unlink(temp, () => res()));
              }
            } else if (way === 'pull' && guestHash) {
              await journal?.prepare([{ side: 'host', path: name, after: guestHash }]);
              await mkdir(dirname(local), { recursive: true });
              await hostPath(name);
              const temp = join(dirname(local), '.sakura-sync-' + randomUUID());
              try {
                await pipeline(
                  ftp.createReadStream(remote),
                  rate.stream(transferSignal),
                  storageGrowth(lease, temp, 256 * 1024 ** 2),
                  createWriteStream(temp, { flags: 'wx' }),
                  {
                    signal: transferSignal,
                  },
                );
                if ((await hash(createReadStream(temp), transferSignal)) !== guestHash)
                  throw new AppError(`文件在同步中改变，请重试：${name}`);
                const current = await lstat(await hostPath(name)).catch((e: NodeJS.ErrnoException) => {
                  if (e.code !== 'ENOENT') throw e;
                  return null;
                });
                if ((current ? await hash(createReadStream(local), transferSignal) : undefined) !== hostHash)
                  throw new AppError(`目标在同步中改变，已保留原文件：${name}`);
                transferSignal.throwIfAborted();
                await rename(temp, local);
                next[name] = guestHash;
              } finally {
                await removeStorageTemporary(lease, temp);
              }
            } else {
              if (previous[name]) next[name] = previous[name];
              continue;
            }
            changed++;
            log(
              `${way === 'push' ? '上传' : way === 'pull' ? '下载' : way === 'delete-host' ? '删除 Windows 文件' : '删除 Linux 文件'}：${name}\n`,
            );
          }
        },
        connection.signal,
      );
    } catch (error) {
      await journal?.finish(error);
      throw error;
    } finally {
      signal.removeEventListener('abort', abortConnection);
    }
    signal.throwIfAborted();
    if (preview) return plan;
    try {
      if (config.mergeText) {
        const retained: Record<string, string> = Object.create(null);
        let total = 0,
          serializedBytes = 2;
        for (const [name, sha] of Object.entries(next)) {
          let text = typeof bases[name] === 'string' && digest(bases[name]) === sha ? bases[name] : undefined;
          if (text === undefined) {
            const file = await hostPath(name);
            const info = await lstat(file).catch((error) => {
              if (error.code !== 'ENOENT') throw error;
              return null;
            });
            if (info?.isFile() && info.size <= 1024 ** 2) {
              const bytes = await readFile(file);
              if (digest(bytes) === sha) {
                try {
                  text = decodeSyncText(bytes);
                } catch {}
              }
            }
          }
          const cost =
            text === undefined
              ? 0
              : Buffer.byteLength(JSON.stringify(name)) + Buffer.byteLength(JSON.stringify(text)) + 2;
          if (
            text !== undefined &&
            total + Buffer.byteLength(text) <= 16 * 1024 ** 2 &&
            serializedBytes + cost <= 32 * 1024 ** 2
          ) {
            retained[name] = text;
            total += Buffer.byteLength(text);
            serializedBytes += cost;
          }
        }
        await metadataFile<Record<string, string>>(baseFile, () => ({})).replace(retained);
      }
      await metadataFile<Record<string, string>>(stateFile, () => ({})).replace(next);
      await journal?.finish();
    } catch (error) {
      await journal?.finish(error);
      throw error;
    }
    log(`完成：${changed} 个文件已同步，${conflicts} 个冲突。仅按明确决策传播删除。\n`);
    return plan;
  }
}
