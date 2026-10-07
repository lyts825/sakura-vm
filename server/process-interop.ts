/**
 * 模块职责：协调 Windows 与客户机命令互操作，校验 EXE 的实际路径及启动归属。
 * Module purpose: Coordinates host/guest command interoperability, validating physical EXE paths and launch ownership.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hostProcess } from './host-process.ts';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { captureOperationCheck, withOperationCheck } from './operation-context.ts';
import { vmLifetime } from './vm-lifetime.ts';
import { withResourceContext } from './host-runtime/context.ts';

const programId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/);
const executable = z.string().max(512).regex(/^[a-zA-Z]:\\[^\x00-\x1f"<>|?*]+\.exe$/i);
export const processInteropInput = z.object({
  mode: z.enum(['status', 'allow', 'remove', 'install', 'disable']).default('status'),
  programId: programId.optional(),
  executable: executable.optional(),
  fixedArgs: z.array(z.string().max(4096)).max(32).optional(),
}).strict();
export const guestInteropRequest = z.object({
  vmId: z.uuid(), programId,
}).strict();

type Program = { executable: string; fixedArgs: string[]; sha256: string };
type Entry = { enabled: boolean; tokenHash?: string; programs: Record<string, Program> };
type State = Record<string, Entry>;
const stateSchema = z.record(z.uuid(), z.object({
  enabled: z.boolean(),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  programs: z.record(programId, z.object({
    executable, fixedArgs: z.array(z.string().max(4096)).max(32),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()),
}).strict());
/**
 * 入口 / Entry: file.
 * 功能：把本层请求转交 `join`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `join` and propagates the provider result or rejection.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `join(DATA, 'process-interop.json')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const file = () => join(DATA, 'process-interop.json');
/**
 * 入口 / Entry: digest.
 * 功能：在协调 Windows 与客户机命令互操作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(value).digest('hex')` 供上层消费（`process-interop.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `process-interop.ts`; this entry produces `createHash('sha256').update(value).digest('hex')` for its caller. Module context: Coordinates host/guest command interoperability, validating physical EXE paths and launch ownership.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: Buffer | string
 * 输出 / Returns: `createHash('sha256').update(value).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

/**
 * 入口 / Entry: checkedExecutable.
 * 功能：在协调 Windows 与客户机命令互操作中，核对调用资格、输入或资源归属；本入口产生 `hash.digest('hex')` 供上层消费（`process-interop.ts`）。
 * Purpose: Checks admission, input or resource ownership in `process-interop.ts`; this entry produces `hash.digest('hex')` for its caller. Module context: Coordinates host/guest command interoperability, validating physical EXE paths and launch ownership.
 * 处理：通过 `executable.parse`, `lstat().catch`, `lstat`, `info.isFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `executable.parse`, `lstat().catch`, `lstat`, `info.isFile`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: path: string
 * 输出 / Returns: `hash.digest('hex')`.
 * 副作用 / Effects: `executable.parse`; `createHash`; `createReadStream`; `hash.update`.
 * 拒绝 / Refusals: 条件 / conditions `!info?.isFile() || info.isSymbolicLink()`; `(await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()`; 异常 / errors `new AppError('需要普通 Windows EXE 文件', 400)`; `new AppError('不允许经符号链接或联接指向可执行文件', 400)`.
 */
async function checkedExecutable(path: string) {
  executable.parse(path);
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new AppError('需要普通 Windows EXE 文件', 400);
  if ((await realpath(path)).toLowerCase() !== resolve(path).toLowerCase())
    throw new AppError('不允许经符号链接或联接指向可执行文件', 400);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * 入口 / Entry: sameToken.
 * 功能：在协调 Windows 与客户机命令互操作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))` 供上层消费（`process-interop.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `process-interop.ts`; this entry produces `false` / `timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))` for its caller. Module context: Coordinates host/guest command interoperability, validating physical EXE paths and launch ownership.
 * 处理：通过 `inline.test`, `timingSafeEqual` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.test`, `timingSafeEqual`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!expected || !actual || !/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(actual)`.
 * 输入 / Inputs: expected: string | undefined; actual: string | undefined
 * 输出 / Returns: `false`; `timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function sameToken(expected: string | undefined, actual: string | undefined) {
  if (!expected || !actual || !/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(actual))
    return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

/**
 * 入口 / Entry: runProgram.
 * 功能：在协调 Windows 与客户机命令互操作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ exitCode: result.code, stdout: result.stdout, stderr: result.stderr }` 供上层消费（`process-interop.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `process-interop.ts`; this entry produces `{ exitCode: result.code, stdout: result.stdout, stderr: result.stderr }` for its caller. Module context: Coordinates host/guest command interoperability, validating physical EXE paths and launch ownership.
 * 处理：通过 `signal.throwIfAborted`, `captureOperationCheck`, `withOperationCheck` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `captureOperationCheck`, `withOperationCheck`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `process.env[name] !== undefined`.
 * 输入 / Inputs: program: Program; signal: AbortSignal optional
 * 输出 / Returns: `{ exitCode: result.code, stdout: result.stdout, stderr: result.stderr }`.
 * 副作用 / Effects: 更新 / updates `env[name]`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
async function runProgram(program: Program, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const authority = captureOperationCheck();
  const env: NodeJS.ProcessEnv = {};
    for (const name of ['SystemRoot', 'WINDIR', 'Path', 'PATH', 'TEMP', 'TMP', 'USERPROFILE']) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
  const result = await withOperationCheck(async () => {
    // Check the registered image after process-budget admission, not before an arbitrarily long queue.
    if (await checkedExecutable(program.executable) !== program.sha256)
      throw new AppError('Windows 程序已改变，请重新登记', 409);
    await authority();
  }, () => hostProcess('process-interop', program.executable, program.fixedArgs,
    { signal, env, timeout: 30000, maxBuffer: 128 * 1024 }));
  return { exitCode: result.code, stdout: result.stdout, stderr: result.stderr };
}

export class ProcessInterop {
  private stateValue?: State;
  private loading?: Promise<State>;
  private writes = Promise.resolve();
  private busy = new Set<string>();

  /**
   * 入口 / Entry: ProcessInterop.constructor.
   * 功能：建立 ProcessInterop 的协调 Windows 与客户机命令互操作上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProcessInterop context for this module's responsibility: Coordinates host/guest command interoperability, validating physical EXE paths and launch ownership. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; port: number; allowed: () => void default=() => {}; execute: typeof runProgram default=runProgram
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines, private port: number,
    private allowed: () => void = () => {}, private execute: typeof runProgram = runProgram) {}

  /**
   * 入口 / Entry: ProcessInterop.state.
   * 功能：在协调 Windows 与客户机命令互操作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.stateValue ||= await (this.loading ||= readStore<State>(file(), () => ({})) .then((value) => stateSchema.parse(value)))` 供上层消费（`ProcessInterop`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProcessInterop`; this entry produces `this.stateValue ||= await (this.loading ||= readStore<State>(file(), () => ({})) .then((value) => stateSchema.parse(value)))` for its caller. Module context: Coordinates host/guest command interoperability, validating physical EXE paths and launch ownership.
   * 处理：通过 `readStore().then`, `readStore`, `file` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readStore().then`, `readStore`, `file`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.stateValue ||= await (this.loading ||= readStore<State>(file(), () => ({})) .then((value) => stateSchema.parse(value)))`.
   * 副作用 / Effects: 更新 / updates `this.stateValue`, `this.loading`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async state() {
    return this.stateValue ||= await (this.loading ||= readStore<State>(file(), () => ({}))
      .then((value) => stateSchema.parse(value)));
  }

  /**
   * 入口 / Entry: ProcessInterop.mutate.
   * 功能：在协调 Windows 与客户机命令互操作中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.writes`（`ProcessInterop`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProcessInterop`; the outcome is recorded in `this.writes`. Module context: Coordinates host/guest command interoperability, validating physical EXE paths and launch ownership.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: change: (state: State) => void
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async mutate(change: (state: State) => void) {
    /**
     * 入口 / Entry: ProcessInterop.mutate.callback@93.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.writes.catch().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.writes.catch().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.stateValue`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const write = this.writes.catch(() => {}).then(async () => {
      const next = structuredClone(await this.state());
      change(next);
      await writeStore(file(), next);
      this.stateValue = next;
    });
    this.writes = write;
    await write;
  }

  /**
   * 入口 / Entry: ProcessInterop.guard.
   * 功能：在协调 Windows 与客户机命令互操作中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`ProcessInterop`）。
   * Purpose: Checks admission, input or resource ownership in `ProcessInterop`; the calls and state transitions below complete the operation. Module context: Coordinates host/guest command interoperability, validating physical EXE paths and launch ownership.
   * 处理：通过 `this.allowed`, `this.machines.get`, `this.machines.requireUnlocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.allowed`, `this.machines.get`, `this.machines.requireUnlocked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private guard(id: string) {
    this.allowed();
    this.machines.get(id);
    this.machines.requireUnlocked(id);
  }

  /**
   * 入口 / Entry: ProcessInterop.action.
   * 功能：在允许列表与原配置约束下执行 Windows EXE 或管理其互操作授权。
   * Purpose: Executes or manages Windows EXE interoperability under allowlists and captured configuration.
   * 设计：实际路径、联接及映像摘要先检查，客户机请求不能通过任意环境扩大宿主权限；创建后失败仍收尾原参与者。
   * Design: Physical paths/junctions/image digests are checked and guest environments cannot widen host grants; post-spawn failure cleans original participants.
   * 输入 / Inputs: id: string; options: unknown; phase: 'check' | 'run'; signal: AbortSignal optional
   * 输出 / Returns: `{ ready: process.platform === 'win32', executed: false, enabled: entry.enabled, installed: !!entry.tokenHash, programs, ...(p…`; `{ ready: true, executed: phase === 'run', programId: input.programId, sha256 }`; `{ ready: true, executed: phase === 'run', programId: input.programId }`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `this.machines.exec`; `this.machines.writeGuestFile`.
   * 拒绝 / Refusals: 条件 / conditions `process.platform !== 'win32'`; `input.mode === 'allow'`; `!input.programId || !input.executable`; 异常 / errors `new AppError('仅支持 Windows 宿主机', 409)`; `new AppError('需要 programId 和 executable', 400)`.
   */
  async action(id: string, options: unknown, phase: 'check' | 'run', signal?: AbortSignal) {
    this.guard(id);
    const input = processInteropInput.parse(options);
    const entry = (await this.state())[id] || { enabled: false, programs: {} };
    const programs = Object.entries(entry.programs).map(([name, program]) => ({
      programId: name, executable: program.executable, fixedArgs: program.fixedArgs,
      sha256: program.sha256,
    }));
    if (input.mode === 'status')
      return { ready: process.platform === 'win32', executed: false,
        enabled: entry.enabled, installed: !!entry.tokenHash, programs,
        ...(process.platform !== 'win32' ? { reason: '仅支持 Windows 宿主机' } : {}),
        message: '先登记固定 EXE，再启动实例并安装 sakura-win；在 Linux 中运行 sakura-win <programId>。' };
    if (process.platform !== 'win32') throw new AppError('仅支持 Windows 宿主机', 409);
    if (input.mode === 'allow') {
      if (!input.programId || !input.executable) throw new AppError('需要 programId 和 executable', 400);
      const sha256 = await checkedExecutable(input.executable);
      if (phase === 'run') {
        await this.mutate((state) => {
          const target = state[id] ||= { enabled: false, programs: {} };
          target.programs[input.programId!] = { executable: input.executable!,
            fixedArgs: input.fixedArgs || [], sha256 };
        });
      }
      return { ready: true, executed: phase === 'run', programId: input.programId, sha256 };
    }
    if (input.mode === 'remove') {
      if (!input.programId) throw new AppError('需要 programId', 400);
      if (!entry.programs[input.programId]) throw new AppError('程序尚未登记', 404);
      if (phase === 'run') await this.mutate((state) => {
        if (!state[id]?.programs[input.programId!]) throw new AppError('程序尚未登记', 404);
        delete state[id].programs[input.programId!];
      });
      return { ready: true, executed: phase === 'run', programId: input.programId };
    }
    if (input.mode === 'disable') {
      if (phase === 'run') await this.mutate((state) => {
        const target = state[id] ||= { enabled: false, programs: {} };
        target.enabled = false;
        delete target.tokenHash;
      });
      return { ready: true, executed: phase === 'run', enabled: phase === 'run' ? false : entry.enabled };
    }
    if (!programs.length) throw new AppError('请先登记 Windows 程序', 409);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
    if (phase === 'check') {
      const check = await this.machines.exec(id, 'command -v curl; command -v jq', 10000, signal);
      return { ready: check.code === 0, executed: false, installed: !!entry.tokenHash,
        reason: check.code === 0 ? undefined : '客户机需要 curl 和 jq；run 会尝试安装。' };
    }
    const check = await this.machines.exec(id,
      'command -v curl >/dev/null && command -v jq >/dev/null || { if command -v apk >/dev/null; then apk add --no-cache curl jq; elif command -v apt-get >/dev/null; then apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y curl jq; else exit 1; fi; }',
      180000, signal);
    if (check.code !== 0) throw new AppError('安装客户机 curl/jq 失败：' + check.stderr.slice(0, 1000), 409);
    const token = randomBytes(32).toString('hex');
    const helper = [
      '#!/bin/sh', 'set -eu',
      'if [ "$#" -ne 1 ]; then echo "usage: sakura-win <programId>" >&2; exit 2; fi',
      'id="$1"',
      'case "$id" in ""|*[!a-zA-Z0-9_-]*) echo "invalid programId" >&2; exit 2;; esac',
      'payload=$(printf \'{"vmId":"' + id + '","programId":"%s"}\' "$id")',
      'result=$(printf %s "$payload" | curl --config /etc/sakura/interop.curl --noproxy "*" --fail-with-body --silent --show-error --max-time 35 -H "Host: localhost:' + this.port + '" -H "Content-Type: application/json" --data-binary @- http://10.0.2.2:' + this.port + '/api/guest/interop)',
      'printf %s "$result" | jq -rj ".stdout // empty"',
      'printf %s "$result" | jq -rj ".stderr // empty" >&2',
      'code=$(printf %s "$result" | jq -r ".exitCode")',
      'exit "$code"',
      '',
    ].join('\n');
    const mkdir = await this.machines.exec(id, 'install -d -m 700 /etc/sakura', 10000, signal);
    if (mkdir.code !== 0) throw new AppError('创建客户机配置目录失败', 409);
    await this.machines.writeGuestFile(id, '/etc/sakura/interop.curl',
      'header = "X-Sakura-Guest-Token: ' + token + '"\n');
    await this.machines.writeGuestFile(id, '/usr/local/bin/sakura-win', helper);
    const chmod = await this.machines.exec(id,
      'chmod 600 /etc/sakura/interop.curl && chmod 755 /usr/local/bin/sakura-win', 10000, signal);
    if (chmod.code !== 0) throw new AppError('设置客户机调用程序权限失败', 409);
    /**
     * 入口 / Entry: ProcessInterop.action.callback@185.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.mutate）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.mutate).
     * 输入 / Inputs: state
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `state[id]`, `target.enabled`, `target.tokenHash`.
     * 拒绝 / Refusals: 条件 / conditions `!Object.keys(target.programs).length`; 异常 / errors `new AppError('请先登记 Windows 程序', 409)`.
     */
    await this.mutate((state) => {
      const target = state[id] ||= { enabled: false, programs: {} };
      if (!Object.keys(target.programs).length) throw new AppError('请先登记 Windows 程序', 409);
      target.enabled = true;
      target.tokenHash = digest(token);
    });
    return { ready: true, executed: true, enabled: true, installed: true,
      command: 'sakura-win <programId>' };
  }

  /**
   * 入口 / Entry: ProcessInterop.guest.
   * 功能：在协调 Windows 与客户机命令互操作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ programId: name, ...await withResourceContext(identity, () => withOperationCheck(check, () => this.execute(program, executi…` 供上层消费（`ProcessInterop`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProcessInterop`; this entry produces `{ programId: name, ...await withResourceContext(identity, () => withOperationCheck(check, () => this.execute(program, executi…` for its caller. Module context: Coordinates host/guest command interoperability, validating physical EXE paths and launch ownership.
   * 处理：通过 `guestInteropRequest.parse`, `this.guard`, `this.machines.live.get`, `vmLifetime` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `guestInteropRequest.parse`, `this.guard`, `this.machines.live.get`, `vmLifetime`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: request: unknown; token: string | undefined; signal: AbortSignal optional
   * 输出 / Returns: `{ programId: name, ...await withResourceContext(identity, () => withOperationCheck(check, () => this.execute(program, executi…`.
   * 副作用 / Effects: `AbortSignal.any`; `this.busy.add`; `this.busy.delete`.
   * 拒绝 / Refusals: 条件 / conditions `!live`; `!entry?.enabled || !sameToken(entry.tokenHash, digest(token || ''))`; `this.machines.state(vmId) !== 'running'`; 异常 / errors `new AppError('实例未运行', 409)`; `new AppError('客户机调用未授权', 403)`.
   * 收尾：退出 try 区域时始终执行 `this.busy.delete(vmId);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.busy.delete(vmId);`; these steps also apply to exceptional exits.
   */
  async guest(request: unknown, token: string | undefined, signal?: AbortSignal) {
    const { vmId, programId: name } = guestInteropRequest.parse(request);
    this.guard(vmId);
    const live = this.machines.live.get(vmId);
    if (!live) throw new AppError('实例未运行', 409);
    const lifetime = vmLifetime(vmId, live), identity = lifetime.capture();
    const executionSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    const entry = (await this.state())[vmId];
    if (!entry?.enabled || !sameToken(entry.tokenHash, digest(token || '')))
      throw new AppError('客户机调用未授权', 403);
    if (this.machines.state(vmId) !== 'running') throw new AppError('实例未运行', 409);
    if (!entry.programs[name]) throw new AppError('程序未获准调用', 403);
    const program = structuredClone(entry.programs[name]);
    const fingerprint = JSON.stringify(program);
    /**
     * 入口 / Entry: ProcessInterop.guest.check.
     * 功能：在协调 Windows 与客户机命令互操作中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`ProcessInterop`）。
     * Purpose: Checks admission, input or resource ownership in `ProcessInterop`; the calls and state transitions below complete the operation. Module context: Coordinates host/guest command interoperability, validating physical EXE paths and launch ownership.
     * 处理：通过 `this.guard`, `sameToken`, `digest`, `this.machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.guard`, `sameToken`, `digest`, `this.machines.live.get`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!current?.enabled || !sameToken(current.tokenHash, digest(token || '')) || JSON.stringify(current.programs[name]) !== fingerp…`; `this.machines.live.get(vmId) !== live || this.machines.state(vmId) !== 'running'`; 异常 / errors `new AppError('客户机程序授权已改变', 403, 'INTEROP_AUTHORITY_CHANGED')`; `new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
     */
    const check = async () => {
      this.guard(vmId);
      // stateValue is published only after writeStore confirms the atomic write. Never re-enter its writer queue.
      const current = this.stateValue?.[vmId];
      if (!current?.enabled || !sameToken(current.tokenHash, digest(token || '')) ||
          JSON.stringify(current.programs[name]) !== fingerprint)
        throw new AppError('客户机程序授权已改变', 403, 'INTEROP_AUTHORITY_CHANGED');
      if (this.machines.live.get(vmId) !== live || this.machines.state(vmId) !== 'running')
        throw new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      lifetime.assert(identity);
    };
    await check();
    if (this.busy.has(vmId)) throw new AppError('实例已有程序在运行', 409);
    this.busy.add(vmId);
    try {
      return { programId: name, ...await withResourceContext(identity, () =>
        withOperationCheck(check, () => this.execute(program, executionSignal))) };
    }
    finally { this.busy.delete(vmId); }
  }
}
