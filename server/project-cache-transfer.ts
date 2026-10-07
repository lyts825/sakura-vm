/**
 * 模块职责：登记项目缓存转交票据并分配受控暂存区，归属或退休未确认时保留原任务证明。
 * Module purpose: Registers cache handoff tickets and staging areas; unconfirmed ownership/retirement retains original task evidence.
 */
import { randomUUID } from 'node:crypto';
import { readdir, readFile, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import type { Project } from './project-config.ts';
import { AppError } from '../shared/errors.ts';
import { vmDir } from './paths.ts';
import { quote } from './shell.ts';
import { writeStore } from './local-store.ts';
import { projectIdSchema } from './project-catalog.ts';
import { dependencyManagerSchema, type DependencyManager } from './project-dependency-cache.ts';
import {
  projectIdentityRunSchema,
  projectIdentitySchema,
  projectIdentitySources,
} from './project-identity.ts';
import {
  ProjectRunScopes,
  type ProjectTaskAdmissionOptions,
  type ProjectTaskResourceContext,
  type ProjectTaskResourceReceipt,
} from './project-run-scope.ts';
import { projectCacheTransferControl } from './project-cache-transfer-control.ts';

export const projectCacheTransferLimits = Object.freeze({ fileBytes: 64 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024, nodes: 65536, depth: 32, controlBytes: 16384,
  replyBytes: 32768, pendingRecords: 1024 });
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/), uuid = z.uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);
const inode = z.object({ device: decimal, inode: decimal.refine(value => value !== '0') }).strict();
export const projectCacheTransferOwnerSchema = z.object({ stageId: uuid, manager: dependencyManagerSchema, build: digest,
  identity: projectIdentitySchema, owner: z.object({ kind: z.literal('task'), runId: uuid, bootId: uuid }).strict(), sha256: digest,
}).strict().refine(value => value.identity.phase === 'active');
export type ProjectCacheTransferOwner = z.infer<typeof projectCacheTransferOwnerSchema>;
const taskReceiptSchema = z.object({ run: projectIdentityRunSchema.nullable(),
  retirement: z.object({ reason: z.literal('guest-reboot'), bootId: uuid }).strict().optional() }).strict();
export const projectCacheTransferReceiptSchema = z.object({ version: z.literal(1),
  phase: z.enum(['copying', 'ready', 'retiring', 'closed']), owner: projectCacheTransferOwnerSchema, stage: inode, data: inode,
  manifest: z.object({ sha256: digest, bytes: z.number().int().min(0).max(projectCacheTransferLimits.totalBytes),
    nodes: z.number().int().min(1).max(projectCacheTransferLimits.nodes) }).strict().nullable(),
  task: taskReceiptSchema.nullable(),
}).strict().refine(value => value.stage.device === value.data.device &&
  (value.phase === 'copying' || value.manifest !== null || value.phase === 'retiring' || value.phase === 'closed') &&
  ((value.phase === 'retiring' || value.phase === 'closed') === Boolean(value.task)));
type Preparation = z.infer<typeof projectCacheTransferReceiptSchema>;
const replySchema = z.discriminatedUnion('state', [
  z.object({ version: z.literal(1), state: z.literal('absent'), bootId: uuid }).strict(),
  z.object({ version: z.literal(1), state: z.literal('present'), bootId: uuid, receipt: projectCacheTransferReceiptSchema }).strict(),
]);
export type ProjectCacheTransferReply = z.infer<typeof replySchema>;
const recordSchema = z.object({ version: z.literal(1), phase: z.enum(['intent', 'prepared', 'retiring', 'closed']),
  owner: projectCacheTransferOwnerSchema, preparation: projectCacheTransferReceiptSchema.nullable(),
  task: taskReceiptSchema.nullable(), retirement: replySchema.nullable(),
}).strict().refine(value => (!value.preparation || same(value.preparation.owner, value.owner)) &&
  (value.phase !== 'prepared' || value.preparation?.phase === 'ready') &&
  (value.phase !== 'closed' || Boolean(value.task && value.retirement)));
type Record = z.infer<typeof recordSchema>;
/**
 * 入口 / Entry: same.
 * 功能：从当前输入或状态计算 `JSON.stringify(left) === JSON.stringify(right)`，供调用方后续验证或使用。
 * Purpose: Computes `JSON.stringify(left) === JSON.stringify(right)` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: left: unknown; right: unknown
 * 输出 / Returns: `JSON.stringify(left) === JSON.stringify(right)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
/**
 * 入口 / Entry: cleanupFailure.
 * 功能：从当前输入或状态计算 `new AppError('项目缓存转交归属或退休未确认，原完整任务证明继续保留', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('项目缓存转交归属或退休未确认，原完整任务证明继续保留', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('项目缓存转交归属或退休未确认，原完整任务证明继续保留', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const cleanupFailure = () => new AppError('项目缓存转交归属或退休未确认，原完整任务证明继续保留', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
const queues = new WeakMap<Machines, Map<string, Promise<unknown>>>();
const active = new WeakMap<Machines, Set<string>>();
export type ProjectCacheTransferOptions = {
  rootDirectory?: string;
  source?: typeof projectIdentitySources;
  scopes?: Pick<ProjectRunScopes, 'recoverStoppedTasks' | 'taskResourceReceipt' | 'taskResources' | 'completeTaskResource'>;
  /**
   * 签名 / Signature: ProjectCacheTransferOptions.control.
   * 功能：为登记项目缓存转交票据并分配受控暂存区声明 control 的输入与结果契约，所属容器为 ProjectCacheTransferOptions。
   * Purpose: Declares the input/result contract for control in ProjectCacheTransferOptions. Module responsibility: Registers cache handoff tickets and staging areas; unconfirmed ownership/retirement retains original task evidence.
   * 输入 / Inputs: vmId: string; request: { action: 'prepare' | 'probe' | 'retire'; owner: ProjectCacheTransferOwner; preparati…; signal: AbortSignal optional
   * 输出 / Returns: Promise<ProjectCacheTransferReply>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  control?: (vmId: string, request: { action: 'prepare' | 'probe' | 'retire'; owner: ProjectCacheTransferOwner;
    preparation?: Preparation | null; task?: ProjectTaskResourceReceipt }, signal?: AbortSignal) => Promise<ProjectCacheTransferReply>;
};

/** A private cache copy is a resource of one exact native task, never a reusable root path. */
export class ProjectCacheTransfers {
  /**
   * 入口 / Entry: ProjectCacheTransfers.constructor.
   * 功能：建立 ProjectCacheTransfers 的登记项目缓存转交票据并分配受控暂存区上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectCacheTransfers context for this module's responsibility: Registers cache handoff tickets and staging areas; unconfirmed ownership/retirement retains original task evidence. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; options: ProjectCacheTransferOptions default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines, private options: ProjectCacheTransferOptions = {}) {}
  /**
   * 入口 / Entry: ProjectCacheTransfers.root.
   * 功能：在登记项目缓存转交票据并分配受控暂存区中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(this.options.rootDirectory || vmDir(vmId), 'project-cache-transfers', projectIdSchema.parse(projectId))` 供上层消费（`ProjectCacheTransfers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectCacheTransfers`; this entry produces `join(this.options.rootDirectory || vmDir(vmId), 'project-cache-transfers', projectIdSchema.parse(projectId))` for its caller. Module context: Registers cache handoff tickets and staging areas; unconfirmed ownership/retirement retains original task evidence.
   * 处理：通过 `join`, `vmDir`, `projectIdSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `vmDir`, `projectIdSchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; projectId: string
   * 输出 / Returns: `join(this.options.rootDirectory || vmDir(vmId), 'project-cache-transfers', projectIdSchema.parse(projectId))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private root(vmId: string, projectId: string) {
    return join(this.options.rootDirectory || vmDir(vmId), 'project-cache-transfers', projectIdSchema.parse(projectId));
  }
  /**
   * 入口 / Entry: ProjectCacheTransfers.file.
   * 功能：在登记项目缓存转交票据并分配受控暂存区中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(this.root(vmId, owner.identity.projectId), ...(archived ? ['closed', owner.stageId.slice(0, 2)] : []), uuid.parse(owner.…` 供上层消费（`ProjectCacheTransfers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectCacheTransfers`; this entry produces `join(this.root(vmId, owner.identity.projectId), ...(archived ? ['closed', owner.stageId.slice(0, 2)] : []), uuid.parse(owner.…` for its caller. Module context: Registers cache handoff tickets and staging areas; unconfirmed ownership/retirement retains original task evidence.
   * 处理：通过 `join`, `this.root`, `owner.stageId.slice`, `uuid.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `this.root`, `owner.stageId.slice`, `uuid.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; owner: ProjectCacheTransferOwner; archived: default=false
   * 输出 / Returns: `join(this.root(vmId, owner.identity.projectId), ...(archived ? ['closed', owner.stageId.slice(0, 2)] : []), uuid.parse(owner.…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private file(vmId: string, owner: ProjectCacheTransferOwner, archived = false) {
    return join(this.root(vmId, owner.identity.projectId), ...(archived ? ['closed', owner.stageId.slice(0, 2)] : []),
      uuid.parse(owner.stageId) + '.json');
  }
  /**
   * 入口 / Entry: ProjectCacheTransfers.serial.
   * 功能：在登记项目缓存转交票据并分配受控暂存区中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await promise` 供上层消费（`ProjectCacheTransfers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectCacheTransfers`; this entry produces `await promise` for its caller. Module context: Registers cache handoff tickets and staging areas; unconfirmed ownership/retirement retains original task evidence.
   * 处理：通过 `queues.get`, `queues.set`, `inline.catch().then`, `inline.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `queues.get`, `queues.set`, `inline.catch().then`, `inline.catch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!map`; `map.get(key) === promise`.
   * 输入 / Inputs: vmId: string; projectId: string; action: () => Promise<T>
   * 输出 / Returns: `await promise`.
   * 副作用 / Effects: `queues.set`; `map.set`; `map.delete`; 更新 / updates `map`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `if (map.get(key) === promise) map.delete(key);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `if (map.get(key) === promise) map.delete(key);`; these steps also apply to exceptional exits.
   */
  private async serial<T>(vmId: string, projectId: string, action: () => Promise<T>) {
    let map = queues.get(this.machines);
    if (!map) { map = new Map(); queues.set(this.machines, map); }
    const key = vmId + ':' + projectId, promise = (map.get(key) || Promise.resolve()).catch(() => {}).then(action);
    map.set(key, promise);
    try { return await promise; } finally { if (map.get(key) === promise) map.delete(key); }
  }
  /**
   * 入口 / Entry: ProjectCacheTransfers.read.
   * 功能：在登记项目缓存转交票据并分配受控暂存区中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `recordSchema.parse(JSON.parse(await readFile(path, 'utf8')))` / `null` 供上层消费（`ProjectCacheTransfers`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectCacheTransfers`; this entry produces `recordSchema.parse(JSON.parse(await readFile(path, 'utf8')))` / `null` for its caller. Module context: Registers cache handoff tickets and staging areas; unconfirmed ownership/retirement retains original task evidence.
   * 处理：通过 `lstat`, `info.isFile`, `info.isSymbolicLink`, `cleanupFailure` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `lstat`, `info.isFile`, `info.isSymbolicLink`, `cleanupFailure`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `(error as NodeJS.ErrnoException).code === 'ENOENT'`.
   * 输入 / Inputs: path: string
   * 输出 / Returns: Promise<Record | null>；结果来自 / values from `recordSchema.parse(JSON.parse(await readFile(path, 'utf8')))`; `null`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!info.isFile() || info.isSymbolicLink() || info.size > projectCacheTransferLimits.replyBytes`; 异常 / errors `cleanupFailure()`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;`; `throw cleanupFailure();`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;`; `throw cleanupFailure();`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async read(path: string): Promise<Record | null> {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > projectCacheTransferLimits.replyBytes) throw cleanupFailure();
      return recordSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw cleanupFailure();
    }
  }
  /**
   * 入口 / Entry: ProjectCacheTransfers.save.
   * 功能：在登记项目缓存转交票据并分配受控暂存区中，校验并提交领域状态变更；完成下述调用及状态处理（`ProjectCacheTransfers`）。
   * Purpose: Validates and commits a domain state change in `ProjectCacheTransfers`; the calls and state transitions below complete the operation. Module context: Registers cache handoff tickets and staging areas; unconfirmed ownership/retirement retains original task evidence.
   * 处理：通过 `this.file`, `same`, `this.read`, `cleanupFailure` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.file`, `same`, `this.read`, `cleanupFailure`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; record: Record; before: Record | null
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`.
   * 拒绝 / Refusals: 条件 / conditions `!same(await this.read(path), before)`; 异常 / errors `cleanupFailure()`.
   */
  private async save(vmId: string, record: Record, before: Record | null) {
    const path = this.file(vmId, record.owner);
    if (!same(await this.read(path), before)) throw cleanupFailure();
    await writeStore(path, recordSchema.parse(record));
  }
  /**
   * 入口 / Entry: ProjectCacheTransfers.archive.
   * 功能：在登记项目缓存转交票据并分配受控暂存区中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectCacheTransfers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectCacheTransfers`; the calls and state transitions below complete the operation. Module context: Registers cache handoff tickets and staging areas; unconfirmed ownership/retirement retains original task evidence.
   * 处理：通过 `this.file`, `this.read`, `same`, `cleanupFailure` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.file`, `this.read`, `same`, `cleanupFailure`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!old`.
   * 输入 / Inputs: vmId: string; record: Record
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`; `rm`.
   * 拒绝 / Refusals: 条件 / conditions `old && !same(old, record)`; `!same(await this.read(path), record) || !same(await this.read(this.file(vmId, record.owner)), record)`; 异常 / errors `cleanupFailure()`.
   */
  private async archive(vmId: string, record: Record) {
    const path = this.file(vmId, record.owner, true), old = await this.read(path);
    if (old && !same(old, record)) throw cleanupFailure();
    if (!old) await writeStore(path, record);
    if (!same(await this.read(path), record) || !same(await this.read(this.file(vmId, record.owner)), record)) throw cleanupFailure();
    await rm(this.file(vmId, record.owner));
  }
  /**
   * 入口 / Entry: ProjectCacheTransfers.control.
   * 功能：在登记项目缓存转交票据并分配受控暂存区中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`ProjectCacheTransfers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectCacheTransfers`; this entry produces `result` for its caller. Module context: Registers cache handoff tickets and staging areas; unconfirmed ownership/retirement retains original task evidence.
   * 处理：通过 `this.machines.live.get`, `cleanupFailure`, `replySchema.parse`, `this.options.control` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.live.get`, `cleanupFailure`, `replySchema.parse`, `this.options.control`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.options.control`.
   * 输入 / Inputs: vmId: string; request: Parameters<NonNullable<ProjectCacheTransferOptions['control']>>[1]; live: NonNullable<ReturnType<Machines['live']['get']>>; signal: AbortSignal optional
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `this.machines.exec`; 更新 / updates `result`.
   * 拒绝 / Refusals: 条件 / conditions `this.machines.live.get(vmId) !== live`; `bytes.length > projectCacheTransferLimits.controlBytes`; `reply.code !== 0 || Buffer.byteLength(reply.stdout) > projectCacheTransferLimits.replyBytes`; 异常 / errors `cleanupFailure()`.
   * 失败处理：catch 分支执行 `throw cleanupFailure();`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw cleanupFailure();`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async control(vmId: string, request: Parameters<NonNullable<ProjectCacheTransferOptions['control']>>[1],
    live: NonNullable<ReturnType<Machines['live']['get']>>, signal?: AbortSignal) {
    if (this.machines.live.get(vmId) !== live) throw cleanupFailure();
    let result: ProjectCacheTransferReply;
    if (this.options.control) result = replySchema.parse(await this.options.control(vmId, request, signal));
    else {
      const bytes = Buffer.from(JSON.stringify(request));
      if (bytes.length > projectCacheTransferLimits.controlBytes) throw cleanupFailure();
      const command = '# SAKURA_PROJECT_CACHE_TRANSFER=' + request.action + '\n' +
        '/usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C ' +
        '/usr/bin/python3 -I -S -c ' + quote(projectCacheTransferControl) + ' ' + quote(bytes.toString('base64'));
      const reply = await this.machines.exec(vmId, command, 100000, signal);
      if (reply.code !== 0 || Buffer.byteLength(reply.stdout) > projectCacheTransferLimits.replyBytes) throw cleanupFailure();
      try {
        const parsed = JSON.parse(reply.stdout);
        if (parsed.ok !== true || Object.keys(parsed).sort().join(',') !== 'ok,result') throw cleanupFailure();
        result = replySchema.parse(parsed.result);
      } catch { throw cleanupFailure(); }
    }
    if (this.machines.live.get(vmId) !== live) throw cleanupFailure();
    if (result.state === 'present' && !same(result.receipt.owner, request.owner)) throw cleanupFailure();
    return result;
  }
  /**
   * 入口 / Entry: ProjectCacheTransfers.preparationMatches.
   * 功能：从当前输入或状态计算 `!record.preparation || ['version', 'owner', 'stage', 'data', 'manifest'].every(key => same(record.preparation![key as keyof P…`，供调用方后续验证或使用。
   * Purpose: Computes `!record.preparation || ['version', 'owner', 'stage', 'data', 'manifest'].every(key => same(record.preparation![key as keyof P…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: record: Record; receipt: Preparation
   * 输出 / Returns: `!record.preparation || ['version', 'owner', 'stage', 'data', 'manifest'].every(key => same(record.preparation![key as keyof P…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private preparationMatches(record: Record, receipt: Preparation) {
    return !record.preparation || ['version', 'owner', 'stage', 'data', 'manifest'].every(key =>
      same(record.preparation![key as keyof Preparation], receipt[key as keyof Preparation]));
  }
  /**
   * 入口 / Entry: ProjectCacheTransfers.taskMatches.
   * 功能：从当前输入或状态计算 `(!run || run.projectId === owner.identity.projectId && run.registryId === owner.identity.registryId && run.identityId === own…`，供调用方后续验证或使用。
   * Purpose: Computes `(!run || run.projectId === owner.identity.projectId && run.registryId === owner.identity.registryId && run.identityId === own…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: owner: ProjectCacheTransferOwner; task: ProjectTaskResourceReceipt
   * 输出 / Returns: `(!run || run.projectId === owner.identity.projectId && run.registryId === owner.identity.registryId && run.identityId === own…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private taskMatches(owner: ProjectCacheTransferOwner, task: ProjectTaskResourceReceipt) {
    const run = task.run;
    return (!run || run.projectId === owner.identity.projectId && run.registryId === owner.identity.registryId &&
      run.identityId === owner.identity.identityId && run.revision === owner.identity.revision &&
      run.runId === owner.owner.runId && run.bootId === owner.owner.bootId && run.build === owner.build &&
      run.mode === 'inherit-current' && run.cgroupName === 'sakura-task-' + owner.owner.runId &&
      (run.phase === 'closed' || Boolean(task.retirement))) &&
      (!task.retirement || task.retirement.bootId !== owner.owner.bootId);
  }
  /**
   * 入口 / Entry: ProjectCacheTransfers.descriptor.
   * 功能：从当前输入或状态计算 `{ stageId: owner.stageId, manager: owner.manager, build: owner.build }`，供调用方后续验证或使用。
   * Purpose: Computes `{ stageId: owner.stageId, manager: owner.manager, build: owner.build }` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: owner: ProjectCacheTransferOwner
   * 输出 / Returns: `{ stageId: owner.stageId, manager: owner.manager, build: owner.build }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private descriptor(owner: ProjectCacheTransferOwner) {
    return { stageId: owner.stageId, manager: owner.manager, build: owner.build };
  }
  /**
   * 入口 / Entry: ProjectCacheTransfers.complete.
   * 功能：在登记项目缓存转交票据并分配受控暂存区中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectCacheTransfers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectCacheTransfers`; the calls and state transitions below complete the operation. Module context: Registers cache handoff tickets and staging areas; unconfirmed ownership/retirement retains original task evidence.
   * 处理：通过 `inline.completeTaskResource`, `this.descriptor` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.completeTaskResource`, `this.descriptor`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; context: ProjectTaskResourceContext; owner: ProjectCacheTransferOwner
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async complete(vmId: string, context: ProjectTaskResourceContext, owner: ProjectCacheTransferOwner) {
    await (this.options.scopes || new ProjectRunScopes(this.machines)).completeTaskResource(vmId, context, this.descriptor(owner));
  }
  /**
   * 入口 / Entry: ProjectCacheTransfers.retireRecord.
   * 功能：在登记项目缓存转交票据并分配受控暂存区中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ProjectCacheTransfers`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectCacheTransfers`; the calls and state transitions below complete the operation. Module context: Registers cache handoff tickets and staging areas; unconfirmed ownership/retirement retains original task evidence.
   * 处理：通过 `this.retireRecordChecked`, `cleanupFailure` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.retireRecordChecked`, `cleanupFailure`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; record: Record; context: ProjectTaskResourceContext; task: ProjectTaskResourceReceipt
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `error instanceof AppError && error.status === 503`; 异常 / errors `error`; `cleanupFailure()`.
   * 失败处理：catch 分支执行 `if (error instanceof AppError && error.status === 503) throw error;`; `throw cleanupFailure();`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (error instanceof AppError && error.status === 503) throw error;`; `throw cleanupFailure();`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async retireRecord(vmId: string, record: Record, context: ProjectTaskResourceContext,
    task: ProjectTaskResourceReceipt) {
    try { await this.retireRecordChecked(vmId, record, context, task); }
    catch (error) {
      if (error instanceof AppError && error.status === 503) throw error;
      throw cleanupFailure();
    }
  }
  /**
   * 入口 / Entry: ProjectCacheTransfers.retireRecordChecked.
   * 功能：在登记项目缓存转交票据并分配受控暂存区中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`ProjectCacheTransfers`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectCacheTransfers`; this entry produces `void` for its caller. Module context: Registers cache handoff tickets and staging areas; unconfirmed ownership/retirement retains original task evidence.
   * 处理：通过 `taskReceiptSchema.parse`, `same`, `this.taskMatches`, `cleanupFailure` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `taskReceiptSchema.parse`, `same`, `this.taskMatches`, `cleanupFailure`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `record.phase === 'closed'`; `!record.task`; `!record.preparation`.
   * 输入 / Inputs: vmId: string; record: Record; context: ProjectTaskResourceContext; task: ProjectTaskResourceReceipt
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.save`; 更新 / updates `task`, `record`.
   * 拒绝 / Refusals: 条件 / conditions `!same(context.identity, record.owner.identity) || !same(context.owner, record.owner.owner) || context.sha256 !== record.owner…`; `probe.state === 'present'`; `probe.bootId !== record.owner.owner.bootId || !this.preparationMatches(record, probe.receipt)`; 异常 / errors `cleanupFailure()`.
   */
  private async retireRecordChecked(vmId: string, record: Record, context: ProjectTaskResourceContext,
    task: ProjectTaskResourceReceipt) {
    task = taskReceiptSchema.parse(task);
    if (!same(context.identity, record.owner.identity) || !same(context.owner, record.owner.owner) ||
        context.sha256 !== record.owner.sha256 || !this.taskMatches(record.owner, task) ||
        record.task && !same(record.task, task)) throw cleanupFailure();
    if (record.phase === 'closed') { await this.complete(vmId, context, record.owner); await this.archive(vmId, record); return; }
    // Persist the complete original native proof before any guest unlink.
    if (!record.task) {
      const next = { ...record, phase: 'retiring' as const, task }; await this.save(vmId, next, record); record = next;
    }
    const probe = await this.control(vmId, { action: 'probe', owner: record.owner,
      preparation: record.preparation }, context.live);
    if (probe.state === 'present') {
      if (probe.bootId !== record.owner.owner.bootId || !this.preparationMatches(record, probe.receipt)) throw cleanupFailure();
      if (!record.preparation) {
        const next = { ...record, preparation: probe.receipt }; await this.save(vmId, next, record); record = next;
      }
    } else if (record.preparation && probe.bootId === record.owner.owner.bootId) throw cleanupFailure();
    const retired = await this.control(vmId, { action: 'retire', owner: record.owner,
      preparation: record.preparation, task }, context.live);
    if (retired.state === 'present') {
      if (retired.bootId !== record.owner.owner.bootId || retired.receipt.phase !== 'closed' ||
          !this.preparationMatches(record, retired.receipt) || !same(retired.receipt.task, task)) throw cleanupFailure();
    } else if (record.preparation && retired.bootId === record.owner.owner.bootId ||
        retired.bootId !== record.owner.owner.bootId && task.retirement?.bootId !== retired.bootId) throw cleanupFailure();
    const next = { ...record, phase: 'closed' as const, retirement: retired };
    await this.save(vmId, next, record); await this.complete(vmId, context, next.owner); await this.archive(vmId, next);
  }
  /** Recover only original resources whose complete native task has been closed. */
  /**
   * 入口 / Entry: ProjectCacheTransfers.recover.
   * 功能：在登记项目缓存转交票据并分配受控暂存区中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(vmId, projectId, async () => { const folder = this.root(vmId, projectId), scopes = this.options.scopes || new Pro…` 供上层消费（`ProjectCacheTransfers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectCacheTransfers`; this entry produces `this.serial(vmId, projectId, async () => { const folder = this.root(vmId, projectId), scopes = this.options.scopes || new Pro…` for its caller. Module context: Registers cache handoff tickets and staging areas; unconfirmed ownership/retirement retains original task evidence.
   * 处理：通过 `projectIdSchema.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; projectId: string
   * 输出 / Returns: `this.serial(vmId, projectId, async () => { const folder = this.root(vmId, projectId), scopes = this.options.scopes || new Pro…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async recover(vmId: string, projectId: string) {
    projectIdSchema.parse(projectId);
    /**
     * 入口 / Entry: ProjectCacheTransfers.recover.callback@194.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `this.save`; 更新 / updates `names`.
     * 拒绝 / Refusals: 条件 / conditions `owners.length && !live`; `!await this.read(this.file(vmId, owner))`; `archived`; 异常 / errors `cleanupFailure()`.
     * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;`; `throw cleanupFailure();`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;`; `throw cleanupFailure();`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.serial(vmId, projectId, async () => {
      const folder = this.root(vmId, projectId), scopes = this.options.scopes || new ProjectRunScopes(this.machines);
      const resources = await scopes.taskResources(vmId, projectId), live = this.machines.live.get(vmId);
      const owners = resources.filter(resource => !resource.active);
      if (owners.length && !live) throw cleanupFailure();
      for (const resource of owners) {
        const context = resource.context, owner = projectCacheTransferOwnerSchema.parse({ ...resource.descriptor,
          identity: context.identity, owner: context.owner, sha256: context.sha256 });
        if (active.get(this.machines)?.has(vmId + ':' + owner.stageId)) continue;
        if (!await this.read(this.file(vmId, owner))) {
          const archived = await this.read(this.file(vmId, owner, true));
          if (archived) {
            if (archived.phase !== 'closed' || !same(archived.owner, owner)) throw cleanupFailure();
            await this.complete(vmId, context, owner); continue;
          }
          // Only the immutable original native intent may reconstruct a missing cache intent.
          await scopes.recoverStoppedTasks(vmId, projectId);
          await scopes.taskResourceReceipt(vmId, context);
          await this.save(vmId, { version: 1, phase: 'intent', owner, preparation: null, task: null, retirement: null }, null);
        }
      }
      let names: string[];
      try { names = await readdir(folder); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw cleanupFailure();
      }
      const files = names.filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
      if (files.length > projectCacheTransferLimits.pendingRecords) throw cleanupFailure();
      if (files.length && !live) throw cleanupFailure();
      for (const name of files) {
        const record = await this.read(join(folder, name));
        if (!record || record.owner.identity.projectId !== projectId || name !== record.owner.stageId + '.json') throw cleanupFailure();
        if (active.get(this.machines)?.has(vmId + ':' + record.owner.stageId) ||
            resources.some(resource => resource.active && resource.descriptor.stageId === record.owner.stageId)) continue;
        if (record.phase === 'closed') {
          const context = { identity: record.owner.identity, owner: record.owner.owner, sha256: record.owner.sha256, live: live! };
          await this.complete(vmId, context, record.owner); await this.archive(vmId, record); continue;
        }
        await scopes.recoverStoppedTasks(vmId, projectId);
        if (this.machines.live.get(vmId) !== live) throw cleanupFailure();
        const context = { identity: record.owner.identity, owner: record.owner.owner, sha256: record.owner.sha256, live: live! };
        const task = await scopes.taskResourceReceipt(vmId, context);
        await this.retireRecord(vmId, record, context, task);
      }
    });
  }
  /**
   * 入口 / Entry: ProjectCacheTransfers.allocate.
   * 功能：在登记项目缓存转交票据并分配受控暂存区中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ stageId, directory: '/run/sakura-project-cache-transfers/' + stageId + '/data', resource }` 供上层消费（`ProjectCacheTransfers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectCacheTransfers`; this entry produces `{ stageId, directory: '/run/sakura-project-cache-transfers/' + stageId + '/data', resource }` for its caller. Module context: Registers cache handoff tickets and staging areas; unconfirmed ownership/retirement retains original task evidence.
   * 处理：通过 `dependencyManagerSchema.parse`, `projectIdSchema.parse`, `this.recover`, `signal.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `dependencyManagerSchema.parse`, `projectIdSchema.parse`, `this.recover`, `signal.throwIfAborted`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!registry`.
   * 输入 / Inputs: vmId: string; project: Project; manager: DependencyManager; signal: AbortSignal; live: NonNullable<ReturnType<Machines['live']['get']>>
   * 输出 / Returns: `{ stageId, directory: '/run/sakura-project-cache-transfers/' + stageId + '/data', resource }`.
   * 副作用 / Effects: `active.set`; 更新 / updates `manager`, `registry`.
   * 拒绝 / Refusals: 条件 / conditions `this.machines.live.get(vmId) !== live`; 异常 / errors `cleanupFailure()`.
   */
  async allocate(vmId: string, project: Project, manager: DependencyManager, signal: AbortSignal,
    live: NonNullable<ReturnType<Machines['live']['get']>>) {
    manager = dependencyManagerSchema.parse(manager);
    const projectId = projectIdSchema.parse(project._workspace || 'default');
    await this.recover(vmId, projectId);
    signal.throwIfAborted();
    const { manifest } = await (this.options.source || projectIdentitySources)();
    if (this.machines.live.get(vmId) !== live) throw cleanupFailure();
    const stageId = randomUUID(); let started = false, submitted = false;
    let registry = active.get(this.machines); if (!registry) { registry = new Set(); active.set(this.machines, registry); }
    const key = vmId + ':' + stageId;
    /**
     * 入口 / Entry: ProjectCacheTransfers.allocate.callback@268.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `inline.delete`.
     * 拒绝 / Refusals: 条件 / conditions `!record`; `!same(record.owner, owner)`; 异常 / errors `cleanupFailure()`.
     * 收尾：退出 try 区域时始终执行 `registry!.delete(key);`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `registry!.delete(key);`; these steps also apply to exceptional exits.
     */
    /**
     * 入口 / Entry: ProjectCacheTransfers.allocate.callback@253.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.save`; `inline.add`; 更新 / updates `started`, `submitted`.
     * 拒绝 / Refusals: 条件 / conditions `started || context.live !== live || this.machines.live.get(vmId) !== live`; `owner.identity.projectId !== projectId || owner.identity.directory !== project.directory || owner.identity.networkIsolation !…`; `await this.read(this.file(vmId, owner)) || await this.read(this.file(vmId, owner, true))`; 异常 / errors `cleanupFailure()`.
     */
    const resource: NonNullable<ProjectTaskAdmissionOptions['resource']> = {
      descriptor: { stageId, manager, build: manifest.build },
      /**
       * 入口 / Entry: ProjectCacheTransfers.allocate.prepare.
       * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
       * 输入 / Inputs: context
       * 输出 / Returns: `this.serial(vmId, projectId, async () => { if (started || context.live !== live || this.machines.live.get(vmId) !== live) thr…`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      prepare: async context => this.serial(vmId, projectId,
      /**
       * 中文功能：核对原 live 与项目缓存 owner，先持久 intent 并登记 key，再请求客户机 prepare，匹配 boot/ready 回执后保存 prepared。
       * English: Checks original live/cache owner, persists intent/registers the key, requests guest preparation and saves prepared only after matching boot/ready receipt.
       * 所属 / Owner: ProjectCacheTransfers.allocate.resource.prepare.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       */
      async () => {
        if (started || context.live !== live || this.machines.live.get(vmId) !== live) throw cleanupFailure();
        started = true;
        const owner = projectCacheTransferOwnerSchema.parse({ stageId, manager, build: manifest.build,
          identity: context.identity, owner: context.owner, sha256: context.sha256 });
        if (owner.identity.projectId !== projectId || owner.identity.directory !== project.directory ||
            owner.identity.networkIsolation !== (project.networkIsolation || 'host')) throw cleanupFailure();
        if (await this.read(this.file(vmId, owner)) || await this.read(this.file(vmId, owner, true))) throw cleanupFailure();
        const record: Record = { version: 1, phase: 'intent', owner, preparation: null, task: null, retirement: null };
        await this.save(vmId, record, null); registry!.add(key);
        submitted = true;
        const reply = await this.control(vmId, { action: 'prepare', owner }, context.live, signal);
        if (reply.state !== 'present' || reply.bootId !== context.owner.bootId || reply.receipt.phase !== 'ready') throw cleanupFailure();
        await this.save(vmId, { ...record, phase: 'prepared', preparation: reply.receipt }, record);
      }),
      /**
       * 入口 / Entry: ProjectCacheTransfers.allocate.retire.
       * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
       * 输入 / Inputs: context; task
       * 输出 / Returns: `this.serial(vmId, projectId, async () => { try { const owner = projectCacheTransferOwnerSchema.parse({ stageId, manager, buil…`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      retire: async (context, task) => this.serial(vmId, projectId,
      /**
       * 中文功能：核对原 owner 与已归档关闭记录的 task，未提交时可无操作，否则退役原记录；finally 移除活动 registry key。
       * English: Checks original owner and archived closed-record task, permits no-op before submission or retires the original record, always removing the active registry key in finally.
       * 所属 / Owner: ProjectCacheTransfers.allocate.resource.retire.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       */
      async () => {
        try {
        const owner = projectCacheTransferOwnerSchema.parse({ stageId, manager, build: manifest.build,
          identity: context.identity, owner: context.owner, sha256: context.sha256 });
        let record = await this.read(this.file(vmId, owner));
        if (!record) {
          const archived = await this.read(this.file(vmId, owner, true));
          if (archived && same(archived.owner, owner) && archived.phase === 'closed' && same(archived.task, task)) return;
          if (!submitted) return;
          throw cleanupFailure();
        }
        if (!same(record.owner, owner)) throw cleanupFailure();
        await this.retireRecord(vmId, record, context, task);
        } finally { registry!.delete(key); }
      }),
    };
    return { stageId, directory: '/run/sakura-project-cache-transfers/' + stageId + '/data', resource };
  }
}

/** This text and the project environment enter only the protected native payload. */
/**
 * 入口 / Entry: projectCachedInstallCommand.
 * 功能：在登记项目缓存转交票据并分配受控暂存区中，执行此领域的具体处理步骤并返回其结果；本入口产生 `manager === 'npm' ? header + `command -v npm >/dev/null\ntest -f package.json\nif [ -f npm-shrinkwrap.json ]; then lock=npm-s…` 供上层消费（`project-cache-transfer.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-cache-transfer.ts`; this entry produces `manager === 'npm' ? header + `command -v npm >/dev/null\ntest -f package.json\nif [ -f npm-shrinkwrap.json ]; then lock=npm-s…` for its caller. Module context: Registers cache handoff tickets and staging areas; unconfirmed ownership/retirement retains original task evidence.
 * 处理：通过 `dependencyManagerSchema.parse`, `inline.test`, `cleanupFailure`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `dependencyManagerSchema.parse`, `inline.test`, `cleanupFailure`, `quote`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: _directory: string; cache: string; manager: DependencyManager
 * 输出 / Returns: `manager === 'npm' ? header + `command -v npm >/dev/null\ntest -f package.json\nif [ -f npm-shrinkwrap.json ]; then lock=npm-s…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!/^\/run\/sakura-project-cache-transfers\/[a-f0-9-]{36}\/data$/.test(cache)`; 异常 / errors `cleanupFailure()`.
 */
export function projectCachedInstallCommand(_directory: string, cache: string, manager: DependencyManager) {
  dependencyManagerSchema.parse(manager);
  if (!/^\/run\/sakura-project-cache-transfers\/[a-f0-9-]{36}\/data$/.test(cache)) throw cleanupFailure();
  // Retain the exact native directory FD instead of resolving the project path again.
  const header = `set -eu\ncache=${quote(cache)}\n`;
  return manager === 'npm' ? header + `command -v npm >/dev/null\ntest -f package.json\nif [ -f npm-shrinkwrap.json ]; then lock=npm-shrinkwrap.json; elif [ -f package-lock.json ]; then lock=package-lock.json; else echo '项目 npm 锁文件不存在' >&2; exit 2; fi\ntest -f "$cache/LOCKSUMS" || { echo '项目依赖缓存不存在' >&2; exit 2; }\nsha256sum -c "$cache/LOCKSUMS" >/dev/null\nnpm ci --offline --ignore-scripts --cache "$cache/data" --no-audit --no-fund\nprintf '已从离线缓存安装 npm 依赖\\n'` :
    header + `command -v python3 >/dev/null\npython3 -m pip --version >/dev/null\ntest -f requirements.txt\nif grep -Ev '^[[:space:]]*(#|$)' requirements.txt | grep -Ev '^[[:space:]]*[A-Za-z0-9_.-]+(\\[[A-Za-z0-9_,.-]+\\])?==[A-Za-z0-9_.+!-]+[[:space:]]*$' | grep -q .; then echo '离线缓存仅支持固定版本的普通 PyPI 包' >&2; exit 2; fi\ntest -f "$cache/LOCKSUMS" && test -f "$cache/wheels/WHEELS" || { echo '项目依赖缓存不存在' >&2; exit 2; }\nsha256sum -c "$cache/LOCKSUMS" >/dev/null\n(cd "$cache/wheels" && sha256sum -c WHEELS >/dev/null)\nmkdir -p .sakura\npython3 -m venv .sakura/venv\n.sakura/venv/bin/python -m pip install --no-index --no-build-isolation --only-binary=:all: --find-links="$cache/wheels" -r requirements.txt\nprintf '已从离线缓存安装 Python 依赖到 .sakura/venv\\n'`;
}
