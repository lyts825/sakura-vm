/**
 * 模块职责：定义 SSH Agent 任务票据与专属转发流，物理关闭未确认时保留原资源租约。
 * Module purpose: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed.
 */
import { networkFor } from './network/index.ts';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Socket } from 'node:net';
import { deflateSync } from 'node:zlib';
import ssh2, { type GetStreamCallback } from 'ssh2';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { ROOT } from './paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { quote } from './shell.ts';
import { projectIdentitySchema } from './project-identity.ts';

const { connectLocal: connect } = networkFor('core:ssh-agent-scope');
const { OpenSSHAgent } = ssh2;

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const sshAgentResourceSchema = z.object({ version: z.literal(1), kind: z.literal('ssh-agent'),
  leaseId: z.uuid(), brokerSha256: digest, timeoutSeconds: z.number().int().min(1).max(300) }).strict();
export type SshAgentResource = z.infer<typeof sshAgentResourceSchema>;
export const sshAgentContextSchema = z.object({ resource: sshAgentResourceSchema,
  identity: projectIdentitySchema, owner: z.object({ kind: z.literal('task'), runId: z.uuid(), bootId: z.uuid() }).strict(),
  sha256: digest }).strict();
export type SshAgentContext = z.infer<typeof sshAgentContextSchema>;
const manifestSchema = z.object({ version: z.literal(1), file: z.literal('broker.py'),
  size: z.number().int().min(1).max(262144), sha256: digest }).strict();
const fixedEnvironment = 'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C';
export const sshAgentControlRoot = '/run/sakura-agent-forwards';
export const sshAgentSocketRoot = '/run/sakura-agent-sockets';
/**
 * 入口 / Entry: sshAgentSocketPath.
 * 功能：在定义 SSH Agent 任务票据与专属转发流中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``${sshAgentSocketRoot}/${z.uuid().parse(leaseId)}/agent`` 供上层消费（`ssh-agent-scope.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ssh-agent-scope.ts`; this entry produces ``${sshAgentSocketRoot}/${z.uuid().parse(leaseId)}/agent`` for its caller. Module context: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed.
 * 处理：通过 `z.uuid().parse`, `z.uuid` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: leaseId: string
 * 输出 / Returns: ``${sshAgentSocketRoot}/${z.uuid().parse(leaseId)}/agent``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const sshAgentSocketPath = (leaseId: string) => `${sshAgentSocketRoot}/${z.uuid().parse(leaseId)}/agent`;

/** One owner creates and revokes only its own host streams, including pending connects. */
export class OwnedForwardAgent extends OpenSSHAgent {
  private streams = new Set<Socket>();
  private revoked = false;
  private closing?: Promise<void>;
  /**
   * 签名 / Signature: OwnedForwardAgent.abort.
   * 功能：为定义 SSH Agent 任务票据与专属转发流声明 abort 的输入与结果契约，所属容器为 OwnedForwardAgent。
   * Purpose: Declares the input/result contract for abort in OwnedForwardAgent. Module responsibility: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private abort: () => void;
  /**
   * 入口 / Entry: OwnedForwardAgent.constructor.
   * 功能：建立 OwnedForwardAgent 的定义 SSH Agent 任务票据与专属转发流上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the OwnedForwardAgent context for this module's responsibility: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: path: string; signal: AbortSignal
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `signal.addEventListener`; `this.abort`; 更新 / updates `this.abort`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private path: string, private signal: AbortSignal) {
    super(path);
    /**
     * 入口 / Entry: OwnedForwardAgent.constructor.this.abort.
     * 功能：在定义 SSH Agent 任务票据与专属转发流中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`OwnedForwardAgent`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `OwnedForwardAgent`; the calls and state transitions below complete the operation. Module context: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed.
     * 处理：通过 `this.close().catch`, `this.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.close().catch`, `this.close`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.close().catch`; `this.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    this.abort = () => { void this.close().catch(() => {}); };
    signal.addEventListener('abort', this.abort, { once: true });
    if (signal.aborted) this.abort();
  }
  /**
   * 入口 / Entry: OwnedForwardAgent.getStream.
   * 功能：在定义 SSH Agent 任务票据与专属转发流中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `void` 供上层消费（`OwnedForwardAgent`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `OwnedForwardAgent`; this entry produces `void` for its caller. Module context: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed.
   * 处理：通过 `callback`, `connect`, `this.streams.add`, `setTimeout` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `callback`, `connect`, `this.streams.add`, `setTimeout`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.revoked || this.signal.aborted || this.streams.size >= 8`.
   * 输入 / Inputs: callback: GetStreamCallback
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `connect`; `this.streams.add`; `setTimeout`; 更新 / updates `stream`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `callback(error as Error);`; `return;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `callback(error as Error);`; `return;`; these statements determine whether a failure is absorbed or rejected again.
   */
  override getStream(callback: GetStreamCallback) {
    if (this.revoked || this.signal.aborted || this.streams.size >= 8) {
      callback(new Error('This task agent is closed or its connection budget is exhausted')); return;
    }
    let stream: Socket;
    try { stream = connect(this.path); } catch (error) { callback(error as Error); return; }
    this.streams.add(stream);
    let delivered = false;
    /**
     * 入口 / Entry: OwnedForwardAgent.getStream.finish.
     * 功能：在定义 SSH Agent 任务票据与专属转发流中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`OwnedForwardAgent`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `OwnedForwardAgent`; this entry produces `void` for its caller. Module context: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed.
     * 处理：通过 `clearTimeout`, `stream.destroy`, `callback` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `clearTimeout`, `stream.destroy`, `callback`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `delivered`; `error || this.revoked || this.signal.aborted`.
     * 输入 / Inputs: error: Error optional
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `clearTimeout`; `stream.destroy`; 更新 / updates `delivered`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const finish = (error?: Error) => {
      if (delivered) return;
      delivered = true; clearTimeout(timer);
      if (error || this.revoked || this.signal.aborted) {
        stream.destroy(); callback(error || new Error('This task agent was revoked'));
      } else callback(null, stream);
    };
    const timer = setTimeout(() => finish(new Error('Agent connection timed out')), 3000);
    stream.once('connect', () => finish());
    stream.on('error', error => { finish(error); stream.destroy(); });
    stream.once('end', () => stream.destroy());
    stream.once('close', () => { this.streams.delete(stream); finish(new Error('Agent stream closed')); });
  }
  /**
   * 入口 / Entry: OwnedForwardAgent.close.
   * 功能：在定义 SSH Agent 任务票据与专属转发流中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.closing` 供上层消费（`OwnedForwardAgent`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `OwnedForwardAgent`; this entry produces `this.closing` for its caller. Module context: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed.
   * 处理：通过 `this.signal.removeEventListener`, `inline`, `operation.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.signal.removeEventListener`, `inline`, `operation.then`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closing`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.closing`.
   * 副作用 / Effects: 更新 / updates `this.revoked`, `this.closing`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close() {
    this.revoked = true; this.signal.removeEventListener('abort', this.abort);
    if (this.closing) return this.closing;
    const operation = (async () => {
      const streams = [...this.streams];
      /**
       * 入口 / Entry: OwnedForwardAgent.close.callback@74.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（streams.map）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (streams.map).
       * 输入 / Inputs: resolve; reject
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `setTimeout`; `stream.destroy`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      await Promise.all(streams.map(stream => new Promise<void>((resolve, reject) => {
        /**
         * 入口 / Entry: OwnedForwardAgent.close.closed.
         * 功能：在定义 SSH Agent 任务票据与专属转发流中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`OwnedForwardAgent`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `OwnedForwardAgent`; the calls and state transitions below complete the operation. Module context: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed.
         * 处理：通过 `clearTimeout`, `resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `clearTimeout`, `resolve`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `clearTimeout`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const closed = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => {
          stream.off('close', closed);
          reject(new AppError('本任务宿主 Agent stream 关闭未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'));
        }, 5000);
        stream.once('close', closed); stream.destroy();
      })));
    })();
    // A late actual socket close may make the next exact cleanup successful.
    // Keep revoked, but do not permanently cache an unconfirmed close promise.
    this.closing = operation.then(() => { this.closing = undefined; }, error => {
      this.closing = undefined; throw error;
    });
    return this.closing;
  }
  /**
   * 入口 / Entry: OwnedForwardAgent.streamCount.
   * 功能：向调用者提供 `this.streams.size` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.streams.size` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.streams.size`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get streamCount() { return this.streams.size; }
}

type HostOwner = { agent: OwnedForwardAgent; context: SshAgentContext; live: NonNullable<ReturnType<Machines['live']['get']>>;
  cleaned: boolean };
const owners = new WeakMap<Machines, Map<string, HostOwner>>();
/**
 * 入口 / Entry: same.
 * 功能：从当前输入或状态计算 `JSON.stringify(a) === JSON.stringify(b)`，供调用方后续验证或使用。
 * Purpose: Computes `JSON.stringify(a) === JSON.stringify(b)` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: a: unknown; b: unknown
 * 输出 / Returns: `JSON.stringify(a) === JSON.stringify(b)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/**
 * 入口 / Entry: ownerKey.
 * 功能：从当前输入或状态计算 `vmId + ':' + context.owner.runId`，供调用方后续验证或使用。
 * Purpose: Computes `vmId + ':' + context.owner.runId` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: vmId: string; context: SshAgentContext
 * 输出 / Returns: `vmId + ':' + context.owner.runId`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const ownerKey = (vmId: string, context: SshAgentContext) => vmId + ':' + context.owner.runId;
/**
 * 入口 / Entry: bindTaskAgent.
 * 功能：在定义 SSH Agent 任务票据与专属转发流中，执行此领域的具体处理步骤并返回其结果；本入口产生 `() => { if (value.cleaned && registry.get(key) === value) registry.delete(key); }` 供上层消费（`ssh-agent-scope.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ssh-agent-scope.ts`; this entry produces `() => { if (value.cleaned && registry.get(key) === value) registry.delete(key); }` for its caller. Module context: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed.
 * 处理：通过 `sshAgentContextSchema.parse`, `machines.live.get`, `owners.get`, `owners.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `sshAgentContextSchema.parse`, `machines.live.get`, `owners.get`, `owners.set`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!registry`.
 * 输入 / Inputs: machines: Machines; vmId: string; context: SshAgentContext; agent: OwnedForwardAgent; live: HostOwner['live']
 * 输出 / Returns: `() => { if (value.cleaned && registry.get(key) === value) registry.delete(key); }`.
 * 副作用 / Effects: `owners.set`; `registry.set`; 更新 / updates `context`, `registry`.
 * 拒绝 / Refusals: 条件 / conditions `machines.live.get(vmId) !== live`; `registry.has(key)`; 异常 / errors `new AppError('Agent 准备的客户机身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`; `new AppError('本次 Agent 运行已被登记', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
 */
export function bindTaskAgent(machines: Machines, vmId: string, context: SshAgentContext,
  agent: OwnedForwardAgent, live: HostOwner['live']) {
  context = sshAgentContextSchema.parse(context);
  if (machines.live.get(vmId) !== live) throw new AppError('Agent 准备的客户机身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
  let registry = owners.get(machines); if (!registry) { registry = new Map(); owners.set(machines, registry); }
  const key = ownerKey(vmId, context);
  if (registry.has(key)) throw new AppError('本次 Agent 运行已被登记', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
  const value: HostOwner = { context: structuredClone(context), agent, live, cleaned: false }; registry.set(key, value);
  // Execution completion and resource cleanup are different lifetimes. A failed
  // host close must leave this exact stream owner reachable for recovery.
  return () => { if (value.cleaned && registry.get(key) === value) registry.delete(key); };
}
/**
 * 入口 / Entry: isOwnedTaskAgent.
 * 功能：在定义 SSH Agent 任务票据与专属转发流中，执行此领域的具体处理步骤并返回其结果；本入口产生 `agent instanceof OwnedForwardAgent && value?.agent === agent && value.live === machines.live.get(vmId)` 供上层消费（`ssh-agent-scope.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ssh-agent-scope.ts`; this entry produces `agent instanceof OwnedForwardAgent && value?.agent === agent && value.live === machines.live.get(vmId)` for its caller. Module context: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed.
 * 处理：通过 `owners.get().get`, `owners.get`, `machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `owners.get().get`, `owners.get`, `machines.live.get`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: machines: Machines; vmId: string; runId: string; agent: unknown
 * 输出 / Returns: `agent instanceof OwnedForwardAgent && value?.agent === agent && value.live === machines.live.get(vmId)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function isOwnedTaskAgent(machines: Machines, vmId: string, runId: string, agent: unknown) {
  const value = owners.get(machines)?.get(vmId + ':' + runId);
  return agent instanceof OwnedForwardAgent && value?.agent === agent && value.live === machines.live.get(vmId);
}

// All generation and bootstrap paths are fixed. Existing unknown entries are
// refused rather than truncated; the helper is executed from verified bytes.
const bootstrap = `import base64,hashlib,json,os,stat,sys
request=json.loads(base64.b64decode(sys.argv[1],validate=True)); sha=request['context']['resource']['brokerSha256']
root='/run/sakura-agent-forwards'; filename=root+'/tools/'+sha+'/broker.py'
def directory(path,mode=None):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC); info=os.fstat(fd)
 assert info.st_uid==0 and info.st_gid==0 and not stat.S_IMODE(info.st_mode)&0o022
 if mode is not None: assert stat.S_IMODE(info.st_mode)==mode
 return fd
fd=directory('/run'); os.close(fd)
for path in [root,root+'/tools',root+'/tools/'+sha]:
 if not os.path.lexists(path):
  if request['action']!='cleanup': raise RuntimeError('AGENT_ASSET_ABSENT')
  # No helper was ever published. An absent exact resource and endpoint can be
  # confirmed without installing anything on the cleanup path.
  for parent in [root,root+'/records','/run/sakura-agent-sockets']:
   if os.path.lexists(parent): os.close(directory(parent,0o755 if parent.endswith('sockets') else 0o700))
  assert not os.path.lexists(root+'/records/'+request['context']['resource']['leaseId']+'.json')
  assert not os.path.lexists('/run/sakura-agent-sockets/'+request['context']['resource']['leaseId'])
  assert not os.path.lexists('/sys/fs/cgroup/sakura-task-'+request['context']['owner']['runId'])
  print(json.dumps({'version':1,'ok':True,'result':{'phase':'closed','context':request['context'],'record':None}})); sys.exit(0)
 os.close(directory(path,0o700))
fd=os.open(filename,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC); info=os.fstat(fd)
assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_gid==0 and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600 and 0<info.st_size<=262144
source=os.read(fd,262145); assert len(source)==info.st_size and not os.read(fd,1)
assert hashlib.sha256(source).hexdigest()==sha; os.close(fd)
sys.argv=[filename,sys.argv[1]]; exec(compile(source,filename,'exec'),{'__name__':'__main__','__file__':filename})
`;
const installer = `import hashlib,json,os,stat,sys,uuid,zlib,fcntl
request=json.loads(sys.argv[1]); root='/run/sakura-agent-forwards'; tools=root+'/tools'
def directory(path,create=False):
 if create and not os.path.lexists(path): os.mkdir(path,0o700)
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC); info=os.fstat(fd)
 assert info.st_uid==0 and info.st_gid==0 and not stat.S_IMODE(info.st_mode)&0o022
 if path!='/run': assert stat.S_IMODE(info.st_mode)==0o700
 return fd
os.umask(0o077); os.close(directory('/run')); os.close(directory(root,True)); parent=directory(tools,True)
lock=os.open('install.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,0o600,dir_fd=parent)
info=os.fstat(lock); assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_gid==0 and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600
fcntl.flock(lock,fcntl.LOCK_EX)
raw=sys.stdin.buffer.read(131073); assert len(raw)<=131072
codec=zlib.decompressobj(); source=codec.decompress(raw,262145)
assert codec.eof and not codec.unconsumed_tail and not codec.unused_data and len(source)==request['size'] and 0<len(source)<=262144
assert hashlib.sha256(source).hexdigest()==request['sha256']
def verify(path):
 gen=directory(path); fd=os.open('broker.py',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=gen); info=os.fstat(fd)
 assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_gid==0 and info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600 and info.st_size==len(source)
 value=os.read(fd,262145); assert len(value)==info.st_size and hashlib.sha256(value).hexdigest()==request['sha256']; os.close(fd)
 assert sorted(os.listdir(gen))==['broker.py']; os.close(gen)
target=tools+'/'+request['sha256']
if not os.path.lexists(target):
 stage=tools+'/stage-'+str(uuid.uuid4()); os.mkdir(stage,0o700); gen=directory(stage)
 fd=os.open('broker.py',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=gen)
 with os.fdopen(fd,'wb') as out: out.write(source); out.flush(); os.fsync(out.fileno())
 os.fsync(gen); os.close(gen); verify(stage); os.rename(stage,target); os.fsync(parent)
verify(target); print(json.dumps({'version':1,'ok':True,'sha256':request['sha256']}))
`;

export class SshAgentScopes {
  /**
   * 入口 / Entry: SshAgentScopes.constructor.
   * 功能：建立 SshAgentScopes 的定义 SSH Agent 任务票据与专属转发流上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the SshAgentScopes context for this module's responsibility: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; options: { sourceDirectory?: string } default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines, private options: { sourceDirectory?: string } = {}) {}
  /**
   * 入口 / Entry: SshAgentScopes.asset.
   * 功能：在定义 SSH Agent 任务票据与专属转发流中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...manifest, source }` 供上层消费（`SshAgentScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SshAgentScopes`; this entry produces `{ ...manifest, source }` for its caller. Module context: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed.
   * 处理：通过 `join`, `manifestSchema.parse`, `readFile`, `createHash().update().digest` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `manifestSchema.parse`, `readFile`, `createHash().update().digest`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ ...manifest, source }`.
   * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
   * 拒绝 / Refusals: 条件 / conditions `source.length !== manifest.size || createHash('sha256').update(source).digest('hex') !== manifest.sha256`; 异常 / errors `new Error('asset mismatch')`; `new AppError('SSH Agent broker 资产缺失或摘要不符', 503, 'PROJECT_IDENTITY_AGENT_ASSET_INVALID')`.
   * 失败处理：catch 分支执行 `throw new AppError('SSH Agent broker 资产缺失或摘要不符', 503, 'PROJECT_IDENTITY_AGENT_ASSET_INVALID');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('SSH Agent broker 资产缺失或摘要不符', 503, 'PROJECT_IDENTITY_AGENT_ASSET_INVALID');`; these statements determine whether a failure is absorbed or rejected again.
   */
  async asset() {
    const directory = this.options.sourceDirectory || join(ROOT, '.sakura-server/assets/ssh-agent');
    try {
      const manifest = manifestSchema.parse(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')));
      const source = await readFile(join(directory, manifest.file));
      if (source.length !== manifest.size || createHash('sha256').update(source).digest('hex') !== manifest.sha256)
        throw new Error('asset mismatch');
      return { ...manifest, source };
    } catch { throw new AppError('SSH Agent broker 资产缺失或摘要不符', 503, 'PROJECT_IDENTITY_AGENT_ASSET_INVALID'); }
  }
  /**
   * 入口 / Entry: SshAgentScopes.resource.
   * 功能：在定义 SSH Agent 任务票据与专属转发流中，执行此领域的具体处理步骤并返回其结果；本入口产生 `sshAgentResourceSchema.parse({ version: 1, kind: 'ssh-agent', leaseId: randomUUID(), brokerSha256: (await this.asset()).sha25…` 供上层消费（`SshAgentScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SshAgentScopes`; this entry produces `sshAgentResourceSchema.parse({ version: 1, kind: 'ssh-agent', leaseId: randomUUID(), brokerSha256: (await this.asset()).sha25…` for its caller. Module context: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed.
   * 处理：通过 `sshAgentResourceSchema.parse`, `randomUUID`, `this.asset` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `sshAgentResourceSchema.parse`, `randomUUID`, `this.asset`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: timeoutSeconds: number
   * 输出 / Returns: `sshAgentResourceSchema.parse({ version: 1, kind: 'ssh-agent', leaseId: randomUUID(), brokerSha256: (await this.asset()).sha25…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async resource(timeoutSeconds: number) {
    return sshAgentResourceSchema.parse({ version: 1, kind: 'ssh-agent', leaseId: randomUUID(),
      brokerSha256: (await this.asset()).sha256, timeoutSeconds });
  }
  /**
   * 入口 / Entry: SshAgentScopes.install.
   * 功能：在定义 SSH Agent 任务票据与专属转发流中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`SshAgentScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SshAgentScopes`; the calls and state transitions below complete the operation. Module context: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed.
   * 处理：通过 `this.asset`, `deflateSync`, `quote`, `this.machines.execInput` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.asset`, `deflateSync`, `quote`, `this.machines.execInput`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; resource: SshAgentResource; signal: AbortSignal
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.machines.execInput`.
   * 拒绝 / Refusals: 条件 / conditions `asset.sha256 !== resource.brokerSha256`; `reply.code !== 0 || !value.success || value.data.sha256 !== resource.brokerSha256`; 异常 / errors `new AppError('Agent 资产在任务准备后改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`; `new AppError('SSH Agent broker 私有 generation 安装未确认', 503, 'PROJECT_IDENTITY_AGENT_ASSET_INVALID')`.
   */
  async install(vmId: string, resource: SshAgentResource, signal: AbortSignal) {
    const asset = await this.asset();
    if (asset.sha256 !== resource.brokerSha256) throw new AppError('Agent 资产在任务准备后改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    const compressed = deflateSync(asset.source);
    const command = `# SAKURA_SSH_AGENT_INSTALL\n${fixedEnvironment} /usr/bin/python3 -I -S -c ${quote(installer)} ${quote(JSON.stringify({ sha256: asset.sha256, size: asset.size }))}`;
    const reply = await this.machines.execInput(vmId, command, compressed, 15000, signal);
    const value = z.object({ version: z.literal(1), ok: z.literal(true), sha256: digest }).strict().safeParse(parseJson(reply.stdout));
    if (reply.code !== 0 || !value.success || value.data.sha256 !== resource.brokerSha256)
      throw new AppError('SSH Agent broker 私有 generation 安装未确认', 503, 'PROJECT_IDENTITY_AGENT_ASSET_INVALID');
  }
  /**
   * 入口 / Entry: SshAgentScopes.command.
   * 功能：在定义 SSH Agent 任务票据与专属转发流中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``# SAKURA_SSH_AGENT_${action.toUpperCase()}\n${environment} /usr/bin/python3 -I -S -c ${quote(bootstrap)} ${quote(data)}`` 供上层消费（`SshAgentScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SshAgentScopes`; this entry produces ``# SAKURA_SSH_AGENT_${action.toUpperCase()}\n${environment} /usr/bin/python3 -I -S -c ${quote(bootstrap)} ${quote(data)}`` for its caller. Module context: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed.
   * 处理：通过 `sshAgentContextSchema.parse`, `action.toUpperCase`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `sshAgentContextSchema.parse`, `action.toUpperCase`, `quote`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: action: 'run' | 'cleanup' | 'read'; context: SshAgentContext; launcher: string optional
   * 输出 / Returns: ``# SAKURA_SSH_AGENT_${action.toUpperCase()}\n${environment} /usr/bin/python3 -I -S -c ${quote(bootstrap)} ${quote(data)}``.
   * 副作用 / Effects: 更新 / updates `context`.
   * 拒绝 / Refusals: 条件 / conditions `action === 'run' && !launcher`; 异常 / errors `new Error('missing fixed launcher')`.
   */
  command(action: 'run' | 'cleanup' | 'read', context: SshAgentContext, launcher?: string) {
    context = sshAgentContextSchema.parse(context);
    if (action === 'run' && !launcher) throw new Error('missing fixed launcher');
    const data = Buffer.from(JSON.stringify({ action, context, ...(launcher ? { launcher } : {}) })).toString('base64');
    // RUN has a single whitelisted sshd value. It never accepts a project env.
    const environment = fixedEnvironment + (action === 'run' ? ' SAKURA_SSH_AGENT_SOURCE="${SAKURA_SSH_AGENT_SOURCE-}"' : '');
    return `# SAKURA_SSH_AGENT_${action.toUpperCase()}\n${environment} /usr/bin/python3 -I -S -c ${quote(bootstrap)} ${quote(data)}`;
  }
  /**
   * 入口 / Entry: SshAgentScopes.cleanup.
   * 功能：在定义 SSH Agent 任务票据与专属转发流中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`SshAgentScopes`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `SshAgentScopes`; this entry produces `void` for its caller. Module context: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed.
   * 处理：通过 `sshAgentContextSchema.parse`, `owners.get().get`, `owners.get`, `ownerKey` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `sshAgentContextSchema.parse`, `owners.get().get`, `owners.get`, `ownerKey`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!live || this.machines.live.get(vmId) !== live`; `owner`; `owners.get(this.machines)?.get(ownerKey(vmId, context)) === owner`.
   * 输入 / Inputs: vmId: string; context: SshAgentContext
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `owner.agent.close`; `this.machines.exec`; `inline.delete`; 更新 / updates `context`, `owner.cleaned`, `failure`.
   * 拒绝 / Refusals: 条件 / conditions `owner`; `!same(owner.context, context)`; `reply.code !== 0 || !parsed.success || !same(parsed.data.result.context, context) || this.machines.live.get(vmId) !== live`; 异常 / errors `new AppError('本次 Agent 宿主归属已改变', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`; `new Error('Agent exact cleanup reply missing or changed')`.
   * 失败处理：catch 分支执行 `failure = error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `failure = error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async cleanup(vmId: string, context: SshAgentContext) {
    context = sshAgentContextSchema.parse(context);
    const owner = owners.get(this.machines)?.get(ownerKey(vmId, context));
    if (owner) {
      if (!same(owner.context, context))
        throw new AppError('本次 Agent 宿主归属已改变', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      await owner.agent.close();
    }
    let failure: unknown;
    const live = this.machines.live.get(vmId);
    for (let attempt = 0; attempt < 3; ++attempt) {
      if (!live || this.machines.live.get(vmId) !== live) break;
      try {
        const reply = await this.machines.exec(vmId, this.command('cleanup', context), 7000);
        const parsed = cleanupReply.safeParse(parseJson(reply.stdout));
        if (reply.code !== 0 || !parsed.success || !same(parsed.data.result.context, context) || this.machines.live.get(vmId) !== live)
          throw new Error('Agent exact cleanup reply missing or changed');
        if (owner) {
          owner.cleaned = true;
          if (owners.get(this.machines)?.get(ownerKey(vmId, context)) === owner)
            owners.get(this.machines)!.delete(ownerKey(vmId, context));
        }
        return;
      } catch (error) { failure = error; }
    }
    throw new AppError(`本次 SSH Agent 资源清理未确认，原运行回执保留：${failure instanceof Error ? failure.message : '客户机身份已改变'}`,
      503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  }
  /**
   * 入口 / Entry: SshAgentScopes.readonly.
   * 功能：在定义 SSH Agent 任务票据与专属转发流中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `parsed.data.result` 供上层消费（`SshAgentScopes`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `SshAgentScopes`; this entry produces `parsed.data.result` for its caller. Module context: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed.
   * 处理：通过 `this.machines.exec`, `this.command`, `readReply.safeParse`, `parseJson` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.exec`, `this.command`, `readReply.safeParse`, `parseJson`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; context: SshAgentContext
   * 输出 / Returns: `parsed.data.result`.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `reply.code !== 0 || !parsed.success || !same(parsed.data.result.context, context)`; 异常 / errors `new AppError('SSH Agent 资源回执读取未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`.
   */
  async readonly(vmId: string, context: SshAgentContext) {
    const reply = await this.machines.exec(vmId, this.command('read', context), 7000);
    const parsed = readReply.safeParse(parseJson(reply.stdout));
    if (reply.code !== 0 || !parsed.success || !same(parsed.data.result.context, context))
      throw new AppError('SSH Agent 资源回执读取未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    return parsed.data.result;
  }
}
const numberText = z.string().regex(/^(0|[1-9][0-9]*)$/);
const unixObject = z.object({ device: numberText, inode: numberText,
  uid: z.number().int().nonnegative(), gid: z.number().int().nonnegative(),
  mode: z.number().int().min(0).max(0o7777), type: z.number().int() }).strict();
const processSchema = z.object({ pid: z.number().int().min(2), startTicks: numberText }).strict();
export const sshAgentRecordSchema = z.object({ version: z.literal(1), context: sshAgentContextSchema,
  phase: z.enum(['preparing', 'ready', 'failed', 'closed']),
  scope: z.object({ device: numberText, inode: numberText, controlToken: z.uuid() }).strict(),
  source: z.object({ path: z.string().min(1).max(107), parent: unixObject, socket: unixObject, peer: processSchema }).strict().nullable(),
  endpointDirectory: unixObject.nullable(), endpoint: unixObject.nullable(), broker: processSchema.nullable(),
  failure: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable() }).strict().superRefine((value, ctx) => {
  if (value.phase === 'ready' && (!value.source || !value.endpointDirectory || !value.endpoint || !value.broker || value.failure))
    ctx.addIssue({ code: 'custom', message: 'Agent ready 回执缺少完整对象身份' });
});
const resultSchema = z.object({ phase: z.enum(['preparing', 'ready', 'failed', 'closed']),
  context: sshAgentContextSchema, record: sshAgentRecordSchema.nullable() }).strict().superRefine((value, ctx) => {
  if ((!value.record && value.phase !== 'closed') || (value.record &&
      (value.record.phase !== value.phase || !same(value.record.context, value.context))))
    ctx.addIssue({ code: 'custom', message: 'Agent 回执与原上下文不符' });
});
const readReply = z.object({ version: z.literal(1), ok: z.literal(true), result: resultSchema }).strict();
const cleanupReply = z.object({ version: z.literal(1), ok: z.literal(true),
  result: resultSchema.safeExtend({ phase: z.literal('closed') }) }).strict();
/**
 * 入口 / Entry: parseJson.
 * 功能：在定义 SSH Agent 任务票据与专属转发流中，转换协议或持久数据表示并保持调用边界；本入口产生 `JSON.parse(text)` / `null` 供上层消费（`ssh-agent-scope.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `ssh-agent-scope.ts`; this entry produces `JSON.parse(text)` / `null` for its caller. Module context: Defines SSH Agent task tickets/exclusive streams, retaining leases when physical closure is unconfirmed.
 * 输入 / Inputs: text: string
 * 输出 / Returns: `JSON.parse(text)`; `null`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败处理：catch 分支执行 `return null;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return null;`; these statements determine whether a failure is absorbed or rejected again.
 */
const parseJson = (text: string) => { try { return JSON.parse(text); } catch { return null; } };
