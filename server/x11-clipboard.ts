/**
 * 模块职责：管理 Linux 应用剪贴板策略与运行票据，桌面退休需确认对应完整应用域清理。
 * Module purpose: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
 */
import type { JobsV1 } from './service-contracts/v1.ts';
import { createHash, randomUUID } from 'node:crypto';
import { join, posix } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { guestPath } from '../shared/paths.ts';
import { vmDir } from './paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import type { Project } from './project-config.ts';
import { readStore, writeStore } from './local-store.ts';
import { quote } from './shell.ts';
import { guestTask } from './guest-task.ts';
import { Jobs } from './jobs.ts';
import { projectNetworkCheckScript, projectNetworkNamespace } from './project-network-isolation.ts';
import { x11SourceBundle } from './x11-clipboard-assets.ts';
import { waylandSourceBundle } from './wayland-clipboard-assets.ts';
import { defaultClipboardRule } from '../shared/clipboard-policy.ts';
import type { X11ClipboardView } from '../shared/x11-clipboard.ts';
import { desktopControlProofSchema, type DesktopAuthority } from './desktop-project-control.ts';

/**
 * 入口 / Entry: callback@30.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.string().min().max().refine / 需要规范的 Linux 应用完整路径）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.string().min().max().refine / 需要规范的 Linux 应用完整路径).
 * 输入 / Inputs: value
 * 输出 / Returns: `( guestPath(value) === value && value === posix.normalize(value) && !value.endsWith('/') && !/[\x00-\x1f]/.test(value) )`; `false`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `return false;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return false;`; these statements determine whether a failure is absorbed or rejected again.
 */
const image = z
  .string()
  .min(2)
  .max(1024)
  .refine((value) => {
    try {
      return (
        guestPath(value) === value &&
        value === posix.normalize(value) &&
        !value.endsWith('/') &&
        !/[\x00-\x1f]/.test(value)
      );
    } catch {
      return false;
    }
  }, '需要规范的 Linux 应用完整路径');
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const x11ClipboardRule = z
  .object({
    copy: z.boolean(),
    paste: z.boolean(),
    files: z.boolean(),
    sensitive: z.boolean(),
    maxTextBytes: z.number().int().min(1024).max(1048576),
  })
  .strict();
export const x11ClipboardApplication = z.object({ image, sha256: digest, rule: x11ClipboardRule }).strict();
export const x11ClipboardConfiguration = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    owner: z.uuid(),
    applications: z.array(x11ClipboardApplication).max(32),
  })
  .strict()
  .refine((value) => new Set(value.applications.map((app) => app.image)).size === value.applications.length);
export const x11ClipboardRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('install') }).strict(),
  z.object({ action: z.literal('identify'), image }).strict(),
  z
    .object({
      action: z.literal('save'),
      version: z.number().int().positive(),
      application: x11ClipboardApplication,
    })
    .strict(),
  z.object({ action: z.literal('remove'), version: z.number().int().positive(), image }).strict(),
  z
    .object({
      action: z.literal('launch'),
      version: z.number().int().positive(),
      image,
      args: z
        .array(
          z
            .string()
            .max(1024)
            .refine((value) => !/[\x00-\x1f]/.test(value)),
        )
        .max(32)
        .default([]),
    })
    .strict(),
  z.object({ action: z.literal('stop'), id: z.uuid() }).strict(),
  z.object({ action: z.literal('forget'), id: z.uuid() }).strict(),
  z.object({ action: z.literal('refresh') }).strict(),
]);
const session = z
  .object({
    id: z.uuid(),
    state: z.enum(['running', 'stopped', 'error']),
    image: image.optional(),
    sha256: digest.optional(),
    projectId: z.string().optional(),
    directory: z.string().optional(),
    startedAt: z.string().optional(),
    compatible: z.boolean().optional(),
    active: z.boolean().optional(),
    generation: z.number().int().positive().optional(),
    rule: x11ClipboardRule.optional(),
    blockedCopy: z.number().nonnegative().optional(),
    blockedPaste: z.number().nonnegative().optional(),
    error: z.string().max(256).optional(),
    desktopOwner: z.object({ projectId: z.string(), uid: z.number().int().min(20000).max(59999), runId: z.uuid() }).strict().optional(),
    applicationOwner: z.object({ uid: z.number().int().min(1000), kind: z.enum(['project-desktop', 'window-sandbox']) }).strict().optional(),
    processes: z
      .array(
        z
          .object({
            pid: z.number().int().positive(),
            created: z.string().regex(/^[0-9]+$/),
            image: z.string().max(4096),
            loaded: z.boolean(),
          })
          .strict(),
      )
      .max(1024)
      .optional(),
  })
  .strict();
const inventory = z
  .object({
    ready: z.boolean(),
    build: digest,
    sessions: z.array(session).max(128),
    error: z.string().max(256).optional(),
  })
  .strict();
const job = z
  .object({
    status: z.enum(['running', 'done', 'error', 'cancelled', 'interrupted']),
    log: z.string(),
    startedAt: z.string(),
  })
  .passthrough();
export const x11ClipboardViewSchema = z
  .object({
    version: z.number().int().positive(),
    applications: z.array(x11ClipboardApplication).max(32),
    ready: z.boolean(),
    build: digest.optional(),
    sessions: z.array(session).max(128),
    error: z.string().optional(),
    installation: job.nullable(),
  })
  .strict();
export const x11ClipboardActionResponse = z.union([
  x11ClipboardViewSchema,
  session,
  job,
  z.object({ image, sha256: digest }).strict(),
  z.object({ stopped: z.literal(true) }).strict(),
  z.object({ removed: z.literal(true) }).strict(),
]);
/**
 * 入口 / Entry: matches.
 * 功能：从当前输入或状态计算 `a.copy === b.copy && a.paste === b.paste && a.files === b.files && a.sensitive === b.sensitive && a.maxTextBytes === b.maxTex…`，供调用方后续验证或使用。
 * Purpose: Computes `a.copy === b.copy && a.paste === b.paste && a.files === b.files && a.sensitive === b.sensitive && a.maxTextBytes === b.maxTex…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: a: z.infer<typeof x11ClipboardRule>; b: z.infer<typeof x11ClipboardRule>
 * 输出 / Returns: `a.copy === b.copy && a.paste === b.paste && a.files === b.files && a.sensitive === b.sensitive && a.maxTextBytes === b.maxTex…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const matches = (a: z.infer<typeof x11ClipboardRule>, b: z.infer<typeof x11ClipboardRule>) =>
  a.copy === b.copy &&
  a.paste === b.paste &&
  a.files === b.files &&
  a.sensitive === b.sensitive &&
  a.maxTextBytes === b.maxTextBytes;
type State = z.infer<typeof x11ClipboardConfiguration>;
type Bundle = Awaited<ReturnType<typeof x11SourceBundle>> | Awaited<ReturnType<typeof waylandSourceBundle>>;
export type X11ApplicationContext = { project: Project; desktop?: DesktopAuthority; launcherSha256?: string;
  /**
   * 签名 / Signature: X11ApplicationContext.validate.
   * 功能：为管理 Linux 应用剪贴板策略与运行票据声明 validate 的输入与结果契约，所属容器为 X11ApplicationContext。
   * Purpose: Declares the input/result contract for validate in X11ApplicationContext. Module responsibility: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  validate?: () => Promise<void>;
  /**
   * 签名 / Signature: X11ApplicationContext.release.
   * 功能：为管理 Linux 应用剪贴板策略与运行票据声明 release 的输入与结果契约，所属容器为 X11ApplicationContext。
   * Purpose: Declares the input/result contract for release in X11ApplicationContext. Module responsibility: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  release?: () => Promise<void> };
export type LinuxClipboardOptions = { assets?: string;
/**
 * 签名 / Signature: LinuxClipboardOptions.file.
 * 功能：为管理 Linux 应用剪贴板策略与运行票据声明 file 的输入与结果契约，所属容器为 LinuxClipboardOptions。
 * Purpose: Declares the input/result contract for file in LinuxClipboardOptions. Module responsibility: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
 * 输入 / Inputs: id: string
 * 输出 / Returns: string.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
file?: (id: string) => string; jobsDirectory?: string;
  transport?: 'x11' | 'wayland' };

type RetainedApplication = { runId: string;
/**
 * 签名 / Signature: RetainedApplication.release.
 * 功能：为管理 Linux 应用剪贴板策略与运行票据声明 release 的输入与结果契约，所属容器为 RetainedApplication。
 * Purpose: Declares the input/result contract for release in RetainedApplication. Module responsibility: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Promise<void>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
release: () => Promise<void> };
const retainedApplications = new WeakMap<Machines, Map<string, RetainedApplication>>();
export class X11Clipboard {
  readonly jobs: JobsV1;
  private states = new Map<string, Promise<State>>();
  private closed = false;
  private retained: Map<string, RetainedApplication>;
  /**
   * 入口 / Entry: X11Clipboard.constructor.
   * 功能：建立 X11Clipboard 的管理 Linux 应用剪贴板策略与运行票据上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the X11Clipboard context for this module's responsibility: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; applicationProject: (id: string) => Promise<X11ApplicationContext>; options: LinuxClipboardOptions default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `retainedApplications.set`; 更新 / updates `this.jobs`, `this.retained`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    private machines: Machines,
    private applicationProject: (id: string) => Promise<X11ApplicationContext>,
    private options: LinuxClipboardOptions = {},
  ) {
    this.jobs = new Jobs(`${this.transport}-clipboard-install`, options.jobsDirectory);
    if (!retainedApplications.has(machines)) retainedApplications.set(machines, new Map());
    this.retained = retainedApplications.get(machines)!;
  }
  /**
   * 入口 / Entry: X11Clipboard.transport.
   * 功能：向调用者提供 `this.options.transport || 'x11'` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.options.transport || 'x11'` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.options.transport || 'x11'`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private get transport() { return this.options.transport || 'x11'; }
  /**
   * 入口 / Entry: X11Clipboard.retainedKey.
   * 功能：从当前输入或状态计算 `[this.transport, id, owner, sessionId].join(':')`，供调用方后续验证或使用。
   * Purpose: Computes `[this.transport, id, owner, sessionId].join(':')` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string; owner: string; sessionId: string
   * 输出 / Returns: `[this.transport, id, owner, sessionId].join(':')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private retainedKey(id: string, owner: string, sessionId: string) { return [this.transport, id, owner, sessionId].join(':'); }
  /**
   * 入口 / Entry: X11Clipboard.retireDesktop.
   * 功能：在管理 Linux 应用剪贴板策略与运行票据中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`X11Clipboard`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `X11Clipboard`; this entry produces `void` for its caller. Module context: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
   * 处理：通过 `readStore`, `this.file`, `x11ClipboardConfiguration.parse`, `this.bundle` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readStore`, `this.file`, `x11ClipboardConfiguration.parse`, `this.bundle`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!proof.run`; `raw === null`; `pending?.runId === proof.run.runId`.
   * 输入 / Inputs: id: string; proof: import('./desktop-project-control.ts').DesktopControlProof
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `pending.release`; `this.retained.delete`.
   * 拒绝 / Refusals: 条件 / conditions `error instanceof AppError && error.status === 503`; 异常 / errors `error`; `new AppError('Desktop 所属 Linux 应用原完整域清理未确认，原票据保留', 503, 'LINUX_CLIPBOARD_CLEANUP_FAILED')`.
   * 失败处理：catch 分支执行 `if (error instanceof AppError && error.status === 503) throw error;`; `throw new AppError('Desktop 所属 Linux 应用原完整域清理未确认，原票据保留', 503, 'LINUX_CLIPBOARD_CLEANUP_FAILED');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (error instanceof AppError && error.status === 503) throw error;`; `throw new AppError('Desktop 所属 Linux 应用原完整域清理未确认，原票据保留', 503, 'LINUX_CLIPBOARD_CLEANUP_FAILED');`; these statements determine whether a failure is absorbed or rejected again.
   */
  async retireDesktop(id: string, proof: import('./desktop-project-control.ts').DesktopControlProof) {
    if (!proof.run) return;
    const raw = await readStore(this.file(id), () => null);
    if (raw === null) return;
    const state = x11ClipboardConfiguration.parse(raw), bundle = await this.bundle();
    try {
      const { build: _build, ...desktop } = proof;
      const reply = z.object({ stopped: z.literal(true), sessions: z.array(z.uuid()).max(128) }).strict().parse(
        await this.command(id, bundle, { action: 'stop-desktop', owner: state.owner, desktop }));
      for (const sessionId of reply.sessions) {
        const key = this.retainedKey(id, state.owner, sessionId), pending = this.retained.get(key);
        if (pending?.runId === proof.run.runId) { await pending.release(); this.retained.delete(key); }
      }
    } catch (error) {
      if (error instanceof AppError && error.status === 503) throw error;
      throw new AppError('Desktop 所属 Linux 应用原完整域清理未确认，原票据保留', 503, 'LINUX_CLIPBOARD_CLEANUP_FAILED');
    }
  }
  /**
   * 入口 / Entry: X11Clipboard.file.
   * 功能：在管理 Linux 应用剪贴板策略与运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.options.file?.(id) || join(vmDir(id), `${this.transport}-clipboard.json`)` 供上层消费（`X11Clipboard`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `X11Clipboard`; this entry produces `this.options.file?.(id) || join(vmDir(id), `${this.transport}-clipboard.json`)` for its caller. Module context: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
   * 处理：通过 `this.options.file`, `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.options.file`, `join`, `vmDir`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.options.file?.(id) || join(vmDir(id), `${this.transport}-clipboard.json`)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private file(id: string) {
    return this.options.file?.(id) || join(vmDir(id), `${this.transport}-clipboard.json`);
  }
  /**
   * 入口 / Entry: X11Clipboard.state.
   * 功能：在管理 Linux 应用剪贴板策略与运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`X11Clipboard`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `X11Clipboard`; this entry produces `task` for its caller. Module context: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
   * 处理：通过 `this.machines.get`, `this.states.get`, `readStore().then`, `readStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.states.get`, `readStore().then`, `readStore`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!task`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `task`.
   * 副作用 / Effects: `this.states.set`; 更新 / updates `task`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private state(id: string) {
    this.machines.get(id);
    let task = this.states.get(id);
    if (!task) {
      task = readStore(this.file(id), () => ({
        schemaVersion: 1,
        version: 1,
        owner: randomUUID(),
        applications: [],
      })).then((raw) => x11ClipboardConfiguration.parse(raw));
      this.states.set(id, task);
      void task.catch(() => {
        if (this.states.get(id) === task) this.states.delete(id);
      });
    }
    return task;
  }
  /**
   * 入口 / Entry: X11Clipboard.require.
   * 功能：在管理 Linux 应用剪贴板策略与运行票据中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`X11Clipboard`）。
   * Purpose: Checks admission, input or resource ownership in `X11Clipboard`; the calls and state transitions below complete the operation. Module context: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
   * 处理：通过 `signal.throwIfAborted`, `this.machines.get`, `this.machines.requireUnlocked`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.machines.get`, `this.machines.requireUnlocked`, `this.machines.state`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.machines.state(id) !== 'running'`; 异常 / errors `new AppError('Linux 剪贴板服务已关闭', 503)`; `new AppError('请先启动 Linux 实例', 409)`.
   */
  private require(id: string, signal?: AbortSignal) {
    if (this.closed) throw new AppError('Linux 剪贴板服务已关闭', 503);
    signal?.throwIfAborted();
    this.machines.get(id);
    this.machines.requireUnlocked(id);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动 Linux 实例', 409);
  }
  /**
   * 入口 / Entry: X11Clipboard.bundle.
   * 功能：在管理 Linux 应用剪贴板策略与运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.transport === 'wayland' ? waylandSourceBundle(this.options.assets) : x11SourceBundle(this.options.assets)` 供上层消费（`X11Clipboard`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `X11Clipboard`; this entry produces `this.transport === 'wayland' ? waylandSourceBundle(this.options.assets) : x11SourceBundle(this.options.assets)` for its caller. Module context: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
   * 处理：通过 `waylandSourceBundle`, `x11SourceBundle` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `waylandSourceBundle`, `x11SourceBundle`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.transport === 'wayland' ? waylandSourceBundle(this.options.assets) : x11SourceBundle(this.options.assets)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async bundle() {
    return this.transport === 'wayland' ? waylandSourceBundle(this.options.assets) : x11SourceBundle(this.options.assets);
  }
  /**
   * 入口 / Entry: X11Clipboard.directoryScript.
   * 功能：从当前输入或状态计算 ``/usr/bin/python3 -I -S -c ${quote(code)}``，供调用方后续验证或使用。
   * Purpose: Computes ``/usr/bin/python3 -I -S -c ${quote(code)}`` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: bundle: Bundle; create: default=true
   * 输出 / Returns: ``/usr/bin/python3 -I -S -c ${quote(code)}``.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private directoryScript(bundle: Bundle, create = true) {
    const code = `import stat\nfrom pathlib import Path\np=Path(${JSON.stringify(bundle.directory)})\nc=Path('/')\nfor part in p.parts[1:]:\n c/=part\n ${create ? 'if not c.exists(): c.mkdir(mode=0o755)\n ' : ''}s=c.lstat()\n if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022: raise RuntimeError('原生源码目录身份或权限不符')`;
    return `/usr/bin/python3 -I -S -c ${quote(code)}`;
  }
  /**
   * 入口 / Entry: X11Clipboard.publish.
   * 功能：在管理 Linux 应用剪贴板策略与运行票据中，校验并提交领域状态变更；完成下述调用及状态处理（`X11Clipboard`）。
   * Purpose: Validates and commits a domain state change in `X11Clipboard`; the calls and state transitions below complete the operation. Module context: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
   * 处理：通过 `this.require`, `bundle.files.get`, `bundle.manifest.files.find`, `createHash().update().digest` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.require`, `bundle.files.get`, `bundle.manifest.files.find`, `createHash().update().digest`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; bundle: Bundle; name: string; signal: AbortSignal optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`; `this.machines.exec`; `this.machines.exec().catch`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError('Linux 原生源码发布失败', 409)`.
   * 收尾：退出 try 区域时始终执行 `await this.machines.exec(id, `rm -f ${quote(staged)}`, 5000).catch(() => {});`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `await this.machines.exec(id, `rm -f ${quote(staged)}`, 5000).catch(() => {});`; these steps also apply to exceptional exits.
   */
  private async publish(id: string, bundle: Bundle, name: string, signal?: AbortSignal) {
    this.require(id, signal);
    const data = name === 'manifest.json' && this.transport === 'wayland'
      ? Buffer.from(JSON.stringify(bundle.manifest) + '\n') : bundle.files.get(name)!;
    const file = bundle.manifest.files.find((file) => file.name === name) ||
      { sha256: createHash('sha256').update(data).digest('hex') };
    const staged = bundle.directory + '/.' + randomUUID() + '.new';
    try {
      await this.machines.sftp(
        id,
        async (ftp, transportSignal) => {
          const transferSignal =
            signal && transportSignal
              ? AbortSignal.any([signal, transportSignal])
              : signal || transportSignal;
          await pipeline(
            Readable.from([data]),
            ftp.createWriteStream(staged, { flags: 'wx', mode: 0o600 }),
            { signal: transferSignal },
          );
        },
        signal,
      );
      const result = await this.machines.exec(
        id,
        `set -eu\ntest -f ${quote(staged)} && test ! -L ${quote(staged)}\n` +
          `test "$(sha256sum ${quote(staged)} | cut -d' ' -f1)" = ${file.sha256}\n` +
          `chmod 444 ${quote(staged)}\nmv -f ${quote(staged)} ${quote(bundle.directory + '/' + name)}`,
        10000,
        signal,
      );
      if (result.code !== 0) throw new AppError('Linux 原生源码发布失败', 409);
    } finally {
      await this.machines.exec(id, `rm -f ${quote(staged)}`, 5000).catch(() => {});
    }
  }
  /**
   * 入口 / Entry: X11Clipboard.controller.
   * 功能：在管理 Linux 应用剪贴板策略与运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`X11Clipboard`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `X11Clipboard`; this entry produces `void` for its caller. Module context: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
   * 处理：通过 `this.require`, `bundle.manifest.files.find`, `this.machines.exec`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.require`, `bundle.manifest.files.find`, `this.machines.exec`, `quote`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `probe.code === 0`; `this.transport === 'wayland'`; `file.name !== 'controller.py'`.
   * 输入 / Inputs: id: string; bundle: Bundle; signal: AbortSignal optional
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.machines.exec`; `this.publish`.
   * 拒绝 / Refusals: 条件 / conditions `prepared.code !== 0`; 异常 / errors `new AppError('无法准备 Linux 原生控制器，请先安装桌面及 Python 3', 409)`.
   */
  private async controller(id: string, bundle: Bundle, signal?: AbortSignal) {
    this.require(id, signal);
    const file = bundle.directory + '/controller.py',
      expected = bundle.manifest.files.find((file) => file.name === 'controller.py')!;
    const probe = await this.machines.exec(
      id,
      `test -f ${quote(file)} && test ! -L ${quote(file)} && ` +
        `test "$(stat -c %u ${quote(file)})" = 0 && ` +
        `test "$(sha256sum ${quote(file)} | cut -d' ' -f1)" = ${expected.sha256}`,
      10000,
      signal,
    );
    if (probe.code === 0) return;
    const prepared = await this.machines.exec(id, this.directoryScript(bundle), 10000, signal);
    if (prepared.code !== 0) throw new AppError('无法准备 Linux 原生控制器，请先安装桌面及 Python 3', 409);
    await this.publish(id, bundle, 'controller.py', signal);
    if (this.transport === 'wayland') {
      for (const file of bundle.manifest.files) if (file.name !== 'controller.py')
        await this.publish(id, bundle, file.name, signal);
      await this.publish(id, bundle, 'manifest.json', signal);
    }
  }
  /**
   * 入口 / Entry: X11Clipboard.script.
   * 功能：在管理 Linux 应用剪贴板策略与运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/sh -c ${quote(script)}`` 供上层消费（`X11Clipboard`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `X11Clipboard`; this entry produces ``env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/sh -c ${quote(script)}`` for its caller. Module context: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
   * 处理：通过 `bundle.manifest.files.find`, `this.directoryScript`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `bundle.manifest.files.find`, `this.directoryScript`, `quote`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: bundle: Bundle; request: object
   * 输出 / Returns: ``env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/sh -c ${quote(script)}``.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private script(bundle: Bundle, request: object) {
    const helper = bundle.manifest.files.find((file) => file.name === 'controller.py')!;
    const file = bundle.directory + '/controller.py';
    const script = (
      `set -eu\n${this.directoryScript(bundle, false)}\ntest -f ${quote(file)} && test ! -L ${quote(file)}\n` +
      `test "$(stat -c %u ${quote(file)})" = 0\n` +
      `test "$(sha256sum ${quote(file)} | cut -d' ' -f1)" = ${helper.sha256}\n` +
      `exec /usr/bin/python3 -I -S ${quote(file)} ${quote(Buffer.from(JSON.stringify(request)).toString('base64'))}`
    );
    return `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/sh -c ${quote(script)}`;
  }
  /**
   * 入口 / Entry: X11Clipboard.command.
   * 功能：在管理 Linux 应用剪贴板策略与运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `raw` 供上层消费（`X11Clipboard`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `X11Clipboard`; this entry produces `raw` for its caller. Module context: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
   * 处理：通过 `signal.throwIfAborted`, `this.script`, `projectNetworkNamespace`, `this.machines.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.script`, `projectNetworkNamespace`, `this.machines.exec`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; bundle: Bundle; request: object; signal: AbortSignal optional; project: Project optional
   * 输出 / Returns: Promise<unknown>；结果来自 / values from `raw`.
   * 副作用 / Effects: `this.machines.exec`; 更新 / updates `raw`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError('Linux 剪贴板控制器尚未安装或输出无效', 503)`; `new AppError(z.object({ error: z.string().max(256) }).parse(raw).error, 409)`.
   * 失败处理：catch 分支执行 `throw new AppError('Linux 剪贴板控制器尚未安装或输出无效', 503);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('Linux 剪贴板控制器尚未安装或输出无效', 503);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async command(
    id: string,
    bundle: Bundle,
    request: object,
    signal?: AbortSignal,
    project?: Project,
  ): Promise<unknown> {
    signal?.throwIfAborted();
    const code = this.script(bundle, request);
    const namespace = project && projectNetworkNamespace(project);
    // ip netns exec also remounts sysfs, hiding its cgroup mount. The pinned
    // controller joins only the network namespace after checking the binding.
    const result = await this.machines.exec(
      id,
      namespace ? `set -eu\n${projectNetworkCheckScript(namespace)}\n${code}` : code,
      20000,
      signal,
    );
    let raw: unknown;
    try {
      raw = JSON.parse(result.stdout);
    } catch {
      throw new AppError('Linux 剪贴板控制器尚未安装或输出无效', 503);
    }
    if (result.code !== 0) throw new AppError(z.object({ error: z.string().max(256) }).parse(raw).error, 409);
    return raw;
  }
  /**
   * 入口 / Entry: X11Clipboard.list.
   * 功能：在管理 Linux 应用剪贴板策略与运行票据中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `inventory.parse(await this.command(id, bundle, { action: 'list', owner: state.owner }, signal))` 供上层消费（`X11Clipboard`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `X11Clipboard`; this entry produces `inventory.parse(await this.command(id, bundle, { action: 'list', owner: state.owner }, signal))` for its caller. Module context: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
   * 处理：通过 `inventory.parse`, `this.command` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inventory.parse`, `this.command`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; state: State; bundle: Bundle; signal: AbortSignal optional
   * 输出 / Returns: `inventory.parse(await this.command(id, bundle, { action: 'list', owner: state.owner }, signal))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async list(id: string, state: State, bundle: Bundle, signal?: AbortSignal) {
    return inventory.parse(await this.command(id, bundle, { action: 'list', owner: state.owner }, signal));
  }
  /**
   * 入口 / Entry: X11Clipboard.view.
   * 功能：在管理 Linux 应用剪贴板策略与运行票据中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `result` 供上层消费（`X11Clipboard`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `X11Clipboard`; this entry produces `result` for its caller. Module context: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
   * 处理：通过 `this.state`, `this.jobs.view`, `this.machines.state`, `this.bundle` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.state`, `this.jobs.view`, `this.machines.state`, `this.bundle`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.machines.state(id) !== 'running'`.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: Promise<X11ClipboardView>；结果来自 / values from `result`.
   * 副作用 / Effects: 更新 / updates `result.ready`, `result.build`, `result.error`, `result.sessions`.
   * 拒绝 / Refusals: 条件 / conditions `signal?.aborted`; 异常 / errors `error`.
   * 失败处理：catch 分支执行 `if (signal?.aborted) throw error;`; `result.error = error instanceof Error ? error.message : '无法检查 Linux 剪贴板状态';`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (signal?.aborted) throw error;`; `result.error = error instanceof Error ? error.message : '无法检查 Linux 剪贴板状态';`; these statements determine whether a failure is absorbed or rejected again.
   */
  async view(id: string, signal?: AbortSignal): Promise<X11ClipboardView> {
    const state = await this.state(id);
    const result: X11ClipboardView = {
      version: state.version,
      applications: state.applications,
      ready: false,
      sessions: [],
      installation: this.jobs.view(id),
    };
    if (this.machines.state(id) !== 'running') return result;
    try {
      const bundle = await this.bundle();
      const value = await this.list(id, state, bundle, signal);
      result.ready = value.ready;
      result.build = value.build;
      result.error = value.error;
      result.sessions = value.sessions.map((row) => {
        const expected = state.applications.find(
          (app) => app.image === row.image && app.sha256 === row.sha256,
        );
        const outdated = row.active
          ? !expected || !row.rule || !matches(expected.rule, row.rule)
          : !!expected;
        return row.state !== 'stopped' && outdated
          ? { ...row, state: 'error', error: '已保存规则尚未应用；请刷新，或停止并重新启动应用' }
          : row;
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      result.error = error instanceof Error ? error.message : '无法检查 Linux 剪贴板状态';
    }
    return result;
  }
  /**
   * 入口 / Entry: X11Clipboard.install.
   * 功能：在管理 Linux 应用剪贴板策略与运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.jobs.start( id, async (log, signal) => { const bundle = await this.bundle(); this.require(id, signal); const checked = a…` 供上层消费（`X11Clipboard`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `X11Clipboard`; this entry produces `this.jobs.start( id, async (log, signal) => { const bundle = await this.bundle(); this.require(id, signal); const checked = a…` for its caller. Module context: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
   * 处理：通过 `this.require`, `this.jobs.start` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.require`, `this.jobs.start`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.jobs.start( id, async (log, signal) => { const bundle = await this.bundle(); this.require(id, signal); const checked = a…`.
   * 副作用 / Effects: `this.jobs.start`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  install(id: string) {
    this.require(id);
    /**
     * 入口 / Entry: X11Clipboard.install.callback@379.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
     * 输入 / Inputs: log; signal
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.machines.exec`; `this.publish`.
     * 拒绝 / Refusals: 条件 / conditions `checked.code !== 0`; `build.code !== 0`; `!actual.ready`; 异常 / errors `new AppError('无法准备 Linux 原生源码目录', 409)`; `new AppError('Linux 原生剪贴板编译失败，请查看安装日志', 409)`.
     */
    return this.jobs.start(
      id,
      async (log, signal) => {
        const bundle = await this.bundle();
        this.require(id, signal);
        const checked = await this.machines.exec(id, this.directoryScript(bundle), 10000, signal);
        if (checked.code !== 0) throw new AppError('无法准备 Linux 原生源码目录', 409);
        for (const file of bundle.manifest.files) {
          await this.publish(id, bundle, file.name, signal);
        }
        if (this.transport === 'wayland') await this.publish(id, bundle, 'manifest.json', signal);
        const distro = this.machines.get(id).distro;
        const dependencies =
          this.transport === 'wayland'
            ? distro === 'alpine' ? 'apk add --no-cache --timeout 30 dbus python3'
              : 'export DEBIAN_FRONTEND=noninteractive\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update\n' +
                'apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y --no-install-recommends dbus python3'
            : distro === 'alpine'
            ? 'apk add --no-cache --timeout 30 g++ libx11-dev libxcb-dev dbus python3'
            : 'export DEBIAN_FRONTEND=noninteractive\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update\n' +
              'apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y --no-install-recommends g++ libx11-dev libx11-xcb-dev libxcb1-dev dbus python3';
        const manifestWriter =
          `import hashlib,json,os\nfrom pathlib import Path\np=Path(${JSON.stringify(bundle.directory)})\n` +
          `q=p/'libSakuraClipboard.so'\nq.chmod(0o555)\nb=q.read_bytes()\n` +
          `m={'version':1,'build':${JSON.stringify(bundle.manifest.build)},'sha256':hashlib.sha256(b).hexdigest()}\n` +
          `f=p/'library.json.new'\nwith f.open('w') as s: json.dump(m,s);s.flush();os.fsync(s.fileno())\nf.chmod(0o444)\nos.replace(f,p/'library.json')`;
        const prepare = this.transport === 'wayland'
          ? `/usr/bin/python3 -I -S -c ${quote("import ast,pathlib\nfor name in ('controller.py','proxy.py'): ast.parse(pathlib.Path(name).read_bytes(),filename=name)")}`
          : `g++ -std=c++17 -O2 -Wall -Wextra -fPIC -shared -Wl,-z,relro,-z,now ` +
            `-DSAKURA_CLIPBOARD_BUILD=${quote('"' + bundle.manifest.build + '"')} policy.cpp ` +
            `-o libSakuraClipboard.so.new -lX11 -lX11-xcb -lxcb -ldl -pthread\n` +
            `chmod 555 libSakuraClipboard.so.new\n` +
            `mv -f libSakuraClipboard.so.new libSakuraClipboard.so\n/usr/bin/python3 -I -S -c ${quote(manifestWriter)}`;
        const label = this.transport === 'wayland' ? 'Wayland' : 'Linux X11';
        log(`正在安装依赖并准备 ${label} 剪贴板代理…\n`);
        const build = await guestTask(
          this.machines,
          id,
          `set -eu\n${dependencies}\ncd ${quote(bundle.directory)}\n` +
            prepare,
          signal,
          log,
        );
        if (build.code !== 0) throw new AppError('Linux 原生剪贴板编译失败，请查看安装日志', 409);
        this.require(id, signal);
        const state = await this.state(id),
          actual = await this.list(id, state, bundle, signal);
        if (!actual.ready) throw new AppError(actual.error || 'Linux 原生剪贴板未就绪', 409);
        log(`${label} 剪贴板代理已就绪。\n`);
      },
      { title: `安装 ${this.transport === 'wayland' ? 'Wayland' : 'Linux X11'} 剪贴板代理`, vmId: id, action: 'install' },
    );
  }
  /**
   * 入口 / Entry: X11Clipboard.reconcile.
   * 功能：在管理 Linux 应用剪贴板策略与运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `errors` 供上层消费（`X11Clipboard`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `X11Clipboard`; this entry produces `errors` for its caller. Module context: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
   * 处理：通过 `this.list`, `state.applications.find`, `state.applications.some`, `errors.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.list`, `state.applications.find`, `state.applications.some`, `errors.push`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `row.state === 'stopped' || !row.image`; `!application && state.applications.some((app) => app.image === row.image)`; `row.active === !!application && (!application || (row.rule && matches(row.rule, application.rule)))`.
   * 输入 / Inputs: id: string; state: State; bundle: Bundle; signal: AbortSignal optional
   * 输出 / Returns: `errors`.
   * 副作用 / Effects: `errors.push`.
   * 拒绝 / Refusals: 条件 / conditions `signal?.aborted`; 异常 / errors `error`.
   * 失败处理：catch 分支执行 `if (signal?.aborted) throw error;`; `errors.push(error instanceof Error ? error.message : '应用规则更新失败');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (signal?.aborted) throw error;`; `errors.push(error instanceof Error ? error.message : '应用规则更新失败');`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async reconcile(id: string, state: State, bundle: Bundle, signal?: AbortSignal) {
    const actual = await this.list(id, state, bundle, signal);
    const errors: string[] = [];
    for (const row of actual.sessions) {
      if (row.state === 'stopped' || !row.image) continue;
      const application = state.applications.find(
        (app) => app.image === row.image && app.sha256 === row.sha256,
      );
      if (!application && state.applications.some((app) => app.image === row.image)) {
        errors.push('已运行应用的文件身份与配置不符，请停止并重新启动应用');
        continue;
      }
      if (row.active === !!application && (!application || (row.rule && matches(row.rule, application.rule))))
        continue;
      try {
        this.require(id, signal);
        await this.command(
          id,
          bundle,
          {
            action: 'configure',
            owner: state.owner,
            id: row.id,
            enabled: !!application,
            generation: state.version,
            rule: application?.rule || defaultClipboardRule(),
          },
          signal,
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        errors.push(error instanceof Error ? error.message : '应用规则更新失败');
      }
    }
    return errors;
  }
  /**
   * 入口 / Entry: X11Clipboard.action.
   * 功能：配置、检查、应用或停止 Linux 应用剪贴板规则及代理运行。
   * Purpose: Configures/checks/applies/stops Linux application clipboard policies and broker execution.
   * 设计：版本及当前原生应用域核对后才操作，停止和 forget 需完整退休证明；未确认清理保留原票据和规则。
   * Design: Version/application-scope checks precede work, stop/forget require complete retirement proof and pending cleanup retains original tickets/rules.
   * 输入 / Inputs: id: string; raw: unknown; signal: AbortSignal optional
   * 输出 / Returns: Promise<unknown>；结果来自 / values from `this.install(id)`; `this.machines.locked(`${this.transport}-clipboard:${id}`, async () => { this.require(id, signal); let state = await this.stat…`.
   * 副作用 / Effects: `this.install`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async action(id: string, raw: unknown, signal?: AbortSignal): Promise<unknown> {
    const request = x11ClipboardRequest.parse(raw);
    this.require(id, signal);
    if (request.action === 'install') return this.install(id);
    /**
     * 入口 / Entry: X11Clipboard.action.callback@470.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `z .object({ image, sha256: digest }) .strict() .parse(await this.command(id, bundle, { ...request, owner: state.owner }, sign…`; `result`; `launched`；另有分支返回 / additional branch-specific returns.
     * 副作用 / Effects: `pending.release`; `this.retained.delete`; `writeStore`; `this.retained.set`; `context.release`; 更新 / updates `sessionId`, `issued`, `retain`, `state`.
     * 拒绝 / Refusals: 条件 / conditions `request.action === 'stop' || request.action === 'forget'`; `error instanceof AppError && error.status === 503`; `'version' in request && request.version !== state.version`; 异常 / errors `error`; `new AppError('Linux 应用原完整域清理未确认；原会话与准备租约保留', 503, 'LINUX_CLIPBOARD_CLEANUP_FAILED')`.
     * 收尾：退出 try 区域时始终执行 `if (!retain) await context.release?.();`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `if (!retain) await context.release?.();`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `if (error instanceof AppError && error.status === 503) throw error;`; `throw new AppError('Linux 应用原完整域清理未确认；原会话与准备租约保留', 503, 'LINUX_CLIPBOARD_CLEANUP_FAILED');`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (error instanceof AppError && error.status === 503) throw error;`; `throw new AppError('Linux 应用原完整域清理未确认；原会话与准备租约保留', 503, 'LINUX_CLIPBOARD_CLEANUP_FAILED');`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.machines.locked(`${this.transport}-clipboard:${id}`, async () => {
      this.require(id, signal);
      let state = await this.state(id);
      const bundle = await this.bundle();
      await this.controller(id, bundle, signal);
      if (request.action === 'identify')
        return z
          .object({ image, sha256: digest })
          .strict()
          .parse(await this.command(id, bundle, { ...request, owner: state.owner }, signal));
      if (request.action === 'stop' || request.action === 'forget') {
        try {
          const raw = await this.command(id, bundle, { ...request, owner: state.owner }, signal);
          const result = (request.action === 'stop' ? z.object({ stopped: z.literal(true) }).strict()
            : z.union([z.object({ stopped: z.literal(true) }).strict(), z.object({ removed: z.literal(true) }).strict()])).parse(raw);
          const key = this.retainedKey(id, state.owner, request.id), pending = this.retained.get(key);
          if (pending) { await pending.release(); this.retained.delete(key); }
          return result;
        } catch (error) {
          if (error instanceof AppError && error.status === 503) throw error;
          throw new AppError('Linux 应用原完整域清理未确认；原会话与准备租约保留', 503, 'LINUX_CLIPBOARD_CLEANUP_FAILED');
        }
      }
      if ('version' in request && request.version !== state.version)
        throw new AppError('Linux 剪贴板配置已变化，请刷新', 409);
      if (request.action === 'launch') {
        const application = state.applications.find((app) => app.image === request.image);
        if (!application) throw new AppError('请先绑定应用并保存剪贴板规则', 409);
        const context = await this.applicationProject(id), { project, desktop } = context;
        let sessionId: string | undefined;
        let issued = false;
        let retain = false;
        try {
        if (!desktop?.run) {
          throw new AppError('Linux 应用需要原项目 Desktop 完整 UID 票据；旧 Root launcher 摘要不能授权', 409, 'DESKTOP_LEGACY_REVIEW_REQUIRED');
        }
        desktopControlProofSchema.parse({ ...desktop, build: desktop.run.build });
        this.require(id, signal);
        sessionId = randomUUID();
        // Persist the owner before any guest process can survive this service.
        await writeStore(this.file(id), state);
        this.require(id, signal);
          await context.validate?.();
          const environment = Object.fromEntries(
            Object.entries(project.environment || {})
              .filter(
                ([key]) =>
                  !/^(?:LD_|SAKURA_CLIPBOARD_|HOME$|USER$|LOGNAME$|DISPLAY$|XAUTHORITY$|DBUS_|WAYLAND_|XDG_|SESSION_MANAGER$|PATH$)/.test(
                    key,
                  ) && !(this.transport === 'wayland' && /^(?:QT_QPA_PLATFORM|GDK_BACKEND|SDL_VIDEODRIVER)$/.test(key)),
              )
              .map(([key, value]) => [key, createHash('sha256').update(value).digest('hex')]),
          );
          issued = true;
          const launched = session.parse(
            await this.command(
              id,
              bundle,
              {
                action: 'launch',
                owner: state.owner,
                id: sessionId,
                image: application.image,
                sha256: application.sha256,
                args: request.args,
                rule: application.rule,
                generation: state.version,
                projectId: project._workspace || 'default',
                directory: project.directory,
                networkNamespace: projectNetworkNamespace(project),
                environment,
                desktop,
              },
              signal,
              project,
            ),
          );
          await context.validate?.();
          return launched;
        } catch (error) {
          // The guest owner lock serializes cleanup after a request with an
          // unknown outcome; only this newly allocated session can be stopped.
          if (issued && sessionId) {
            try { z.object({ stopped: z.literal(true) }).strict().parse(
              await this.command(id, bundle, { action: 'stop', owner: state.owner, id: sessionId })); }
            catch {
              if (context.release) { retain = true; this.retained.set(this.retainedKey(id, state.owner, sessionId),
                { runId: desktop!.run.runId, release: context.release }); }
              throw new AppError('Linux 剪贴板应用原运行域清理未确认；原会话记录与准备租约已保留', 503, 'LINUX_CLIPBOARD_CLEANUP_FAILED');
            }
          }
          throw error;
        } finally { if (!retain) await context.release?.(); }
      }
      if (request.action === 'save' || request.action === 'remove') {
        if (request.action === 'save') {
          const actual = z
            .object({ image, sha256: digest })
            .strict()
            .parse(
              await this.command(
                id,
                bundle,
                { action: 'identify', owner: state.owner, image: request.application.image },
                signal,
              ),
            );
          if (actual.image !== request.application.image || actual.sha256 !== request.application.sha256)
            throw new AppError('应用路径或文件摘要已变化，请重新读取应用身份', 409);
        }
        const path = request.action === 'save' ? request.application.image : request.image;
        const applications = state.applications.filter((app) => app.image !== path);
        if (request.action === 'save') applications.push(request.application);
        const next = x11ClipboardConfiguration.parse({ ...state, version: state.version + 1, applications });
        this.require(id, signal);
        await writeStore(this.file(id), next);
        state = next;
        this.states.set(id, Promise.resolve(next));
      }
      const errors = await this.reconcile(id, state, bundle, signal);
      const value = await this.view(id, signal);
      if (errors.length) value.error = [...new Set(errors)].join('；');
      return value;
    });
  }
  /**
   * 入口 / Entry: X11Clipboard.close.
   * 功能：在管理 Linux 应用剪贴板策略与运行票据中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`X11Clipboard`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `X11Clipboard`; the outcome is recorded in `this.closed`. Module context: Owns Linux application clipboard policies/run tickets, requiring complete application-scope cleanup before desktop retirement.
   * 处理：通过 `this.jobs.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.jobs.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.jobs.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    await this.jobs.close();
  }
}
