/**
 * 模块职责：管理单应用窗口、剪贴板策略和持久运行记录，原会话停止按完整票据核验。
 * Module purpose: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { randomUUID } from 'node:crypto';
import { ProjectSessionLifetime } from './project-session-lifetime.ts';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { vmDir } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import { projectVersion, type Project } from './project-config.ts';

import { projectTerminalsFor, type TerminalService as ProjectTerminals } from './terminal-backend.ts';
import { ProjectRunScopes } from './project-run-scope.ts';
import {
  ProjectIdentities,
  projectIdentitySchema,
  projectIdentityRunSchema,
  projectIdentitySources,
} from './project-identity.ts';
import {
  appIdentity,
  appOriginSchema,
  appReceiptSchema,
  appStatusSchema,
  appStopSchema,
  appRetirementSchema,
  appAbsenceSchema,
  appRecoverySchema,
  SingleAppControl,
  type AppOrigin,
  type AppReceipt,
} from './single-app-sandbox.ts';

export const singleAppProgram = z.string().regex(/^[A-Za-z][A-Za-z0-9+._-]{0,63}$/);
export const singleAppClipboard = z.object({ copy: z.boolean(), paste: z.boolean() }).strict();
const clipboardStoreSchema = z.object({ version: z.literal(1), rules: z.record(singleAppProgram, singleAppClipboard) }).strict()
  .refine(value => Object.keys(value.rules).length <= 64, '单应用剪贴板规则不能超过 64 条');
export const singleAppInput = z.object({ program: singleAppProgram,
  args: z.array(z.string().max(256).refine(value => !/[\x00-\x1f]/.test(value))).max(12).default([]),
  resolution: z.enum(['800x600', '1024x768', '1280x800']).default('1024x768'),
  clipboard: singleAppClipboard.default({ copy: true, paste: true }),
}).strict();
export const singleAppViewSchema = z.object({ id: z.uuid(), vmId: z.uuid(), program: z.string(), display: z.number().int(),
  port: z.number().int(), resolution: z.string(), clipboard: singleAppClipboard, startedAt: z.string(), projectId: z.string().optional(),
  networkIsolation: z.enum(['host', 'private']).optional(), password: z.string(), dataDirectory: z.string(), revoked: z.boolean(),
  projectOwner: z.object({ uid: z.number().int().min(20000).max(59999), user: z.string() }).strict().optional(),
  applicationOwner: z.object({ uid: z.number().int().min(1000), user: z.string() }).strict().optional(),
  cleanupPending: z.boolean(), lastError: z.string().optional(),
  status: z.enum(['running', 'stopped', 'relaunch-required', 'preparing', 'cleanup-pending', 'review-required']),
}).strict();
export type SingleAppWindowView = z.infer<typeof singleAppViewSchema>;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
/**
 * 入口 / Entry: callback@67.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.object().strict().superRefine）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.object().strict().superRefine).
 * 输入 / Inputs: value; ctx
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `ctx.addIssue`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const singleAppRunRecordSchema = z.object({ version: z.literal(1), id: z.uuid(), vmId: z.uuid(),
  program: singleAppProgram, args: singleAppInput.shape.args, resolution: singleAppInput.shape.resolution,
  clipboard: singleAppClipboard, startedAt: z.string(), projectId: z.string().regex(/^(default|[a-f0-9]{16})$/),
  directory: z.string().startsWith('/'), networkIsolation: z.enum(['host', 'private']), configVersion: digest,
  bootId: z.uuid(), build: digest, nativeBuild: digest,
  phase: z.enum(['intent', 'prepared', 'starting', 'running', 'stopping', 'stopped', 'cleanup-failed']),
  identity: projectIdentitySchema, run: projectIdentityRunSchema.nullable(), receipt: appReceiptSchema.nullable(),
  revoked: z.boolean().default(false), retirement: appRetirementSchema.nullable(), closure: projectIdentityRunSchema.nullable(),
  lastError: z.string().max(128).optional(),
  absence: appAbsenceSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.identity.projectId !== value.projectId || value.identity.directory !== value.directory ||
      value.identity.networkIsolation !== value.networkIsolation || value.identity.phase !== 'active' ||
      (value.run && (value.run.runId !== value.id || value.run.bootId !== value.bootId || value.run.mode !== 'independent' ||
        value.run.build !== value.nativeBuild || (['registryId', 'identityId', 'projectId', 'revision'] as const)
          .some(key => value.identity[key] !== value.run![key]))) ||
      (value.receipt && (!value.run || value.receipt.id !== value.id || value.receipt.build !== value.build ||
        JSON.stringify(value.receipt.origin) !== JSON.stringify(origin(value)))) ||
      (['prepared', 'starting', 'running'].includes(value.phase) && (!value.run || !value.receipt)) ||
      (value.phase === 'running' && value.receipt?.state !== 'running') ||
      (value.closure && (!value.run || !sameRun(value.closure, value.run) ||
        (value.retirement ? value.retirement.bootId === value.bootId : value.closure.phase !== 'closed'))) ||
      (value.phase === 'stopped' && (value.run ? !value.closure : !value.absence)) ||
      (value.retirement && (!['stopped', 'stopping', 'cleanup-failed'].includes(value.phase) || value.retirement.bootId === value.bootId)) ||
      (value.absence && (!['stopped', 'stopping', 'cleanup-failed'].includes(value.phase) || value.run || value.receipt || value.absence.id !== value.id ||
        value.absence.bootId !== value.bootId || value.absence.nativeBuild !== value.nativeBuild)))
    ctx.addIssue({ code: 'custom', message: '单应用持久运行记录不完整' });
});
type Session = z.infer<typeof singleAppRunRecordSchema>;
/**
 * 入口 / Entry: sessionReceipt.
 * 功能：从当前输入或状态计算 `{ runId: session.id, bootId: session.bootId, projectId: session.projectId, vmId: session.vmId, program: session.program, args…`，供调用方后续验证或使用。
 * Purpose: Computes `{ runId: session.id, bootId: session.bootId, projectId: session.projectId, vmId: session.vmId, program: session.program, args…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: session: Session
 * 输出 / Returns: `{ runId: session.id, bootId: session.bootId, projectId: session.projectId, vmId: session.vmId, program: session.program, args…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function sessionReceipt(session: Session) {
  return { runId: session.id, bootId: session.bootId, projectId: session.projectId, vmId: session.vmId,
    program: session.program, args: session.args, resolution: session.resolution, clipboard: session.clipboard,
    startedAt: session.startedAt, directory: session.directory, networkIsolation: session.networkIsolation,
    configVersion: session.configVersion, build: session.build, nativeBuild: session.nativeBuild,
    identity: session.identity, run: session.run };
}
const journalSchema = z.object({ version: z.literal(1), sessions: z.array(singleAppRunRecordSchema).max(1024) }).strict()
  .refine(value => new Set(value.sessions.map(session => session.id)).size === value.sessions.length);
type Live = NonNullable<ReturnType<Machines['live']['get']>>;
type Preparation = Awaited<ReturnType<ProjectTerminals['prepare']>>;
type Options = { deferInitialization?: boolean; rootDirectory?: string; terminals?: Pick<ProjectTerminals, 'prepare' | 'close'>;
  scopes?: Pick<ProjectRunScopes, 'identity'>; identities?: Pick<ProjectIdentities, 'install'>;
  control?: Pick<SingleAppControl, 'install' | 'call' | 'streamCommand' | 'recover' | 'legacy' | 'prepareRun'>;
  /**
   * 签名 / Signature: Options.nativeBuild.
   * 功能：为管理单应用窗口、剪贴板策略和持久运行记录声明 nativeBuild 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for nativeBuild in Options. Module responsibility: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<string>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  nativeBuild?: () => Promise<string>; exitPollMs?: number };
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
 * 入口 / Entry: sameRun.
 * 功能：从当前输入或状态计算 `Object.keys(left).every(key => key === 'phase' || left[key as keyof typeof left] === right[key as keyof typeof right])`，供调用方后续验证或使用。
 * Purpose: Computes `Object.keys(left).every(key => key === 'phase' || left[key as keyof typeof left] === right[key as keyof typeof right])` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: left: z.infer<typeof projectIdentityRunSchema>; right: z.infer<typeof projectIdentityRunSchema>
 * 输出 / Returns: `Object.keys(left).every(key => key === 'phase' || left[key as keyof typeof left] === right[key as keyof typeof right])`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function sameRun(left: z.infer<typeof projectIdentityRunSchema>, right: z.infer<typeof projectIdentityRunSchema>) {
  return Object.keys(left).every(key => key === 'phase' || left[key as keyof typeof left] === right[key as keyof typeof right]);
}
/**
 * 入口 / Entry: matchOriginal.
 * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`single-app-windows.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `single-app-windows.ts`; the calls and state transitions below complete the operation. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
 * 处理：通过 `immutable.some`, `same`, `inline.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `immutable.some`, `same`, `inline.some`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: old: Session; session: Session
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `immutable.some(key => !same(old[key], session[key])) || (old.run && !same(old.run, session.run)) || (old.receipt && (!session…`; 异常 / errors `new AppError('单应用原持久票据已变化，保留原记录', 409, 'SINGLE_APP_HOST_CHANGED')`.
 */
function matchOriginal(old: Session, session: Session) {
  const immutable = ['id', 'vmId', 'program', 'args', 'resolution', 'clipboard', 'startedAt', 'projectId', 'directory',
    'networkIsolation', 'configVersion', 'bootId', 'build', 'nativeBuild', 'identity'] as const;
  if (immutable.some(key => !same(old[key], session[key])) ||
      (old.run && !same(old.run, session.run)) ||
      (old.receipt && (!session.receipt ||
        (['uid', 'gid', 'user', 'home', 'runtime', 'password', 'display', 'port', 'image', 'tools'] as const)
          .some(key => !same(old.receipt![key], session.receipt![key])) ||
        (['homeDevice', 'homeInode', 'runtimeDevice', 'runtimeInode', 'directoryView', 'supervisor', 'endpoint', 'processes'] as const)
          .some(key => old.receipt![key] !== null && !same(old.receipt![key], session.receipt![key])))))
    throw new AppError('单应用原持久票据已变化，保留原记录', 409, 'SINGLE_APP_HOST_CHANGED');
}
/**
 * 入口 / Entry: origin.
 * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `appOriginSchema.parse({ identity: session.identity, run: session.run, program: session.program, args: session.args, resolutio…` 供上层消费（`single-app-windows.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `single-app-windows.ts`; this entry produces `appOriginSchema.parse({ identity: session.identity, run: session.run, program: session.program, args: session.args, resolutio…` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
 * 处理：通过 `appOriginSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `appOriginSchema.parse`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: session: Pick<Session, 'identity' | 'run' | 'program' | 'args' | 'resolution' | 'clipboard' | …
 * 输出 / Returns: AppOrigin；结果来自 / values from `appOriginSchema.parse({ identity: session.identity, run: session.run, program: session.program, args: session.args, resolutio…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!session.run`; 异常 / errors `new AppError('单应用原完整运行票据尚未确认', 503, 'SINGLE_APP_RUN_PENDING')`.
 */
function origin(session: Pick<Session, 'identity' | 'run' | 'program' | 'args' | 'resolution' | 'clipboard' | 'configVersion'>): AppOrigin {
  if (!session.run) throw new AppError('单应用原完整运行票据尚未确认', 503, 'SINGLE_APP_RUN_PENDING');
  return appOriginSchema.parse({ identity: session.identity, run: session.run, program: session.program, args: session.args,
    resolution: session.resolution, clipboard: session.clipboard, configVersion: session.configVersion });
}

/** Persisted exact original runs remain cleanup-retryable across service reloads. */
export class SingleAppWindows {
  private sessions = new Map<string, Session>();
  private loaded = new Map<string, Promise<void>>();
  private leases = new Map<string,
  /**
   * 中文功能：登记 SingleAppWindows.leases 的资源退役能力，按返回类型允许同步完成或异步等待。
   * English: Registers resource-retirement capability for SingleAppWindows.leases, allowing synchronous completion or asynchronous waiting according to its result type.
   * 所属 / Owner: SingleAppWindows.leases.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `void | Promise<void>`.
   */
  () => void | Promise<void>>();
  private livePins = new Map<string, Live>();
  private sessionListeners = new Map<string, Set<
  /**
   * 中文功能：为 SingleAppWindows.sessionListeners 登记事件、状态变化或阶段结束通知，接收本声明规定的事件数据。
   * English: Registers event/state-change/phase-completion notification for SingleAppWindows.sessionListeners using its declared event data.
   * 所属 / Owner: SingleAppWindows.sessionListeners.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `void`.
   */
  () => void>>();
  private pending = new Set<Promise<unknown>>();
  private watchers = new Map<string, NodeJS.Timeout>();
  private closed = false;
  private closeAbort = new AbortController();
  /**
   * 签名 / Signature: SingleAppWindows.removeConfigGuard.
   * 功能：为管理单应用窗口、剪贴板策略和持久运行记录声明 removeConfigGuard 的输入与结果契约，所属容器为 SingleAppWindows。
   * Purpose: Declares the input/result contract for removeConfigGuard in SingleAppWindows. Module responsibility: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private removeConfigGuard?: () => void;
  private terminals?: Pick<ProjectTerminals, 'prepare' | 'close'>;
  private scopes: Pick<ProjectRunScopes, 'identity'>;
  private identities: Pick<ProjectIdentities, 'install'>;
  private control: Pick<SingleAppControl, 'install' | 'call' | 'streamCommand' | 'recover' | 'legacy' | 'prepareRun'>;
  private initialized = false;
  /**
   * 入口 / Entry: SingleAppWindows.constructor.
   * 功能：建立 SingleAppWindows 的管理单应用窗口、剪贴板策略和持久运行记录上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the SingleAppWindows context for this module's responsibility: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1 optional; options: Options default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.terminals`, `this.scopes`, `this.identities`, `this.control`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private machines: Machines, private workspaces?: WorkspacesV1, private options: Options = {}) {
    this.terminals = options.terminals;
    this.scopes = options.scopes || new ProjectRunScopes(machines);
    this.identities = options.identities || new ProjectIdentities(machines);
    this.control = options.control || new SingleAppControl(machines);
    if (!options.deferInitialization) this.init();
  }
  /**
   * 入口 / Entry: SingleAppWindows.init.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，初始化并核对当前领域状态；本入口产生 `void` 供上层消费（`SingleAppWindows`）。
   * Purpose: Initializes and verifies current domain state in `SingleAppWindows`; this entry produces `void` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.workspaces.beforeConfigChange`, `this.machines.on`, `projectTerminalsFor`, `this.machines.off` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.beforeConfigChange`, `this.machines.on`, `projectTerminalsFor`, `this.machines.off`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.initialized`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `this.removeConfigGuard`, `this.terminals`, `this.initialized`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; 异常 / errors `new AppError('单应用服务已关闭', 503)`; `error`.
   * 失败处理：catch 分支执行 `this.machines.off('change', this.onChange);`; `this.machines.off('incident-lockdown', this.onLock);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.machines.off('change', this.onChange);`; `this.machines.off('incident-lockdown', this.onLock);`; these statements determine whether a failure is absorbed or rejected again.
   */
  init() {
    if (this.closed) throw new AppError('单应用服务已关闭', 503);
    if (this.initialized) return;
    try {
      /**
       * 入口 / Entry: SingleAppWindows.init.callback@151.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.workspaces.beforeConfigChange）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.workspaces.beforeConfigChange).
       * 输入 / Inputs: id; previous; next
       * 输出 / Returns: `void`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `[...this.sessions.values()].some(session => session.vmId === id && session.projectId === (previous._workspace || 'default') &…`; 异常 / errors `new AppError('请先停止此项目的单应用窗口并确认原运行清理，再修改目录或网络隔离模式', 409, 'SINGLE_APP_RUNS_MUST_STOP')`.
       */
      this.removeConfigGuard = this.workspaces?.beforeConfigChange(async (id, previous, next) => {
        if (previous.directory === next.directory && (previous.networkIsolation || 'host') === (next.networkIsolation || 'host')) return;
        await this.load(id);
        await this.sync(id);
        if ([...this.sessions.values()].some(session => session.vmId === id &&
            session.projectId === (previous._workspace || 'default') && session.phase !== 'stopped'))
          throw new AppError('请先停止此项目的单应用窗口并确认原运行清理，再修改目录或网络隔离模式', 409, 'SINGLE_APP_RUNS_MUST_STOP');
      });
      this.machines.on('change', this.onChange);
      this.machines.on('incident-lockdown', this.onLock);
      this.terminals ||= this.workspaces ? projectTerminalsFor(this.machines, this.workspaces) : undefined;
      this.initialized = true;
    } catch (error) {
      this.machines.off('change', this.onChange);
      this.machines.off('incident-lockdown', this.onLock);
      this.removeConfigGuard?.();
      this.removeConfigGuard = undefined;
      throw error;
    }
  }
  /**
   * 入口 / Entry: SingleAppWindows.file.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(this.options.rootDirectory || vmDir(id), 'single-app-runs.json')` 供上层消费（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; this entry produces `join(this.options.rootDirectory || vmDir(id), 'single-app-runs.json')` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `vmDir`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `join(this.options.rootDirectory || vmDir(id), 'single-app-runs.json')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private file(id: string) { return join(this.options.rootDirectory || vmDir(id), 'single-app-runs.json'); }
  /**
   * 入口 / Entry: SingleAppWindows.readJournal.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `journal` 供上层消费（`SingleAppWindows`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `SingleAppWindows`; this entry produces `journal` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `journalSchema.parse`, `readStore`, `this.file`, `journal.sessions.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `journalSchema.parse`, `readStore`, `this.file`, `journal.sessions.some`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `journal`.
   * 副作用 / Effects: 更新 / updates `journal`.
   * 拒绝 / Refusals: 条件 / conditions `journal.sessions.some(session => session.vmId !== id)`; 异常 / errors `new AppError('单应用主机登记无法核对，保留原记录', 409, 'SINGLE_APP_HOST_CHANGED')`; `new AppError('单应用登记属于其他实例', 409, 'SINGLE_APP_HOST_CHANGED')`.
   * 失败处理：catch 分支执行 `throw new AppError('单应用主机登记无法核对，保留原记录', 409, 'SINGLE_APP_HOST_CHANGED');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('单应用主机登记无法核对，保留原记录', 409, 'SINGLE_APP_HOST_CHANGED');`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async readJournal(id: string) {
    let journal: z.infer<typeof journalSchema>;
    try { journal = journalSchema.parse(await readStore(this.file(id), () => ({ version: 1, sessions: [] }))); }
    catch { throw new AppError('单应用主机登记无法核对，保留原记录', 409, 'SINGLE_APP_HOST_CHANGED'); }
    if (journal.sessions.some(session => session.vmId !== id)) throw new AppError('单应用登记属于其他实例', 409, 'SINGLE_APP_HOST_CHANGED');
    return journal;
  }
  /**
   * 入口 / Entry: SingleAppWindows.sync.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `journal` 供上层消费（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; this entry produces `journal` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.readJournal`, `this.sessions.get`, `matchOriginal`, `this.disconnect` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.readJournal`, `this.sessions.get`, `matchOriginal`, `this.disconnect`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `current`; `saved.phase !== 'stopped'`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `journal`.
   * 副作用 / Effects: `this.sessions.set`; 更新 / updates `saved.revoked`, `current.revoked`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async sync(id: string) {
    const journal = await this.readJournal(id);
    for (const saved of journal.sessions) {
      const current = this.sessions.get(saved.id);
      if (current) {
        matchOriginal(current, saved);
        saved.revoked ||= current.revoked;
        current.revoked ||= saved.revoked;
        if (saved.phase !== 'stopped') continue;
        this.disconnect(saved.id);
      }
      this.sessions.set(saved.id, saved);
      if (saved.phase !== 'stopped') this.enforcePolicy(saved);
    }
    return journal;
  }
  /**
   * 入口 / Entry: SingleAppWindows.load.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `loading` 供上层消费（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; this entry produces `loading` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.loaded.get`, `inline`, `this.loaded.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.loaded.get`, `inline`, `this.loaded.set`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!loading`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `loading`.
   * 副作用 / Effects: `this.loaded.set`; 更新 / updates `loading`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async load(id: string) {
    let loading = this.loaded.get(id);
    if (!loading) {
      loading = (async () => {
        const journal = await this.readJournal(id);
        for (const session of journal.sessions) {
          this.sessions.set(session.id, session);
          if (session.phase !== 'stopped') this.enforcePolicy(session);
        }
      })();
      this.loaded.set(id, loading);
    }
    return loading;
  }
  /**
   * 入口 / Entry: SingleAppWindows.save.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，校验并提交领域状态变更；本入口产生 `writeStore(this.file(id), journalSchema.parse({ version: 1, sessions: [...merged.values()] }))` 供上层消费（`SingleAppWindows`）。
   * Purpose: Validates and commits a domain state change in `SingleAppWindows`; this entry produces `writeStore(this.file(id), journalSchema.parse({ version: 1, sessions: [...merged.values()] }))` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.readJournal`, `previous.sessions.map`, `this.sessions.values`, `merged.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.readJournal`, `previous.sessions.map`, `this.sessions.values`, `merged.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `session.vmId === id`; `old`; `old.phase === 'stopped'`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `writeStore(this.file(id), journalSchema.parse({ version: 1, sessions: [...merged.values()] }))`.
   * 副作用 / Effects: `merged.set`; `writeStore`; 更新 / updates `old.revoked`, `session.revoked`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save(id: string) {
    const previous = await this.readJournal(id);
    const merged = new Map(previous.sessions.map(session => [session.id, session]));
    for (const session of this.sessions.values()) if (session.vmId === id) {
      const old = merged.get(session.id);
      if (old) {
        matchOriginal(old, session);
        // A concurrently reloaded owner can retire this same run. Never erase
        // another UUID, resurrect a stopped row, or relax its saved revocation.
        if (old.phase === 'stopped') { old.revoked ||= session.revoked; merged.set(session.id, old); continue; }
        session.revoked ||= old.revoked;
      }
      merged.set(session.id, session);
    }
    return writeStore(this.file(id), journalSchema.parse({ version: 1, sessions: [...merged.values()] }));
  }
  /**
   * 入口 / Entry: SingleAppWindows.onChange.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; the calls and state transitions below complete the operation. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.sessions.values`, `this.machines.state`, `this.machines.live.get`, `this.livePins.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.sessions.values`, `this.machines.state`, `this.machines.live.get`, `this.livePins.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.machines.state(session.vmId) !== 'running' || this.machines.live.get(session.vmId) !== this.liv…`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private onChange = () => {
    for (const session of this.sessions.values())
      if (this.machines.state(session.vmId) !== 'running' || this.machines.live.get(session.vmId) !== this.livePins.get(session.id))
        this.disconnect(session.id);
  };
  /**
   * 入口 / Entry: SingleAppWindows.onLock.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; the calls and state transitions below complete the operation. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.sessions.values`, `this.disconnect` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.sessions.values`, `this.disconnect`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `session.vmId === id`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private onLock = (id: string) => { for (const session of this.sessions.values()) if (session.vmId === id) this.disconnect(session.id); };
  /**
   * 入口 / Entry: SingleAppWindows.disconnect.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; the calls and state transitions below complete the operation. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.sessionListeners.get`, `this.sessionListeners.delete`, `listener` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.sessionListeners.get`, `this.sessionListeners.delete`, `listener`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.sessionListeners.delete`; `listener`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private disconnect(id: string) {
    const listeners = this.sessionListeners.get(id); this.sessionListeners.delete(id);
    for (const listener of listeners || []) listener();
  }
  /**
   * 入口 / Entry: SingleAppWindows.retireLease.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，结束、撤销或清理本次拥有的领域资源；本入口产生 `ProjectSessionLifetime.retireOriginal(this.machines, session.vmId, sessionReceipt(session), () => this.retireLeaseNative(sess…` 供上层消费（`SingleAppWindows`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `SingleAppWindows`; this entry produces `ProjectSessionLifetime.retireOriginal(this.machines, session.vmId, sessionReceipt(session), () => this.retireLeaseNative(sess…` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `ProjectSessionLifetime.retireOriginal`, `sessionReceipt` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `ProjectSessionLifetime.retireOriginal`, `sessionReceipt`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: session: Session
   * 输出 / Returns: `ProjectSessionLifetime.retireOriginal(this.machines, session.vmId, sessionReceipt(session), () => this.retireLeaseNative(sess…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async retireLease(session: Session) {
    return ProjectSessionLifetime.retireOriginal(this.machines, session.vmId, sessionReceipt(session),
      () => this.retireLeaseNative(session));
  }
  /**
   * 入口 / Entry: SingleAppWindows.retireLeaseNative.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`SingleAppWindows`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `SingleAppWindows`; the calls and state transitions below complete the operation. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.disconnect`, `clearTimeout`, `this.watchers.get`, `this.watchers.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.disconnect`, `clearTimeout`, `this.watchers.get`, `this.watchers.delete`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: session: Session
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `clearTimeout`; `this.watchers.delete`; `this.leases.delete`; `this.livePins.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async retireLeaseNative(session: Session) {
    this.disconnect(session.id); clearTimeout(this.watchers.get(session.id)); this.watchers.delete(session.id);
    await this.leases.get(session.id)?.(); this.leases.delete(session.id); this.livePins.delete(session.id);
  }
  /**
   * 入口 / Entry: SingleAppWindows.watch.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; this entry produces `void` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.watchers.has`, `this.leases.has`, `this.sessions.get`, `setTimeout` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.watchers.has`, `this.leases.has`, `this.sessions.get`, `setTimeout`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || this.watchers.has(id) || !this.leases.has(id) || this.sessions.get(id)?.phase !== 'ru…`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `setTimeout`; `this.watchers.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private watch(id: string) {
    if (this.closed || this.watchers.has(id) || !this.leases.has(id) || this.sessions.get(id)?.phase !== 'running') return;
    /**
     * 入口 / Entry: SingleAppWindows.watch.callback@245.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（setTimeout）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (setTimeout).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `this.watchers.delete`; `this.pending.add`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const timer = setTimeout(() => {
      this.watchers.delete(id); const known = this.sessions.get(id);
      if (!known || this.closed || !this.leases.has(id) || known.phase !== 'running') return;
      let entered = false;
      /**
       * 入口 / Entry: SingleAppWindows.watch.callback@249.
       * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
       * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `void`.
       * 副作用 / Effects: 更新 / updates `entered`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const operation = this.machines.locked(`single-app:${known.vmId}`, async () => {
        entered = true;
        await this.sync(known.vmId);
        const session = this.sessions.get(id)!;
        if (!this.leases.has(id)) return;
        if (session.phase === 'stopped') { await this.retireLease(session); return; }
        if (session.phase !== 'running' || this.closed || this.machines.state(session.vmId) !== 'running') return;
        this.live(session.vmId, this.livePins.get(id));
        const status = await this.status(session);
        if (status.state === 'exited' || status.state === 'stopped') await this.terminate(session);
      }).catch(error => {
        if (entered) {
          this.disconnect(id);
          const current = this.sessions.get(id);
          if (current) current.lastError = error instanceof AppError ? error.code || 'SINGLE_APP_EXIT_UNCONFIRMED' : 'SINGLE_APP_EXIT_UNCONFIRMED';
        }
      }).finally(() => { this.pending.delete(operation); this.watch(id); });
      this.pending.add(operation);
    }, this.options.exitPollMs ?? 2000);
    timer.unref(); this.watchers.set(id, timer);
  }
  /**
   * 入口 / Entry: SingleAppWindows.onSessionInvalidated.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `() => { listeners.delete(listener); if (!listeners.size && this.sessionListeners.get(sessionId) === listeners) this.sessionLi…` 供上层消费（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; this entry produces `() => { listeners.delete(listener); if (!listeners.size && this.sessionListeners.get(sessionId) === listeners) this.sessionLi…` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.sessions.get`, `z.uuid().parse`, `z.uuid`, `this.enforcePolicy` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.sessions.get`, `z.uuid().parse`, `z.uuid`, `this.enforcePolicy`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `session`.
   * 输入 / Inputs: id: string; sessionId: string; listener: () => void
   * 输出 / Returns: `() => { listeners.delete(listener); if (!listeners.size && this.sessionListeners.get(sessionId) === listeners) this.sessionLi…`.
   * 副作用 / Effects: `listeners.add`; `this.sessionListeners.set`.
   * 拒绝 / Refusals: 条件 / conditions `!session || session.vmId !== id || session.phase !== 'running' || session.revoked || this.machines.state(id) !== 'running'`; 异常 / errors `new AppError('应用窗口会话已失效，请停止并重开', 409)`.
   */
  onSessionInvalidated(id: string, sessionId: string, listener: () => void) {
    const session = this.sessions.get(z.uuid().parse(sessionId));
    if (session) this.enforcePolicy(session);
    if (!session || session.vmId !== id || session.phase !== 'running' || session.revoked || this.machines.state(id) !== 'running')
      throw new AppError('应用窗口会话已失效，请停止并重开', 409);
    const listeners = this.sessionListeners.get(sessionId) || new Set<
    /**
     * 中文功能：为 SingleAppWindows.onSessionInvalidated.listeners 登记事件、状态变化或阶段结束通知，接收本声明规定的事件数据。
     * English: Registers event/state-change/phase-completion notification for SingleAppWindows.onSessionInvalidated.listeners using its declared event data.
     * 所属 / Owner: SingleAppWindows.onSessionInvalidated.listeners.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `void`.
     */
    () => void>(); listeners.add(listener);
    this.sessionListeners.set(sessionId, listeners);
    return () => { listeners.delete(listener); if (!listeners.size && this.sessionListeners.get(sessionId) === listeners)
      this.sessionListeners.delete(sessionId); };
  }
  /**
   * 入口 / Entry: SingleAppWindows.clipboardFile.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(vmDir(id), 'single-app-clipboard.json')` 供上层消费（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; this entry produces `join(vmDir(id), 'single-app-clipboard.json')` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `vmDir`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `join(vmDir(id), 'single-app-clipboard.json')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private clipboardFile(id: string) { return join(vmDir(id), 'single-app-clipboard.json'); }
  /**
   * 入口 / Entry: SingleAppWindows.enforcePolicy.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `session.revoked`（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; the outcome is recorded in `session.revoked`. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `clipboardStoreSchema.parse`, `readFileSync`, `this.clipboardFile`, `this.disconnect` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `clipboardStoreSchema.parse`, `readFileSync`, `this.clipboardFile`, `this.disconnect`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `(error as NodeJS.ErrnoException).code === 'ENOENT'`; `rule && ((session.clipboard.copy && !rule.copy) || (session.clipboard.paste && !rule.paste))`.
   * 输入 / Inputs: session: Session
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `rules`, `session.revoked`.
   * 拒绝 / Refusals: 异常 / errors `new AppError('单应用剪贴板规则无法核对', 409, 'SINGLE_APP_CLIPBOARD_POLICY_CHANGED')`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code === 'ENOENT') rules = {}; else { this.disconnect(session.id); throw new AppError('单…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code === 'ENOENT') rules = {}; else { this.disconnect(session.id); throw new AppError('单…`; these statements determine whether a failure is absorbed or rejected again.
   */
  private enforcePolicy(session: Session) {
    let rules: z.infer<typeof clipboardStoreSchema>['rules'];
    try { rules = clipboardStoreSchema.parse(JSON.parse(readFileSync(this.clipboardFile(session.vmId), 'utf8'))).rules; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') rules = {};
      else { this.disconnect(session.id); throw new AppError('单应用剪贴板规则无法核对', 409, 'SINGLE_APP_CLIPBOARD_POLICY_CHANGED'); }
    }
    const rule = rules[session.program];
    if (rule && ((session.clipboard.copy && !rule.copy) || (session.clipboard.paste && !rule.paste))) {
      session.revoked = true; this.disconnect(session.id);
    }
  }
  /**
   * 入口 / Entry: SingleAppWindows.clipboardPolicies.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `clipboardStoreSchema.parse(await readStore(this.clipboardFile(id), () => ({ version: 1, rules: {} }))).rules` 供上层消费（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; this entry produces `clipboardStoreSchema.parse(await readStore(this.clipboardFile(id), () => ({ version: 1, rules: {} }))).rules` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.machines.get`, `clipboardStoreSchema.parse`, `readStore`, `this.clipboardFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `clipboardStoreSchema.parse`, `readStore`, `this.clipboardFile`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `clipboardStoreSchema.parse(await readStore(this.clipboardFile(id), () => ({ version: 1, rules: {} }))).rules`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async clipboardPolicies(id: string) {
    this.machines.get(id);
    return clipboardStoreSchema.parse(await readStore(this.clipboardFile(id), () => ({ version: 1, rules: {} }))).rules;
  }
  /**
   * 入口 / Entry: SingleAppWindows.saveClipboardPolicy.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，校验并提交领域状态变更；本入口产生 `this.machines.locked(`single-app:${id}`, async () => { await this.load(id); await this.sync(id); const rules = await this.cli…` 供上层消费（`SingleAppWindows`）。
   * Purpose: Validates and commits a domain state change in `SingleAppWindows`; this entry produces `this.machines.locked(`single-app:${id}`, async () => { await this.load(id); await this.sync(id); const rules = await this.cli…` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `singleAppProgram.parse`, `singleAppClipboard.parse`, `this.machines.get`, `this.machines.requireUnlocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `singleAppProgram.parse`, `singleAppClipboard.parse`, `this.machines.get`, `this.machines.requireUnlocked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; program: string; raw: unknown
   * 输出 / Returns: `this.machines.locked(`single-app:${id}`, async () => { await this.load(id); await this.sync(id); const rules = await this.cli…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async saveClipboardPolicy(id: string, program: string, raw: unknown) {
    singleAppProgram.parse(program); const clipboard = singleAppClipboard.parse(raw);
    this.machines.get(id); this.machines.requireUnlocked(id);
    /**
     * 入口 / Entry: SingleAppWindows.saveClipboardPolicy.callback@300.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ program, clipboard }`.
     * 副作用 / Effects: `writeStore`; `this.save`; 更新 / updates `session.revoked`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.machines.locked(`single-app:${id}`, async () => {
      await this.load(id); await this.sync(id); const rules = await this.clipboardPolicies(id);
      for (const session of this.sessions.values()) if (session.vmId === id && session.program === program && session.phase !== 'stopped' &&
          ((session.clipboard.copy && !clipboard.copy) || (session.clipboard.paste && !clipboard.paste))) {
        session.revoked = true; this.disconnect(session.id);
      }
      await writeStore(this.clipboardFile(id), clipboardStoreSchema.parse({ version: 1, rules: { ...rules, [program]: clipboard } }));
      await this.save(id); return { program, clipboard };
    });
  }
  /**
   * 入口 / Entry: SingleAppWindows.removeClipboardPolicy.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.machines.locked(`single-app:${id}`, async () => { const rules = await this.clipboardPolicies(id), removed = Object.hasOw…` 供上层消费（`SingleAppWindows`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `SingleAppWindows`; this entry produces `this.machines.locked(`single-app:${id}`, async () => { const rules = await this.clipboardPolicies(id), removed = Object.hasOw…` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `singleAppProgram.parse`, `this.machines.get`, `this.machines.requireUnlocked`, `this.machines.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `singleAppProgram.parse`, `this.machines.get`, `this.machines.requireUnlocked`, `this.machines.locked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; program: string
   * 输出 / Returns: `this.machines.locked(`single-app:${id}`, async () => { const rules = await this.clipboardPolicies(id), removed = Object.hasOw…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async removeClipboardPolicy(id: string, program: string) {
    singleAppProgram.parse(program); this.machines.get(id); this.machines.requireUnlocked(id);
    return this.machines.locked(`single-app:${id}`, async () => {
      const rules = await this.clipboardPolicies(id), removed = Object.hasOwn(rules, program);
      await writeStore(this.clipboardFile(id), { version: 1, rules: Object.fromEntries(Object.entries(rules).filter(([key]) => key !== program)) });
      return { removed, program };
    });
  }
  /**
   * 入口 / Entry: SingleAppWindows.live.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `live` 供上层消费（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; this entry produces `live` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.machines.live.get`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.live.get`, `this.machines.state`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; expected: Live optional
   * 输出 / Returns: `live`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) !== 'running' || !live || (expected && live !== expected)`; 异常 / errors `new AppError('原单应用客户机运行身份已变化，请保留原票据并恢复核对', 409, 'SINGLE_APP_LIVE_CHANGED')`.
   */
  private live(id: string, expected?: Live) {
    const live = this.machines.live.get(id);
    if (this.machines.state(id) !== 'running' || !live || (expected && live !== expected))
      throw new AppError('原单应用客户机运行身份已变化，请保留原票据并恢复核对', 409, 'SINGLE_APP_LIVE_CHANGED');
    return live;
  }
  /**
   * 入口 / Entry: SingleAppWindows.boot.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `z.uuid().parse(result.stdout.trim())` 供上层消费（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; this entry produces `z.uuid().parse(result.stdout.trim())` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.live`, `this.machines.exec`, `z.uuid().parse`, `z.uuid` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.live`, `this.machines.exec`, `z.uuid().parse`, `z.uuid`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; live: Live
   * 输出 / Returns: `z.uuid().parse(result.stdout.trim())`.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError('单应用原客户机 boot 无法核对', 409, 'SINGLE_APP_BOOT_CHANGED')`.
   */
  private async boot(id: string, live: Live) {
    this.live(id, live); const result = await this.machines.exec(id, 'cat /proc/sys/kernel/random/boot_id', 5000); this.live(id, live);
    if (result.code !== 0) throw new AppError('单应用原客户机 boot 无法核对', 409, 'SINGLE_APP_BOOT_CHANGED');
    return z.uuid().parse(result.stdout.trim());
  }
  /**
   * 入口 / Entry: SingleAppWindows.validateCapture.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`SingleAppWindows`）。
   * Purpose: Checks admission, input or resource ownership in `SingleAppWindows`; the calls and state transitions below complete the operation. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `signal.throwIfAborted`, `this.live`, `this.machines.requireUnlocked`, `inline.projects.inScope` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.live`, `this.machines.requireUnlocked`, `inline.projects.inScope`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; live: Live; projectId: string; version: string; signal: AbortSignal optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `projectVersion(current) !== version || (current._workspace || 'default') !== projectId`; 异常 / errors `new AppError('原单应用项目配置已变化，请按原配置重试', 409, 'SINGLE_APP_CONFIG_CHANGED')`.
   */
  private async validateCapture(id: string, live: Live, projectId: string, version: string, signal?: AbortSignal) {
    signal?.throwIfAborted(); this.live(id, live); this.machines.requireUnlocked(id);
    const current = await this.workspaces!.projects.inScope(id, projectId, () => this.workspaces!.config(id));
    signal?.throwIfAborted(); this.live(id, live);
    if (projectVersion(current) !== version || (current._workspace || 'default') !== projectId)
      throw new AppError('原单应用项目配置已变化，请按原配置重试', 409, 'SINGLE_APP_CONFIG_CHANGED');
  }
  /**
   * 入口 / Entry: SingleAppWindows.matchReceipt.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `receipt` 供上层消费（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; this entry produces `receipt` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `appReceiptSchema.parse`, `same`, `origin`, `matchOriginal` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `appReceiptSchema.parse`, `same`, `origin`, `matchOriginal`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `session.receipt`.
   * 输入 / Inputs: session: Session; raw: unknown
   * 输出 / Returns: AppReceipt；结果来自 / values from `receipt`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `receipt.id !== session.id || receipt.build !== session.build || !same(receipt.origin, origin(session))`; 异常 / errors `new AppError('单应用客户机回执不属于原运行', 409, 'SINGLE_APP_RECEIPT_CHANGED')`.
   */
  private matchReceipt(session: Session, raw: unknown): AppReceipt {
    const receipt = appReceiptSchema.parse(raw);
    if (receipt.id !== session.id || receipt.build !== session.build || !same(receipt.origin, origin(session)))
      throw new AppError('单应用客户机回执不属于原运行', 409, 'SINGLE_APP_RECEIPT_CHANGED');
    if (session.receipt) matchOriginal(session, { ...session, receipt });
    return receipt;
  }
  /**
   * 入口 / Entry: SingleAppWindows.status.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `result` 供上层消费（`SingleAppWindows`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `SingleAppWindows`; this entry produces `result` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.live`, `appStatusSchema.parse`, `this.control.call`, `origin` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.live`, `appStatusSchema.parse`, `this.control.call`, `origin`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: session: Session
   * 输出 / Returns: `result`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `result.state === 'running' && (session.receipt?.endpoint === null || !same(result.endpoint, session.receipt?.endpoint))`; 异常 / errors `new AppError('单应用真实图形监听已变化', 409, 'SINGLE_APP_LISTENER_CHANGED')`.
   */
  private async status(session: Session) {
    const live = this.live(session.vmId);
    const result = appStatusSchema.parse(await this.control.call(session.vmId, session.build, 'status', origin(session)));
    this.live(session.vmId, live); this.matchReceipt(session, result.receipt);
    if (result.state === 'running' && (session.receipt?.endpoint === null || !same(result.endpoint, session.receipt?.endpoint)))
      throw new AppError('单应用真实图形监听已变化', 409, 'SINGLE_APP_LISTENER_CHANGED');
    return result;
  }
  /**
   * 入口 / Entry: SingleAppWindows.view.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `singleAppViewSchema.parse({ id: session.id, vmId: session.vmId, program: session.program, display: session.receipt?.display |…` 供上层消费（`SingleAppWindows`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `SingleAppWindows`; this entry produces `singleAppViewSchema.parse({ id: session.id, vmId: session.vmId, program: session.program, display: session.receipt?.display |…` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `singleAppViewSchema.parse`, `appIdentity` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `singleAppViewSchema.parse`, `appIdentity`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: session: Session; status: SingleAppWindowView['status'] default=session.phase === 'running' ? (session.revoked ? 'relau…
   * 输出 / Returns: SingleAppWindowView；结果来自 / values from `singleAppViewSchema.parse({ id: session.id, vmId: session.vmId, program: session.program, display: session.receipt?.display |…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private view(session: Session, status: SingleAppWindowView['status'] = session.phase === 'running' ?
    (session.revoked ? 'relaunch-required' : 'running') : session.phase === 'stopped' ? 'stopped' : 'cleanup-pending'): SingleAppWindowView {
    return singleAppViewSchema.parse({ id: session.id, vmId: session.vmId, program: session.program, display: session.receipt?.display || 0,
      port: session.receipt?.port || 0, resolution: session.resolution, clipboard: session.clipboard, startedAt: session.startedAt,
      projectId: session.projectId, networkIsolation: session.networkIsolation, password: session.receipt?.password || '',
      dataDirectory: appIdentity(session.id).home, revoked: session.revoked, projectOwner: { uid: session.identity.uid, user: session.identity.account },
      applicationOwner: session.receipt ? { uid: session.receipt.uid, user: session.receipt.user } : undefined,
      cleanupPending: status === 'cleanup-pending' || (session.phase !== 'running' && session.phase !== 'stopped'), lastError: session.lastError,
      status });
  }
  /**
   * 入口 / Entry: SingleAppWindows.list.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `rows` 供上层消费（`SingleAppWindows`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `SingleAppWindows`; this entry produces `rows` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.machines.get`, `this.load`, `this.sync`, `Promise.all` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.load`, `this.sync`, `Promise.all`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.machines.state(id) === 'running'`; `!this.sessions.has(entry.id)`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `rows`.
   * 副作用 / Effects: `rows.push`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async list(id: string) {
    this.machines.get(id); await this.load(id); await this.sync(id);
    /**
     * 入口 / Entry: SingleAppWindows.list.callback@363.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline.filter().map）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline.filter().map).
     * 输入 / Inputs: session
     * 输出 / Returns: `this.view(session, 'stopped')`; `{ ...this.view(session, 'cleanup-pending'), cleanupPending: true, lastError: 'SINGLE_APP_CLIPBOARD_POLICY_CHANGED' }`; `this.view(session, 'cleanup-pending')`；另有分支返回 / additional branch-specific returns.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 失败处理：catch 分支执行 `return { ...this.view(session, 'cleanup-pending'), cleanupPending: true, lastError: 'SINGLE_APP_CLIPBOARD_POLICY_CHANGED' };`; `return { ...this.view(session, 'cleanup-pending'), cleanupPending: true, lastError: error instanceof AppError ? error.code ||…`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `return { ...this.view(session, 'cleanup-pending'), cleanupPending: true, lastError: 'SINGLE_APP_CLIPBOARD_POLICY_CHANGED' };`; `return { ...this.view(session, 'cleanup-pending'), cleanupPending: true, lastError: error instanceof AppError ? error.code ||…`; these statements determine whether a failure is absorbed or rejected again.
     */
    const rows = await Promise.all([...this.sessions.values()].filter(session => session.vmId === id).map(async session => {
      if (session.phase === 'stopped') return this.view(session, 'stopped');
      try { this.enforcePolicy(session); }
      catch { return { ...this.view(session, 'cleanup-pending'), cleanupPending: true, lastError: 'SINGLE_APP_CLIPBOARD_POLICY_CHANGED' }; }
      if (this.machines.state(id) === 'paused') return this.view(session, 'cleanup-pending');
      if (session.phase !== 'running' || this.machines.state(id) !== 'running') return this.view(session,
        ['intent', 'prepared', 'starting'].includes(session.phase) ? 'preparing' : 'cleanup-pending');
      try { const state = await this.status(session); return this.view(session, state.state === 'running'
        ? (session.revoked ? 'relaunch-required' : 'running') : 'cleanup-pending'); }
      catch (error) { return { ...this.view(session, 'cleanup-pending'), cleanupPending: true,
        lastError: error instanceof AppError ? error.code || 'SINGLE_APP_CONTROL_FAILED' : 'SINGLE_APP_CONTROL_FAILED' }; }
    }));
    if (this.machines.state(id) === 'running') {
      const live = this.live(id), legacy = await this.control.legacy(id);
      this.live(id, live);
      for (const entry of legacy) if (!this.sessions.has(entry.id)) rows.push({
        id: entry.id, vmId: id, program: 'legacy', display: 0, port: 0, resolution: '1024x768',
        clipboard: { copy: false, paste: false }, startedAt: '', projectId: undefined, networkIsolation: undefined,
        password: '', dataDirectory: entry.home, revoked: true, projectOwner: undefined,
        applicationOwner: { uid: entry.uid, user: entry.user }, cleanupPending: false,
        lastError: '旧窗口缺少原项目、boot、cgroup 和 namespace 票据；请管理员人工核对', status: 'review-required',
      });
    }
    return rows;
  }
  /**
   * 入口 / Entry: SingleAppWindows.port.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `session.receipt!.port` 供上层消费（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; this entry produces `session.receipt!.port` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.load`, `this.sync`, `this.sessions.get`, `z.uuid().parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.load`, `this.sync`, `this.sessions.get`, `z.uuid().parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; sessionId: string
   * 输出 / Returns: `session.receipt!.port`.
   * 副作用 / Effects: `this.livePins.set`.
   * 拒绝 / Refusals: 条件 / conditions `!session || session.vmId !== id || session.phase !== 'running'`; `session.revoked`; `status.state !== 'running' || session.revoked || this.sessions.get(sessionId) !== session || session.phase !== 'running'`; 异常 / errors `new AppError('应用窗口会话不存在或待清理', 404)`; `new AppError('剪贴板规则已收紧，请停止并重开此窗口', 409)`.
   */
  async port(id: string, sessionId: string) {
    await this.load(id); await this.sync(id); const session = this.sessions.get(z.uuid().parse(sessionId));
    if (!session || session.vmId !== id || session.phase !== 'running') throw new AppError('应用窗口会话不存在或待清理', 404);
    this.enforcePolicy(session);
    if (session.revoked) throw new AppError('剪贴板规则已收紧，请停止并重开此窗口', 409);
    this.machines.requireUnlocked(id); const status = await this.status(session);
    this.enforcePolicy(session);
    if (status.state !== 'running' || session.revoked || this.sessions.get(sessionId) !== session || session.phase !== 'running')
      throw new AppError('应用窗口会话已退出或变化', 409);
    this.livePins.set(session.id, this.live(id)); return session.receipt!.port;
  }
  /**
   * 入口 / Entry: SingleAppWindows.connectionCommand.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.control.streamCommand(session.build, origin(session))` 供上层消费（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; this entry produces `this.control.streamCommand(session.build, origin(session))` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.port`, `this.machines.requireUnlocked`, `this.sessions.get`, `this.control.streamCommand` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.port`, `this.machines.requireUnlocked`, `this.sessions.get`, `this.control.streamCommand`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; sessionId: string; port: number
   * 输出 / Returns: `this.control.streamCommand(session.build, origin(session))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `await this.port(id, sessionId) !== port`; 异常 / errors `new AppError('应用窗口端口不匹配', 409)`.
   */
  async connectionCommand(id: string, sessionId: string, port: number) {
    if (await this.port(id, sessionId) !== port) throw new AppError('应用窗口端口不匹配', 409);
    this.machines.requireUnlocked(id); const session = this.sessions.get(sessionId)!;
    return this.control.streamCommand(session.build, origin(session));
  }
  /**
   * 入口 / Entry: SingleAppWindows.start.
   * 功能：准备并启动绑定项目 UID、目录视图和剪贴板规则的单应用会话。
   * Purpose: Prepares/starts single-app sessions bound to project UID, directory view and clipboard policy.
   * 设计：完整原生票据及监听回执核验后交付连接，原准备失败要停止整个所属域；无法确认时保留旧记录供重试。
   * Design: Complete native/listener proof precedes connection handoff; failure stops the owning scope and unconfirmed cleanup retains records.
   * 输入 / Inputs: id: string; raw: unknown; signal: AbortSignal optional
   * 输出 / Returns: `await pending`.
   * 副作用 / Effects: `AbortSignal.any`; `this.pending.add`; `this.pending.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `this.pending.delete(pending);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.pending.delete(pending);`; these steps also apply to exceptional exits.
   */
  async start(id: string, raw: unknown, signal?: AbortSignal) {
    const input = singleAppInput.parse(raw), scope = this.workspaces?.projects.current(id), live = this.live(id);
    const abort = AbortSignal.any([this.closeAbort.signal, ...(signal ? [signal] : [])]);
    /**
     * 入口 / Entry: SingleAppWindows.start.callback@407.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `await lifetime.perform(async abort => { const session = originalSession; const run = projectIdentityRunSchema.parse(await thi…`.
     * 副作用 / Effects: `abort.throwIfAborted`; `this.control.install`; `this.identities.install`; `this.sessions.set`; `this.leases.set`; 更新 / updates `preparation`, `session`, `retained`, `published`.
     * 拒绝 / Refusals: 条件 / conditions `!this.workspaces || !this.terminals || !scope`; `this.closed || this.machines.closing`; `all.filter(session => session.phase !== 'stopped').length >= 4`; 异常 / errors `new AppError('单应用窗口需要项目工作区服务', 409)`; `new AppError('应用窗口服务正在关闭', 503)`.
     * 收尾：退出 try 区域时始终执行 `if (!retained && preparation) await preparation.release();`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `if (!retained && preparation) await preparation.release();`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `if (session && retained && !published) { // No native prepare was issued. A failed host intent write never // authorizes crea…`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (session && retained && !published) { // No native prepare was issued. A failed host intent write never // authorizes crea…`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    const pending = this.machines.locked(`single-app:${id}`, async () => {
      if (!this.workspaces || !this.terminals || !scope) throw new AppError('单应用窗口需要项目工作区服务', 409);
      if (this.closed || this.machines.closing) throw new AppError('应用窗口服务正在关闭', 503);
      abort.throwIfAborted(); this.machines.requireUnlocked(id); this.live(id, live); await this.load(id); await this.sync(id);
      const all = [...this.sessions.values()].filter(session => session.vmId === id);
      if (all.filter(session => session.phase !== 'stopped').length >= 4)
        throw new AppError('每个实例最多保留四个未清理的单应用窗口，请先确认原窗口停止', 409);
      if (all.length >= 1024) throw new AppError('单应用历史票据达到上限，请保留记录并显式整理', 409, 'SINGLE_APP_HOST_LIMIT');
      let preparation: Preparation | undefined, retained = false, published = false, session: Session | undefined;
      try {
        preparation = await this.terminals.prepare(id, scope, null, false, abort, undefined, { mode: 'task' });
        if (!preparation.captured) throw new AppError('单应用项目准备未返回捕获配置', 409);
        const captured = preparation.captured;
        if (captured.live !== live || preparation.projectId !== scope) throw new AppError('单应用原项目或 live 已变化', 409, 'SINGLE_APP_LIVE_CHANGED');
        const project: Project = structuredClone(captured.project);
        Object.defineProperty(project, '_workspace', { value: scope, enumerable: false });
        await this.validateCapture(id, live, scope, captured.configVersion, abort);
        const rules = await this.clipboardPolicies(id), rule = rules[input.program];
        const clipboard = { copy: input.clipboard.copy && (rule?.copy ?? true), paste: input.clipboard.paste && (rule?.paste ?? true) };
        const identity = await this.scopes.identity(id, project, abort);
        await this.validateCapture(id, live, scope, captured.configVersion, abort);
        const build = await this.control.install(id, abort);
        await this.validateCapture(id, live, scope, captured.configVersion, abort);
        const nativeBuild = await this.identities.install(id, abort);
        await this.validateCapture(id, live, scope, captured.configVersion, abort);
        const expectedNativeBuild = await (this.options.nativeBuild?.() || projectIdentitySources().then(source => source.manifest.build));
        if (nativeBuild !== expectedNativeBuild) throw new AppError('原项目 native 构建在捕获中已变化', 409, 'SINGLE_APP_NATIVE_CHANGED');
        const bootId = await this.boot(id, live);
        await this.validateCapture(id, live, scope, captured.configVersion, abort);
        session = singleAppRunRecordSchema.parse({ version: 1, id: randomUUID(), vmId: id, ...input, clipboard,
          startedAt: new Date().toISOString(), projectId: scope, directory: project.directory, networkIsolation: project.networkIsolation || 'host',
          configVersion: captured.configVersion, bootId, build, nativeBuild, phase: 'intent', identity,
          run: null, receipt: null, revoked: false, retirement: null, closure: null });
        this.sessions.set(session.id, session); this.leases.set(session.id, preparation.release); this.livePins.set(session.id, live); retained = true;
        // The stable UUID and captured boot/account precede native prepare.
        await this.save(id);
        published = true;
        const originalSession = session;
        const lifetime = await ProjectSessionLifetime.acquire({ machines: this.machines, vmId: id,
          live, kind: 'single-app', receipt: sessionReceipt(session), signal: abort,
          /**
           * 入口 / Entry: SingleAppWindows.start.cleanup.
           * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`SingleAppWindows`）。
           * Purpose: Ends, revokes or cleans resources owned by this domain action in `SingleAppWindows`; the calls and state transitions below complete the operation. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
           * 处理：通过 `this.sync`, `this.sessions.get`, `matchOriginal`, `this.retireLeaseNative` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `this.sync`, `this.sessions.get`, `matchOriginal`, `this.retireLeaseNative`; the branches below determine continuation, return or refusal.
           * 分支 / Branches: `saved.phase === 'stopped'`.
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 拒绝 / Refusals: 条件 / conditions `!saved`; 异常 / errors `new AppError('单应用原归属登记缺失', 503, 'SINGLE_APP_CLEANUP_FAILED')`.
           */
          cleanup: async () => {
            await this.sync(id);
            const saved = this.sessions.get(originalSession.id);
            if (!saved) throw new AppError('单应用原归属登记缺失', 503, 'SINGLE_APP_CLEANUP_FAILED');
            matchOriginal(originalSession, saved);
            if (saved.phase === 'stopped') await this.retireLeaseNative(originalSession);
            else await this.terminateNative(originalSession);
          } });
        /**
         * 入口 / Entry: SingleAppWindows.start.callback@455.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（lifetime.perform）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (lifetime.perform).
         * 输入 / Inputs: abort
         * 输出 / Returns: `this.view(session)`.
         * 副作用 / Effects: `this.save`; 更新 / updates `session.run`, `session.receipt`, `session.phase`.
         * 拒绝 / Refusals: 条件 / conditions `running.state !== 'running'`; `this.closed || this.machines.closing`; 异常 / errors `new AppError('单应用图形监听尚未确认', 409, 'SINGLE_APP_START_FAILED')`; `new AppError('应用窗口服务正在关闭', 503)`.
         */
        return await lifetime.perform(async abort => {
        const session = originalSession;
        const run = projectIdentityRunSchema.parse(await this.control.prepareRun(id, session.build,
          { id: session.id, identity, bootId: session.bootId, nativeBuild: session.nativeBuild }, abort));
        singleAppRunRecordSchema.parse({ ...session, run }); origin({ ...session, run });
        session.run = run;
        await this.save(id);
        lifetime.pin(sessionReceipt(session));
        await this.validateCapture(id, live, scope, captured.configVersion, abort);
        session.receipt = this.matchReceipt(session, await this.control.call(id, build, 'prepare', origin(session), undefined, abort));
        session.phase = 'prepared'; await this.save(id); await this.validateCapture(id, live, scope, captured.configVersion, abort);
        session.phase = 'starting'; await this.save(id);
        const running = this.matchReceipt(session, await this.control.call(id, build, 'start', origin(session), project.environment || {}, abort));
        if (running.state !== 'running') throw new AppError('单应用图形监听尚未确认', 409, 'SINGLE_APP_START_FAILED');
        session.receipt = running; session.phase = 'running'; await this.save(id);
        await this.validateCapture(id, live, scope, captured.configVersion, abort);
        if (this.closed || this.machines.closing) throw new AppError('应用窗口服务正在关闭', 503);
        this.watch(session.id);
        return this.view(session);
        }, abort);
      } catch (error) {
        if (session && retained && !published) {
          // No native prepare was issued. A failed host intent write never
          // authorizes creating guest resources merely to clean them up.
          this.sessions.delete(session.id); this.leases.delete(session.id); this.livePins.delete(session.id); retained = false;
        } else if (session && retained) {
          try { await this.terminate(session); retained = false; preparation = undefined; }
          catch { throw new AppError('单应用原运行清理未确认；票据和准备租约已保留，请重试停止原会话', 503, 'SINGLE_APP_CLEANUP_FAILED'); }
        }
        throw error;
      } finally { if (!retained && preparation) await preparation.release(); }
    });
    this.pending.add(pending); try { return await pending; } finally { this.pending.delete(pending); }
  }
  /**
   * 入口 / Entry: SingleAppWindows.terminate.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `ProjectSessionLifetime.retireOriginal(this.machines, session.vmId, sessionReceipt(session), () => this.terminateNative(sessio…` 供上层消费（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; this entry produces `ProjectSessionLifetime.retireOriginal(this.machines, session.vmId, sessionReceipt(session), () => this.terminateNative(sessio…` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `ProjectSessionLifetime.retireOriginal`, `sessionReceipt` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `ProjectSessionLifetime.retireOriginal`, `sessionReceipt`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: session: Session
   * 输出 / Returns: `ProjectSessionLifetime.retireOriginal(this.machines, session.vmId, sessionReceipt(session), () => this.terminateNative(sessio…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async terminate(session: Session) {
    return ProjectSessionLifetime.retireOriginal(this.machines, session.vmId, sessionReceipt(session),
      () => this.terminateNative(session));
  }
  /**
   * 入口 / Entry: SingleAppWindows.terminateNative.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`SingleAppWindows`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleAppWindows`; this entry produces `void` for its caller. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `clearTimeout`, `this.watchers.get`, `this.watchers.delete`, `this.disconnect` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `clearTimeout`, `this.watchers.get`, `this.watchers.delete`, `this.disconnect`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: session: Session
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `clearTimeout`; `this.watchers.delete`; `this.save`; 更新 / updates `session.phase`, `session.absence`, `session.run`, `session.receipt`.
   * 拒绝 / Refusals: 条件 / conditions `this.livePins.has(session.id) && this.livePins.get(session.id) !== live && cleanupBoot === session.bootId`; `!session.run`; `recovered.absence`; 异常 / errors `new AppError('原单应用 live 已变化且尚未证明客户机重启', 409, 'SINGLE_APP_LIVE_CHANGED')`; `new AppError('原单应用不存在证明的客户机 boot 已变化', 503, 'SINGLE_APP_CLEANUP_UNCONFIRMED')`.
   * 失败处理：catch 分支执行 `session.phase = 'cleanup-failed';`; `session.lastError = error instanceof AppError ? error.code || 'SINGLE_APP_CLEANUP_FAILED' : 'SINGLE_APP_CLEANUP_FAILED';`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `session.phase = 'cleanup-failed';`; `session.lastError = error instanceof AppError ? error.code || 'SINGLE_APP_CLEANUP_FAILED' : 'SINGLE_APP_CLEANUP_FAILED';`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async terminateNative(session: Session) {
    clearTimeout(this.watchers.get(session.id)); this.watchers.delete(session.id);
    this.disconnect(session.id); session.phase = 'stopping'; await this.save(session.vmId);
    try {
      const live = this.live(session.vmId);
      const cleanupBoot = await this.boot(session.vmId, live);
      if (this.livePins.has(session.id) && this.livePins.get(session.id) !== live && cleanupBoot === session.bootId)
        throw new AppError('原单应用 live 已变化且尚未证明客户机重启', 409, 'SINGLE_APP_LIVE_CHANGED');
      if (!session.run) {
        const recovered = appRecoverySchema.parse(await this.control.recover(session.vmId, session.build,
          { id: session.id, identity: session.identity, bootId: session.bootId, nativeBuild: session.nativeBuild }));
        this.live(session.vmId, live);
        if (recovered.absence) {
          if (recovered.absence.currentBootId !== cleanupBoot)
            throw new AppError('原单应用不存在证明的客户机 boot 已变化', 503, 'SINGLE_APP_CLEANUP_UNCONFIRMED');
          singleAppRunRecordSchema.parse({ ...session, absence: recovered.absence, phase: 'stopped' });
          session.absence = recovered.absence; session.phase = 'stopped';
          await this.save(session.vmId); await this.retireLeaseNative(session); return;
        }
        const run = projectIdentityRunSchema.parse({ ...recovered.run!, phase: 'active' });
        singleAppRunRecordSchema.parse({ ...session, run }); origin({ ...session, run });
        session.run = run; await this.save(session.vmId);
      }
      this.live(session.vmId, live);
      const stopped = appStopSchema.parse(await this.control.call(session.vmId, session.build, 'stop', origin(session)));
      this.live(session.vmId, live);
      const original = session.run;
      if (Object.keys(original).some(key => key !== 'phase' && original[key as keyof typeof original] !== stopped.run[key as keyof typeof stopped.run]) ||
          (stopped.retirement ? stopped.retirement.bootId !== cleanupBoot || stopped.retirement.bootId === session.bootId
            : cleanupBoot !== session.bootId || stopped.run.phase !== 'closed') ||
          (stopped.receipt && (this.matchReceipt(session, stopped.receipt).state !== 'stopped' ||
            !same(stopped.receipt.retirement, stopped.retirement))))
        throw new AppError('单应用原运行关闭回执不符', 503, 'SINGLE_APP_CLEANUP_UNCONFIRMED');
      session.receipt = stopped.receipt; session.retirement = stopped.retirement; session.closure = stopped.run;
      session.phase = 'stopped'; delete session.lastError;
      await this.save(session.vmId); await this.retireLeaseNative(session);
    } catch (error) {
      session.phase = 'cleanup-failed'; session.lastError = error instanceof AppError ? error.code || 'SINGLE_APP_CLEANUP_FAILED' : 'SINGLE_APP_CLEANUP_FAILED';
      await this.save(session.vmId); throw error;
    }
  }
  /**
   * 入口 / Entry: SingleAppWindows.stop.
   * 功能：把本层请求转交 `this.machines.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.machines.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; sessionId: string
   * 输出 / Returns: `this.machines.locked(`single-app:${id}`, async () => { await this.load(id); await this.sync(id); const session = this.session…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async stop(id: string, sessionId: string) {
    /**
     * 入口 / Entry: SingleAppWindows.stop.callback@535.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ stopped: true }`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!session || session.vmId !== id`; `this.machines.state(id) === 'paused'`; 异常 / errors `new AppError('应用窗口会话不存在', 404)`; `new AppError('请先恢复实例，再停止应用窗口', 409)`.
     */
    return this.machines.locked(`single-app:${id}`, async () => {
      await this.load(id); await this.sync(id); const session = this.sessions.get(z.uuid().parse(sessionId));
      if (!session || session.vmId !== id) throw new AppError('应用窗口会话不存在', 404);
      if (session.phase === 'stopped') {
        // The validated durable row carries the exact closed run or complete
        // absence/retirement proof. A reloaded owner already closed it. Only
        // retire this owner's RAM lease; never rewrite a stale journal or
        // invoke native stop/prepare again.
        await this.retireLease(session);
        return { stopped: true };
      }
      if (this.machines.state(id) === 'paused') throw new AppError('请先恢复实例，再停止应用窗口', 409);
      await this.terminate(session); return { stopped: true };
    });
  }
  /**
   * 入口 / Entry: SingleAppWindows.close.
   * 功能：在管理单应用窗口、剪贴板策略和持久运行记录中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`SingleAppWindows`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `SingleAppWindows`; the outcome is recorded in `this.closed`. Module context: Owns single-app windows, clipboard policies and durable runs; stopping verifies complete original tickets.
   * 处理：通过 `this.closeAbort.abort`, `this.watchers.values`, `clearTimeout`, `this.watchers.clear` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.closeAbort.abort`, `this.watchers.values`, `clearTimeout`, `this.watchers.clear`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.options.terminals`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.closeAbort.abort`; `clearTimeout`; `this.watchers.clear`; `this.terminals.close`; `this.sessionListeners.clear`; 更新 / updates `this.closed`.
   * 拒绝 / Refusals: 条件 / conditions `failed.length`; 异常 / errors `new AggregateError(failed.map(result => result.reason), '单应用原运行清理未确认；记录和配置门闩继续保留')`.
   */
  async close() {
    this.closed = true; this.closeAbort.abort();
    for (const timer of this.watchers.values()) clearTimeout(timer); this.watchers.clear();
    await Promise.allSettled([...this.pending]);
    // Serialize each VM; parallel stop calls would collide on Machines.locked.
    const ids = [...new Set([...this.sessions.values()].filter(session => session.phase !== 'stopped' || this.leases.has(session.id)).map(session => session.vmId))];
    const results = await Promise.allSettled(ids.map(async id => {
      const failures: unknown[] = [];
      for (const session of [...this.sessions.values()].filter(value => value.vmId === id && (value.phase !== 'stopped' || this.leases.has(value.id))))
        try { await this.stop(id, session.id); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, '原实例单应用清理未确认');
    }));
    const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed.length) throw new AggregateError(failed.map(result => result.reason), '单应用原运行清理未确认；记录和配置门闩继续保留');
    this.machines.off('change', this.onChange); this.machines.off('incident-lockdown', this.onLock); this.removeConfigGuard?.();
    if (!this.options.terminals) await this.terminals?.close(); this.sessionListeners.clear();
  }
}
