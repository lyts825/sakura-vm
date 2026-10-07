/**
 * 模块职责：安装并运行绑定项目账户的浏览器 IDE；连接与停止都核对原会话的完整运行归属。
 * Module purpose: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { networkFor } from './network/index.ts';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import type { Project } from './project-config.ts';

import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { quote } from './shell.ts';
import { guestTask } from './guest-task.ts';
import { readStore, writeStore } from './local-store.ts';
import { ensureProjectNetworkScript } from './project-network-isolation.ts';
import { ProjectNetworkBridges } from './project-network-bridges.ts';

export const browserIdeInput = z.object({
  mode: z.enum(['status', 'install', 'start', 'stop']).default('status'),
  guestPort: z.number().int().min(1024).max(65535).default(8080),
  hostPort: z.number().int().min(1024).max(65535).default(8080),
  ttlMinutes: z.number().int().min(1).max(240).default(60),
}).strict();
type Input = z.infer<typeof browserIdeInput>;

// The pinned archive is a self-contained Linux amd64 build. Check the release
// digest before any archive contents become executable in the guest.
const VERSION = '4.132.0';
const SHA256 = 'a38d26f4cb81f768feddff79e2937fd3f39c83d3da8be3da7225e1087e62e4ed';
const archive = `code-server-${VERSION}-linux-amd64`;
const installRoot = '/opt/sakura/browser-ide';
const binary = `${installRoot}/${VERSION}/bin/code-server`;
const releaseUrl = `https://github.com/coder/code-server/releases/download/v${VERSION}/${archive}.tar.gz`;
const assetUrl = 'https://api.github.com/repos/coder/code-server/releases/assets/509052857?download=1';
const packageCache = '/var/cache/sakura/browser-ide';
export const browserIdePackage = { version: VERSION, fileName: `${archive}.tar.gz`,
  sha256: SHA256, url: releaseUrl, assetUrl, cachePath: `${packageCache}/${archive}.tar.gz` } as const;

import { ProjectRunScopes, type ProjectInheritedPayload } from './project-run-scope.ts';
import {
  ProjectIdentities,
  projectIdentityPayload,
  projectIdentityRunSchema,
  projectIdentitySchema,
  type ProjectIdentityRun,
} from './project-identity.ts';
import { ProjectBrowserIdeScope, projectBrowserIdeRecordSchema, type ProjectBrowserIdeRecord } from './project-service-scope.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';

const { fetch } = networkFor('core:browser-ide');
const executionSchema = z.object({ identity: projectIdentitySchema,
  record: projectBrowserIdeRecordSchema, run: projectIdentityRunSchema.nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const browserIdeSessionSchema = z.object({
  vmId: z.uuid(), projectId: z.string().regex(/^(default|[a-f0-9]{16})$/),
  directory: z.string().min(1).max(4096),
  guestPort: z.number().int().min(1024).max(65535),
  hostPort: z.number().int().min(1024).max(65535),
  password: z.string().regex(/^[a-f0-9]{64}$/), createdForward: z.boolean(),
  status: z.enum(['starting', 'running', 'review']),
  networkIsolation: z.enum(['host', 'private']).default('host'),
  startedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  execution: executionSchema.optional(),
}).strict().superRefine((session, context) => {
  const execution = session.execution;
  if (session.networkIsolation === 'private' && session.createdForward || execution && (
      session.createdForward || execution.identity.phase !== 'active' ||
      execution.identity.projectId !== session.projectId || execution.record.projectId !== session.projectId ||
      execution.identity.directory !== session.directory || execution.identity.networkIsolation !== session.networkIsolation ||
      session.status === 'running' && (!execution.run || execution.record.phase !== 'running') ||
      execution.run && !nativeMatches(execution.run, execution.identity, execution.record)))
    context.addIssue({ code: 'custom', message: '浏览器 IDE 的完整账号运行归属不符' });
});
type Session = z.infer<typeof browserIdeSessionSchema>;
const storeSchema = z.object({ version: z.literal(1), sessions: z.array(browserIdeSessionSchema).max(128) }).strict();
/**
 * 入口 / Entry: keyOf.
 * 功能：从当前输入或状态计算 ``${session.vmId}:${session.projectId}``，供调用方后续验证或使用。
 * Purpose: Computes ``${session.vmId}:${session.projectId}`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: session: Session
 * 输出 / Returns: ``${session.vmId}:${session.projectId}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const keyOf = (session: Session) => `${session.vmId}:${session.projectId}`;
/**
 * 入口 / Entry: same.
 * 功能：把本层请求转交 `isDeepStrictEqual`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `isDeepStrictEqual` and propagates the provider result or rejection.
 * 输入 / Inputs: left: unknown; right: unknown
 * 输出 / Returns: `isDeepStrictEqual(left, right)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const same = (left: unknown, right: unknown) => isDeepStrictEqual(left, right);
/**
 * 入口 / Entry: scopeChanged.
 * 功能：从当前输入或状态计算 `new AppError('浏览器 IDE 原账号、boot、进程或运行域无法核对，请先停止原会话', 409, 'BROWSER_IDE_SCOPE_CHANGED')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('浏览器 IDE 原账号、boot、进程或运行域无法核对，请先停止原会话', 409, 'BROWSER_IDE_SCOPE_CHANGED')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('浏览器 IDE 原账号、boot、进程或运行域无法核对，请先停止原会话', 409, 'BROWSER_IDE_SCOPE_CHANGED')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const scopeChanged = () => new AppError('浏览器 IDE 原账号、boot、进程或运行域无法核对，请先停止原会话', 409, 'BROWSER_IDE_SCOPE_CHANGED');
/**
 * 入口 / Entry: legacy.
 * 功能：从当前输入或状态计算 `new AppError('旧浏览器 IDE 尚未接入项目账号；请管理员确认关闭原 root 会话及全部后代，并明确迁移项目目录后重建，原记录继续保留', 409, 'BROWSER_IDE_IDENTITY_REQUIRED')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('旧浏览器 IDE 尚未接入项目账号；请管理员确认关闭原 root 会话及全部后代，并明确迁移项目目录后重建，原记录继续保留', 409, 'BROWSER_IDE_IDENTITY_REQUIRED')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('旧浏览器 IDE 尚未接入项目账号；请管理员确认关闭原 root 会话及全部后代，并明确迁移项目目录后重建，原记录继续保留', 409, 'BROWSER_IDE_IDENTITY_REQUIRED')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const legacy = () => new AppError('旧浏览器 IDE 尚未接入项目账号；请管理员确认关闭原 root 会话及全部后代，并明确迁移项目目录后重建，原记录继续保留', 409, 'BROWSER_IDE_IDENTITY_REQUIRED');
/**
 * 入口 / Entry: nativeMatches.
 * 功能：从当前输入或状态计算 `run.phase === 'active' && run.mode === 'inherit-current' && run.projectId === identity.projectId && run.registryId === identi…`，供调用方后续验证或使用。
 * Purpose: Computes `run.phase === 'active' && run.mode === 'inherit-current' && run.projectId === identity.projectId && run.registryId === identi…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: run: ProjectIdentityRun; identity: z.infer<typeof projectIdentitySchema>; record: ProjectBrowserIdeRecord
 * 输出 / Returns: `run.phase === 'active' && run.mode === 'inherit-current' && run.projectId === identity.projectId && run.registryId === identi…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function nativeMatches(run: ProjectIdentityRun, identity: z.infer<typeof projectIdentitySchema>, record: ProjectBrowserIdeRecord) {
  return run.phase === 'active' && run.mode === 'inherit-current' && run.projectId === identity.projectId &&
    run.registryId === identity.registryId && run.identityId === identity.identityId && run.revision === identity.revision &&
    run.runId === record.runId && run.bootId === record.bootId && run.cgroupName === record.scopeName &&
    record.inode !== null && run.cgroupInode === record.inode && run.namespace === (identity.networkIsolation === 'private' ? 'sk-' + identity.projectId : '');
}
/**
 * 入口 / Entry: httpReady.
 * 功能：在安装并运行绑定项目账户的浏览器 IDE中，执行此领域的具体处理步骤并返回其结果；本入口产生 `response.ok` / `false` 供上层消费（`browser-ide.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `browser-ide.ts`; this entry produces `response.ok` / `false` for its caller. Module context: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
 * 处理：通过 `fetch`, `AbortSignal.timeout`, `response.body.cancel` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `fetch`, `AbortSignal.timeout`, `response.body.cancel`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: session: Session
 * 输出 / Returns: `response.ok`; `false`.
 * 副作用 / Effects: `fetch`; `AbortSignal.timeout`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `return false;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return false;`; these statements determine whether a failure is absorbed or rejected again.
 */
async function httpReady(session: Session) {
  try {
    const response = await fetch(`http://127.0.0.1:${session.hostPort}/healthz`,
      { redirect: 'manual', signal: AbortSignal.timeout(2500) });
    await response.body?.cancel(); return response.ok;
  } catch { return false; }
}
type Scope = Pick<ProjectBrowserIdeScope, 'status' | 'newIntent' | 'persistIntent' | 'start' | 'stop'>;
type Options = {
  scopes?: Pick<ProjectRunScopes, 'identity' | 'inherited' | 'active' | 'readonlyActive'>;
  identities?: Pick<ProjectIdentities, 'runReadonly'>;
  /**
   * 签名 / Signature: Options.processScope.
   * 功能：为安装并运行绑定项目账户的浏览器 IDE声明 processScope 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for processScope in Options. Module responsibility: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
   * 输入 / Inputs: id: string; project: Project; expiresAt: string optional
   * 输出 / Returns: Scope.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  processScope?: (id: string, project: Project, expiresAt?: string) => Scope;
  bridges?: Pick<ProjectNetworkBridges, 'open' | 'stop' | 'close'>;
  /**
   * 签名 / Signature: Options.listener.
   * 功能：为安装并运行绑定项目账户的浏览器 IDE声明 listener 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for listener in Options. Module responsibility: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
   * 输入 / Inputs: session: Session; signal: AbortSignal optional
   * 输出 / Returns: Promise<boolean>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  listener?: (session: Session, signal?: AbortSignal) => Promise<boolean>;
};

/** Read kernel ownership only: no project file, command or environment is interpreted by root. */
/**
 * 入口 / Entry: browserIdeListenerCommand.
 * 功能：在安装并运行绑定项目账户的浏览器 IDE中，执行此领域的具体处理步骤并返回其结果；本入口产生 `'# SAKURA_BROWSER_IDE_LISTENER\nenv -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' …` 供上层消费（`browser-ide.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `browser-ide.ts`; this entry produces `'# SAKURA_BROWSER_IDE_LISTENER\nenv -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' …` for its caller. Module context: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
 * 处理：通过 `nativeMatches`, `scopeChanged`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `nativeMatches`, `scopeChanged`, `quote`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: session: Session
 * 输出 / Returns: `'# SAKURA_BROWSER_IDE_LISTENER\nenv -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!execution?.run || !nativeMatches(execution.run, execution.identity, execution.record)`; 异常 / errors `scopeChanged()`.
 */
export function browserIdeListenerCommand(session: Session) {
  const execution = session.execution;
  if (!execution?.run || !nativeMatches(execution.run, execution.identity, execution.record)) throw scopeChanged();
  const { run, identity } = execution;
  const request = { bootId: run.bootId, cgroupName: run.cgroupName, cgroupDevice: run.cgroupDevice,
    cgroupInode: run.cgroupInode, networkDevice: run.networkDevice, networkInode: run.networkInode,
    namespace: run.namespace, uid: identity.uid, gid: identity.gid, port: session.guestPort };
  const source = `import glob,json,os,stat,fcntl
request=${JSON.stringify(request)}
def refuse(): raise ValueError('browser IDE listener ownership changed')
if open('/proc/sys/kernel/random/boot_id').read().strip()!=request['bootId']: refuse()
if not any(row.split()[3]=='/' and row.split()[4]=='/sys/fs/cgroup' and ' - cgroup2 ' in row for row in open('/proc/self/mountinfo')): refuse()
group='/sys/fs/cgroup/'+request['cgroupName']
info=os.lstat(group)
if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022 or str(info.st_dev)!=request['cgroupDevice'] or str(info.st_ino)!=request['cgroupInode']: refuse()
network='/run/netns/'+request['namespace'] if request['namespace'] else '/proc/1/ns/net'
if request['namespace']:
 for path in ['/run','/run/netns']:
  info=os.lstat(path)
  if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022: refuse()
descriptor=os.open(network,os.O_RDONLY|os.O_CLOEXEC)
try:
 info=os.fstat(descriptor)
 if info.st_uid!=0 or fcntl.ioctl(descriptor,0xb703)!=0x40000000 or str(info.st_dev)!=request['networkDevice'] or str(info.st_ino)!=request['networkInode']: refuse()
finally: os.close(descriptor)
def read(parent,name,limit):
 descriptor=os.open(name,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent)
 try:
  data=b''
  while len(data)<=limit:
   part=os.read(descriptor,min(4096,limit+1-len(data)))
   if not part: return data
   data+=part
  refuse()
 finally: os.close(descriptor)
found=False; candidates=glob.glob('/proc/[0-9]*')
if len(candidates)>32768: refuse()
for path in candidates:
 process=None; net=None; files=None
 try:
  process=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
  membership=read(process,'cgroup',4096).decode().strip()
  if membership!='0::/'+request['cgroupName'] and not membership.startswith('0::/'+request['cgroupName']+'/'): continue
  status=dict(line.split(':',1) for line in read(process,'status',65536).decode().splitlines() if ':' in line)
  if status.get('Uid','').split()!=[str(request['uid'])]*4 or status.get('Gid','').split()!=[str(request['gid'])]*4: continue
  before=read(process,'stat',4096).rsplit(b')',1)[1].split()
  if len(before)<20 or before[0] in [b'Z',b'X',b'x']: continue
  net=os.open('ns/net',os.O_RDONLY|os.O_CLOEXEC,dir_fd=process)
  info=os.fstat(net)
  if str(info.st_dev)!=request['networkDevice'] or str(info.st_ino)!=request['networkInode'] or fcntl.ioctl(net,0xb703)!=0x40000000: continue
  files=os.open('fd',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=process)
  sockets=set()
  for name in os.listdir(files):
   try: sockets.add(os.readlink(name,dir_fd=files))
   except (FileNotFoundError,ProcessLookupError): pass
  rows=read(process,'net/tcp',1048576).decode().splitlines()[1:]
  listener='0100007F:'+format(request['port'],'04X')
  owned=any(len(row.split())>9 and row.split()[1]==listener and row.split()[3]=='0A' and 'socket:['+row.split()[9]+']' in sockets for row in rows)
  after=read(process,'stat',4096).rsplit(b')',1)[1].split()
  if owned and before[19]==after[19] and after[0] not in [b'Z',b'X',b'x'] and membership==read(process,'cgroup',4096).decode().strip(): found=True; break
 except (FileNotFoundError,ProcessLookupError): pass
 finally:
  for descriptor in [files,net,process]:
   if descriptor is not None: os.close(descriptor)
info=os.lstat(group)
if str(info.st_dev)!=request['cgroupDevice'] or str(info.st_ino)!=request['cgroupInode'] or open('/proc/sys/kernel/random/boot_id').read().strip()!=request['bootId']: refuse()
print(json.dumps({'ready':found}))
`;
  return '# SAKURA_BROWSER_IDE_LISTENER\nenv -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' + quote(source);
}

export class BrowserIde {
  private state?: z.infer<typeof storeSchema>;
  private writes: Promise<unknown> = Promise.resolve();
  private active = new Set<string>();
  private controls = new Map<string, Promise<unknown>>();
  private installs = new Map<string, Promise<void>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private closed = false;
  private bridges: Pick<ProjectNetworkBridges, 'open' | 'stop' | 'close'>;
  private scopes: NonNullable<Options['scopes']>;
  private identities: NonNullable<Options['identities']>;
  /**
   * 入口 / Entry: BrowserIde.constructor.
   * 功能：建立 BrowserIde 的安装并运行绑定项目账户的浏览器 IDE上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the BrowserIde context for this module's responsibility: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; file: default=join(DATA, 'browser-ide.json'); probeHttp: (session: Session) => Promise<boolean> default=httpReady; options: Options default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.scopes`, `this.identities`, `this.bridges`.
   */
  constructor(private machines: Machines, private workspaces: WorkspacesV1,
    private file = join(DATA, 'browser-ide.json'), private probeHttp: (session: Session) => Promise<boolean> = httpReady,
    private options: Options = {}) {
    this.scopes = options.scopes || new ProjectRunScopes(machines);
    this.identities = options.identities || new ProjectIdentities(machines);
    this.bridges = options.bridges || new ProjectNetworkBridges(machines, async (id, project, signal) => {
      const session = this.state?.sessions.find(item => item.vmId === id && item.projectId === (project._workspace || 'default'));
      if (!session || !await this.prove(session, project, signal)) throw scopeChanged();
    });
  }
  /**
   * 入口 / Entry: BrowserIde.scope.
   * 功能：从当前输入或状态计算 `this.options.processScope?.(session.vmId, project, session.expiresAt) || new ProjectBrowserIdeScope(this.machines, session.vm…`，供调用方后续验证或使用。
   * Purpose: Computes `this.options.processScope?.(session.vmId, project, session.expiresAt) || new ProjectBrowserIdeScope(this.machines, session.vm…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: session: Session
   * 输出 / Returns: Scope；结果来自 / values from `this.options.processScope?.(session.vmId, project, session.expiresAt) || new ProjectBrowserIdeScope(this.machines, session.vm…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private scope(session: Session): Scope {
    const project = { _workspace: session.projectId, directory: session.directory, networkIsolation: session.networkIsolation } as Project;
    return this.options.processScope?.(session.vmId, project, session.expiresAt) ||
      new ProjectBrowserIdeScope(this.machines, session.vmId, project, session.expiresAt);
  }
  /**
   * 入口 / Entry: BrowserIde.current.
   * 功能：把本层请求转交 `this.state.sessions.find`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.state.sessions.find` and propagates the provider result or rejection.
   * 输入 / Inputs: session: Session
   * 输出 / Returns: `this.state?.sessions.find(item => keyOf(item) === keyOf(session) && item.startedAt === session.startedAt && item.password ===…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private current(session: Session) {
    return this.state?.sessions.find(item => keyOf(item) === keyOf(session) && item.startedAt === session.startedAt &&
      item.password === session.password && same(item.execution, session.execution));
  }
  /**
   * 入口 / Entry: BrowserIde.change.
   * 功能：在安装并运行绑定项目账户的浏览器 IDE中，执行此领域的具体处理步骤并返回其结果；本入口产生 `operation` 供上层消费（`BrowserIde`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BrowserIde`; this entry produces `operation` for its caller. Module context: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: edit: (state: z.infer<typeof storeSchema>) => T
   * 输出 / Returns: `operation`.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async change<T>(edit: (state: z.infer<typeof storeSchema>) => T) {
    /**
     * 入口 / Entry: BrowserIde.change.callback@209.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.writes.catch().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.writes.catch().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `result`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const operation = this.writes.catch(() => {}).then(async () => {
      const next = structuredClone(this.state!); const result = edit(next);
      storeSchema.parse(next); await writeStore(this.file, next); this.state = next; return result;
    });
    this.writes = operation; return operation;
  }
  /**
   * 入口 / Entry: BrowserIde.init.
   * 功能：在安装并运行绑定项目账户的浏览器 IDE中，初始化并核对当前领域状态；处理结果记录到 `this.state`（`BrowserIde`）。
   * Purpose: Initializes and verifies current domain state in `BrowserIde`; the outcome is recorded in `this.state`. Module context: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
   * 处理：通过 `storeSchema.parse`, `readStore`, `this.state.sessions.some`, `this.change` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `storeSchema.parse`, `readStore`, `this.state.sessions.some`, `this.change`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.state.sessions.some(item => item.status === 'starting')`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.state`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    this.state = storeSchema.parse(await readStore(this.file, () => ({ version: 1, sessions: [] })));
    // Existing owner records remain recoverable, including deleted/unavailable VMs.
    if (this.state.sessions.some(item => item.status === 'starting'))
      await this.change(state => { for (const item of state.sessions) if (item.status === 'starting') item.status = 'review'; });
    for (const session of this.state.sessions) this.schedule(session);
  }
  /**
   * 入口 / Entry: BrowserIde.close.
   * 功能：在安装并运行绑定项目账户的浏览器 IDE中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`BrowserIde`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `BrowserIde`; the outcome is recorded in `this.closed`. Module context: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
   * 处理：通过 `this.timers.values`, `clearTimeout`, `this.timers.clear`, `this.bridges.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.timers.values`, `clearTimeout`, `this.timers.clear`, `this.bridges.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `clearTimeout`; `this.timers.clear`; `this.bridges.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true; for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear();
    await this.bridges.close(); await Promise.allSettled(this.controls.values()); await this.writes;
  }
  /**
   * 入口 / Entry: BrowserIde.context.
   * 功能：在安装并运行绑定项目账户的浏览器 IDE中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ vm, projectId, session: this.state!.sessions.find(item => item.vmId === id && item.projectId === projectId) }` 供上层消费（`BrowserIde`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BrowserIde`; this entry produces `{ vm, projectId, session: this.state!.sessions.find(item => item.vmId === id && item.projectId === projectId) }` for its caller. Module context: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
   * 处理：通过 `this.machines.get`, `this.workspaces.projects.current`, `inline.sessions.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.workspaces.projects.current`, `inline.sessions.find`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ vm, projectId, session: this.state!.sessions.find(item => item.vmId === id && item.projectId === projectId) }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private context(id: string) {
    const vm = this.machines.get(id), projectId = this.workspaces.projects.current(id);
    return { vm, projectId, session: this.state!.sessions.find(item => item.vmId === id && item.projectId === projectId) };
  }
  /**
   * 入口 / Entry: BrowserIde.control.
   * 功能：在安装并运行绑定项目账户的浏览器 IDE中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await pending` 供上层消费（`BrowserIde`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BrowserIde`; this entry produces `await pending` for its caller. Module context: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
   * 处理：通过 `keyOf`, `inline.catch().then`, `inline.catch`, `this.controls.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `keyOf`, `inline.catch().then`, `inline.catch`, `this.controls.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.controls.get(key) === pending`.
   * 输入 / Inputs: session: Session; work: () => Promise<T>
   * 输出 / Returns: `await pending`.
   * 副作用 / Effects: `this.controls.set`; `this.controls.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `if (this.controls.get(key) === pending) this.controls.delete(key);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `if (this.controls.get(key) === pending) this.controls.delete(key);`; these steps also apply to exceptional exits.
   */
  private async control<T>(session: Session, work: () => Promise<T>) {
    const key = keyOf(session), pending = (this.controls.get(key) || Promise.resolve()).catch(() => {}).then(work);
    this.controls.set(key, pending);
    try { return await pending; } finally { if (this.controls.get(key) === pending) this.controls.delete(key); }
  }
  /**
   * 入口 / Entry: BrowserIde.schedule.
   * 功能：在安装并运行绑定项目账户的浏览器 IDE中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`BrowserIde`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BrowserIde`; this entry produces `void` for its caller. Module context: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
   * 处理：通过 `keyOf`, `this.timers.get`, `clearTimeout`, `setTimeout` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `keyOf`, `this.timers.get`, `clearTimeout`, `setTimeout`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || !session.execution`; `previous`.
   * 输入 / Inputs: session: Session; retryMs: number optional
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `clearTimeout`; `setTimeout`; `this.timers.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private schedule(session: Session, retryMs?: number) {
    if (this.closed || !session.execution) return;
    const key = keyOf(session), previous = this.timers.get(key); if (previous) clearTimeout(previous);
    const timer = setTimeout(() => { this.timers.delete(key); void this.expire(session); },
      retryMs ?? Math.max(0, Date.parse(session.expiresAt) - Date.now()));
    timer.unref?.(); this.timers.set(key, timer);
  }
  /**
   * 入口 / Entry: BrowserIde.expire.
   * 功能：在安装并运行绑定项目账户的浏览器 IDE中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`BrowserIde`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BrowserIde`; this entry produces `void` for its caller. Module context: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
   * 处理：通过 `keyOf`, `this.current`, `this.schedule`, `this.active.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `keyOf`, `this.current`, `this.schedule`, `this.active.has`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`; `!current`; `Date.now() < Date.parse(current.expiresAt)`.
   * 输入 / Inputs: session: Session
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.active.add`; `this.active.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `this.active.delete(key);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.active.delete(key);`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `this.schedule(current, 1000);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.schedule(current, 1000);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async expire(session: Session) {
    if (this.closed) return; const key = keyOf(session), current = this.current(session);
    if (!current) return;
    if (Date.now() < Date.parse(current.expiresAt)) { this.schedule(current); return; }
    if (this.active.has(key)) { this.schedule(current, 5000); return; }
    this.active.add(key);
    try { await this.machines.locked(session.vmId, () => this.stop(session.vmId, current, new AbortController().signal)); }
    catch { this.schedule(current, 1000); }
    finally { this.active.delete(key); }
  }
  /**
   * 入口 / Entry: BrowserIde.matchesProject.
   * 功能：从当前输入或状态计算 `session.projectId === (project._workspace || 'default') && session.directory === project.directory && session.networkIsolatio…`，供调用方后续验证或使用。
   * Purpose: Computes `session.projectId === (project._workspace || 'default') && session.directory === project.directory && session.networkIsolatio…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: session: Session; project: Project
   * 输出 / Returns: `session.projectId === (project._workspace || 'default') && session.directory === project.directory && session.networkIsolatio…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private matchesProject(session: Session, project: Project) {
    return session.projectId === (project._workspace || 'default') && session.directory === project.directory &&
      session.networkIsolation === (project.networkIsolation || 'host');
  }
  /**
   * 入口 / Entry: BrowserIde.prove.
   * 功能：在安装并运行绑定项目账户的浏览器 IDE中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `listener && this.machines.live.get(session.vmId) === instance && !!unchanged && unchanged.status !== 'review'` 供上层消费（`BrowserIde`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BrowserIde`; this entry produces `false` / `listener && this.machines.live.get(session.vmId) === instance && !!unchanged && unchanged.status !== 'review'` for its caller. Module context: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
   * 处理：通过 `this.current`, `this.matchesProject`, `this.machines.state`, `this.machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.current`, `this.matchesProject`, `this.machines.state`, `this.machines.live.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || !current || current.status === 'review' || !this.matchesProject(session, project) || …`; `!instance`; `status.status !== 'running' || !status.record || !same(status.record, execution.record) || status.bo…`.
   * 输入 / Inputs: session: Session; project: Project; signal: AbortSignal optional
   * 输出 / Returns: `false`; `listener && this.machines.live.get(session.vmId) === instance && !!unchanged && unchanged.status !== 'review'`.
   * 副作用 / Effects: `this.options.listener`; `this.machines.exec`; 更新 / updates `listener`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async prove(session: Session, project: Project, signal?: AbortSignal) {
    const current = this.current(session);
    if (this.closed || !current || current.status === 'review' || !this.matchesProject(session, project) ||
        !session.execution?.run || Date.now() >= Date.parse(session.expiresAt) || this.machines.state(session.vmId) !== 'running') return false;
    const instance = this.machines.live.get(session.vmId), execution = session.execution;
    if (!instance) return false;
    const status = await this.scope(session).status(signal, execution.sha256);
    if (status.status !== 'running' || !status.record || !same(status.record, execution.record) || status.bootId !== execution.run!.bootId) return false;
    if (!await this.scopes.readonlyActive(session.vmId, session.projectId, execution.record.runId, signal)) return false;
    const run = await this.identities.runReadonly(session.vmId, execution.identity, execution.record.runId, signal);
    if (!same(run, execution.run) || !nativeMatches(run, execution.identity, execution.record)) return false;
    let listener = false;
    if (this.options.listener) listener = await this.options.listener(session, signal);
    else {
      const result = await this.machines.exec(session.vmId, browserIdeListenerCommand(session), 10000, signal);
      listener = result.code === 0 && z.object({ ready: z.boolean() }).strict().parse(JSON.parse(result.stdout)).ready;
    }
    const unchanged = this.current(session);
    return listener && this.machines.live.get(session.vmId) === instance && !!unchanged && unchanged.status !== 'review';
  }
  /**
   * 入口 / Entry: BrowserIde.installed.
   * 功能：在安装并运行绑定项目账户的浏览器 IDE中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `result.code === 0` 供上层消费（`BrowserIde`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BrowserIde`; this entry produces `false` / `result.code === 0` for its caller. Module context: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
   * 处理：通过 `this.machines.state`, `this.machines.exec`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.state`, `this.machines.exec`, `quote`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.machines.state(id) !== 'running'`.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `false`; `result.code === 0`.
   * 副作用 / Effects: `this.machines.exec`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async installed(id: string, signal?: AbortSignal) {
    if (this.machines.state(id) !== 'running') return false;
    const result = await this.machines.exec(id, `test -x ${quote(binary)}`, 5000, signal); return result.code === 0;
  }
  /**
   * 入口 / Entry: BrowserIde.restoreBridge.
   * 功能：把本层请求转交 `this.control`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.control` and propagates the provider result or rejection.
   * 输入 / Inputs: session: Session; project: Project; signal: AbortSignal optional
   * 输出 / Returns: `this.control(session, async () => { if (!await this.prove(session, project, signal)) throw scopeChanged(); await this.bridges…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private restoreBridge(session: Session, project: Project, signal?: AbortSignal) {
    return this.control(session, async () => {
      if (!await this.prove(session, project, signal)) throw scopeChanged();
      await this.bridges.open(session.vmId, project, session.guestPort, session.hostPort, signal, true);
      if (!this.current(session)) { await this.bridges.stop(session.vmId, session.projectId); throw scopeChanged(); }
    });
  }
  /**
   * 入口 / Entry: BrowserIde.view.
   * 功能：在安装并运行绑定项目账户的浏览器 IDE中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ ready: supported && running, executed: false, supported, installed, projectId, session: session ? { directory: session.dire…` 供上层消费（`BrowserIde`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `BrowserIde`; this entry produces `{ ready: supported && running, executed: false, supported, installed, projectId, session: session ? { directory: session.dire…` for its caller. Module context: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
   * 处理：通过 `browserIdeInput.parse`, `this.context`, `this.workspaces.config`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `browserIdeInput.parse`, `this.context`, `this.workspaces.config`, `this.machines.state`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `session && !expired && session.execution`; `session`.
   * 输入 / Inputs: id: string; input: unknown default={}; signal: AbortSignal optional
   * 输出 / Returns: `{ ready: supported && running, executed: false, supported, installed, projectId, session: session ? { directory: session.dire…`.
   * 副作用 / Effects: `this.installed`; `this.bridges.stop`; 更新 / updates `reachable`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; 异常 / errors `new AppError('浏览器 IDE 服务已关闭', 409)`.
   * 失败处理：catch 分支执行 `signal?.throwIfAborted();`; `await this.bridges.stop(id, projectId);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `signal?.throwIfAborted();`; `await this.bridges.stop(id, projectId);`; these statements determine whether a failure is absorbed or rejected again.
   */
  async view(id: string, input: unknown = {}, signal?: AbortSignal) {
    if (this.closed) throw new AppError('浏览器 IDE 服务已关闭', 409); browserIdeInput.parse(input);
    const { vm, projectId, session } = this.context(id), project = await this.workspaces.config(id);
    const supported = vm.distro === 'debian' || vm.distro === 'ubuntu', running = this.machines.state(id) === 'running';
    const installed = running && await this.installed(id, signal), expired = !!session && Date.now() >= Date.parse(session.expiresAt);
    let reachable = false;
    if (session && !expired && session.execution) {
      try { await this.restoreBridge(session, project, signal); reachable = await this.probeHttp(session); }
      catch { signal?.throwIfAborted(); await this.bridges.stop(id, projectId); }
    } else if (session) await this.bridges.stop(id, projectId);
    return { ready: supported && running, executed: false, supported, installed, projectId,
      session: session ? { directory: session.directory, hostPort: session.hostPort, guestPort: session.guestPort,
        startedAt: session.startedAt, expiresAt: session.expiresAt,
        status: expired ? 'expired' : !session.execution ? 'review' : reachable ? 'running' : 'unhealthy',
        needsReview: !session.execution || session.status === 'review' } : null,
      message: !supported ? '浏览器 IDE 目前支持 Debian 和 Ubuntu 客户机。' : !running ? '请先启动实例。' :
        !session?.execution && session ? legacy().message : '浏览器 IDE 使用项目账号与独立 home，通过本机回环桥接访问。' };
  }
  /**
   * 入口 / Entry: BrowserIde.removeForward.
   * 功能：在安装并运行绑定项目账户的浏览器 IDE中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`BrowserIde`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `BrowserIde`; this entry produces `void` for its caller. Module context: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
   * 处理：通过 `this.machines.get`, `forwards.some`, `this.machines.setForwards`, `forwards.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `forwards.some`, `this.machines.setForwards`, `forwards.filter`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!session.createdForward`; `forwards.some(owns)`.
   * 输入 / Inputs: id: string; session: Session
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.machines.setForwards`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async removeForward(id: string, session: Session) {
    if (!session.createdForward) return;
    const forwards = this.machines.get(id).forwards;
    /**
     * 入口 / Entry: BrowserIde.removeForward.owns.
     * 功能：从当前输入或状态计算 `item.host === session.hostPort && item.guest === session.guestPort && item.name === 'browser-ide'`，供调用方后续验证或使用。
     * Purpose: Computes `item.host === session.hostPort && item.guest === session.guestPort && item.name === 'browser-ide'` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: item: typeof forwards[number]
     * 输出 / Returns: `item.host === session.hostPort && item.guest === session.guestPort && item.name === 'browser-ide'`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    const owns = (item: typeof forwards[number]) => item.host === session.hostPort && item.guest === session.guestPort && item.name === 'browser-ide';
    if (forwards.some(owns)) await this.machines.setForwards(id, forwards.filter(item => !owns(item)), forwards);
  }
  /**
   * 入口 / Entry: BrowserIde.stop.
   * 功能：把本层请求转交 `this.control`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.control` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; session: Session; signal: AbortSignal
   * 输出 / Returns: `this.control(session, async () => { signal.throwIfAborted(); if (!this.current(session)) throw scopeChanged(); if (!session.e…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private stop(id: string, session: Session, signal: AbortSignal) {
    /**
     * 入口 / Entry: BrowserIde.stop.callback@312.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.control）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.control).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.bridges.stop`; `this.scope().stop`; `clearTimeout`; `this.timers.delete`.
     * 拒绝 / Refusals: 条件 / conditions `!this.current(session)`; `!session.execution`; `this.machines.state(id) !== 'running'`; 异常 / errors `scopeChanged()`; `legacy()`.
     */
    return this.control(session, async () => {
      signal.throwIfAborted(); if (!this.current(session)) throw scopeChanged();
      if (!session.execution) throw legacy();
      if (this.machines.state(id) !== 'running')
        throw new AppError('请先启动或恢复实例，再核对原浏览器 IDE 完整运行域', 409);
      // A durable stop intent prevents future HTTP/WebSocket connections from
      // reopening this session when complete domain cleanup needs a retry.
      await this.change(state => { const row = state.sessions.find(item => keyOf(item) === keyOf(session));
        if (!row || !same(row.execution, session.execution)) throw scopeChanged(); row.status = 'review'; });
      await this.bridges.stop(id, session.projectId);
      // Scope.stop first removes every descendant and the exact original group,
      // then confirms ProjectRunScopes.closeAfterScopeStopped. Its retries keep
      // both full ownership receipts and the protected frame on uncertainty.
      await this.scope(session).stop(session.execution.record);
      if (!this.current(session)) throw scopeChanged();
      await this.removeForward(id, session);
      await this.change(state => { state.sessions = state.sessions.filter(item => keyOf(item) !== keyOf(session) || item.startedAt !== session.startedAt); });
      const timer = this.timers.get(keyOf(session)); if (timer) clearTimeout(timer); this.timers.delete(keyOf(session));
    });
  }
  /**
   * 入口 / Entry: BrowserIde.prepareNetwork.
   * 功能：在安装并运行绑定项目账户的浏览器 IDE中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`BrowserIde`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BrowserIde`; the calls and state transitions below complete the operation. Module context: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
   * 处理：通过 `ensureProjectNetworkScript`, `this.machines.get`, `guestTask` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `ensureProjectNetworkScript`, `this.machines.get`, `guestTask`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; project: Project; signal: AbortSignal
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError(result.stderr || '浏览器 IDE 项目网络准备失败', 409)`.
   */
  private async prepareNetwork(id: string, project: Project, signal: AbortSignal) {
    const script = 'set -eu\ncd /\n' + ensureProjectNetworkScript(project, this.machines.get(id).distro || 'debian');
    const result = await guestTask(this.machines, id, script, signal);
    if (result.code !== 0) throw new AppError(result.stderr || '浏览器 IDE 项目网络准备失败', 409);
  }
  /**
   * 入口 / Entry: BrowserIde.start.
   * 功能：准备项目账户与固定 IDE 包，持久化服务意图并建立可核验的 IDE 监听会话。
   * Purpose: Prepares the project account and pinned IDE package, persists service intent and opens a verifiable IDE listener.
   * 设计：原配置和客户机身份在准备后重查；完整运行票据先固定，再发布连接入口，失败通过原会话停止协议回滚。
   * Design: Configuration/guest identity are rechecked after preparation; complete tickets precede connection publication and original stop protocols handle rollback.
   * 输入 / Inputs: id: string; input: Input; signal: AbortSignal; log: (line: string) => void
   * 输出 / Returns: `{ ready: true, executed: true, session: { status: 'running', hostPort: prior.hostPort, guestPort: prior.guestPort, expiresAt:…`; `{ ready: true, executed: true, session: { status: 'running', hostPort: session.hostPort, guestPort: session.guestPort, expire…`.
   * 副作用 / Effects: `this.stop`; `this.install`; `createHash().update().digest`; `createHash().update`; `createHash`; 更新 / updates `session`.
   * 拒绝 / Refusals: 条件 / conditions `vm.distro !== 'debian' && vm.distro !== 'ubuntu'`; `this.machines.state(id) !== 'running'`; `!instance || (project._workspace || 'default') !== projectId`; 异常 / errors `new AppError('浏览器 IDE 目前支持 Debian 和 Ubuntu 客户机', 409)`; `new AppError('请先启动实例', 409)`.
   * 失败处理：catch 分支执行 `try { if (session && this.current(session)) await this.stop(id, session, new AbortController().signal); else await process.st…`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `try { if (session && this.current(session)) await this.stop(id, session, new AbortController().signal); else await process.st…`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async start(id: string, input: Input, signal: AbortSignal, log: (line: string) => void) {
    const { vm, projectId, session: prior } = this.context(id);
    if (vm.distro !== 'debian' && vm.distro !== 'ubuntu') throw new AppError('浏览器 IDE 目前支持 Debian 和 Ubuntu 客户机', 409);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
    const instance = this.machines.live.get(id), project = await this.workspaces.resolvedConfig(id);
    if (!instance || (project._workspace || 'default') !== projectId) throw scopeChanged();
    if (prior && prior.status !== 'review' && Date.now() < Date.parse(prior.expiresAt) && prior.execution?.run) {
      if (!this.matchesProject(prior, project) || prior.hostPort !== input.hostPort || prior.guestPort !== input.guestPort)
        throw new AppError('请先停止当前浏览器 IDE 会话，再修改参数', 409);
      await this.restoreBridge(prior, project, signal);
      if (!await this.probeHttp(prior)) throw new AppError('浏览器 IDE 原运行已核对但入口不可达', 409);
      return { ready: true, executed: true, session: { status: 'running', hostPort: prior.hostPort,
        guestPort: prior.guestPort, expiresAt: prior.expiresAt }, message: '浏览器 IDE 会话已经运行。' };
    }
    if (prior) await this.stop(id, prior, signal);
    await this.install(id, signal, log); await this.prepareNetwork(id, project, signal);
    // Do not create/chown the project here. The existing directory migration
    // gate requires an explicit proposal and confirmation for legacy root data.
    const identity = await this.scopes.identity(id, project, signal);
    if (this.machines.get(id).forwards.some(item => item.host === input.hostPort))
      throw new AppError('所选本机端口已有实例转发，请选择独立回环端口', 409);
    if (this.closed || this.machines.live.get(id) !== instance) throw scopeChanged();
    const now = new Date().toISOString(), expiresAt = new Date(Date.now() + input.ttlMinutes * 60000).toISOString();
    const partial: Session = { vmId: id, projectId, directory: project.directory, networkIsolation: project.networkIsolation || 'host',
      guestPort: input.guestPort, hostPort: input.hostPort, password: randomBytes(32).toString('hex'), createdForward: false,
      startedAt: now, expiresAt, status: 'starting' };
    const process = this.scope(partial), status = await process.status(signal);
    if (!['absent', 'stopped'].includes(status.status)) throw new AppError('原浏览器 IDE 运行尚未清理，请先停止并核对完整归属', 409);
    const binding = createHash('sha256').update(JSON.stringify(['browser-ide-uid-v1', projectId, project.directory,
      project.networkIsolation || 'host', project.environment || {}, input.guestPort, expiresAt, partial.password])).digest('hex');
    const intent = process.newIntent(binding, status.bootId);
    let session: Session | undefined;
    try {
      const seconds = Math.max(1, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
      const command = 'set -eu\numask 077\n' +
        'mkdir -p "$HOME/.config/sakura-browser-ide" "$HOME/.local/share/sakura-browser-ide"\n' +
        'export CODE_SERVER_CONFIG="$HOME/.config/sakura-browser-ide/config.yaml"\n' +
        `exec /usr/bin/timeout --kill-after=5s ${seconds}s ${quote(binary)} . --auth password --bind-addr 127.0.0.1:${input.guestPort}` +
        ' --disable-telemetry --disable-update-check --user-data-dir "$HOME/.local/share/sakura-browser-ide"' +
        ' --extensions-dir "$HOME/.local/share/sakura-browser-ide/extensions"';
      const execution = { command, environment: { ...project.environment, PASSWORD: partial.password } };
      const { sha256 } = projectIdentityPayload(execution);
      // Persist enough BrowserIde ownership for explicit cleanup even when the
      // lower identity intent is durable but its acknowledgement is lost.
      session = { ...partial, execution: { identity, record: intent, run: null, sha256 } };
      await this.change(state => { if (state.sessions.length >= 128) throw new AppError('浏览器 IDE 会话记录已达到上限', 409); state.sessions.push(session!); });
      await process.persistIntent(intent);
      const payload: ProjectInheritedPayload = await this.scopes.inherited(id, project, execution,
        { kind: 'service', runId: intent.runId, bootId: intent.bootId }, signal);
      if (!same(payload.identity, identity) || payload.sha256 !== sha256) throw scopeChanged();
      const started = await process.start(intent, payload, signal);
      /**
       * 入口 / Entry: BrowserIde.start.callback@388.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.change）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.change).
       * 输入 / Inputs: state
       * 输出 / Returns: `row`.
       * 副作用 / Effects: 更新 / updates `row.execution!.record`.
       * 拒绝 / Refusals: 条件 / conditions `!same(row.execution!.record, intent)`; 异常 / errors `scopeChanged()`.
       */
      session = await this.change(state => { const row = state.sessions.find(item => keyOf(item) === keyOf(session!))!;
        if (!same(row.execution!.record, intent)) throw scopeChanged(); row.execution!.record = started; return row; });
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        signal.throwIfAborted(); if (this.closed || this.machines.live.get(id) !== instance) throw scopeChanged();
        const state = await process.status(signal);
        if (state.status !== 'running' || !same(state.record, started)) throw scopeChanged();
        if (await this.scopes.active(id, projectId, intent.runId, signal)) {
          const run = await this.identities.runReadonly(id, payload.identity, intent.runId, signal);
          if (!nativeMatches(run, payload.identity, started)) throw scopeChanged();
          if (!session.execution!.run) session = await this.change(state => { const row = state.sessions.find(item => keyOf(item) === keyOf(session!))!;
            row.execution!.run = run; return row; });
          await this.restoreBridge(session, project, signal);
          if (await this.probeHttp(session)) {
            session = await this.change(state => { const row = state.sessions.find(item => keyOf(item) === keyOf(session!))!; row.status = 'running'; return row; });
            this.schedule(session); log('浏览器 IDE 已使用项目账号在本机回环端口就绪。\n');
            return { ready: true, executed: true, session: { status: 'running', hostPort: session.hostPort,
              guestPort: session.guestPort, expiresAt: session.expiresAt }, message: '浏览器 IDE 已启动；打开入口后输入访问密码。' };
          }
        }
        await delay(500, undefined, { signal });
      }
      throw new AppError('浏览器 IDE 就绪检查超时', 409);
    } catch (error) {
      try {
        if (session && this.current(session)) await this.stop(id, session, new AbortController().signal);
        else await process.stop(intent);
      } catch (cleanupError) {
        if (session && this.current(session)) await this.change(state => { const row = state.sessions.find(item => keyOf(item) === keyOf(session!)); if (row) row.status = 'review'; });
        throw new AppError(`浏览器 IDE 启动失败：${error instanceof Error ? error.message : String(error)}；回滚清理未确认：${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}；已保留原运行记录`, 503, 'BROWSER_IDE_CLEANUP_FAILED');
      }
      throw error;
    }
  }
  /**
   * 入口 / Entry: BrowserIde.run.
   * 功能：在安装并运行绑定项目账户的浏览器 IDE中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.view(id, options, signal)` / `await this.machines.locked(id, async () => { if (this.workspaces.projects.current(id) !== projectId) throw scopeChanged(); if…` 供上层消费（`BrowserIde`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BrowserIde`; this entry produces `this.view(id, options, signal)` / `await this.machines.locked(id, async () => { if (this.workspaces.projects.current(id) !== projectId) throw scopeChanged(); if…` for its caller. Module context: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
   * 处理：通过 `browserIdeInput.parse`, `this.context`, `this.active.has`, `this.active.add` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `browserIdeInput.parse`, `this.context`, `this.active.has`, `this.active.add`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `options.mode === 'status'`.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal; log: (line: string) => void
   * 输出 / Returns: `this.view(id, options, signal)`; `await this.machines.locked(id, async () => { if (this.workspaces.projects.current(id) !== projectId) throw scopeChanged(); if…`.
   * 副作用 / Effects: `this.active.add`; `this.active.delete`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.active.has(key)`; 异常 / errors `new AppError('浏览器 IDE 服务已关闭', 409)`; `new AppError('此项目的浏览器 IDE 操作仍在进行', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.active.delete(key);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.active.delete(key);`; these steps also apply to exceptional exits.
   */
  async run(id: string, input: unknown, signal: AbortSignal, log: (line: string) => void) {
    if (this.closed) throw new AppError('浏览器 IDE 服务已关闭', 409);
    const options = browserIdeInput.parse(input), { vm, projectId } = this.context(id), key = `${id}:${projectId}`;
    if (this.active.has(key)) throw new AppError('此项目的浏览器 IDE 操作仍在进行', 409);
    this.active.add(key);
    try {
      signal.throwIfAborted(); if (options.mode === 'status') return this.view(id, options, signal);
      /**
       * 入口 / Entry: BrowserIde.run.callback@429.
       * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
       * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `this.start(id, options, signal, log)`; `{ ready: true, executed: true, installed: true, message: '浏览器 IDE 已安装；现在可启动会话。' }`; `{ ready: true, executed: true, session: null, message: '浏览器 IDE 会话已停止。' }`.
       * 副作用 / Effects: `this.start`; `this.install`; `this.stop`.
       * 拒绝 / Refusals: 条件 / conditions `this.workspaces.projects.current(id) !== projectId`; `options.mode === 'install'`; `vm.distro !== 'debian' && vm.distro !== 'ubuntu'`; 异常 / errors `scopeChanged()`; `new AppError('浏览器 IDE 目前支持 Debian 和 Ubuntu 客户机', 409)`.
       */
      return await this.machines.locked(id, async () => {
        if (this.workspaces.projects.current(id) !== projectId) throw scopeChanged();
        if (options.mode === 'start') return this.start(id, options, signal, log);
        if (options.mode === 'install') {
          if (vm.distro !== 'debian' && vm.distro !== 'ubuntu') throw new AppError('浏览器 IDE 目前支持 Debian 和 Ubuntu 客户机', 409);
          if (this.machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
          await this.install(id, signal, log); return { ready: true, executed: true, installed: true, message: '浏览器 IDE 已安装；现在可启动会话。' };
        }
        const session = this.context(id).session; if (session) await this.stop(id, session, signal);
        return { ready: true, executed: true, session: null, message: '浏览器 IDE 会话已停止。' };
      });
    } finally { this.active.delete(key); }
  }
  /**
   * 入口 / Entry: BrowserIde.link.
   * 功能：在安装并运行绑定项目账户的浏览器 IDE中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ url: `http://127.0.0.1:${session.hostPort}/`, password: session.password, expiresAt: session.expiresAt }` 供上层消费（`BrowserIde`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BrowserIde`; this entry produces `{ url: `http://127.0.0.1:${session.hostPort}/`, password: session.password, expiresAt: session.expiresAt }` for its caller. Module context: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
   * 处理：通过 `this.context`, `legacy`, `scopeChanged`, `this.restoreBridge` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.context`, `legacy`, `scopeChanged`, `this.restoreBridge`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ url: `http://127.0.0.1:${session.hostPort}/`, password: session.password, expiresAt: session.expiresAt }`.
   * 副作用 / Effects: `this.bridges.stop`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `!session || !session.execution`; `!await this.probeHttp(session) || !this.current(session) || Date.now() >= Date.parse(session.expiresAt)`; 异常 / errors `new AppError('浏览器 IDE 服务已关闭', 409)`; `session ? legacy() : scopeChanged()`.
   * 失败处理：catch 分支执行 `await this.bridges.stop(id, session.projectId);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await this.bridges.stop(id, session.projectId);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async link(id: string) {
    if (this.closed) throw new AppError('浏览器 IDE 服务已关闭', 409);
    const { session } = this.context(id); if (!session || !session.execution) throw session ? legacy() : scopeChanged();
    try {
      await this.restoreBridge(session, await this.workspaces.config(id));
      if (!await this.probeHttp(session) || !this.current(session) || Date.now() >= Date.parse(session.expiresAt)) throw scopeChanged();
      return { url: `http://127.0.0.1:${session.hostPort}/`, password: session.password, expiresAt: session.expiresAt };
    } catch (error) { await this.bridges.stop(id, session.projectId); throw error; }
  }
  /**
   * 入口 / Entry: BrowserIde.install.
   * 功能：在安装并运行绑定项目账户的浏览器 IDE中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`BrowserIde`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BrowserIde`; this entry produces `void` for its caller. Module context: Installs and runs a project-account browser IDE; connections and stops verify the original session's complete ownership.
   * 处理：通过 `this.installed`, `this.installs.get`, `inline`, `this.installs.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.installed`, `this.installs.get`, `inline`, `this.installs.set`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `await this.installed(id, signal)`; `existing`.
   * 输入 / Inputs: id: string; signal: AbortSignal; log: (line: string) => void
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.installed`; `this.installs.get`; `this.installs.set`; `this.installs.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `this.installs.delete(id);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.installs.delete(id);`; these steps also apply to exceptional exits.
   */
  private async install(id: string, signal: AbortSignal, log: (line: string) => void) {
    if (await this.installed(id, signal)) return;
    const existing = this.installs.get(id);
    if (existing) { await existing; return; }
    /**
     * 入口 / Entry: BrowserIde.install.callback@455.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `vm.distro !== 'debian' && vm.distro !== 'ubuntu'`; `result.code !== 0`; 异常 / errors `new AppError('浏览器 IDE 目前支持 Debian 和 Ubuntu 客户机', 409)`; `new AppError(`浏览器 IDE 安装失败：${result.stderr.slice(-1000) || result.code}`)`.
     */
    const promise = (async () => {
      const vm = this.machines.get(id);
      if (vm.distro !== 'debian' && vm.distro !== 'ubuntu')
        throw new AppError('浏览器 IDE 目前支持 Debian 和 Ubuntu 客户机', 409);
      log(`正在准备并校验 code-server ${VERSION}；缺少缓存时下载约 239 MB…\n`);
      const cacheTemp = browserIdePackage.cachePath + '.' + randomBytes(16).toString('hex') + '.tmp';
      const script = `set -eu
cd /
if ! command -v curl >/dev/null || ! command -v tmux >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o Acquire::Retries=2 update
  apt-get -o Acquire::Retries=2 install -y curl ca-certificates tmux
fi
if test -x ${quote(binary)}; then exit 0; fi
mkdir -p ${quote(installRoot)}
sakura_stage=$(mktemp -d ${quote(installRoot + '/.install.XXXXXX')})
trap ${quote(`rm -rf "$sakura_stage"; rm -f -- ${quote(cacheTemp)}`)} EXIT HUP INT TERM
if test -f ${quote(browserIdePackage.cachePath)}; then
  cp -- ${quote(browserIdePackage.cachePath)} "$sakura_stage/release.tgz"
else
  if ! curl -fL --retry 3 --retry-all-errors --retry-max-time 1800 --connect-timeout 20 --max-time 1800 -o "$sakura_stage/release.tgz" ${quote(releaseUrl)}; then
    curl -fL --retry 3 --retry-all-errors --retry-max-time 1800 --connect-timeout 20 --max-time 1800 -H 'Accept: application/octet-stream' -H 'X-GitHub-Api-Version: 2026-03-10' -o "$sakura_stage/release.tgz" ${quote(assetUrl)}
  fi
fi
printf '%s  %s\\n' ${quote(SHA256)} "$sakura_stage/release.tgz" | sha256sum -c -
if ! test -f ${quote(browserIdePackage.cachePath)}; then
  mkdir -p ${quote(packageCache)}
  cp -- "$sakura_stage/release.tgz" ${quote(cacheTemp)}
  mv -- ${quote(cacheTemp)} ${quote(browserIdePackage.cachePath)}
fi
tar -xzf "$sakura_stage/release.tgz" -C "$sakura_stage"
mv "$sakura_stage/${archive}" ${quote(installRoot + '/' + VERSION)}
test -x ${quote(binary)}`;
      const result = await guestTask(this.machines, id, script, signal, undefined, 35 * 60_000);
      if (result.code !== 0)
        throw new AppError(`浏览器 IDE 安装失败：${result.stderr.slice(-1000) || result.code}`);
      log('code-server 已安装并通过校验。\n');
    })();
    this.installs.set(id, promise);
    try { await promise; } finally { this.installs.delete(id); }
  }

}
