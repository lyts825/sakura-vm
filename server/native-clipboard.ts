/**
 * 模块职责：管理 Windows 原生应用剪贴板规则与启动归属，校验可执行文件和受管进程身份。
 * Module purpose: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
 */
import { hostExecFile } from './host-process.ts';
import { processSupervisor, spawnObserved as spawn } from './process-supervisor.ts';
import { randomUUID } from 'node:crypto';
import { lstat, open, readFile } from 'node:fs/promises';
import { dirname, join, win32 } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA, ROOT } from './paths.ts';
import { fileHash, readStore, regularDirectory, writeStore } from './local-store.ts';
import type { ClipboardRule } from '../shared/clipboard-policy.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';
import {
  nativeClipboardDescendants,
  nativeClipboardDescendantRequest,
  type NativeClipboardDescendantBroker,
  type NativeClipboardDescendantChannel,
  type NativeClipboardDescendantFactory,
  type NativeClipboardDescendantRequest,
} from './native-clipboard-descendants.ts';
import type {
  NativeClipboardProcess,
  NativeClipboardProcessState,
  NativeClipboardView,
} from '../shared/native-clipboard.ts';

const executable = z
  .string()
  .min(7)
  .max(1024)
  .refine(
    (value) =>
      /^[a-z]:[\\/]/i.test(value) &&
      win32.extname(value).toLowerCase() === '.exe' &&
      !/[\x00-\x1f"<>|?*]/.test(value) &&
      !value.slice(2).includes(':') &&
      !value.split(/[\\/]/).some((part) => part === '.' || part === '..' || /[. ]$/.test(part)),
    '需要本机驱动器中的完整 EXE 路径',
  );
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const rule = z
  .object({
    copy: z.boolean(),
    paste: z.boolean(),
    files: z.boolean(),
    sensitive: z.boolean(),
    maxTextBytes: z.number().int().min(1024).max(1048576),
  })
  .strict();
const application = z.object({ image: executable, sha256: digest, rule }).strict();
/**
 * 入口 / Entry: samePath.
 * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `win32.normalize(value).toLowerCase()` 供上层消费（`native-clipboard.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `native-clipboard.ts`; this entry produces `win32.normalize(value).toLowerCase()` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
 * 处理：通过 `win32.normalize().toLowerCase`, `win32.normalize` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `win32.normalize().toLowerCase`, `win32.normalize`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: string
 * 输出 / Returns: `win32.normalize(value).toLowerCase()`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const samePath = (value: string) => win32.normalize(value).toLowerCase();
export const nativeClipboardSettings = z
  .object({
    enabled: z.boolean(),
    applications: z.array(application).max(32),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.applications.map((item) => samePath(item.image))).size === value.applications.length,
    '应用路径不能重复',
  );
export const nativeClipboardRequest = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('configure'),
      version: z.number().int().positive(),
      settings: nativeClipboardSettings,
    })
    .strict(),
  z
    .object({
      action: z.literal('identify'),
      pid: z.number().int().positive(),
      created: z.string().regex(/^[1-9][0-9]{0,19}$/),
    })
    .strict(),
  z.object({ action: z.literal('refresh') }).strict(),
  z
    .object({
      action: z.literal('launch'),
      version: z.number().int().positive(),
      image: executable,
      sha256: digest,
      args: z
        .array(
          z
            .string()
            .max(2048)
            .refine((value) => !value.includes('\0')),
        )
        .max(64)
        .refine(
          (values) => values.reduce((length, value) => length + value.length, 0) <= 8192,
          '启动参数合计不能超过 8192 个字符',
        ),
    })
    .strict(),
]);
const identity = z
  .object({
    pid: z.number().int().positive().max(0xffffffff),
    created: z.string().regex(/^[1-9][0-9]{0,19}$/),
    image: executable,
    bits: z.union([z.literal(0), z.literal(32), z.literal(64)]),
  })
  .strict();
const inheritance = z
  .object({
    application: z.object({ image: executable, sha256: digest }).strict(),
    parent: identity.pick({ pid: true, created: true }).strict(),
  })
  .strict();
const managed = identity.extend({ sha256: digest, inheritance: inheritance.optional() }).strict();
const stateSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    owner: z.uuid(),
    settings: nativeClipboardSettings,
    managed: z.array(managed).max(256),
  })
  .strict();
const nativeState = z
  .object({
    present: z.literal(true),
    ready: z.boolean(),
    active: z.boolean(),
    compatible: z.boolean(),
    flags: z.number().int().min(0).max(15),
    maximum: z.number().int().min(1024).max(1048576),
    blockedCopy: z.number().nonnegative(),
    blockedPaste: z.number().nonnegative(),
    reserved: z.boolean().optional(),
  })
  .strict();
const statusSchema = z.union([
  z.object({ present: z.literal(false), reserved: z.boolean().optional() }).strict(),
  nativeState,
]);
const listSchema = z
  .object({ processes: z.array(identity.extend({ image: z.string().min(1).max(32768) }).strict()).max(8192) })
  .strict();
const assetNames = [
  'SakuraClipboardPolicy.dll',
  'sakura-clipboard-controller.exe',
  'MinHook-LICENSE.txt',
] as const;
const dualAssetNames = [
  ...assetNames,
  'SakuraClipboardPolicy-x86.dll',
  'sakura-clipboard-controller-x86.exe',
] as const;
const earlyAssetNames = [...dualAssetNames, 'Detours-LICENSE.md'] as const;
const assetsSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8)]),
    architecture: z.literal('x64'),
    build: digest,
    files: z
      .array(
        z
          .object({
            name: z.enum(earlyAssetNames),
            size: z
              .number()
              .int()
              .positive()
              .max(16 * 1024 * 1024),
            sha256: digest,
          })
          .strict(),
      )
      .min(3)
      .max(6),
  })
  .strict()
  .refine((value) => {
    const expected =
      value.version === 1 ? assetNames : value.version === 2 ? dualAssetNames : earlyAssetNames;
    return (
      value.files.length === expected.length &&
      new Set(value.files.map((item) => item.name)).size === expected.length &&
      expected.every((name) => value.files.some((item) => item.name === name))
    );
  });
/**
 * 入口 / Entry: flags.
 * 功能：从当前输入或状态计算 `(value.copy ? 1 : 0) | (value.paste ? 2 : 0) | (value.files ? 4 : 0) | (value.sensitive ? 8 : 0)`，供调用方后续验证或使用。
 * Purpose: Computes `(value.copy ? 1 : 0) | (value.paste ? 2 : 0) | (value.files ? 4 : 0) | (value.sensitive ? 8 : 0)` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: value: ClipboardRule
 * 输出 / Returns: `(value.copy ? 1 : 0) | (value.paste ? 2 : 0) | (value.files ? 4 : 0) | (value.sensitive ? 8 : 0)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const flags = (value: ClipboardRule) =>
  (value.copy ? 1 : 0) | (value.paste ? 2 : 0) | (value.files ? 4 : 0) | (value.sensitive ? 8 : 0);
/**
 * 入口 / Entry: key.
 * 功能：从当前输入或状态计算 ``${value.pid}:${value.created}``，供调用方后续验证或使用。
 * Purpose: Computes ``${value.pid}:${value.created}`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: value: { pid: number; created: string }
 * 输出 / Returns: ``${value.pid}:${value.created}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const key = (value: { pid: number; created: string }) => `${value.pid}:${value.created}`;
export type NativeClipboardLaunchHooks = {
  /**
   * 签名 / Signature: NativeClipboardLaunchHooks.prepared.
   * 功能：为管理 Windows 原生应用剪贴板规则与启动归属声明 prepared 的输入与结果契约，所属容器为 NativeClipboardLaunchHooks。
   * Purpose: Declares the input/result contract for prepared in NativeClipboardLaunchHooks. Module responsibility: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 输入 / Inputs: process: NativeClipboardProcess
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  prepared: (process: NativeClipboardProcess) => Promise<void>;
  /**
   * 签名 / Signature: NativeClipboardLaunchHooks.attached.
   * 功能：为管理 Windows 原生应用剪贴板规则与启动归属声明 attached 的输入与结果契约，所属容器为 NativeClipboardLaunchHooks。
   * Purpose: Declares the input/result contract for attached in NativeClipboardLaunchHooks. Module responsibility: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 输入 / Inputs: process: NativeClipboardProcess; state: z.infer<typeof nativeState>
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  attached: (process: NativeClipboardProcess, state: z.infer<typeof nativeState>) => Promise<void>;
};
/**
 * 签名 / Signature: NativeClipboardLaunch.NativeClipboardLaunch.
 * 功能：为管理 Windows 原生应用剪贴板规则与启动归属声明 NativeClipboardLaunch 的输入与结果契约，所属容器为 NativeClipboardLaunch。
 * Purpose: Declares the input/result contract for NativeClipboardLaunch in NativeClipboardLaunch. Module responsibility: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
 * 输入 / Inputs: file: string; args: string[]; hooks: NativeClipboardLaunchHooks; signal: AbortSignal
 * 输出 / Returns: Promise<NativeClipboardProcess>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
export type NativeClipboardLaunch = (
  file: string,
  args: string[],
  hooks: NativeClipboardLaunchHooks,
  signal: AbortSignal,
) => Promise<NativeClipboardProcess>;
const launchIdentity = z
  .object({
    stage: z.enum(['prepared', 'attached', 'committed']),
    launchId: z.uuid(),
    process: identity,
    state: nativeState.optional(),
  })
  .strict();
// The helper owns a fresh kill-on-close Job atomically assigned at creation.
// Before commit, EOF, service close or a rejected handshake kills only that Job.
// A lost commit reply may leave an enforced child alive; retain its journal.
/**
 * 入口 / Entry: nativeLaunch.
 * 功能：启动原生应用控制参与者并等待协议承诺，把原窗口及进程交付给调用方。
 * Purpose: Starts native launch participants and waits for protocol commitment before handing off window/process ownership.
 * 设计：协议拒绝、取消和异常分别观察；创建后才失败仍需核销原进程，不能把退出事件当成所有句柄关闭。
 * Design: Refusal/cancellation/failure are observed separately; post-spawn failure still retires original processes and exit is not handle closure.
 * 输入 / Inputs: file; args; hooks; signal
 * 输出 / Returns: `processIdentity`.
 * 副作用 / Effects: `processSupervisor.observe`; `signal.addEventListener`; `setTimeout`; `child.stdout.setEncoding`; `clearTimeout`.
 * 拒绝 / Refusals: 条件 / conditions `signal.aborted`; `failure`; `code !== 0 || sequence !== 3 || output.trim() || !processIdentity`; 异常 / errors `new AppError('受控启动已取消', 503)`; `failure`.
 * 收尾：退出 try 区域时始终执行 `clearTimeout(timeout);`; `signal.removeEventListener('abort', aborted);`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `clearTimeout(timeout);`; `signal.removeEventListener('abort', aborted);`; these steps also apply to exceptional exits.
 */
export const nativeLaunch: NativeClipboardLaunch = async (file, args, hooks, signal) => {
  if (signal.aborted) throw new AppError('受控启动已取消', 503);
  const owned = await processSupervisor.observe('clipboard-launch', () => spawn(file, args, {
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  }), { signal });
  const child = owned.child as import('node:child_process').ChildProcessWithoutNullStreams;
  let output = '',
    bytes = 0,
    sequence = 0,
    processIdentity: NativeClipboardProcess | undefined;
  let failure: unknown,
    flow: Promise<void> = Promise.resolve();
  let committed!:
  /**
   * 中文功能：原生启动提交/拒绝通知，或 reconcile 串行执行的持久修改工作。
   * English: Native-launch commit/refusal notification or serialized persistent mutation work in reconciliation.
   * 所属 / Owner: nativeLaunch.committed.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `void`.
   */
  () => void, rejected!:
  /**
   * 中文功能：原生启动提交/拒绝通知，或 reconcile 串行执行的持久修改工作。
   * English: Native-launch commit/refusal notification or serialized persistent mutation work in reconciliation.
   * 所属 / Owner: nativeLaunch.rejected.
   * 输入 / Inputs: reason: unknown.
   * 结果 / Result: `void`.
   */
  (reason: unknown) => void;
  const commitment = new Promise<void>((resolve, reject) => {
    committed = resolve;
    rejected = reject;
  });
  void commitment.catch(() => {});
  /**
   * 入口 / Entry: stop.
   * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`native-clipboard.ts`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `native-clipboard.ts`; the calls and state transitions below complete the operation. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 处理：通过 `rejected`, `child.stdin.destroy`, `child.kill`, `child.stdout.destroy` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `rejected`, `child.stdin.destroy`, `child.kill`, `child.stdout.destroy`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: error: unknown
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `child.stdin.destroy`; `child.kill`; `child.stdout.destroy`; `child.stderr.destroy`; 更新 / updates `failure`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const stop = (error: unknown) => {
    failure ||= error;
    rejected(failure);
    child.stdin.destroy();
    child.kill();
    child.stdout.destroy();
    child.stderr.destroy();
  };
  /**
   * 入口 / Entry: aborted.
   * 功能：把本层请求转交 `stop`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `stop` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `stop(new AppError('受控启动确认已中止；已保存的归属保留，请刷新进程状态', 503))`.
   * 副作用 / Effects: `stop`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const aborted = () => stop(new AppError('受控启动确认已中止；已保存的归属保留，请刷新进程状态', 503));
  signal.addEventListener('abort', aborted, { once: true });
  const timeout = setTimeout(
    () => stop(new AppError('受控启动确认超时；已保存的归属保留，请刷新进程状态', 503)),
    120000,
  );
  /**
   * 入口 / Entry: consume.
   * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`native-clipboard.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `native-clipboard.ts`; this entry produces `void` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 处理：通过 `z.object().strict().safeParse`, `z.object().strict`, `z.object`, `z.string().max` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.object().strict().safeParse`, `z.object().strict`, `z.object`, `z.string().max`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `failure || signal.aborted`; `message.stage === 'prepared'`; `message.stage === 'attached'`.
   * 输入 / Inputs: line: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `child.stdin.write`; 更新 / updates `processIdentity`.
   * 拒绝 / Refusals: 条件 / conditions `error.success`; `message.stage !== ['prepared', 'attached', 'committed'][sequence] || message.launchId !== args[7] || (message.stage === 'atta…`; 异常 / errors `new AppError(error.data.error, 503)`; `new AppError('受控启动握手身份或顺序无效', 503)`.
   */
  const consume = async (line: string) => {
    if (failure || signal.aborted) return;
    const value: unknown = JSON.parse(line);
    const error = z
      .object({ error: z.string().max(256), systemError: z.number() })
      .strict()
      .safeParse(value);
    if (error.success) throw new AppError(error.data.error, 503);
    const message = launchIdentity.parse(value);
    if (
      message.stage !== ['prepared', 'attached', 'committed'][sequence] ||
      message.launchId !== args[7] ||
      (message.stage === 'attached') !== !!message.state ||
      (processIdentity &&
        (key(processIdentity) !== key(message.process) ||
          samePath(processIdentity.image) !== samePath(message.process.image) ||
          processIdentity.bits !== message.process.bits))
    )
      throw new AppError('受控启动握手身份或顺序无效', 503);
    processIdentity = message.process;
    if (message.stage === 'prepared') await hooks.prepared(message.process);
    if (message.stage === 'attached') await hooks.attached(message.process, message.state!);
    if (failure || signal.aborted) return;
    sequence++;
    if (message.stage !== 'committed')
      child.stdin.write(`${message.stage === 'prepared' ? 'attach' : 'resume'} ${args[7]}\n`);
    else {
      child.stdin.end();
      committed();
    }
  };
  child.stdout.setEncoding('utf8');
  /**
   * 入口 / Entry: callback@279.
   * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（child.stdout.on / data）。
   * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (child.stdout.on / data).
   * 输入 / Inputs: chunk: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `stop`; `output.slice().replace`; 更新 / updates `bytes`, `output`, `index`, `flow`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  child.stdout.on('data', (chunk: string) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 32768) {
      stop(new AppError('受控启动工具返回过多数据', 503));
      return;
    }
    output += chunk;
    let index: number;
    while ((index = output.indexOf('\n')) >= 0) {
      const line = output.slice(0, index).replace(/\r$/, '');
      output = output.slice(index + 1);
      flow = flow.then(() => consume(line)).catch(stop);
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 32768) stop(new AppError('受控启动工具返回过多数据', 503));
  });
  child.stdin.on('error', (error) => {
    if (sequence < 3) stop(error);
  });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    // Windows console lifetimes may keep a pipe open after the helper exits.
    // Success requires its explicit commit frame and zero process exit status,
    // rather than the lifetime of any inherited console resource.
    if (code === 0) await commitment;
    await flow;
    if (failure) throw failure;
    if (code !== 0 || sequence !== 3 || output.trim() || !processIdentity)
      throw new AppError('受控启动未确认；已保存的归属保留，请刷新进程状态', 503);
    return processIdentity;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', aborted);
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await owned.waitForClose();
  }
};
/**
 * 入口 / Entry: nativeCommand.
 * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `JSON.parse(stdout)` 供上层消费（`native-clipboard.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `native-clipboard.ts`; this entry produces `JSON.parse(stdout)` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
 * 处理：通过 `hostExecFile`, `z.object().parse`, `z.object`, `z.string().max` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `hostExecFile`, `z.object().parse`, `z.object`, `z.string().max`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `output`.
 * 输入 / Inputs: file: string; args: string[]
 * 输出 / Returns: Promise<unknown>；结果来自 / values from `JSON.parse(stdout)`.
 * 副作用 / Effects: 更新 / updates `reason`.
 * 拒绝 / Refusals: 条件 / conditions `error instanceof AppError && error.code === 'HOST_PROCESS_CLEANUP_PENDING'`; 异常 / errors `error`; `new AppError(reason, 503)`.
 * 失败处理：catch 分支执行 `if (error instanceof AppError && error.code === 'HOST_PROCESS_CLEANUP_PENDING') throw error;`; `const output = (error as { stdout?: string }).stdout;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (error instanceof AppError && error.code === 'HOST_PROCESS_CLEANUP_PENDING') throw error;`; `const output = (error as { stdout?: string }).stdout;`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function nativeCommand(file: string, args: string[]): Promise<unknown> {
  try {
    const { stdout } = await hostExecFile('clipboard-command', file, args, {
      timeout: 70000,
      maxBuffer: 8 * 1024 * 1024,
      // Status validates an already captured process birth; disabling only retires
      // the owner's existing policy. New attachment remains ordinary admission.
      lane: args[0] === 'status' || (args[0] === 'apply' && args[8] === '0') ? 'control' : 'background',
    });
    return JSON.parse(stdout);
  } catch (error) {
    if (error instanceof AppError && error.code === 'HOST_PROCESS_CLEANUP_PENDING') throw error;
    const output = (error as { stdout?: string }).stdout;
    let reason = '原生剪贴板工具未完成';
    if (output) {
      try {
        reason = z
          .object({ error: z.string().max(256), systemError: z.number() })
          .parse(JSON.parse(output)).error;
      } catch {}
    }
    throw new AppError(reason, 503);
  }
}
/**
 * 入口 / Entry: clipboardExecutableHash.
 * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `value` 供上层消费（`native-clipboard.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `native-clipboard.ts`; this entry produces `value` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
 * 处理：通过 `executable.parse`, `regularDirectory`, `dirname`, `lstat` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `executable.parse`, `regularDirectory`, `dirname`, `lstat`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: path: string
 * 输出 / Returns: `value`.
 * 副作用 / Effects: `executable.parse`.
 * 拒绝 / Refusals: 条件 / conditions `!before.isFile() || before.isSymbolicLink() || before.size > 512 * 1024 * 1024`; `before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs`; 异常 / errors `new AppError('应用程序文件不是普通 EXE 文件')`; `new AppError('应用程序文件正在变化，请重试', 409)`.
 */
export async function clipboardExecutableHash(path: string) {
  executable.parse(path);
  await regularDirectory(dirname(path));
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > 512 * 1024 * 1024)
    throw new AppError('应用程序文件不是普通 EXE 文件');
  const value = await fileHash(path);
  const after = await lstat(path);
  if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
    throw new AppError('应用程序文件正在变化，请重试', 409);
  return value;
}
/**
 * 入口 / Entry: clipboardExecutableBits.
 * 功能：读取 EXE 的 PE 头并识别受支持位数，核对读取期间文件身份和长度。
 * Purpose: Reads EXE PE headers to identify supported bitness while checking file identity/length during reading.
 * 设计：头部偏移和格式严格有界，文件变更或不支持机器类型拒绝，句柄在所有路径关闭。
 * Design: Offsets/formats are bounded, changed files/unsupported machine types reject, and every path closes the descriptor.
 * 输入 / Inputs: path: string
 * 输出 / Returns: Promise<32 | 64>；结果来自 / values from `width`; `64`.
 * 副作用 / Effects: `executable.parse`; `locations.push`; `file.close`; 更新 / updates `width`.
 * 拒绝 / Refusals: 条件 / conditions `(await file.read(header, 0, header.length, 0)).bytesRead !== header.length || header.readUInt16LE(0) !== 0x5a4d`; `offset < 64 || offset > 1048576 || (await file.read(pe, 0, pe.length, offset)).bytesRead !== pe.length || pe.readUInt32LE(0) …`; `pe.readUInt16LE(20) !== optionalSize || sections > 96`; 异常 / errors `new AppError('所选文件不是 Windows EXE')`; `new AppError('受控启动仅支持 x64 或 x86 EXE')`.
 * 收尾：退出 try 区域时始终执行 `await file.close();`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `await file.close();`; these steps also apply to exceptional exits.
 */
export async function clipboardExecutableBits(path: string): Promise<32 | 64> {
  executable.parse(path);
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(64),
      pe = Buffer.alloc(26);
    if (
      (await file.read(header, 0, header.length, 0)).bytesRead !== header.length ||
      header.readUInt16LE(0) !== 0x5a4d
    )
      throw new AppError('所选文件不是 Windows EXE');
    const offset = header.readUInt32LE(60);
    if (
      offset < 64 ||
      offset > 1048576 ||
      (await file.read(pe, 0, pe.length, offset)).bytesRead !== pe.length ||
      pe.readUInt32LE(0) !== 0x4550 ||
      !(pe.readUInt16LE(22) & 2) ||
      pe.readUInt16LE(22) & 0x2000
    )
      throw new AppError('所选文件不是 Windows EXE');
    let width: 32 | 64;
    if (pe.readUInt16LE(4) === 0x14c && pe.readUInt16LE(24) === 0x10b) width = 32;
    else if (pe.readUInt16LE(4) === 0x8664 && pe.readUInt16LE(24) === 0x20b) width = 64;
    else throw new AppError('受控启动仅支持 x64 或 x86 EXE');
    const size = (await file.stat()).size;
    /**
     * 入口 / Entry: clipboardExecutableBits.read.
     * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `bytes` 供上层消费（`native-clipboard.ts`）。
     * Purpose: Reads/verifies domain state and constructs a caller-facing result in `native-clipboard.ts`; this entry produces `bytes` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
     * 处理：通过 `file.read` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `file.read`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: position: number; length: number
     * 输出 / Returns: `bytes`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `position < 0 || position > size || length > size - position`; `(await file.read(bytes, 0, length, position)).bytesRead !== length`; 异常 / errors `new AppError('所选 EXE 启动头无法核对')`.
     */
    const read = async (position: number, length: number) => {
      if (position < 0 || position > size || length > size - position)
        throw new AppError('所选 EXE 启动头无法核对');
      const bytes = Buffer.alloc(length);
      if ((await file.read(bytes, 0, length, position)).bytesRead !== length)
        throw new AppError('所选 EXE 启动头无法核对');
      return bytes;
    };
    const optionalSize = width === 32 ? 224 : 240,
      sections = pe.readUInt16LE(6);
    if (pe.readUInt16LE(20) !== optionalSize || sections > 96) throw new AppError('所选 EXE 启动头无法核对');
    const optional = await read(offset + 24, optionalSize);
    const directories = width === 32 ? 96 : 112;
    if (optional.readUInt32LE(directories - 4) < 16 || ![2, 3].includes(optional.readUInt16LE(68)))
      throw new AppError('所选 EXE 启动头无法核对');
    const corRva = optional.readUInt32LE(directories + 14 * 8);
    const corSize = optional.readUInt32LE(directories + 14 * 8 + 4);
    if (!corRva && !corSize) return width;
    const imageSize = optional.readUInt32LE(56);
    if (!corRva || corSize < 72 || !sections || corRva + corSize > imageSize)
      throw new AppError('CLR 启动头无法核对');
    const table = await read(offset + 24 + optionalSize, sections * 40);
    const locations: number[] = [];
    for (let index = 0; index < sections; index++) {
      const start = index * 40,
        rva = table.readUInt32LE(start + 12),
        rawSize = table.readUInt32LE(start + 16);
      if (corRva >= rva && corRva - rva + corSize <= rawSize)
        locations.push(table.readUInt32LE(start + 20) + corRva - rva);
    }
    if (locations.length !== 1) throw new AppError('CLR 启动头映射无法核对');
    const cli = await read(locations[0], 72),
      flags = cli.readUInt32LE(16),
      entry = cli.readUInt32LE(20);
    if (
      cli.readUInt32LE(0) !== 72 ||
      !cli.readUInt32LE(8) ||
      !cli.readUInt32LE(12) ||
      cli.readUInt32LE(8) + cli.readUInt32LE(12) > imageSize ||
      !(flags & 1) ||
      flags & ~0x3000b ||
      cli.readUInt32LE(64) ||
      cli.readUInt32LE(68) ||
      !(entry & 0xffffff) ||
      ![6, 0x26].includes(entry >>> 24)
    )
      throw new AppError('受控启动仅支持纯 IL CLR EXE，混合模式或启动头不明的应用无法启动');
    if (width === 64 && flags & (2 | 0x20000)) throw new AppError('CLR 位数标记不一致');
    if (width === 32 && !(flags & (2 | 0x20000))) {
      if (process.arch === 'x64') return 64;
      if (process.arch !== 'ia32') throw new AppError('AnyCPU 受控启动需要 x86/x64 Windows 宿主');
    }
    return width;
  } finally {
    await file.close();
  }
}
type Options = {
  file?: string;
  assets?: string;
  supported?: boolean;
  pid?: number;
  interval?: number;
  /**
   * 签名 / Signature: Options.run.
   * 功能：为管理 Windows 原生应用剪贴板规则与启动归属声明 run 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for run in Options. Module responsibility: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 输入 / Inputs: file: string; args: string[]
   * 输出 / Returns: Promise<unknown>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  run?: (file: string, args: string[]) => Promise<unknown>;
  /**
   * 签名 / Signature: Options.hashImage.
   * 功能：为管理 Windows 原生应用剪贴板规则与启动归属声明 hashImage 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for hashImage in Options. Module responsibility: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 输入 / Inputs: path: string
   * 输出 / Returns: Promise<string>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  hashImage?: (path: string) => Promise<string>;
  /**
   * 签名 / Signature: Options.imageBits.
   * 功能：为管理 Windows 原生应用剪贴板规则与启动归属声明 imageBits 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for imageBits in Options. Module responsibility: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 输入 / Inputs: path: string
   * 输出 / Returns: Promise<32 | 64>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  imageBits?: (path: string) => Promise<32 | 64>;
  launch?: NativeClipboardLaunch;
  descendants?: NativeClipboardDescendantFactory;
  /**
   * 签名 / Signature: Options.guard.
   * 功能：为管理 Windows 原生应用剪贴板规则与启动归属声明 guard 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for guard in Options. Module responsibility: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  guard?: () => void;
  /**
   * 签名 / Signature: Options.maintenance.
   * 功能：为管理 Windows 原生应用剪贴板规则与启动归属声明 maintenance 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for maintenance in Options. Module responsibility: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  maintenance?: () => boolean;
  /**
   * 签名 / Signature: Options.mutation.
   * 功能：为管理 Windows 原生应用剪贴板规则与启动归属声明 mutation 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for mutation in Options. Module responsibility: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 输入 / Inputs: delta: number
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  mutation?: (delta: number) => void;
};
type ProcessClaim = { kind: 'scan' | 'adopt'; mutation?: Promise<unknown> };

// Only explicitly selected, same-user/session processes are attached. The DLL
// retains its current policy if this service closes; shutdown never relaxes it.
export class NativeClipboard {
  private hasX86 = false;
  private hasEarly = false;
  private hasDescendants = false;
  private descendantChannel?: NativeClipboardDescendantChannel;
  private descendantStarting?: Promise<void>;
  private descendantLifetime = new AbortController();
  private descendantTasks = new Set<Promise<void>>();
  private processClaims = new Map<string, ProcessClaim>();
  private state: z.infer<typeof stateSchema> = {
    schemaVersion: 1,
    version: 1,
    owner: randomUUID(),
    settings: { enabled: false, applications: [] },
    managed: [],
  };
  private inventory: NativeClipboardProcess[] = [];
  private processes: NativeClipboardProcessState[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private stateQueue: Promise<unknown> = Promise.resolve();
  private timer?: ScheduleHandle;
  private closed = false;
  private readonly lifetime = new AbortController();
  private scanning = false;
  private ready = false;
  private error?: string;
  private lastScan?: string;
  private failed = new Map<string, number>();
  private readonly file: string;
  private readonly assets: string;
  private readonly supported: boolean;
  private readonly pid: number;
  private readonly run: NonNullable<Options['run']>;
  private readonly hashImage: NonNullable<Options['hashImage']>;
  private readonly imageBits: NonNullable<Options['imageBits']>;
  private readonly start: NativeClipboardLaunch;
  /**
   * 入口 / Entry: NativeClipboard.constructor.
   * 功能：建立 NativeClipboard 的管理 Windows 原生应用剪贴板规则与启动归属上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the NativeClipboard context for this module's responsibility: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: options: Options default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.file`, `this.assets`, `this.supported`, `this.pid`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private options: Options = {}) {
    this.file = options.file || join(DATA, 'native-clipboard.json');
    this.assets = options.assets || join(ROOT, '.sakura-server', 'assets', 'native-clipboard');
    this.supported = options.supported ?? (process.platform === 'win32' && process.arch === 'x64');
    this.pid = options.pid ?? process.pid;
    this.run = options.run || nativeCommand;
    this.hashImage = options.hashImage || clipboardExecutableHash;
    this.imageBits = options.imageBits || clipboardExecutableBits;
    this.start = options.launch || nativeLaunch;
  }
  /**
   * 入口 / Entry: NativeClipboard.init.
   * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，初始化并核对当前领域状态；处理结果记录到 `this.state`, `this.timer`（`NativeClipboard`）。
   * Purpose: Initializes and verifies current domain state in `NativeClipboard`; the outcome is recorded in `this.state`, `this.timer`. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 处理：通过 `stateSchema.parse`, `readStore`, `this.serial`, `scheduler.register` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stateSchema.parse`, `readStore`, `this.serial`, `scheduler.register`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `interval > 0`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `scheduler.register`; 更新 / updates `this.state`, `this.timer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    this.state = stateSchema.parse(await readStore(this.file, () => this.state));
    await this.serial(() => this.scan());
    const interval = this.options.interval ?? 4000;
    if (interval > 0) {
      this.timer = scheduler.register({ owner: 'core:native-clipboard', label: '原生剪贴板应用状态校准', intervalMs: interval,
        overlap: 'skip',
        /**
         * 入口 / Entry: NativeClipboard.init.run.
         * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`NativeClipboard`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeClipboard`; this entry produces `void` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
         * 处理：通过 `this.serial().catch().finally`, `this.serial().catch`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `this.serial().catch().finally`, `this.serial().catch`, `this.serial`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `this.closed || this.scanning || (!this.state.settings.enabled && !this.state.managed.length)`.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `void`.
         * 副作用 / Effects: 更新 / updates `this.scanning`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        run: async () => {
        if (this.closed || this.scanning || (!this.state.settings.enabled && !this.state.managed.length))
          return;
        this.scanning = true;
        await this.serial(() => this.scan())
          .catch((error) => {
            this.error = (error as Error).message;
            throw error;
          })
          .finally(() => {
            this.scanning = false;
          });
      } });
    }
  }
  /**
   * 入口 / Entry: NativeClipboard.view.
   * 功能：把本层请求转交 `structuredClone`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `structuredClone` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: NativeClipboardView；结果来自 / values from `structuredClone({ version: this.state.version, supported: this.supported, ready: this.ready, settings: this.state.settings, a…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(): NativeClipboardView {
    return structuredClone({
      version: this.state.version,
      supported: this.supported,
      ready: this.ready,
      settings: this.state.settings,
      available: this.inventory,
      processes: this.processes,
      lastScan: this.lastScan,
      error: this.error,
    });
  }
  /**
   * 入口 / Entry: NativeClipboard.serial.
   * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`NativeClipboard`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeClipboard`; this entry produces `task` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 处理：通过 `this.queue.catch().then`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.queue.catch().then`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `task`.
   * 副作用 / Effects: 更新 / updates `this.queue`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new AppError('剪贴板代理正在关闭', 503);
        return work();
      });
    this.queue = task;
    return task;
  }
  /**
   * 入口 / Entry: NativeClipboard.controller.
   * 功能：把本层请求转交 `join`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `join` and propagates the provider result or rejection.
   * 输入 / Inputs: bits: default=64
   * 输出 / Returns: `join(this.assets, `sakura-clipboard-controller${bits === 32 ? '-x86' : ''}.exe`)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private controller(bits = 64) {
    return join(this.assets, `sakura-clipboard-controller${bits === 32 ? '-x86' : ''}.exe`);
  }
  /**
   * 入口 / Entry: NativeClipboard.library.
   * 功能：把本层请求转交 `join`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `join` and propagates the provider result or rejection.
   * 输入 / Inputs: bits: default=64
   * 输出 / Returns: `join(this.assets, `SakuraClipboardPolicy${bits === 32 ? '-x86' : ''}.dll`)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private library(bits = 64) {
    return join(this.assets, `SakuraClipboardPolicy${bits === 32 ? '-x86' : ''}.dll`);
  }
  /**
   * 入口 / Entry: NativeClipboard.checkedAssets.
   * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，核对调用资格、输入或资源归属；处理结果记录到 `this.hasX86`, `this.hasEarly`, `this.hasDescendants`（`NativeClipboard`）。
   * Purpose: Checks admission, input or resource ownership in `NativeClipboard`; the outcome is recorded in `this.hasX86`, `this.hasEarly`, `this.hasDescendants`. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 处理：通过 `regularDirectory`, `join`, `lstat`, `info.isFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `regularDirectory`, `join`, `lstat`, `info.isFile`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: library: boolean
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.hasX86`, `this.hasEarly`, `this.hasDescendants`.
   * 拒绝 / Refusals: 条件 / conditions `!this.supported`; `!info.isFile() || info.isSymbolicLink() || info.size > 16384`; `!info.isFile() || info.isSymbolicLink() || info.size !== item.size || (await fileHash(file)) !== item.sha256`; 异常 / errors `new AppError('当前宿主机需要 Windows x64 才能使用此代理', 503)`; `new AppError('原生剪贴板清单无效', 503)`.
   */
  private async checkedAssets(library: boolean) {
    if (!this.supported) throw new AppError('当前宿主机需要 Windows x64 才能使用此代理', 503);
    await regularDirectory(this.assets);
    const manifestPath = join(this.assets, 'native-clipboard.json');
    const info = await lstat(manifestPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16384)
      throw new AppError('原生剪贴板清单无效', 503);
    const manifest = assetsSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
    for (const name of library
      ? manifest.version === 1
        ? assetNames
        : manifest.version === 2
          ? dualAssetNames
          : earlyAssetNames
      : (['sakura-clipboard-controller.exe'] as const)) {
      const file = join(this.assets, name),
        item = manifest.files.find((item) => item.name === name)!;
      const info = await lstat(file);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size !== item.size ||
        (await fileHash(file)) !== item.sha256
      )
        throw new AppError(`原生剪贴板文件完整性失败：${name}`, 503);
    }
    this.hasX86 = manifest.version >= 2;
    this.hasEarly = manifest.version >= 3;
    this.hasDescendants = manifest.version >= 5;
  }
  /**
   * 入口 / Entry: NativeClipboard.list.
   * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `listSchema .parse(await this.run(this.controller(), ['list'])) .processes.filter((item) => item.pid !== this.pid && executabl…` 供上层消费（`NativeClipboard`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `NativeClipboard`; this entry produces `listSchema .parse(await this.run(this.controller(), ['list'])) .processes.filter((item) => item.pid !== this.pid && executabl…` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 处理：通过 `listSchema.parse().processes.filter`, `listSchema.parse`, `this.run`, `this.controller` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `listSchema.parse().processes.filter`, `listSchema.parse`, `this.run`, `this.controller`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `listSchema .parse(await this.run(this.controller(), ['list'])) .processes.filter((item) => item.pid !== this.pid && executabl…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async list() {
    return listSchema
      .parse(await this.run(this.controller(), ['list']))
      .processes.filter((item) => item.pid !== this.pid && executable.safeParse(item.image).success);
  }
  /**
   * 入口 / Entry: NativeClipboard.status.
   * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `this.run(this.controller(), ['status', this.state.owner, String(item.pid), item.created]).then( (value) => statusSchema.parse…` 供上层消费（`NativeClipboard`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `NativeClipboard`; this entry produces `this.run(this.controller(), ['status', this.state.owner, String(item.pid), item.created]).then( (value) => statusSchema.parse…` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 处理：通过 `this.run().then`, `this.run`, `this.controller` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.run().then`, `this.run`, `this.controller`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: item: NativeClipboardProcess
   * 输出 / Returns: `this.run(this.controller(), ['status', this.state.owner, String(item.pid), item.created]).then( (value) => statusSchema.parse…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private status(item: NativeClipboardProcess) {
    return this.run(this.controller(), ['status', this.state.owner, String(item.pid), item.created]).then(
      (value) => statusSchema.parse(value),
    );
  }
  /**
   * 入口 / Entry: NativeClipboard.apply.
   * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.run(this.controller(bits), [ 'apply', this.state.owner, String(item.pid), item.created, item.image, this.library(bits), …` 供上层消费（`NativeClipboard`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeClipboard`; this entry produces `this.run(this.controller(bits), [ 'apply', this.state.owner, String(item.pid), item.created, item.image, this.library(bits), …` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 处理：通过 `this.run().then`, `this.run`, `this.controller`, `this.library` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.run().then`, `this.run`, `this.controller`, `this.library`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: item: NativeClipboardProcess; rule: ClipboardRule; active: boolean
   * 输出 / Returns: `this.run(this.controller(bits), [ 'apply', this.state.owner, String(item.pid), item.created, item.image, this.library(bits), …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `active && bits === 32 && !this.hasX86`; 异常 / errors `new AppError('此运行包未包含 32 位应用代理，请更新运行包')`.
   */
  private apply(item: NativeClipboardProcess, rule: ClipboardRule, active: boolean) {
    const bits = active ? item.bits : 64;
    if (active && bits === 32 && !this.hasX86)
      throw new AppError('此运行包未包含 32 位应用代理，请更新运行包');
    return this.run(this.controller(bits), [
      'apply',
      this.state.owner,
      String(item.pid),
      item.created,
      item.image,
      this.library(bits),
      String(flags(rule)),
      String(rule.maxTextBytes),
      active ? '1' : '0',
    ]).then((value) => nativeState.parse(value));
  }
  /**
   * 入口 / Entry: NativeClipboard.persist.
   * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，校验并提交领域状态变更；本入口产生 `operation` 供上层消费（`NativeClipboard`）。
   * Purpose: Validates and commits a domain state change in `NativeClipboard`; this entry produces `operation` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 处理：通过 `this.stateQueue.catch().then`, `this.stateQueue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.stateQueue.catch().then`, `this.stateQueue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: change: (state: z.infer<typeof stateSchema>) => z.infer<typeof stateSchema>
   * 输出 / Returns: `operation`.
   * 副作用 / Effects: 更新 / updates `this.stateQueue`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private persist(change: (state: z.infer<typeof stateSchema>) => z.infer<typeof stateSchema>) {
    /**
     * 入口 / Entry: NativeClipboard.persist.callback@616.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.stateQueue.catch().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.stateQueue.catch().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
     * 拒绝 / Refusals: 条件 / conditions `this.closed`; 异常 / errors `new AppError('剪贴板代理正在关闭', 503)`.
     */
    const operation = this.stateQueue
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new AppError('剪贴板代理正在关闭', 503);
        const next = stateSchema.parse(change(this.state));
        await writeStore(this.file, next);
        this.state = next;
      });
    this.stateQueue = operation;
    return operation;
  }
  /**
   * 入口 / Entry: NativeClipboard.saveManaged.
   * 功能：把本层请求转交 `this.persist`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.persist` and propagates the provider result or rejection.
   * 输入 / Inputs: change: (items: z.infer<typeof managed>[]) => z.infer<typeof managed>[]
   * 输出 / Returns: `this.persist((state) => ({ ...state, managed: change(state.managed) }))`.
   * 副作用 / Effects: `this.persist`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private saveManaged(change: (items: z.infer<typeof managed>[]) => z.infer<typeof managed>[]) {
    return this.persist((state) => ({ ...state, managed: change(state.managed) }));
  }
  /**
   * 入口 / Entry: NativeClipboard.ensureDescendants.
   * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`NativeClipboard`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeClipboard`; this entry produces `void` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 处理：通过 `inline().finally`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline().finally`, `inline`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.hasDescendants || this.descendantChannel?.alive`; `!this.descendantStarting`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `this.descendantStarting`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async ensureDescendants() {
    if (!this.hasDescendants || this.descendantChannel?.alive) return;
    if (!this.descendantStarting) {
      /**
       * 入口 / Entry: NativeClipboard.ensureDescendants.callback@631.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `this.descendantChannel.close`; `create`; 更新 / updates `this.descendantChannel`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      this.descendantStarting = (async () => {
        await this.descendantChannel?.close();
        const create = this.options.descendants || nativeClipboardDescendants;
        this.descendantChannel = await create(
          this.controller(),
          this.state.owner,
          (request, broker) => {
            const task = this.descendantLaunch(request, broker);
            this.descendantTasks.add(task);
            return task.finally(() => {
              this.descendantTasks.delete(task);
            });
          },
          (error) => {
            this.error = error.message;
          },
        );
      })().finally(() => {
        this.descendantStarting = undefined;
      });
    }
    await this.descendantStarting;
  }
  /**
   * 入口 / Entry: NativeClipboard.stopDescendants.
   * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.descendantChannel`, `this.descendantLifetime`（`NativeClipboard`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `NativeClipboard`; the outcome is recorded in `this.descendantChannel`, `this.descendantLifetime`. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 处理：通过 `this.descendantLifetime.abort`, `this.descendantStarting.catch`, `this.descendantChannel.close`, `Promise.allSettled` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.descendantLifetime.abort`, `this.descendantStarting.catch`, `this.descendantChannel.close`, `Promise.allSettled`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.closed`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.descendantLifetime.abort`; `this.descendantChannel.close`; 更新 / updates `this.descendantChannel`, `this.descendantLifetime`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async stopDescendants() {
    this.descendantLifetime.abort();
    await this.descendantStarting?.catch(() => {});
    await this.descendantChannel?.close();
    await Promise.allSettled([...this.descendantTasks]);
    this.descendantChannel = undefined;
    if (!this.closed) this.descendantLifetime = new AbortController();
  }
  /**
   * 入口 / Entry: NativeClipboard.scan.
   * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`NativeClipboard`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeClipboard`; this entry produces `void` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 处理：通过 `this.options.maintenance`, `this.options.mutation`, `this.reconcile` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.options.maintenance`, `this.options.mutation`, `this.reconcile`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.options.maintenance?.()`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `this.error`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `this.options.mutation?.(-1);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.options.mutation?.(-1);`; these steps also apply to exceptional exits.
   */
  private async scan() {
    if (this.options.maintenance?.()) {
      this.error = '数据目录迁移维护中；已加载的进程策略继续生效';
      return;
    }
    this.options.mutation?.(1);
    try {
      await this.reconcile();
    } finally {
      this.options.mutation?.(-1);
    }
  }
  /**
   * 入口 / Entry: NativeClipboard.reconcile.
   * 功能：核对受管原生应用、可执行文件摘要与规则，修复仍可证明归属的策略状态。
   * Purpose: Reconciles managed native applications, executable digests and policies, repairing only provably owned state.
   * 设计：进程、策略与当前配置核对后才操作，原归属失配保留诊断证据，不接管同名或复用 PID。
   * Design: Process/policy/configuration proof precedes effects; mismatches preserve evidence instead of adopting same-name or reused-PID processes.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.state.settings.applications.map`; `known.set`; `this.processClaims.set`; `handled.add`; `handled.delete`; 更新 / updates `this.error`, `this.ready`, `this.inventory`, `libraryError`.
   * 拒绝 / Refusals: 条件 / conditions `!desired`; `observed.present && observed.active`; `observed.active`; 异常 / errors `new AppError('进程策略尚未停用')`; `new AppError('进程仍保留策略，但当前无法核对身份')`.
   * 收尾：退出 try 区域时始终执行 `if (current()) this.processClaims.delete(id); else handled.delete(id);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `if (current()) this.processClaims.delete(id); else handled.delete(id);`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `this.error = this.supported ? `原生剪贴板代理不可用：${(error as Error).message}` : '当前宿主机需要 Windows x64 才能使用此代理';`; `this.inventory = [];`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.error = this.supported ? `原生剪贴板代理不可用：${(error as Error).message}` : '当前宿主机需要 Windows x64 才能使用此代理';`; `this.inventory = [];`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async reconcile() {
    this.error = undefined;
    this.ready = false;
    let libraryError: string | undefined;
    try {
      await this.checkedAssets(false);
      this.inventory = await this.list();
      try {
        await this.checkedAssets(true);
        await this.ensureDescendants();
        this.ready = true;
      } catch (error) {
        libraryError = (error as Error).message;
        this.error = libraryError;
      }
    } catch (error) {
      this.error = this.supported
        ? `原生剪贴板代理不可用：${(error as Error).message}`
        : '当前宿主机需要 Windows x64 才能使用此代理';
      this.inventory = [];
      this.processes = this.state.managed.map((item) => ({
        ...item,
        state: 'error',
        error: this.error,
        blockedCopy: 0,
        blockedPaste: 0,
      }));
      return;
    }
    const selected = new Map(this.state.settings.applications.map((item) => [samePath(item.image), item]));
    const states: NativeClipboardProcessState[] = [];
    const handled = new Set<string>();
    const hashes = new Map<string, Promise<string>>();
    /**
     * 入口 / Entry: NativeClipboard.reconcile.check.
     * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，核对调用资格、输入或资源归属；本入口产生 `hashes.get(path)!` 供上层消费（`NativeClipboard`）。
     * Purpose: Checks admission, input or resource ownership in `NativeClipboard`; this entry produces `hashes.get(path)!` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
     * 处理：通过 `samePath`, `hashes.has`, `hashes.set`, `this.hashImage` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `samePath`, `hashes.has`, `hashes.set`, `this.hashImage`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `!hashes.has(path)`.
     * 输入 / Inputs: image: string
     * 输出 / Returns: `hashes.get(path)!`.
     * 副作用 / Effects: `hashes.set`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const check = (image: string) => {
      const path = samePath(image);
      if (!hashes.has(path)) hashes.set(path, this.hashImage(image));
      return hashes.get(path)!;
    };
    // A missing process-list entry is not proof of exit. A live DLL owns its
    // policy mapping, so retain the journal until that mapping is gone/disabled.
    const known = new Map<string, NativeClipboardProcess>(
      this.state.managed.map((item) => [key(item), item]),
    );
    for (const item of this.inventory)
      if (this.state.settings.enabled && selected.has(samePath(item.image)))
        known.set(key(item), { ...known.get(key(item)), ...item });
    for (const item of known.values()) {
      const id = key(item);
      if (this.processClaims.has(id)) continue;
      const claim: ProcessClaim = { kind: 'scan' };
      this.processClaims.set(id, claim);
      /**
       * 入口 / Entry: NativeClipboard.reconcile.current.
       * 功能：从当前输入或状态计算 `this.processClaims.get(id) === claim`，供调用方后续验证或使用。
       * Purpose: Computes `this.processClaims.get(id) === claim` from current inputs/state for the caller to validate or consume.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `this.processClaims.get(id) === claim`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const current = () => this.processClaims.get(id) === claim;
      /**
       * 入口 / Entry: NativeClipboard.reconcile.mutate.
       * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `operation` 供上层消费（`NativeClipboard`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeClipboard`; this entry produces `operation` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
       * 处理：通过 `current`, `work().finally`, `work` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `current`, `work().finally`, `work`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: work: () => Promise<T>
       * 输出 / Returns: `operation`.
       * 副作用 / Effects: 更新 / updates `claim.mutation`.
       * 拒绝 / Refusals: 条件 / conditions `!current()`; 异常 / errors `new AppError('此进程的扫描已让出给受控子进程接入', 409)`.
       */
      const mutate = <T>(work:
      /**
       * 中文功能：原生启动提交/拒绝通知，或 reconcile 串行执行的持久修改工作。
       * English: Native-launch commit/refusal notification or serialized persistent mutation work in reconciliation.
       * 所属 / Owner: NativeClipboard.reconcile.mutate.work.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       * 结果 / Result: `Promise<T>`.
       */
      () => Promise<T>) => {
        if (!current()) throw new AppError('此进程的扫描已让出给受控子进程接入', 409);
        const operation = work().finally(() => {
          if (claim.mutation === operation) claim.mutation = undefined;
        });
        claim.mutation = operation;
        return operation;
      };
      handled.add(id);
      let observed: z.infer<typeof statusSchema> = { present: false };
      try {
        const owned = this.state.managed.find((entry) => key(entry) === key(item));
        const source = owned?.inheritance?.application;
        const desired = this.state.settings.enabled
          ? selected.get(samePath(source?.image || item.image))
          : undefined;
        observed = await this.status(item);
        if (!current()) continue;
        // The native Job reservation is published before CreateProcess. It
        // also protects a child whose broker request has not reached Node yet.
        if (observed.reserved) {
          handled.delete(id);
          continue;
        }
        if (!desired) {
          if (observed.present && observed.active) {
            observed = await mutate(() =>
              this.apply(
                item,
                { copy: true, paste: true, files: true, sensitive: false, maxTextBytes: 1048576 },
                false,
              ),
            );
            if (!current()) continue;
            if (observed.active) throw new AppError('进程策略尚未停用');
          }
          if (this.state.managed.some((entry) => key(entry) === key(item))) {
            await mutate(() =>
              this.saveManaged((items) => (current() ? items.filter((entry) => key(entry) !== id) : items)),
            );
            if (!current()) continue;
          }
          states.push({
            ...item,
            state: 'disabled',
            blockedCopy: observed.present ? observed.blockedCopy : 0,
            blockedPaste: observed.present ? observed.blockedPaste : 0,
          });
          continue;
        }
        if (!this.inventory.some((entry) => key(entry) === key(item))) {
          if (!observed.present) {
            await mutate(() =>
              this.saveManaged((items) => (current() ? items.filter((entry) => key(entry) !== id) : items)),
            );
            if (!current()) continue;
            continue;
          }
          throw new AppError('进程仍保留策略，但当前无法核对身份');
        }
        if (item.bits !== 64 && (item.bits !== 32 || !this.hasX86))
          throw new AppError('此进程架构不受支持；需要运行包对应的 x64 或 x86 应用');
        if (source && source.sha256 !== desired.sha256)
          throw new AppError('继承规则的应用摘要已变化，请重新受控启动原应用');
        const digest = await check(item.image);
        if (!current()) continue;
        if (digest !== (source ? owned!.sha256 : desired.sha256))
          throw new AppError('应用文件已变化，请重新选择应用并保存规则');
        if (libraryError) throw new AppError(libraryError);
        if (
          !observed.present ||
          !observed.ready ||
          !observed.active ||
          observed.flags !== flags(desired.rule) ||
          observed.maximum !== desired.rule.maxTextBytes
        ) {
          if ((this.failed.get(key(item)) || 0) > Date.now())
            throw new AppError('等待重试原生附加；可刷新立即重试');
          if (!this.state.managed.some((entry) => key(entry) === key(item))) {
            if (this.state.managed.length >= 256) throw new AppError('受管进程已达到 256 个上限');
            // Persist ownership before attaching, including failed/pending calls.
            await mutate(() =>
              this.saveManaged((items) =>
                current() ? [...items, { ...item, sha256: desired.sha256 }] : items,
              ),
            );
            if (!current()) continue;
          }
          observed = await mutate(() => this.apply(item, desired.rule, true));
          if (!current()) continue;
        }
        if (
          !observed.present ||
          !observed.ready ||
          !observed.active ||
          !observed.compatible ||
          observed.flags !== flags(desired.rule) ||
          observed.maximum !== desired.rule.maxTextBytes
        )
          throw new AppError('进程代理与当前版本不一致，请重新启动该应用');
        this.failed.delete(key(item));
        states.push({
          ...item,
          state: 'enforced',
          blockedCopy: observed.blockedCopy,
          blockedPaste: observed.blockedPaste,
        });
      } catch (error) {
        if (!current()) continue;
        this.failed.set(key(item), Date.now() + 30000);
        states.push({
          ...item,
          state: 'error',
          error: (error as Error).message,
          blockedCopy: observed.present ? observed.blockedCopy : 0,
          blockedPaste: observed.present ? observed.blockedPaste : 0,
        });
      } finally {
        if (current()) this.processClaims.delete(id);
        else handled.delete(id);
      }
    }
    this.processes = [
      ...states,
      ...this.processes.filter(
        (item) => !handled.has(key(item)) && this.state.managed.some((entry) => key(entry) === key(item)),
      ),
    ];
    this.lastScan = new Date().toISOString();
    for (const id of this.failed.keys()) if (!known.has(id)) this.failed.delete(id);
  }
  /**
   * 入口 / Entry: NativeClipboard.descendantLaunch.
   * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`NativeClipboard`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeClipboard`; the calls and state transitions below complete the operation. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 处理：通过 `nativeClipboardDescendantRequest.parse`, `key`, `this.processClaims.get`, `this.processClaims.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `nativeClipboardDescendantRequest.parse`, `key`, `this.processClaims.get`, `this.processClaims.set`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.processClaims.get(id) === claim`.
   * 输入 / Inputs: value: NativeClipboardDescendantRequest; broker: NativeClipboardDescendantBroker
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.processClaims.set`; `this.processClaims.delete`.
   * 拒绝 / Refusals: 条件 / conditions `previous?.kind === 'adopt'`; `this.closed || generation.aborted || this.lifetime.signal.aborted || this.state.version !== version`; 异常 / errors `new AppError('此准确子进程已有受控接入', 503)`; `new AppError('等待同一进程的扫描期间子进程策略代际已改变', 503)`.
   * 收尾：退出 try 区域时始终执行 `if (this.processClaims.get(id) === claim) this.processClaims.delete(id);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `if (this.processClaims.get(id) === claim) this.processClaims.delete(id);`; these steps also apply to exceptional exits.
   */
  private async descendantLaunch(
    value: NativeClipboardDescendantRequest,
    broker: NativeClipboardDescendantBroker,
  ) {
    const request = nativeClipboardDescendantRequest.parse(value);
    const id = key(request.process);
    const previous = this.processClaims.get(id);
    if (previous?.kind === 'adopt') throw new AppError('此准确子进程已有受控接入', 503);
    const claim: ProcessClaim = { kind: 'adopt' };
    const generation = this.descendantLifetime.signal,
      version = this.state.version;
    // Synchronous registration precedes every asset/hash/helper await. A scan
    // gives way at its next read boundary; only already-issued writes/native
    // calls for this identity must settle, never the ancestor's global queue.
    this.processClaims.set(id, claim);
    try {
      await previous?.mutation?.catch(() => {});
      if (this.closed || generation.aborted || this.lifetime.signal.aborted || this.state.version !== version)
        throw new AppError('等待同一进程的扫描期间子进程策略代际已改变', 503);
      await this.descendantAdopt(request, broker);
    } finally {
      // nativeLaunch settles after real helper close and exact Job cleanup.
      if (this.processClaims.get(id) === claim) this.processClaims.delete(id);
    }
  }
  /**
   * 入口 / Entry: NativeClipboard.descendantAdopt.
   * 功能：验证父子进程、映像及位数，把允许的后代登记进原剪贴板策略域。
   * Purpose: Verifies parent/child processes, images and bitness before admitting an eligible descendant into the original policy domain.
   * 设计：父归属、规则和后代快照需同时成立；重查后才提交，失败不能把未知后代加入已有受管身份。
   * Design: Parent authority, policy and descendant snapshots must agree through rechecks; failure cannot attach unknown descendants to existing ownership.
   * 输入 / Inputs: value: NativeClipboardDescendantRequest; broker: NativeClipboardDescendantBroker
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.start`; 更新 / updates `this.inventory`, `this.processes`.
   * 拒绝 / Refusals: 条件 / conditions `child.pid === parent.pid || child.pid === this.pid`; `!ancestor || samePath(ancestor.image) !== samePath(parent.image) || ancestor.bits !== parent.bits`; `this.state.managed.some((entry) => key(entry) === key(child))`; 异常 / errors `new AppError('子进程归属身份无效', 503)`; `new AppError('子进程没有已保存的父进程归属', 503)`.
   * 收尾：退出 try 区域时始终执行 `this.options.mutation?.(-1);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.options.mutation?.(-1);`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `if (owned) this.processes = [ ...this.processes.filter((entry) => key(entry) !== key(child)), { ...inherited, state: 'error',…`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (owned) this.processes = [ ...this.processes.filter((entry) => key(entry) !== key(child)), { ...inherited, state: 'error',…`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async descendantAdopt(
    value: NativeClipboardDescendantRequest,
    broker: NativeClipboardDescendantBroker,
  ) {
    const request = nativeClipboardDescendantRequest.parse(value);
    const child = identity.parse(request.process),
      parent = identity.parse(request.parent);
    if (child.pid === parent.pid || child.pid === this.pid) throw new AppError('子进程归属身份无效', 503);
    const version = this.state.version;
    const generation = this.descendantLifetime.signal;
    const ancestor = this.state.managed.find((entry) => key(entry) === key(parent));
    if (!ancestor || samePath(ancestor.image) !== samePath(parent.image) || ancestor.bits !== parent.bits)
      throw new AppError('子进程没有已保存的父进程归属', 503);
    const source = ancestor.inheritance?.application || { image: ancestor.image, sha256: ancestor.sha256 };
    /**
     * 入口 / Entry: NativeClipboard.descendantAdopt.allowed.
     * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `selected` 供上层消费（`NativeClipboard`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeClipboard`; this entry produces `selected` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
     * 处理：通过 `this.options.maintenance`, `this.state.settings.applications.find`, `this.state.managed.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.options.maintenance`, `this.state.settings.applications.find`, `this.state.managed.some`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `selected`.
     * 副作用 / Effects: `this.state.settings.applications.find`.
     * 拒绝 / Refusals: 条件 / conditions `this.closed || this.lifetime.signal.aborted || generation.aborted`; `this.options.maintenance?.()`; `this.state.version !== version`; 异常 / errors `new AppError('子进程策略代际已关闭', 503)`; `new AppError('数据目录迁移维护中；子进程启动未授权', 409)`.
     */
    const allowed = () => {
      if (this.closed || this.lifetime.signal.aborted || generation.aborted)
        throw new AppError('子进程策略代际已关闭', 503);
      if (this.options.maintenance?.()) throw new AppError('数据目录迁移维护中；子进程启动未授权', 409);
      if (this.state.version !== version) throw new AppError('子进程启动期间剪贴板配置已改变', 409);
      const selected = this.state.settings.applications.find(
        (entry) => samePath(entry.image) === samePath(source.image),
      );
      if (
        !this.state.settings.enabled ||
        !selected ||
        selected.sha256 !== source.sha256 ||
        !this.state.managed.some((entry) => key(entry) === key(parent) && entry.sha256 === ancestor.sha256)
      )
        throw new AppError('子进程需要已保存并启用的父应用规则', 409);
      return selected;
    };
    const selected = allowed();
    if (this.state.managed.some((entry) => key(entry) === key(child)))
      throw new AppError('此子进程已有独立持久归属；拒绝替换为父应用继承规则', 503);
    this.options.mutation?.(1);
    let owned = false,
      loaded: z.infer<typeof nativeState> | undefined;
    const inherited = {
      ...child,
      sha256: request.sha256,
      inheritance: { application: source, parent: { pid: parent.pid, created: parent.created } },
    };
    /**
     * 入口 / Entry: NativeClipboard.descendantAdopt.sameIdentity.
     * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`NativeClipboard`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeClipboard`; the calls and state transitions below complete the operation. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
     * 处理：通过 `identity.parse`, `key`, `samePath` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `identity.parse`, `key`, `samePath`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: value: NativeClipboardProcess
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `key(actual) !== key(child) || samePath(actual.image) !== samePath(child.image) || actual.bits !== child.bits`; 异常 / errors `new AppError('子进程控制工具返回了其他身份', 503)`.
     */
    const sameIdentity = (value: NativeClipboardProcess) => {
      const actual = identity.parse(value);
      if (
        key(actual) !== key(child) ||
        samePath(actual.image) !== samePath(child.image) ||
        actual.bits !== child.bits
      )
        throw new AppError('子进程控制工具返回了其他身份', 503);
    };
    /**
     * 入口 / Entry: NativeClipboard.descendantAdopt.coherent.
     * 功能：从当前输入或状态计算 `value.present && value.ready && value.active && value.compatible && value.flags === flags(selected.rule) && value.maximum ===…`，供调用方后续验证或使用。
     * Purpose: Computes `value.present && value.ready && value.active && value.compatible && value.flags === flags(selected.rule) && value.maximum ===…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: value: z.infer<typeof statusSchema>
     * 输出 / Returns: `value.present && value.ready && value.active && value.compatible && value.flags === flags(selected.rule) && value.maximum ===…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const coherent = (value: z.infer<typeof statusSchema>) =>
      value.present &&
      value.ready &&
      value.active &&
      value.compatible &&
      value.flags === flags(selected.rule) &&
      value.maximum === selected.rule.maxTextBytes;
    try {
      await this.checkedAssets(true);
      if (!this.hasDescendants) throw new AppError('子进程提前继承需要第 5 版具备创建保留的策略通道', 503);
      if (
        (await this.hashImage(child.image)) !== request.sha256 ||
        (await this.hashImage(source.image)) !== source.sha256
      )
        throw new AppError('子进程或父应用文件摘要已变化', 409);
      if ((await this.imageBits(child.image)) !== child.bits)
        throw new AppError('子进程实际架构与映像不一致', 503);
      allowed();
      const result = await this.start(
        this.controller(child.bits),
        [
          'adopt',
          this.state.owner,
          win32.normalize(child.image),
          request.sha256,
          this.library(child.bits),
          String(flags(selected.rule)),
          String(selected.rule.maxTextBytes),
          request.id,
          String(broker.pid),
          broker.created,
          request.handles.process,
          request.handles.thread,
          request.handles.job,
          request.handles.file,
          request.suspended ? '1' : '0',
          String(parent.pid),
          parent.created,
        ],
        {
          /**
           * 入口 / Entry: NativeClipboard.descendantAdopt.prepared.
           * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`NativeClipboard`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeClipboard`; the calls and state transitions below complete the operation. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
           * 处理：通过 `sameIdentity`, `allowed`, `this.saveManaged` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `sameIdentity`, `allowed`, `this.saveManaged`; the branches below determine continuation, return or refusal.
           * 输入 / Inputs: value
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: `this.saveManaged`; 更新 / updates `owned`.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          prepared: async (value) => {
            sameIdentity(value);
            allowed();
            // A short storage queue protects concurrent child/grandchild journals.
            // It never waits for a loader or the ancestor's controlled-launch queue.
            await this.saveManaged((items) => {
              allowed();
              if (items.length >= 256 || items.some((entry) => key(entry) === key(child)))
                throw new AppError('子进程归属重复或受管进程达到上限', 503);
              return [...items, inherited];
            });
            owned = true;
            allowed();
          },
          /**
           * 入口 / Entry: NativeClipboard.descendantAdopt.attached.
           * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`NativeClipboard`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeClipboard`; the calls and state transitions below complete the operation. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
           * 处理：通过 `sameIdentity`, `allowed`, `this.state.managed.find`, `coherent` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `sameIdentity`, `allowed`, `this.state.managed.find`, `coherent`; the branches below determine continuation, return or refusal.
           * 输入 / Inputs: value; state
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: 更新 / updates `loaded`.
           * 拒绝 / Refusals: 条件 / conditions `!owned || journal?.sha256 !== request.sha256 || journal.inheritance?.application.sha256 !== source.sha256 || journal.inherita…`; `!coherent(observed)`; `(await this.hashImage(child.image)) !== request.sha256`; 异常 / errors `new AppError('子进程缺少已保存归属或已加载规则', 503)`; `new AppError('子进程真实共享策略复核失败', 503)`.
           */
          attached: async (value, state) => {
            sameIdentity(value);
            allowed();
            const journal = this.state.managed.find((entry) => key(entry) === key(child));
            if (
              !owned ||
              journal?.sha256 !== request.sha256 ||
              journal.inheritance?.application.sha256 !== source.sha256 ||
              journal.inheritance.parent.pid !== parent.pid ||
              journal.inheritance.parent.created !== parent.created ||
              !coherent(nativeState.parse(state))
            )
              throw new AppError('子进程缺少已保存归属或已加载规则', 503);
            const observed = await this.status(child);
            if (!coherent(observed)) throw new AppError('子进程真实共享策略复核失败', 503);
            await this.checkedAssets(true);
            if ((await this.hashImage(child.image)) !== request.sha256)
              throw new AppError('子进程文件摘要已变化', 409);
            allowed();
            loaded = nativeState.parse(observed);
          },
        },
        generation,
      );
      sameIdentity(result);
      allowed();
      if (!owned || !loaded) throw new AppError('子进程未返回已核对提交身份', 503);
      this.inventory = [...this.inventory.filter((entry) => key(entry) !== key(child)), child];
      this.processes = [
        ...this.processes.filter((entry) => key(entry) !== key(child)),
        {
          ...inherited,
          state: 'enforced',
          blockedCopy: loaded.blockedCopy,
          blockedPaste: loaded.blockedPaste,
        },
      ];
    } catch (error) {
      if (owned)
        this.processes = [
          ...this.processes.filter((entry) => key(entry) !== key(child)),
          {
            ...inherited,
            state: 'error',
            error: (error as Error).message,
            blockedCopy: loaded?.blockedCopy || 0,
            blockedPaste: loaded?.blockedPaste || 0,
          },
        ];
      throw error;
    } finally {
      this.options.mutation?.(-1);
    }
  }
  /**
   * 入口 / Entry: NativeClipboard.controlledLaunch.
   * 功能：按当前允许列表、映像摘要和位数建立原生应用受控启动流程。
   * Purpose: Creates controlled native launch from current allowlists, image digests and bitness.
   * 设计：维护、关闭或规则变更拒绝启动，原生协议回执完整后才登记运行；启动失败保持原清理能力。
   * Design: Maintenance/draining/policy changes refuse launch; complete native receipts precede publication and failure retains original cleanup authority.
   * 输入 / Inputs: input: Extract<z.infer<typeof nativeClipboardRequest>, { action: 'launch' }>
   * 输出 / Returns: `{ process: item, view: this.view() }`.
   * 副作用 / Effects: `this.start`; 更新 / updates `this.inventory`, `this.processes`, `this.error`, `this.ready`.
   * 拒绝 / Refusals: 条件 / conditions `this.state.managed.length >= 256`; `(await this.hashImage(selected.image)) !== selected.sha256`; `bits === 32 && !this.hasX86`; 异常 / errors `new AppError('受管进程已达到 256 个上限')`; `new AppError('应用文件摘要已变化，请重新选择', 409)`.
   * 失败处理：catch 分支执行 `if (owned) { this.processes = [ ...this.processes.filter((entry) => key(entry) !== key(owned!)), { ...owned, state: 'error', …`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (owned) { this.processes = [ ...this.processes.filter((entry) => key(entry) !== key(owned!)), { ...owned, state: 'error', …`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async controlledLaunch(
    input: Extract<z.infer<typeof nativeClipboardRequest>, { action: 'launch' }>,
  ) {
    /**
     * 入口 / Entry: NativeClipboard.controlledLaunch.allowed.
     * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `selected` 供上层消费（`NativeClipboard`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeClipboard`; this entry produces `selected` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
     * 处理：通过 `this.options.guard`, `this.options.maintenance`, `this.state.settings.applications.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.options.guard`, `this.options.maintenance`, `this.state.settings.applications.find`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `selected`.
     * 副作用 / Effects: `this.state.settings.applications.find`.
     * 拒绝 / Refusals: 条件 / conditions `this.closed || this.lifetime.signal.aborted`; `this.options.maintenance?.()`; `input.version !== this.state.version`; 异常 / errors `new AppError('剪贴板代理正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
     */
    const allowed = () => {
      if (this.closed || this.lifetime.signal.aborted) throw new AppError('剪贴板代理正在关闭', 503);
      this.options.guard?.();
      if (this.options.maintenance?.()) throw new AppError('数据目录迁移维护中', 409);
      if (input.version !== this.state.version) throw new AppError('剪贴板配置已改变，请刷新后重试', 409);
      const selected = this.state.settings.applications.find(
        (entry) => samePath(entry.image) === samePath(input.image),
      );
      if (!this.state.settings.enabled || !selected || selected.sha256 !== input.sha256)
        throw new AppError('受控启动需要已保存并启用的应用规则', 409);
      return selected;
    };
    const selected = allowed();
    if (this.state.managed.length >= 256) throw new AppError('受管进程已达到 256 个上限');
    await this.checkedAssets(true);
    if ((await this.hashImage(selected.image)) !== selected.sha256)
      throw new AppError('应用文件摘要已变化，请重新选择', 409);
    const bits = await this.imageBits(selected.image);
    if (bits === 32 && !this.hasX86) throw new AppError('此运行包未包含 32 位应用代理，请更新运行包');
    if (!this.hasEarly) throw new AppError('此运行包未包含应用 DLL/TLS 初始化前的策略代理，请更新运行包');
    await this.ensureDescendants();
    allowed();
    /**
     * 入口 / Entry: NativeClipboard.controlledLaunch.sameIdentity.
     * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `item` 供上层消费（`NativeClipboard`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeClipboard`; this entry produces `item` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
     * 处理：通过 `identity.parse`, `samePath` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `identity.parse`, `samePath`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: value: NativeClipboardProcess
     * 输出 / Returns: `item`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `samePath(item.image) !== samePath(selected.image) || item.bits !== bits || item.pid === this.pid`; 异常 / errors `new AppError('受控启动进程身份与已保存应用不一致', 503)`.
     */
    const sameIdentity = (value: NativeClipboardProcess) => {
      const item = identity.parse(value);
      if (samePath(item.image) !== samePath(selected.image) || item.bits !== bits || item.pid === this.pid)
        throw new AppError('受控启动进程身份与已保存应用不一致', 503);
      return item;
    };
    let owned: NativeClipboardProcess | undefined, loaded: z.infer<typeof nativeState> | undefined;
    try {
      const process = await this.start(
        this.controller(bits),
        [
          'launch',
          this.state.owner,
          win32.normalize(selected.image),
          selected.sha256,
          this.library(bits),
          String(flags(selected.rule)),
          String(selected.rule.maxTextBytes),
          randomUUID(),
          ...input.args,
        ],
        {
          /**
           * 入口 / Entry: NativeClipboard.controlledLaunch.prepared.
           * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`NativeClipboard`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeClipboard`; the calls and state transitions below complete the operation. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
           * 处理：通过 `allowed`, `sameIdentity`, `this.state.managed.some`, `this.inventory.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `allowed`, `sameIdentity`, `this.state.managed.some`, `this.inventory.some`; the branches below determine continuation, return or refusal.
           * 输入 / Inputs: value
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: `this.saveManaged`; 更新 / updates `owned`.
           * 拒绝 / Refusals: 条件 / conditions `this.state.managed.some((entry) => key(entry) === key(item)) || this.inventory.some((entry) => key(entry) === key(item))`; 异常 / errors `new AppError('受控启动返回了已有进程；拒绝复用其归属', 503)`.
           */
          prepared: async (value) => {
            allowed();
            const item = sameIdentity(value);
            if (
              this.state.managed.some((entry) => key(entry) === key(item)) ||
              this.inventory.some((entry) => key(entry) === key(item))
            )
              throw new AppError('受控启动返回了已有进程；拒绝复用其归属', 503);
            // The helper waits with a suspended primary thread and a kill-on-close
            // Job until this journal is durably saved, before loading any policy.
            await this.saveManaged((items) => [...items, { ...item, sha256: selected.sha256 }]);
            owned = item;
            allowed();
          },
          /**
           * 入口 / Entry: NativeClipboard.controlledLaunch.attached.
           * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`NativeClipboard`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeClipboard`; the calls and state transitions below complete the operation. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
           * 处理：通过 `allowed`, `sameIdentity`, `key`, `this.state.managed.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `allowed`, `sameIdentity`, `key`, `this.state.managed.some`; the branches below determine continuation, return or refusal.
           * 输入 / Inputs: value; state
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: 更新 / updates `loaded`.
           * 拒绝 / Refusals: 条件 / conditions `!owned || key(owned) !== key(item) || !this.state.managed.some( (entry) => key(entry) === key(item) && entry.sha256 === selec…`; `!coherent(nativeState.parse(state))`; `!coherent(observed)`; 异常 / errors `new AppError('受控启动缺少已保存的进程归属', 503)`; `new AppError('受控启动策略未加载完成', 503)`.
           */
          attached: async (value, state) => {
            allowed();
            const item = sameIdentity(value);
            if (
              !owned ||
              key(owned) !== key(item) ||
              !this.state.managed.some(
                (entry) => key(entry) === key(item) && entry.sha256 === selected.sha256,
              )
            )
              throw new AppError('受控启动缺少已保存的进程归属', 503);
            /**
             * 入口 / Entry: NativeClipboard.controlledLaunch.coherent.
             * 功能：从当前输入或状态计算 `value.present && value.ready && value.active && value.compatible && value.flags === flags(selected.rule) && value.maximum ===…`，供调用方后续验证或使用。
             * Purpose: Computes `value.present && value.ready && value.active && value.compatible && value.flags === flags(selected.rule) && value.maximum ===…` from current inputs/state for the caller to validate or consume.
             * 输入 / Inputs: value: z.infer<typeof statusSchema>
             * 输出 / Returns: `value.present && value.ready && value.active && value.compatible && value.flags === flags(selected.rule) && value.maximum ===…`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            const coherent = (value: z.infer<typeof statusSchema>) =>
              value.present &&
              value.ready &&
              value.active &&
              value.compatible &&
              value.flags === flags(selected.rule) &&
              value.maximum === selected.rule.maxTextBytes;
            if (!coherent(nativeState.parse(state))) throw new AppError('受控启动策略未加载完成', 503);
            const observed = await this.status(item);
            if (!coherent(observed)) throw new AppError('受控启动策略复核失败', 503);
            await this.checkedAssets(true);
            if ((await this.hashImage(selected.image)) !== selected.sha256)
              throw new AppError('应用文件摘要已变化，请重新选择', 409);
            allowed();
            loaded = nativeState.parse(observed);
          },
        },
        this.lifetime.signal,
      );
      const item = sameIdentity(process);
      if (!owned || key(owned) !== key(item) || !loaded)
        throw new AppError('受控启动未返回已核对的提交身份', 503);
      this.inventory = [...this.inventory.filter((entry) => key(entry) !== key(item)), item];
      this.processes = [
        ...this.processes.filter((entry) => key(entry) !== key(item)),
        {
          ...item,
          state: 'enforced',
          blockedCopy: loaded.blockedCopy,
          blockedPaste: loaded.blockedPaste,
        },
      ];
      this.error = undefined;
      this.ready = true;
      this.lastScan = new Date().toISOString();
      return { process: item, view: this.view() };
    } catch (error) {
      if (owned) {
        this.processes = [
          ...this.processes.filter((entry) => key(entry) !== key(owned!)),
          {
            ...owned,
            state: 'error',
            error: (error as Error).message,
            blockedCopy: loaded?.blockedCopy || 0,
            blockedPaste: loaded?.blockedPaste || 0,
          },
        ];
      }
      throw error;
    }
  }
  /**
   * 入口 / Entry: NativeClipboard.action.
   * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { this.options.guard?.(); if (this.options.maintenance?.()) throw new AppError('数据目录迁移维护中', 409); thi…` 供上层消费（`NativeClipboard`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NativeClipboard`; this entry produces `this.serial(async () => { this.options.guard?.(); if (this.options.maintenance?.()) throw new AppError('数据目录迁移维护中', 409); thi…` for its caller. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 处理：通过 `nativeClipboardRequest.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `nativeClipboardRequest.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: value: unknown
   * 输出 / Returns: `this.serial(async () => { this.options.guard?.(); if (this.options.maintenance?.()) throw new AppError('数据目录迁移维护中', 409); thi…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  action(value: unknown) {
    const input = nativeClipboardRequest.parse(value);
    /**
     * 入口 / Entry: NativeClipboard.action.callback@1167.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `await this.controlledLaunch(input)`; `{ image: item.image, sha256 }`; `this.view()`.
     * 副作用 / Effects: `this.stopDescendants`; `this.persist`; `this.failed.clear`.
     * 拒绝 / Refusals: 条件 / conditions `this.options.maintenance?.()`; `input.action === 'identify'`; `!item`; 异常 / errors `new AppError('数据目录迁移维护中', 409)`; `new AppError('进程身份已变化，请刷新应用列表', 409)`.
     * 收尾：退出 try 区域时始终执行 `this.options.mutation?.(-1);`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `this.options.mutation?.(-1);`; these steps also apply to exceptional exits.
     */
    return this.serial(async () => {
      this.options.guard?.();
      if (this.options.maintenance?.()) throw new AppError('数据目录迁移维护中', 409);
      this.options.mutation?.(1);
      try {
        if (input.action === 'launch') return await this.controlledLaunch(input);
        if (input.action === 'identify') {
          await this.checkedAssets(false);
          const item = (await this.list()).find(
            (item) => item.pid === input.pid && item.created === input.created,
          );
          if (!item) throw new AppError('进程身份已变化，请刷新应用列表', 409);
          if (item.bits !== 64 && (item.bits !== 32 || !this.hasX86))
            throw new AppError('此进程架构不受支持；需要运行包对应的 x64 或 x86 应用');
          const sha256 = await this.hashImage(item.image);
          const again = (await this.list()).find((entry) => key(entry) === key(item));
          if (!again || samePath(again.image) !== samePath(item.image))
            throw new AppError('进程身份已变化，请刷新应用列表', 409);
          return { image: item.image, sha256 };
        }
        if (input.action === 'configure') {
          if (input.version !== this.state.version) throw new AppError('剪贴板配置已改变，请刷新后重试', 409);
          if (input.settings.enabled) await this.checkedAssets(true);
          if (input.settings.enabled)
            for (const item of input.settings.applications)
              if ((await this.hashImage(item.image)) !== item.sha256)
                throw new AppError('应用文件摘要已变化，请重新选择', 409);
          this.options.guard?.();
          // Retire the old descendant generation before saving new rules.
          // Existing pending helpers cannot resume under the preceding version.
          await this.stopDescendants();
          await this.persist((state) => ({ ...state, version: state.version + 1, settings: input.settings }));
        }
        this.failed.clear();
        await this.reconcile();
        return this.view();
      } finally {
        this.options.mutation?.(-1);
      }
    });
  }
  /**
   * 入口 / Entry: NativeClipboard.close.
   * 功能：在管理 Windows 原生应用剪贴板规则与启动归属中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`NativeClipboard`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `NativeClipboard`; the outcome is recorded in `this.closed`. Module context: Owns Windows native application clipboard policies and launch identity, checking executable and managed process ownership.
   * 处理：通过 `this.lifetime.abort`, `this.stopDescendants`, `this.timer.close`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.lifetime.abort`, `this.stopDescendants`, `this.timer.close`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.lifetime.abort`; `this.stopDescendants`; `this.timer.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    this.lifetime.abort();
    await this.stopDescendants();
    await this.timer?.close();
    await this.queue.catch(() => {});
    await this.stateQueue.catch(() => {});
  }
}
