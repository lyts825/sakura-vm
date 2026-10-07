/**
 * 模块职责：维护项目协议运行票据与双向流，核对原项目配置、账户及客户机启动身份。
 * Module purpose: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Duplex, type Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { projectVersion, type Project } from './project-config.ts';
import { projectPrivateValues } from './workspaces.ts';
import { AppError } from '../shared/errors.ts';
import { vmDir } from './paths.ts';
import { quote } from './shell.ts';
import { readStore, writeStore } from './local-store.ts';
import { projectTerminalsFor, type TerminalService as ProjectTerminals } from './terminal-backend.ts';
import { ProjectRunScopes, type ProjectTaskAdmissionOptions } from './project-run-scope.ts';
import { ProjectIdentities, projectIdentitySchema, projectIdentityRunSchema, projectIdentityPayload, type ProjectIdentityExecution, type ProjectIdentityRun } from './project-identity.ts';
import { guestTaskControlPlan, guestTaskControlPaths, cleanupGuestTaskPlan } from './guest-task.ts';
import { projectIdSchema } from './project-catalog.ts';
import { redactValues } from './secrets.ts';
import { ProjectSessionLifetime } from './project-session-lifetime.ts';

const hash = z.string().regex(/^[a-f0-9]{64}$/), uuidFile = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/;
const same = isDeepStrictEqual;
/**
 * 入口 / Entry: changed.
 * 功能：从当前输入或状态计算 `new AppError('协议流原项目、配置、账号或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('协议流原项目、配置、账号或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('协议流原项目、配置、账号或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const changed = () => new AppError('协议流原项目、配置、账号或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
/**
 * 入口 / Entry: cloneProject.
 * 功能：把本层请求转交 `structuredClone`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `structuredClone` and propagates the provider result or rejection.
 * 输入 / Inputs: project: Project
 * 输出 / Returns: `Object.defineProperty(structuredClone(project), '_workspace', { value: project._workspace, enumerable: false, })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const cloneProject = (project: Project) => Object.defineProperty(structuredClone(project), '_workspace', {
  value: project._workspace, enumerable: false,
});
/**
 * 入口 / Entry: immutable.
 * 功能：从当前输入或状态计算 `metadata`，供调用方后续验证或使用。
 * Purpose: Computes `metadata` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: record: ProjectProtocolStreamRecord
 * 输出 / Returns: `metadata`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function immutable(record: ProjectProtocolStreamRecord) {
  const { phase: _phase, issued: _issued, run: _run, closure: _closure, ...metadata } = record;
  return metadata;
}
export const projectProtocolStreamSchema = z.object({ version: z.literal(1), vmId: z.uuid(), projectId: projectIdSchema,
  kind: z.enum(['lsp', 'dap']), runId: z.uuid(), bootId: z.uuid(), controlToken: z.uuid(), configSha256: hash,
  identity: projectIdentitySchema, sha256: hash, timeoutMs: z.number().int().min(1000).max(24 * 60 * 60 * 1000),
  phase: z.enum(['intent', 'active', 'review', 'closed']), issued: z.boolean(), run: projectIdentityRunSchema.nullable(),
  closure: z.object({ reason: z.enum(['scope-stopped', 'guest-reboot', 'never-issued']), bootId: z.uuid() }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (value.identity.projectId !== value.projectId || value.identity.phase !== 'active' ||
      value.phase === 'active' && (!value.issued || !value.run || value.run.phase !== 'active') ||
      (value.phase === 'closed') !== Boolean(value.closure) || value.closure && (
        value.closure.reason === 'guest-reboot' ? value.closure.bootId === value.bootId : value.closure.bootId !== value.bootId) ||
      value.run && !matches(value, value.run)) context.addIssue({ code: 'custom', message: '协议流原完整运行归属不符' });
});
export type ProjectProtocolStreamRecord = z.infer<typeof projectProtocolStreamSchema>;
/**
 * 入口 / Entry: sessionReceipt.
 * 功能：从当前输入或状态计算 `({ ...immutable(record), run: record.run })`，供调用方后续验证或使用。
 * Purpose: Computes `({ ...immutable(record), run: record.run })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: record: ProjectProtocolStreamRecord
 * 输出 / Returns: `({ ...immutable(record), run: record.run })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const sessionReceipt = (record: ProjectProtocolStreamRecord) => ({ ...immutable(record), run: record.run });
export type ProjectProtocolCapture = { projectId: string; project: Project; resolved: Project; configSha256: string;
  live: object; bootId: string; signal: AbortSignal };
/**
 * 入口 / Entry: matches.
 * 功能：从当前输入或状态计算 `run.mode === 'inherit-current' && run.projectId === record.projectId && run.runId === record.runId && run.bootId === record.b…`，供调用方后续验证或使用。
 * Purpose: Computes `run.mode === 'inherit-current' && run.projectId === record.projectId && run.runId === record.runId && run.bootId === record.b…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: record: Pick<ProjectProtocolStreamRecord, 'identity' | 'runId' | 'bootId' | 'projectId'>; run: ProjectIdentityRun
 * 输出 / Returns: `run.mode === 'inherit-current' && run.projectId === record.projectId && run.runId === record.runId && run.bootId === record.b…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function matches(record: Pick<ProjectProtocolStreamRecord, 'identity' | 'runId' | 'bootId' | 'projectId'>, run: ProjectIdentityRun) {
  const identity = record.identity;
  return run.mode === 'inherit-current' && run.projectId === record.projectId && run.runId === record.runId &&
    run.bootId === record.bootId && run.cgroupName === 'sakura-task-' + record.runId &&
    run.registryId === identity.registryId && run.identityId === identity.identityId && run.revision === identity.revision &&
    run.namespace === (identity.networkIsolation === 'private' ? 'sk-' + record.projectId : '');
}

/** Only the first bounded frame is consumed here. The unread protocol channel
 * is inherited independently as fd3; C accepts frame+EOF before its UID drop. */
/**
 * 入口 / Entry: projectProtocolRelaySource.
 * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``import fcntl,hashlib,json,os,selectors,signal,stat,struct,subprocess,time request=json.loads(${JSON.stringify(JSON.stringify…` 供上层消费（`project-protocol-stream.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-protocol-stream.ts`; this entry produces ``import fcntl,hashlib,json,os,selectors,signal,stat,struct,subprocess,time request=json.loads(${JSON.stringify(JSON.stringify…` for its caller. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
 * 处理：通过 `hash.parse`, `command.includes`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `hash.parse`, `command.includes`, `changed`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: sha256: string; command: string
 * 输出 / Returns: ``import fcntl,hashlib,json,os,selectors,signal,stat,struct,subprocess,time request=json.loads(${JSON.stringify(JSON.stringify…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `Buffer.byteLength(command) > 8192 || command.includes('\0')`; 异常 / errors `changed()`.
 */
export function projectProtocolRelaySource(sha256: string, command: string) {
  hash.parse(sha256);
  if (Buffer.byteLength(command) > 8192 || command.includes('\0')) throw changed();
  return `import fcntl,hashlib,json,os,selectors,signal,stat,struct,subprocess,time
request=json.loads(${JSON.stringify(JSON.stringify({ sha256, command }))})
def refuse():raise ValueError('protected protocol stream frame refused')
def frame():
 info=os.fstat(0);flags=fcntl.fcntl(0,fcntl.F_GETFL)
 if flags&os.O_ACCMODE==os.O_WRONLY or not (stat.S_ISFIFO(info.st_mode) or stat.S_ISSOCK(info.st_mode)):refuse()
 deadline=time.monotonic()+8;fcntl.fcntl(0,fcntl.F_SETFL,flags|os.O_NONBLOCK)
 try:
  with selectors.DefaultSelector() as poller:
   poller.register(0,selectors.EVENT_READ)
   def exact(size):
    data=b''
    while len(data)<size:
     remaining=deadline-time.monotonic()
     if remaining<=0 or not poller.select(remaining):refuse()
     try:part=os.read(0,min(65536,size-len(data)))
     except (BlockingIOError,InterruptedError):continue
     if not part:refuse()
     data+=part
    return data
   header=exact(32);magic,version,flags2,body,count,script,reserved=struct.unpack('<8s6I',header)
   if magic!=b'SKIDP001' or version!=1 or flags2!=2 or reserved or body>131040 or not 0<script<=65536 or script>body or count>128:refuse()
   payload=header+exact(body)
   if hashlib.sha256(payload).hexdigest()!=request['sha256']:refuse()
   return payload
 finally:fcntl.fcntl(0,fcntl.F_SETFL,flags)
payload=frame()
environment={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/','USER':'root','LOGNAME':'root','LANG':'C','LC_ALL':'C'}
os.dup2(0,3)
try:child=subprocess.Popen(['/bin/sh','-ec',request['command']],stdin=subprocess.PIPE,stdout=None,stderr=None,env=environment,close_fds=True,pass_fds=(3,))
finally:os.close(3)
def cancelled(signum,_frame):
 if child.poll() is None:child.send_signal(signum)
 raise InterruptedError('protocol stream cancelled')
try:
 for signum in [signal.SIGHUP,signal.SIGTERM,signal.SIGINT,signal.SIGQUIT]:signal.signal(signum,cancelled)
 os.set_blocking(child.stdin.fileno(),False);deadline=time.monotonic()+8
 with selectors.DefaultSelector() as poller:
  poller.register(child.stdin,selectors.EVENT_WRITE);view=memoryview(payload)
  while view:
   remaining=deadline-time.monotonic()
   if remaining<=0 or not poller.select(remaining):refuse()
   try:count=os.write(child.stdin.fileno(),view)
   except (BlockingIOError,InterruptedError):continue
   if count<=0:refuse()
   view=view[count:]
 child.stdin.close();code=child.wait();raise SystemExit(code if code>=0 else 128-code)
finally:
 if not child.stdin.closed:child.stdin.close()
 if child.poll() is None:
  child.terminate()
  try:child.wait(timeout=3)
  except subprocess.TimeoutExpired:
   child.kill();child.wait(timeout=3)
`;
}
/**
 * 入口 / Entry: projectProtocolRelayCommand.
 * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；本入口产生 `'exec /usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C ' + '/usr/bin/python3 …` 供上层消费（`project-protocol-stream.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-protocol-stream.ts`; this entry produces `'exec /usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C ' + '/usr/bin/python3 …` for its caller. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
 * 处理：通过 `quote`, `projectProtocolRelaySource` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `quote`, `projectProtocolRelaySource`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: sha256: string; command: string
 * 输出 / Returns: `'exec /usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C ' + '/usr/bin/python3 …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectProtocolRelayCommand(sha256: string, command: string) {
  return 'exec /usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C ' +
    '/usr/bin/python3 -I -S -u -c ' + quote(projectProtocolRelaySource(sha256, command));
}
type Wire = Duplex & { stderr?: Readable;
/**
 * 签名 / Signature: Wire.close.
 * 功能：为维护项目协议运行票据与双向流声明 close 的输入与结果契约，所属容器为 Wire。
 * Purpose: Declares the input/result contract for close in Wire. Module responsibility: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: void.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
close?: () => void };

/** SSH readiness does not retain its connect-time abort listener. Bound the
 * subsequent exec acknowledgment independently and discard late channels. */
/**
 * 入口 / Entry: openProjectProtocolChannel.
 * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await new Promise<{ wire: Wire; close: () => void }>((resolve, reject) => { let settled = false; const clear = () => { clearT…` 供上层消费（`project-protocol-stream.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-protocol-stream.ts`; this entry produces `await new Promise<{ wire: Wire; close: () => void }>((resolve, reject) => { let settled = false; const clear = () => { clearT…` for its caller. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
 * 处理：通过 `signal.throwIfAborted`, `machines.connect`, `client.destroy` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `machines.connect`, `client.destroy`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: machines: Pick<Machines, 'connect' | 'live' | 'state'>; id: string; command: string; live: object; signal: AbortSignal; beforeLaunch: () => Promise<void>; setupTimeoutMs: default=10000
 * 输出 / Returns: Promise<{ wire: Wire; close: () => void }>；结果来自 / values from `await new Promise<{ wire: Wire; close: () => void }>((resolve, reject) => { let settled = false; const clear = () => { clearT…`.
 * 副作用 / Effects: `machines.connect`; `client.destroy`.
 * 拒绝 / Refusals: 异常 / errors `error`.
 * 失败处理：catch 分支执行 `client.destroy();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `client.destroy();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function openProjectProtocolChannel(machines: Pick<Machines, 'connect' | 'live' | 'state'>,
  id: string, command: string, live: object, signal: AbortSignal,
  beforeLaunch: () => Promise<void>, setupTimeoutMs = 10000): Promise<{ wire: Wire;
  /**
   * 签名 / Signature: openProjectProtocolChannel.close.
   * 功能：为维护项目协议运行票据与双向流声明 close 的输入与结果契约，所属容器为 openProjectProtocolChannel。
   * Purpose: Declares the input/result contract for close in openProjectProtocolChannel. Module responsibility: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  close: () => void }> {
  signal.throwIfAborted();
  const client = await machines.connect(id, Math.min(setupTimeoutMs, 10000), signal);
  /**
   * 入口 / Entry: openProjectProtocolChannel.current.
   * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`project-protocol-stream.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-protocol-stream.ts`; the calls and state transitions below complete the operation. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `signal.throwIfAborted`, `machines.live.get`, `machines.state`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `machines.live.get`, `machines.state`, `changed`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `machines.live.get(id) !== live || machines.state(id) !== 'running'`; 异常 / errors `changed()`.
   */
  const current = () => { signal.throwIfAborted();
    if (machines.live.get(id) !== live || machines.state(id) !== 'running') throw changed(); };
  try {
    /**
     * 入口 / Entry: openProjectProtocolChannel.callback@138.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
     * 输入 / Inputs: resolve; reject
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `setTimeout`; `signal.addEventListener`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return await new Promise<{ wire: Wire;
    /**
     * 签名 / Signature: openProjectProtocolChannel.close.
     * 功能：为维护项目协议运行票据与双向流声明 close 的输入与结果契约，所属容器为 openProjectProtocolChannel。
     * Purpose: Declares the input/result contract for close in openProjectProtocolChannel. Module responsibility: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    close: () => void }>((resolve, reject) => {
      let settled = false;
      /**
       * 入口 / Entry: openProjectProtocolChannel.clear.
       * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`project-protocol-stream.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-protocol-stream.ts`; the calls and state transitions below complete the operation. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
       * 处理：通过 `clearTimeout`, `signal.removeEventListener`, `client.off` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `clearTimeout`, `signal.removeEventListener`, `client.off`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `clearTimeout`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const clear = () => { clearTimeout(timer); signal.removeEventListener('abort', abort);
        client.off('close', closed); client.off('error', failed); };
      /**
       * 入口 / Entry: openProjectProtocolChannel.fail.
       * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`project-protocol-stream.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-protocol-stream.ts`; this entry produces `void` for its caller. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
       * 处理：通过 `clear`, `client.destroy`, `reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `clear`, `client.destroy`, `reject`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `settled`.
       * 输入 / Inputs: error: unknown
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `clear`; `client.destroy`; 更新 / updates `settled`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const fail = (error: unknown) => { if (settled) return; settled = true; clear(); client.destroy(); reject(error); };
      /**
       * 入口 / Entry: openProjectProtocolChannel.abort.
       * 功能：把本层请求转交 `fail`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `fail` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `fail(signal.reason || new DOMException('Protocol setup aborted', 'AbortError'))`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const abort = () => fail(signal.reason || new DOMException('Protocol setup aborted', 'AbortError'));
      /**
       * 入口 / Entry: openProjectProtocolChannel.closed.
       * 功能：把本层请求转交 `fail`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `fail` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `fail(new AppError('协议 SSH 通道就绪应答前已关闭', 409))`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const closed = () => fail(new AppError('协议 SSH 通道就绪应答前已关闭', 409));
      /**
       * 入口 / Entry: openProjectProtocolChannel.failed.
       * 功能：把本层请求转交 `fail`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `fail` and propagates the provider result or rejection.
       * 输入 / Inputs: error: Error
       * 输出 / Returns: `fail(error)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const failed = (error: Error) => fail(error);
      const timer = setTimeout(() => fail(new AppError('协议 SSH 通道就绪应答超时', 408)), setupTimeoutMs);
      signal.addEventListener('abort', abort, { once: true }); client.once('close', closed); client.once('error', failed);
      /**
       * 入口 / Entry: openProjectProtocolChannel.callback@148.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.resolve().then）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.resolve().then).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `client.exec`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      void Promise.resolve().then(async () => {
        current(); if (settled) return;
        await beforeLaunch(); current(); if (settled) return;
        /**
         * 入口 / Entry: openProjectProtocolChannel.callback@151.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（client.exec）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (client.exec).
         * 输入 / Inputs: error; wire
         * 输出 / Returns: `void`.
         * 副作用 / Effects: `wire.destroy`; `clear`; 更新 / updates `settled`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         * 失败处理：catch 分支执行 `wire.destroy();`; `fail(error);`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `wire.destroy();`; `fail(error);`; these statements determine whether a failure is absorbed or rejected again.
         */
        client.exec(command, (error, wire) => {
          if (settled) { wire?.destroy(); return; }
          if (error) { fail(error); return; }
          try { current(); }
          catch (error) { wire.destroy(); fail(error); return; }
          settled = true; clear();
          resolve({ wire,
          /**
           * 入口 / Entry: openProjectProtocolChannel.close.
           * 功能：在维护项目协议运行票据与双向流中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`project-protocol-stream.ts`）。
           * Purpose: Ends, revokes or cleans resources owned by this domain action in `project-protocol-stream.ts`; the calls and state transitions below complete the operation. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
           * 处理：通过 `wire.destroy`, `client.destroy` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `wire.destroy`, `client.destroy`; the branches below determine continuation, return or refusal.
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: `wire.destroy`; `client.destroy`.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          close: () => { wire.destroy(); client.destroy(); } });
        });
      }).catch(fail);
    });
  } catch (error) { client.destroy(); throw error; }
}

export class ProjectProtocolDuplex extends Duplex {
  private stopped = false;
  /**
   * 入口 / Entry: ProjectProtocolDuplex.finish.
   * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.stopped`（`ProjectProtocolDuplex`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProtocolDuplex`; the outcome is recorded in `this.stopped`. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `this.stop` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.stop`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.stopped`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.stop`; 更新 / updates `this.stopped`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private finish() { if (!this.stopped) { this.stopped = true; this.stop(); } }
  /**
   * 入口 / Entry: ProjectProtocolDuplex.constructor.
   * 功能：建立 ProjectProtocolDuplex 的维护项目协议运行票据与双向流上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectProtocolDuplex context for this module's responsibility: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: wire: Wire; stop: () => void
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private wire: Wire, private stop: () => void) {
    super({ allowHalfOpen: true, readableHighWaterMark: 65536, writableHighWaterMark: 65536 });
    wire.pause();
    wire.on('data', (chunk: Buffer) => { if (!this.push(Buffer.from(chunk))) wire.pause(); });
    wire.on('end', () => this.push(null));
    wire.on('error', error => this.destroy(error));
    // Preserve already-buffered final protocol bytes until the reader observes EOF.
    wire.on('close', () => { this.push(null); this.finish(); });
    this.on('error', () => {});
  }
  /**
   * 入口 / Entry: ProjectProtocolDuplex._read.
   * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectProtocolDuplex`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProtocolDuplex`; the calls and state transitions below complete the operation. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `this.wire.resume` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.wire.resume`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  override _read() { this.wire.resume(); }
  /**
   * 入口 / Entry: ProjectProtocolDuplex._write.
   * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectProtocolDuplex`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProtocolDuplex`; the calls and state transitions below complete the operation. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `this.wire.write` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.wire.write`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: chunk: Buffer; _encoding: BufferEncoding; done: (error?: Error | null) => void
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.wire.write`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    this.wire.write(Buffer.from(chunk), done);
  }
  /**
   * 入口 / Entry: ProjectProtocolDuplex._final.
   * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectProtocolDuplex`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProtocolDuplex`; the calls and state transitions below complete the operation. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `this.wire.end` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.wire.end`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: done: (error?: Error | null) => void
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  override _final(done: (error?: Error | null) => void) { this.wire.end(done); }
  /**
   * 入口 / Entry: ProjectProtocolDuplex._destroy.
   * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectProtocolDuplex`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProtocolDuplex`; the calls and state transitions below complete the operation. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `this.finish`, `this.wire.destroy`, `done` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.finish`, `this.wire.destroy`, `done`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: error: Error | null; done: (error?: Error | null) => void
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.wire.destroy`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  override _destroy(error: Error | null, done: (error?: Error | null) => void) {
    this.finish(); this.wire.destroy(); done(error);
  }
}
type Preparation = Pick<ProjectTerminals, 'prepare' | 'close'>;
type Admission = Awaited<ReturnType<ProjectRunScopes['admitTask']>>;
type Scopes = Pick<ProjectRunScopes, 'admitTask' | 'active' | 'readonlyTask' | 'taskRun' | 'closeAfterScopeStopped'>;
type Options = { scopes?: Scopes; identities?: Pick<ProjectIdentities, 'runReadonly'>;
  /**
   * 签名 / Signature: Options.createPreparation.
   * 功能：为维护项目协议运行票据与双向流声明 createPreparation 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for createPreparation in Options. Module responsibility: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Preparation.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  createPreparation?: () => Preparation; rootDirectory?: string;
  /**
   * 签名 / Signature: Options.channel.
   * 功能：为维护项目协议运行票据与双向流声明 channel 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for channel in Options. Module responsibility: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 输入 / Inputs: id: string; command: string; signal: AbortSignal
   * 输出 / Returns: Promise<{ wire: Wire; close: () => void }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  channel?: (id: string, command: string, signal: AbortSignal) => Promise<{ wire: Wire;
  /**
   * 签名 / Signature: Options.close.
   * 功能：为维护项目协议运行票据与双向流声明 close 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for close in Options. Module responsibility: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  close: () => void }>; };
export type OwnedProjectProtocolStream = { stream: Duplex; capture: ProjectProtocolCapture;
  /**
   * 签名 / Signature: OwnedProjectProtocolStream.record.
   * 功能：为维护项目协议运行票据与双向流声明 record 的输入与结果契约，所属容器为 OwnedProjectProtocolStream。
   * Purpose: Declares the input/result contract for record in OwnedProjectProtocolStream. Module responsibility: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: ProjectProtocolStreamRecord.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  record: () => ProjectProtocolStreamRecord;
  /**
   * 签名 / Signature: OwnedProjectProtocolStream.close.
   * 功能：为维护项目协议运行票据与双向流声明 close 的输入与结果契约，所属容器为 OwnedProjectProtocolStream。
   * Purpose: Declares the input/result contract for close in OwnedProjectProtocolStream. Module responsibility: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  close: () => Promise<void>; done: Promise<void>;
  /**
   * 签名 / Signature: OwnedProjectProtocolStream.detachRequest.
   * 功能：为维护项目协议运行票据与双向流声明 detachRequest 的输入与结果契约，所属容器为 OwnedProjectProtocolStream。
   * Purpose: Declares the input/result contract for detachRequest in OwnedProjectProtocolStream. Module responsibility: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  detachRequest: () => void;
  /**
   * 签名 / Signature: OwnedProjectProtocolStream.assertCurrent.
   * 功能：为维护项目协议运行票据与双向流声明 assertCurrent 的输入与结果契约，所属容器为 OwnedProjectProtocolStream。
   * Purpose: Declares the input/result contract for assertCurrent in OwnedProjectProtocolStream. Module responsibility: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  assertCurrent: () => Promise<void>;
  /**
   * 签名 / Signature: OwnedProjectProtocolStream.assertNative.
   * 功能：为维护项目协议运行票据与双向流声明 assertNative 的输入与结果契约，所属容器为 OwnedProjectProtocolStream。
   * Purpose: Declares the input/result contract for assertNative in OwnedProjectProtocolStream. Module responsibility: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  assertNative: () => Promise<void> };

/** A durable original ticket owns one binary protocol connection and all its descendants. */
export class ProjectProtocolStreams {
  private scopes: Scopes;
  private identities: NonNullable<Options['identities']>;
  private owners = new Map<string, OwnedProjectProtocolStream>();
  private recoveries = new Map<string, { projectId: string;
  /**
   * 签名 / Signature: ProjectProtocolStreams.close.
   * 功能：为维护项目协议运行票据与双向流声明 close 的输入与结果契约，所属容器为 ProjectProtocolStreams。
   * Purpose: Declares the input/result contract for close in ProjectProtocolStreams. Module responsibility: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  close: () => Promise<void>;
  /**
   * 签名 / Signature: ProjectProtocolStreams.record.
   * 功能：为维护项目协议运行票据与双向流声明 record 的输入与结果契约，所属容器为 ProjectProtocolStreams。
   * Purpose: Declares the input/result contract for record in ProjectProtocolStreams. Module responsibility: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: ProjectProtocolStreamRecord.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  record: () => ProjectProtocolStreamRecord }>();
  private cleanups = new Set<
  /**
   * 中文功能：协议流的异步清理或启动/完成 Promise 的本地结束通道。
   * English: Asynchronous protocol-stream cleanup or a local completion channel for startup/done promises.
   * 所属 / Owner: ProjectProtocolStreams.cleanups.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `Promise<void>`.
   */
  () => Promise<void>>();
  private writes = new Map<string, Promise<unknown>>();
  private controller = new AbortController();
  private pending = new Set<Promise<unknown>>();
  /**
   * 入口 / Entry: ProjectProtocolStreams.constructor.
   * 功能：建立 ProjectProtocolStreams 的维护项目协议运行票据与双向流上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectProtocolStreams context for this module's responsibility: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; options: Options default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.scopes`, `this.identities`.
   */
  constructor(private machines: Machines, private workspaces: WorkspacesV1, private options: Options = {}) {
    this.scopes = options.scopes || new ProjectRunScopes(machines);
    this.identities = options.identities || new ProjectIdentities(machines);
  }
  /**
   * 入口 / Entry: ProjectProtocolStreams.file.
   * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(this.options.rootDirectory || vmDir(id), 'project-protocol-streams', projectId, runId + '.json')` 供上层消费（`ProjectProtocolStreams`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProtocolStreams`; this entry produces `join(this.options.rootDirectory || vmDir(id), 'project-protocol-streams', projectId, runId + '.json')` for its caller. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `projectIdSchema.parse`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `projectIdSchema.parse`, `join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; projectId: string; runId: string
   * 输出 / Returns: `join(this.options.rootDirectory || vmDir(id), 'project-protocol-streams', projectId, runId + '.json')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private file(id: string, projectId: string, runId: string) {
    z.uuid().parse(id); projectIdSchema.parse(projectId); z.uuid().parse(runId);
    return join(this.options.rootDirectory || vmDir(id), 'project-protocol-streams', projectId, runId + '.json');
  }
  /**
   * 入口 / Entry: ProjectProtocolStreams.save.
   * 功能：在维护项目协议运行票据与双向流中，校验并提交领域状态变更；完成下述调用及状态处理（`ProjectProtocolStreams`）。
   * Purpose: Validates and commits a domain state change in `ProjectProtocolStreams`; the calls and state transitions below complete the operation. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `projectProtocolStreamSchema.parse`, `structuredClone`, `this.file`, `inline.catch().then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectProtocolStreamSchema.parse`, `structuredClone`, `this.file`, `inline.catch().then`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.writes.get(file) === next`.
   * 输入 / Inputs: record: ProjectProtocolStreamRecord
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.writes.get`; `this.writes.set`; `this.writes.delete`; 更新 / updates `record`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `if (this.writes.get(file) === next) this.writes.delete(file);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `if (this.writes.get(file) === next) this.writes.delete(file);`; these steps also apply to exceptional exits.
   */
  private async save(record: ProjectProtocolStreamRecord) {
    record = projectProtocolStreamSchema.parse(structuredClone(record));
    const file = this.file(record.vmId, record.projectId, record.runId);
    /**
     * 入口 / Entry: ProjectProtocolStreams.save.callback@217.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline.catch().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline.catch().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `writeStore`; `mkdir`; `rename`.
     * 拒绝 / Refusals: 条件 / conditions `prior && (prior.phase === 'closed' && record.phase !== 'closed' || prior.phase === 'review' && ['intent', 'active'].includes(…`; 异常 / errors `changed()`.
     */
    const next = (this.writes.get(file) || Promise.resolve()).catch(() => {}).then(async () => {
      const archived = join(dirname(file), 'closed', record.runId + '.json');
      const value = await readStore<unknown>(file, () => null) || await readStore<unknown>(archived, () => null);
      const prior = value ? projectProtocolStreamSchema.parse(value) : null;
      if (prior && (prior.phase === 'closed' && record.phase !== 'closed' || prior.phase === 'review' && ['intent', 'active'].includes(record.phase) ||
          !same(immutable(prior), immutable(record)) || prior.issued && !record.issued ||
          prior.run && !same(prior.run, record.run) || prior.closure && !same(prior.closure, record.closure))) throw changed();
      if (prior?.phase === 'closed' && await readStore<unknown>(archived, () => null)) return;
      await writeStore(file, record);
      if (record.phase === 'closed') {
        await mkdir(dirname(archived), { recursive: true }); await rename(file, archived);
      }
    });
    this.writes.set(file, next); try { await next; } finally { if (this.writes.get(file) === next) this.writes.delete(file); }
  }
  /**
   * 入口 / Entry: ProjectProtocolStreams.acceptedClosure.
   * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `true` 供上层消费（`ProjectProtocolStreams`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProtocolStreams`; this entry produces `false` / `true` for its caller. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `this.file`, `readStore`, `join`, `dirname` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.file`, `readStore`, `join`, `dirname`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!value`; `prior.phase !== 'closed'`.
   * 输入 / Inputs: record: ProjectProtocolStreamRecord
   * 输出 / Returns: `false`; `true`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!same(immutable(prior), immutable(record)) || prior.issued !== record.issued || record.run && !same(prior.run, record.run)`; 异常 / errors `changed()`.
   */
  private async acceptedClosure(record: ProjectProtocolStreamRecord) {
    const file = this.file(record.vmId, record.projectId, record.runId);
    const value = await readStore<unknown>(file, () => null) || await readStore<unknown>(join(dirname(file), 'closed', record.runId + '.json'), () => null);
    if (!value) return false;
    const prior = projectProtocolStreamSchema.parse(value); if (prior.phase !== 'closed') return false;
    if (!same(immutable(prior), immutable(record)) || prior.issued !== record.issued || record.run && !same(prior.run, record.run)) throw changed();
    Object.assign(record, prior); return true;
  }
  /**
   * 入口 / Entry: ProjectProtocolStreams.records.
   * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；本入口产生 `[]` / `rows` 供上层消费（`ProjectProtocolStreams`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProtocolStreams`; this entry produces `[]` / `rows` for its caller. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `join`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `(error as NodeJS.ErrnoException).code === 'ENOENT'`; `key.startsWith(id + ':') && recovery.projectId === projectId`; `record.phase === 'closed' && !rows.some(row => row.runId === record.runId)`.
   * 输入 / Inputs: id: string; projectId: string
   * 输出 / Returns: `[]`; `rows`.
   * 副作用 / Effects: `key.startsWith`; `rows.push`; 更新 / updates `files`.
   * 拒绝 / Refusals: 条件 / conditions `files.length > 1024 || files.some(file => !uuidFile.test(file))`; 异常 / errors `error`; `changed()`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async records(id: string, projectId: string) {
    projectIdSchema.parse(projectId); z.uuid().parse(id);
    const directory = join(this.options.rootDirectory || vmDir(id), 'project-protocol-streams', projectId);
    let files: string[]; try { files = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    files = files.filter(file => file !== 'closed' && !/^[a-f0-9-]{36}\.json\.[a-f0-9-]{36}\.tmp$/.test(file));
    if (files.length > 1024 || files.some(file => !uuidFile.test(file))) throw changed();
    const records = await Promise.all(files.map(file => readStore<unknown>(join(directory, file), () => null)));
    const rows = records.map(value => projectProtocolStreamSchema.parse(value)).filter(record => {
      if (record.vmId !== id || record.projectId !== projectId) throw changed(); return record.phase !== 'closed';
    });
    for (const [key, recovery] of this.recoveries) if (key.startsWith(id + ':') && recovery.projectId === projectId) {
      const record = recovery.record(); if (record.phase === 'closed' && !rows.some(row => row.runId === record.runId)) rows.push(record);
    }
    return rows;
  }
  /**
   * 入口 / Entry: ProjectProtocolStreams.recordsAll.
   * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；本入口产生 `[]` / `(await Promise.all(projects.map(projectId => this.records(id, projectId)))).flat()` 供上层消费（`ProjectProtocolStreams`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProtocolStreams`; this entry produces `[]` / `(await Promise.all(projects.map(projectId => this.records(id, projectId)))).flat()` for its caller. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `join`, `vmDir`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `(error as NodeJS.ErrnoException).code === 'ENOENT'`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `[]`; `(await Promise.all(projects.map(projectId => this.records(id, projectId)))).flat()`.
   * 副作用 / Effects: 更新 / updates `projects`.
   * 拒绝 / Refusals: 条件 / conditions `projects.length > 1024 || projects.some(projectId => !projectIdSchema.safeParse(projectId).success)`; 异常 / errors `error`; `changed()`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async recordsAll(id: string) {
    z.uuid().parse(id); const directory = join(this.options.rootDirectory || vmDir(id), 'project-protocol-streams');
    let projects: string[];
    try { projects = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    if (projects.length > 1024 || projects.some(projectId => !projectIdSchema.safeParse(projectId).success)) throw changed();
    return (await Promise.all(projects.map(projectId => this.records(id, projectId)))).flat();
  }
  /**
   * 入口 / Entry: ProjectProtocolStreams.readonly.
   * 功能：在维护项目协议运行票据与双向流中，读取或核对领域状态并构造调用方可消费的结果；完成下述调用及状态处理（`ProjectProtocolStreams`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectProtocolStreams`; the calls and state transitions below complete the operation. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `projectProtocolStreamSchema.parse`, `this.machines.live.get`, `this.machines.state`, `this.boot` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectProtocolStreamSchema.parse`, `this.machines.live.get`, `this.machines.state`, `this.boot`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: record: ProjectProtocolStreamRecord; signal: AbortSignal optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `record`.
   * 拒绝 / Refusals: 条件 / conditions `!live || this.machines.state(record.vmId) !== 'running' || await this.boot(record.vmId, signal) !== record.bootId`; `this.machines.live.get(record.vmId) !== live || await this.boot(record.vmId, signal) !== record.bootId`; 异常 / errors `changed()`.
   */
  async readonly(record: ProjectProtocolStreamRecord, signal?: AbortSignal) {
    record = projectProtocolStreamSchema.parse(record);
    const live = this.machines.live.get(record.vmId);
    if (!live || this.machines.state(record.vmId) !== 'running' || await this.boot(record.vmId, signal) !== record.bootId) throw changed();
    await this.native(record, signal);
    if (this.machines.live.get(record.vmId) !== live || await this.boot(record.vmId, signal) !== record.bootId) throw changed();
  }
  /**
   * 入口 / Entry: ProjectProtocolStreams.recover.
   * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectProtocolStreams`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProtocolStreams`; the calls and state transitions below complete the operation. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `this.records`, `signal.throwIfAborted`, `this.owners.get`, `this.recoveries.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.records`, `signal.throwIfAborted`, `this.owners.get`, `this.recoveries.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `record.kind !== kind`; `recovery && ['intent', 'active'].includes(recovery.record().phase) && (!owner || !owner.stream.destr…`.
   * 输入 / Inputs: id: string; projectId: string; kind: 'lsp' | 'dap'; signal: AbortSignal optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.stop`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async recover(id: string, projectId: string, kind: 'lsp' | 'dap', signal?: AbortSignal) {
    for (const record of await this.records(id, projectId)) {
      signal?.throwIfAborted(); if (record.kind !== kind) continue;
      const key = id + ':' + record.runId, owner = this.owners.get(key), recovery = this.recoveries.get(key);
      if (recovery && ['intent', 'active'].includes(recovery.record().phase) && (!owner || !owner.stream.destroyed)) continue;
      await this.stop(id, projectId, record.runId);
    }
  }
  /**
   * 入口 / Entry: ProjectProtocolStreams.boot.
   * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；本入口产生 `parsed.data` 供上层消费（`ProjectProtocolStreams`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProtocolStreams`; this entry produces `parsed.data` for its caller. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `this.machines.live.get`, `this.machines.exec`, `z.uuid().safeParse`, `z.uuid` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.live.get`, `this.machines.exec`, `z.uuid().safeParse`, `z.uuid`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `parsed.data`.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `!live || this.machines.live.get(id) !== live || result.code || !parsed.success`; 异常 / errors `changed()`.
   */
  private async boot(id: string, signal?: AbortSignal) {
    const live = this.machines.live.get(id), result = await this.machines.exec(id,
      'env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C /bin/cat /proc/sys/kernel/random/boot_id', 10000, signal);
    const parsed = z.uuid().safeParse(result.stdout.trim());
    if (!live || this.machines.live.get(id) !== live || result.code || !parsed.success) throw changed(); return parsed.data;
  }
  /**
   * 入口 / Entry: ProjectProtocolStreams.assertCapture.
   * 功能：把本层请求转交 `this.workspaces.projects.inScope`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.workspaces.projects.inScope` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; capture: ProjectProtocolCapture; boot: default=true
   * 输出 / Returns: `this.workspaces.projects.inScope(id, capture.projectId, async () => { const current = () => { capture.signal.throwIfAborted()…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async assertCapture(id: string, capture: ProjectProtocolCapture, boot = true) {
    /**
     * 入口 / Entry: ProjectProtocolStreams.assertCapture.callback@284.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.workspaces.projects.inScope）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.workspaces.projects.inScope).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `(project._workspace || 'default') !== capture.projectId || projectVersion(project) !== capture.configSha256`; `boot && await this.boot(id, capture.signal) !== capture.bootId`; 异常 / errors `changed()`.
     */
    return this.workspaces.projects.inScope(id, capture.projectId, async () => {
      /**
       * 入口 / Entry: ProjectProtocolStreams.assertCapture.current.
       * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectProtocolStreams`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProtocolStreams`; the calls and state transitions below complete the operation. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
       * 处理：通过 `capture.signal.throwIfAborted`, `this.machines.state`, `this.machines.live.get`, `this.workspaces.projects.current` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `capture.signal.throwIfAborted`, `this.machines.state`, `this.machines.live.get`, `this.workspaces.projects.current`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) !== 'running' || this.machines.live.get(id) !== capture.live || this.workspaces.projects.current(id) …`; 异常 / errors `changed()`.
       */
      const current = () => { capture.signal.throwIfAborted();
        if (this.machines.state(id) !== 'running' || this.machines.live.get(id) !== capture.live ||
            this.workspaces.projects.current(id) !== capture.projectId) throw changed(); };
      current(); const project = await this.workspaces.config(id); current();
      if ((project._workspace || 'default') !== capture.projectId || projectVersion(project) !== capture.configSha256) throw changed();
      if (boot && await this.boot(id, capture.signal) !== capture.bootId) throw changed(); current();
    });
  }
  /**
   * 入口 / Entry: ProjectProtocolStreams.native.
   * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectProtocolStreams`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProtocolStreams`; the calls and state transitions below complete the operation. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `changed`, `this.scopes.readonlyTask`, `same`, `matches` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `changed`, `this.scopes.readonlyTask`, `same`, `matches`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: record: ProjectProtocolStreamRecord; signal: AbortSignal optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `record.phase !== 'active' || !record.run`; `!same(value.identity, record.identity) || value.sha256 !== record.sha256 || value.owner.bootId !== record.bootId || value.own…`; 异常 / errors `changed()`.
   */
  private async native(record: ProjectProtocolStreamRecord, signal?: AbortSignal) {
    if (record.phase !== 'active' || !record.run) throw changed();
    const value = await this.scopes.readonlyTask(record.vmId, record.projectId, record.runId, signal);
    if (!same(value.identity, record.identity) || value.sha256 !== record.sha256 || value.owner.bootId !== record.bootId ||
        value.owner.kind !== 'task' || value.owner.runId !== record.runId || !same(value.run, record.run) || !matches(record, value.run)) throw changed();
  }
  /**
   * 入口 / Entry: ProjectProtocolStreams.open.
   * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；本入口产生 `operation` 供上层消费（`ProjectProtocolStreams`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProtocolStreams`; this entry produces `operation` for its caller. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `this.start`, `this.pending.add`, `operation.finally().catch`, `operation.finally` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.start`, `this.pending.add`, `operation.finally().catch`, `operation.finally`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; kind: 'lsp' | 'dap'; project: Project; execution: (resolved: Project) => ProjectIdentityExecution; signal: AbortSignal optional; timeoutMs: default=kind === 'lsp' ? 180000 : 12 * 60 * 60 * 1000; expectedLive: object optional
   * 输出 / Returns: Promise<OwnedProjectProtocolStream>；结果来自 / values from `operation`.
   * 副作用 / Effects: `this.start`; `this.pending.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  open(id: string, kind: 'lsp' | 'dap', project: Project, execution: (resolved: Project) => ProjectIdentityExecution,
    signal?: AbortSignal, timeoutMs = kind === 'lsp' ? 180000 : 12 * 60 * 60 * 1000, expectedLive?: object): Promise<OwnedProjectProtocolStream> {
    const operation = this.start(id, kind, project, execution, signal, timeoutMs, expectedLive);
    this.pending.add(operation); void operation.finally(() => this.pending.delete(operation)).catch(() => {}); return operation;
  }
  /**
   * 入口 / Entry: ProjectProtocolStreams.start.
   * 功能：捕获项目与客户机运行身份，准备账户协议进程并交付受管 LSP/DAP 双向流。
   * Purpose: Captures project/guest identity, prepares account-owned protocol processes and hands off managed LSP/DAP duplex streams.
   * 设计：意图、完整原生运行和 relay 归属分阶段验证；准备或交付失败停止原进程域，未确认回滚保留票据与准备租约。
   * Design: Intent/native-run/relay ownership is verified in stages; failed preparation/handoff stops original scopes while pending rollback retains tickets/leases.
   * 输入 / Inputs: id: string; kind: 'lsp' | 'dap'; original: Project; execute: (resolved: Project) => ProjectIdentityExecution; incoming: AbortSignal | undefined; timeoutMs: number; expectedLive: object optional
   * 输出 / Returns: `owner`.
   * 副作用 / Effects: `incoming.addEventListener`; `AbortSignal.any`; `setTimeout`; `this.options.createPreparation`; `this.cleanups.add`; 更新 / updates `prepared`, `capture`, `admission`, `record.issued`.
   * 拒绝 / Refusals: 条件 / conditions `this.workspaces.projects.current(id) !== projectId`; `!live || expectedLive && live !== expectedLive || this.machines.state(id) !== 'running'`; `!originalCapture || !prepared.signal || prepared.projectId !== projectId || originalCapture.live !== live || (originalCapture…`; 异常 / errors `changed()`; `new AppError('协议适配器未就绪：' + redactValues(stderr, secrets), 409)`.
   * 失败处理：catch 分支执行 `settleStartup();`; `try { await finish(); } catch (cleanupError) { const failure = cleanupError instanceof AppError ? cleanupError : new AppError…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `settleStartup();`; `try { await finish(); } catch (cleanupError) { const failure = cleanupError instanceof AppError ? cleanupError : new AppError…`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async start(id: string, kind: 'lsp' | 'dap', original: Project,
    execute: (resolved: Project) => ProjectIdentityExecution, incoming: AbortSignal | undefined, timeoutMs: number, expectedLive?: object) {
    this.controller.signal.throwIfAborted(); incoming?.throwIfAborted();
    z.number().int().min(1000).max(24 * 60 * 60 * 1000).parse(timeoutMs);
    const projectId = projectIdSchema.parse(original._workspace || 'default'), project = cloneProject(original), configSha256 = projectVersion(project);
    if (this.workspaces.projects.current(id) !== projectId) throw changed();
    const live = this.machines.live.get(id); if (!live || expectedLive && live !== expectedLive || this.machines.state(id) !== 'running') throw changed();
    /**
     * 入口 / Entry: ProjectProtocolStreams.start.abortRequest.
     * 功能：把本层请求转交 `controller.abort`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `controller.abort` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `controller.abort(incoming?.reason)`.
     * 副作用 / Effects: `controller.abort`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const controller = new AbortController(), abortRequest = () => controller.abort(incoming?.reason);
    incoming?.addEventListener('abort', abortRequest, { once: true });
    /**
     * 入口 / Entry: ProjectProtocolStreams.start.detachRequest.
     * 功能：把本层请求转交 `incoming.removeEventListener`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `incoming.removeEventListener` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `incoming?.removeEventListener('abort', abortRequest)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const detachRequest = () => incoming?.removeEventListener('abort', abortRequest);
    const lifetime = AbortSignal.any([this.controller.signal, controller.signal]);
    const timer = setTimeout(() => controller.abort(new AppError('协议会话期限已到', 408)), timeoutMs); timer.unref();
    const preparation = this.options.createPreparation?.() || projectTerminalsFor(this.machines, this.workspaces);
    let prepared: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined, admission: Admission | undefined;
    let record: ProjectProtocolStreamRecord | undefined, capture: ProjectProtocolCapture | undefined;
    let session: ProjectSessionLifetime<ReturnType<typeof sessionReceipt>> | undefined;
    let settleStartup!:
    /**
     * 中文功能：协议流的异步清理或启动/完成 Promise 的本地结束通道。
     * English: Asynchronous protocol-stream cleanup or a local completion channel for startup/done promises.
     * 所属 / Owner: ProjectProtocolStreams.start.settleStartup.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `void`.
     */
    () => void;
    const startupSettled = new Promise<void>(resolve => { settleStartup = resolve; });
    let channel: { wire: Wire;
    /**
     * 签名 / Signature: ProjectProtocolStreams.start.close.
     * 功能：为维护项目协议运行票据与双向流声明 close 的输入与结果契约，所属容器为 ProjectProtocolStreams.start。
     * Purpose: Declares the input/result contract for close in ProjectProtocolStreams.start. Module responsibility: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    close: () => void } | undefined, owner: OwnedProjectProtocolStream | undefined, cleanup: Promise<void> | undefined;
    let abortProtocol: (
    /**
     * 中文功能：协议流的异步清理或启动/完成 Promise 的本地结束通道。
     * English: Asynchronous protocol-stream cleanup or a local completion channel for startup/done promises.
     * 所属 / Owner: ProjectProtocolStreams.start.abortProtocol.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `void`.
     */
    () => void) | undefined;
    let resolveDone!:
    /**
     * 中文功能：协议流的异步清理或启动/完成 Promise 的本地结束通道。
     * English: Asynchronous protocol-stream cleanup or a local completion channel for startup/done promises.
     * 所属 / Owner: ProjectProtocolStreams.start.resolveDone.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `void`.
     */
    () => void, rejectDone!:
    /**
     * 中文功能：协议流的异步清理或启动/完成 Promise 的本地结束通道。
     * English: Asynchronous protocol-stream cleanup or a local completion channel for startup/done promises.
     * 所属 / Owner: ProjectProtocolStreams.start.rejectDone.
     * 输入 / Inputs: error: unknown.
     * 结果 / Result: `void`.
     */
    (error: unknown) => void;
    const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; }); void done.catch(() => {});
    /**
     * 入口 / Entry: ProjectProtocolStreams.start.finish.
     * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；本入口产生 `session && record ? ProjectSessionLifetime.retireOriginal(this.machines, id, sessionReceipt(record), finishNative) : finishNa…` 供上层消费（`ProjectProtocolStreams`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProtocolStreams`; this entry produces `session && record ? ProjectSessionLifetime.retireOriginal(this.machines, id, sessionReceipt(record), finishNative) : finishNa…` for its caller. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
     * 处理：通过 `ProjectSessionLifetime.retireOriginal`, `sessionReceipt`, `finishNative` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `ProjectSessionLifetime.retireOriginal`, `sessionReceipt`, `finishNative`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `session && record ? ProjectSessionLifetime.retireOriginal(this.machines, id, sessionReceipt(record), finishNative) : finishNa…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const finish = () => session && record
      ? ProjectSessionLifetime.retireOriginal(this.machines, id, sessionReceipt(record), finishNative)
      : finishNative();
    /**
     * 入口 / Entry: ProjectProtocolStreams.start.finishNative.
     * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；本入口产生 `cleanup` 供上层消费（`ProjectProtocolStreams`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProtocolStreams`; this entry produces `cleanup` for its caller. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
     * 处理：通过 `Promise.resolve().then`, `Promise.resolve`, `prepared.signal.removeEventListener`, `controller.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `Promise.resolve().then`, `Promise.resolve`, `prepared.signal.removeEventListener`, `controller.abort`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `!cleanup`; `abortProtocol`.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `cleanup`.
     * 副作用 / Effects: `controller.abort`; `clearTimeout`; `channel.wire.destroy`; 更新 / updates `cleanup`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const finishNative = async () => {
      // Assign before abort/destroy emits nested close callbacks.
      if (!cleanup)
      /**
       * 入口 / Entry: ProjectProtocolStreams.start.callback@331.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.resolve().then）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.resolve().then).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `this.save`; `this.stopRecord`; `channel.close`; `prepared.release`; `errors.push`; 更新 / updates `record.phase`, `cleanup`.
       * 拒绝 / Refusals: 条件 / conditions `errors.length`; 异常 / errors `failure`.
       * 收尾：退出 try 区域时始终执行 `channel?.close();`；这些步骤也适用于异常退出。
       * Finalization: Leaving the try region always executes `channel?.close();`; these steps also apply to exceptional exits.
       * 失败处理：catch 分支执行 `const failure = (error as any)?.status === 503 ? error : new AppError('原协议运行归属或闭合登记未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILE…`; `if (failure !== error) Object.defineProperty(failure, 'cause', { value: error, configurable: true });`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `const failure = (error as any)?.status === 503 ? error : new AppError('原协议运行归属或闭合登记未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILE…`; `if (failure !== error) Object.defineProperty(failure, 'cause', { value: error, configurable: true });`; these statements determine whether a failure is absorbed or rejected again.
       */
      cleanup = Promise.resolve().then(async () => {
        try { if (record) { if (record.phase !== 'closed' && !await this.acceptedClosure(record)) { record.phase = 'review'; await this.save(record); await this.stopRecord(record, live); }
            else await this.save(record); } }
        catch (error) {
          const failure = (error as any)?.status === 503 ? error : new AppError('原协议运行归属或闭合登记未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
          if (failure !== error) Object.defineProperty(failure, 'cause', { value: error, configurable: true });
          cleanup = undefined; rejectDone(failure); throw failure;
        }
        finally { channel?.close(); }
        const errors: unknown[] = [];
        try { await prepared?.release(); } catch (error) { errors.push(error); }
        try { await preparation.close(); } catch (error) { errors.push(error); }
        if (errors.length) { cleanup = undefined; const critical = errors.find((error: any) => error?.status === 503) as any;
          const failure = new AggregateError(errors, critical?.message || '协议准备租约清理未确认', { cause: critical || errors[0] });
          Object.assign(failure, { status: critical?.status || 503, code: critical?.code || 'GUEST_TASK_CLEANUP_FAILED' }); rejectDone(failure); throw failure; }
        admission?.release();
        if (record) { this.owners.delete(id + ':' + record.runId); this.recoveries.delete(id + ':' + record.runId); }
        this.cleanups.delete(finish); resolveDone();
      });
      if (abortProtocol) prepared?.signal?.removeEventListener('abort', abortProtocol);
      controller.abort(); detachRequest(); clearTimeout(timer); channel?.wire.destroy();
      return cleanup;
    };
    this.cleanups.add(finish);
    try {
      prepared = await preparation.prepare(id, projectId, null, false, lifetime, undefined, { mode: 'task' });
      const originalCapture = prepared.captured;
      if (!originalCapture || !prepared.signal || prepared.projectId !== projectId || originalCapture.live !== live ||
          (originalCapture.project._workspace || 'default') !== projectId || originalCapture.configVersion !== configSha256 ||
          projectVersion(originalCapture.project) !== configSha256) throw changed();
      const resolved = await this.workspaces.projects.inScope(id, projectId, () => this.workspaces.resolveProject(id, cloneProject(project)));
      if ((resolved._workspace || 'default') !== projectId || resolved.directory !== project.directory ||
          (resolved.networkIsolation || 'host') !== (project.networkIsolation || 'host')) throw changed();
      capture = { projectId, project, resolved: cloneProject(resolved), configSha256, live, bootId: await this.boot(id, prepared.signal), signal: prepared.signal };
      await this.assertCapture(id, capture);
      const body = { ...execute(capture.resolved), environment: { ...capture.resolved.environment }, stdin: 'session' as const };
      projectIdentityPayload(body);
      const controlToken = randomUUID();
      const options: ProjectTaskAdmissionOptions = { expectedLive: live as never, expectedBootId: capture.bootId,
        /**
         * 入口 / Entry: ProjectProtocolStreams.start.beforeIntent.
         * 功能：在维护项目协议运行票据与双向流中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectProtocolStreams`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectProtocolStreams`; the calls and state transitions below complete the operation. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
         * 处理：通过 `projectProtocolStreamSchema.parse`, `this.save`, `ProjectSessionLifetime.acquire`, `sessionReceipt` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `projectProtocolStreamSchema.parse`, `this.save`, `ProjectSessionLifetime.acquire`, `sessionReceipt`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `session.signal.aborted`.
         * 输入 / Inputs: { identity, owner: outer, sha256 }
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `this.save`; `ProjectSessionLifetime.acquire`; `session.signal.addEventListener`; `this.recoveries.set`; 更新 / updates `record`, `session`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        beforeIntent: async ({ identity, owner: outer, sha256 }) => {
          record = projectProtocolStreamSchema.parse({ version: 1, vmId: id, projectId, kind, controlToken, timeoutMs,
            runId: outer.runId, bootId: outer.bootId, identity, sha256, configSha256, phase: 'intent', issued: false, run: null });
          await this.save(record);
          session = await ProjectSessionLifetime.acquire({ machines: this.machines, vmId: id, live, kind,
            receipt: sessionReceipt(record), signal: prepared!.signal,
            /**
             * 入口 / Entry: ProjectProtocolStreams.start.cleanup.
             * 功能：在维护项目协议运行票据与双向流中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ProjectProtocolStreams`）。
             * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectProtocolStreams`; the calls and state transitions below complete the operation. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
             * 处理：通过 `controller.abort`, `finishNative` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `controller.abort`, `finishNative`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
             * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
             * 副作用 / Effects: `controller.abort`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            cleanup: async () => { controller.abort(); await startupSettled; await finishNative(); } });
          /**
           * 入口 / Entry: ProjectProtocolStreams.start.cancel.
           * 功能：把本层请求转交 `controller.abort`，沿用该实现的结果与失败路径。
           * Purpose: Delegates this request to `controller.abort` and propagates the provider result or rejection.
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: `controller.abort(session!.signal.reason)`.
           * 副作用 / Effects: `controller.abort`.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          const cancel = () => controller.abort(session!.signal.reason);
          session.signal.addEventListener('abort', cancel, { once: true });
          if (session.signal.aborted) cancel();
          this.recoveries.set(id + ':' + record.runId, { projectId, close: finish,
          /**
           * 入口 / Entry: ProjectProtocolStreams.start.record.
           * 功能：把本层请求转交 `structuredClone`，沿用该实现的结果与失败路径。
           * Purpose: Delegates this request to `structuredClone` and propagates the provider result or rejection.
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: `structuredClone(record!)`.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          record: () => structuredClone(record!) });
        } };
      admission = await this.scopes.admitTask(id, project, body, prepared.signal, options);
      if (!record || record.runId !== admission.payload.runId || record.sha256 !== admission.payload.sha256 ||
          !same(record.identity, admission.payload.identity) || admission.live !== live || admission.payload.input.readUInt32LE(12) !== 2 ||
          createHash('sha256').update(admission.payload.input).digest('hex') !== record.sha256) throw changed();
      await this.assertCapture(id, capture);
      const plan = guestTaskControlPlan(record.runId, record.controlToken,
        projectProtocolRelayCommand(record.sha256, admission.payload.command), timeoutMs);
      if (this.options.channel) {
        record.issued = true; await this.save(record);
        channel = await this.options.channel(id, plan.run, prepared.signal);
      }
      else {
        channel = await openProjectProtocolChannel(this.machines, id, plan.run, live, prepared.signal, async () => {
          await this.assertCapture(id, capture!); record!.issued = true; await this.save(record!);
        });
      }
      if (!record.issued) { record.issued = true; await this.save(record); }
      const secrets = projectPrivateValues(capture.resolved); let stderr = '';
      channel.wire.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-65536); });
      channel.wire.once('close', () => { void finish().catch(() => {}); });
      const stream = new ProjectProtocolDuplex(channel.wire, () => { void finish().catch(() => {}); });
      owner = { stream, capture,
      /**
       * 入口 / Entry: ProjectProtocolStreams.start.record.
       * 功能：把本层请求转交 `structuredClone`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `structuredClone` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `structuredClone(record!)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      record: () => structuredClone(record!), close: finish, done, detachRequest,
        /**
         * 入口 / Entry: ProjectProtocolStreams.start.assertCurrent.
         * 功能：把本层请求转交 `this.assertCapture`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `this.assertCapture` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `this.assertCapture(id, capture!)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        assertCurrent: () => this.assertCapture(id, capture!),
        /**
         * 入口 / Entry: ProjectProtocolStreams.start.assertNative.
         * 功能：把本层请求转交 `this.native`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `this.native` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `this.native(record!, capture!.signal)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        assertNative: () => this.native(record!, capture!.signal) };
      this.owners.set(id + ':' + record.runId, owner);
      /**
       * 入口 / Entry: ProjectProtocolStreams.start.abortProtocol.
       * 功能：在维护项目协议运行票据与双向流中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ProjectProtocolStreams`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectProtocolStreams`; the calls and state transitions below complete the operation. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
       * 处理：通过 `stream.destroy` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `stream.destroy`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `stream.destroy`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      abortProtocol = () => { stream.destroy(); }; prepared.signal.addEventListener('abort', abortProtocol, { once: true });
      void done.finally(() => prepared!.signal!.removeEventListener('abort', abortProtocol!)).catch(() => {});
      await new Promise<void>((resolve, reject) => channel!.wire.write(Buffer.from(admission!.payload.input), error => error ? reject(error) : resolve()));
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        await this.assertCapture(id, capture);
        if (await this.scopes.active(id, projectId, record.runId, prepared.signal)) {
          const run = await this.identities.runReadonly(id, record.identity, record.runId, prepared.signal);
          if (!matches(record, run) || run.phase !== 'active') throw changed();
          await this.assertCapture(id, capture); record.run = run; record.phase = 'active'; await this.save(record);
          session!.pin(sessionReceipt(record)); settleStartup(); return owner;
        }
        if (channel.wire.destroyed) throw new AppError('协议适配器未就绪：' + redactValues(stderr, secrets), 409);
        await delay(50, undefined, { signal: prepared.signal });
      }
      throw new AppError('项目账号协议适配器入场超时：' + redactValues(stderr, secrets), 409);
    } catch (error) {
      settleStartup();
      try { await finish(); } catch (cleanupError) {
        const failure = cleanupError instanceof AppError ? cleanupError : new AppError('协议原完整运行域清理未确认', 503, 'GUEST_TASK_CLEANUP_FAILED');
        Object.defineProperty(failure, 'cause', { value: new AggregateError([error, cleanupError]), configurable: true }); throw failure;
      }
      throw error;
    }
  }
  /**
   * 入口 / Entry: ProjectProtocolStreams.stopRecord.
   * 功能：在维护项目协议运行票据与双向流中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.save(record)` / `void` 供上层消费（`ProjectProtocolStreams`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectProtocolStreams`; this entry produces `this.save(record)` / `void` for its caller. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `this.save`, `this.machines.live.get`, `this.machines.state`, `this.scopes.taskRun` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.save`, `this.machines.live.get`, `this.machines.state`, `this.scopes.taskRun`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `record.phase === 'closed'`; `record.issued`; `original`.
   * 输入 / Inputs: record: ProjectProtocolStreamRecord; live: object
   * 输出 / Returns: `this.save(record)`; `void`.
   * 副作用 / Effects: `this.save`; `this.machines.exec`; `this.scopes.closeAfterScopeStopped`; 更新 / updates `record.phase`, `record.closure`.
   * 拒绝 / Refusals: 条件 / conditions `this.machines.live.get(record.vmId) !== live || this.machines.state(record.vmId) !== 'running'`; `!original && (record.issued || record.run) || original && ( !same(original.identity, record.identity) || original.sha256 !== …`; `bootId !== record.bootId`; 异常 / errors `new AppError('协议原客户机 live 身份改变，完整票据继续保留', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`; `changed()`.
   * 失败处理：catch 分支执行 `if ((error as any)?.status === 503) throw error;`; `const failure = new AppError('协议原完整运行域清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as any)?.status === 503) throw error;`; `const failure = new AppError('协议原完整运行域清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async stopRecord(record: ProjectProtocolStreamRecord, live: object) {
    if (record.phase === 'closed') return this.save(record);
    try {
    if (this.machines.live.get(record.vmId) !== live || this.machines.state(record.vmId) !== 'running')
      throw new AppError('协议原客户机 live 身份改变，完整票据继续保留', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    const original = await this.scopes.taskRun(record.vmId, record.projectId, record.runId);
    if (!original && (record.issued || record.run) || original && (
        !same(original.identity, record.identity) || original.sha256 !== record.sha256 || original.owner.kind !== 'task' ||
        original.owner.runId !== record.runId || original.owner.bootId !== record.bootId ||
        record.run && (!original.run || !same({ ...original.run, phase: record.run.phase }, record.run)) ||
        original.run && !matches(record, original.run))) throw changed();
    const bootId = await this.boot(record.vmId);
    if (bootId !== record.bootId) {
      const { directory } = guestTaskControlPaths(record.runId);
      const result = await this.machines.exec(record.vmId, 'env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C /bin/sh -ec ' +
        quote('test ! -e ' + quote(directory) + ' && test ! -L ' + quote(directory)), 10000);
      if (result.code !== 0) throw new AppError('新 boot 已有同路径控制归属，拒绝旧协议流停止', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      await this.scopes.closeAfterScopeStopped(record.vmId, record.projectId, record.runId);
      if (await this.boot(record.vmId) !== bootId || this.machines.live.get(record.vmId) !== live) throw changed();
      record.phase = 'closed'; record.closure = { reason: 'guest-reboot', bootId }; await this.save(record); return;
    }
    if (record.issued) {
      const plan = guestTaskControlPlan(record.runId, record.controlToken, '', record.timeoutMs);
      await cleanupGuestTaskPlan(this.machines, record.vmId, live, record.runId, plan,
        () => this.scopes.closeAfterScopeStopped(record.vmId, record.projectId, record.runId));
    } else if (original)
      await this.scopes.closeAfterScopeStopped(record.vmId, record.projectId, record.runId);
    if (await this.boot(record.vmId) !== bootId || this.machines.live.get(record.vmId) !== live) throw changed();
    record.phase = 'closed'; record.closure = { reason: record.issued ? 'scope-stopped' : 'never-issued', bootId }; await this.save(record);
    } catch (error) {
      if ((error as any)?.status === 503) throw error;
      const failure = new AppError('协议原完整运行域清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      Object.defineProperty(failure, 'cause', { value: error, configurable: true }); throw failure;
    }
  }
  /**
   * 入口 / Entry: ProjectProtocolStreams.stop.
   * 功能：在维护项目协议运行票据与双向流中，结束、撤销或清理本次拥有的领域资源；本入口产生 `recovery.close()` 供上层消费（`ProjectProtocolStreams`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectProtocolStreams`; this entry produces `recovery.close()` for its caller. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `projectIdSchema.parse`, `this.recoveries.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `projectIdSchema.parse`, `this.recoveries.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; projectId: string; runId: string
   * 输出 / Returns: `recovery.close()`.
   * 副作用 / Effects: `recovery.close`.
   * 拒绝 / Refusals: 条件 / conditions `recovery`; `recovery.projectId !== projectId`; `record.vmId !== id || record.projectId !== projectId || record.runId !== runId`; 异常 / errors `changed()`; `error`.
   * 失败处理：catch 分支执行 `if ((error as any)?.status === 503) throw error;`; `const failure = new AppError('原协议运行登记或完整域清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as any)?.status === 503) throw error;`; `const failure = new AppError('原协议运行登记或完整域清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');`; these statements determine whether a failure is absorbed or rejected again.
   */
  async stop(id: string, projectId: string, runId: string) {
    z.uuid().parse(id); projectIdSchema.parse(projectId); z.uuid().parse(runId);
    const recovery = this.recoveries.get(id + ':' + runId);
    if (recovery) { if (recovery.projectId !== projectId) throw changed(); return recovery.close(); }
    try {
    const file = this.file(id, projectId, runId);
    const value = await readStore<unknown>(file, () => null) || await readStore<unknown>(join(dirname(file), 'closed', runId + '.json'), () => null);
    const record = projectProtocolStreamSchema.parse(value); if (record.vmId !== id || record.projectId !== projectId || record.runId !== runId) throw changed();
    /**
     * 入口 / Entry: ProjectProtocolStreams.stop.callback@474.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（ProjectSessionLifetime.retireOriginal）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (ProjectSessionLifetime.retireOriginal).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `this.save`; `this.stopRecord`; 更新 / updates `record.phase`.
     * 拒绝 / Refusals: 条件 / conditions `!live`; 异常 / errors `new AppError('请先恢复原实例核对协议运行域', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`.
     */
    await ProjectSessionLifetime.retireOriginal(this.machines, id, sessionReceipt(record), async () => {
      if (record.phase === 'closed') return;
      const live = this.machines.live.get(id); if (!live) throw new AppError('请先恢复原实例核对协议运行域', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      record.phase = 'review'; await this.save(record); await this.stopRecord(record, live);
    });
    } catch (error) {
      if ((error as any)?.status === 503) throw error;
      const failure = new AppError('原协议运行登记或完整域清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      Object.defineProperty(failure, 'cause', { value: error, configurable: true }); throw failure;
    }
  }
  /**
   * 入口 / Entry: ProjectProtocolStreams.close.
   * 功能：在维护项目协议运行票据与双向流中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ProjectProtocolStreams`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectProtocolStreams`; the calls and state transitions below complete the operation. Module context: Owns project protocol tickets and duplex streams, checking original configuration, account and guest boot identity.
   * 处理：通过 `this.controller.abort`, `Promise.allSettled`, `inline.map`, `results.flatMap` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.controller.abort`, `Promise.allSettled`, `inline.map`, `results.flatMap`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.controller.abort`.
   * 拒绝 / Refusals: 条件 / conditions `errors.length`; 异常 / errors `error`.
   */
  async close() {
    this.controller.abort(); await Promise.allSettled(this.pending);
    const results = await Promise.allSettled([...this.cleanups].map(cleanup => cleanup()));
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (errors.length) { const error = new AggregateError(errors, '协议服务关闭时完整原运行域清理未确认', { cause: errors[0] });
      Object.assign(error, { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' }); throw error; }
  }
}
