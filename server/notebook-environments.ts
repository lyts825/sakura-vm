/**
 * 模块职责：管理绑定项目账户的 Notebook 会话，连接和停止需核对原启动及完整运行域。
 * Module purpose: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { networkFor } from './network/index.ts';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { projectVersion, type Project } from './project-config.ts';

import { AppError } from '../shared/errors.ts';
import { DATA, vmDir } from './paths.ts';
import { quote } from './shell.ts';
import { guestTask } from './guest-task.ts';
import { readStore, writeStore } from './local-store.ts';
import { ProjectNetworkBridges } from './project-network-bridges.ts';
import { projectTerminalsFor, type TerminalService as ProjectTerminals } from './terminal-backend.ts';
import { ProjectRunScopes, projectIdentityTask } from './project-run-scope.ts';
import {
  ProjectIdentities,
  projectIdentityPayload,
  projectIdentityRunSchema,
  projectIdentitySchema,
  type ProjectIdentity,
  type ProjectIdentityRun,
} from './project-identity.ts';
import {
  ProjectNotebookScope,
  projectNotebookRecordSchema,
  type ProjectNotebookRecord,
} from './project-service-scope.ts';
import {
  notebookProviderSchema,
  notebookInstallExecution,
  notebookInstalledCommand,
  notebookWheelRequest,
  notebookWheelhouseCommand,
  notebookWheelLeaseSchema,
  type NotebookProvider,
} from './notebook-wheelhouse.ts';
import { privateLog, redactValues } from './secrets.ts';

const { fetch } = networkFor('core:notebook-environments');

export const notebookInput = z.object({
  mode: z.enum(['status', 'install', 'start', 'stop']).default('status'),
  provider: notebookProviderSchema.default('jupyter'),
  guestPort: z.number().int().min(1024).max(65535).default(8888),
  hostPort: z.number().int().min(1024).max(65535).default(8888),
}).strict();
type Input = z.infer<typeof notebookInput>;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const executionSchema = z.object({ identity: projectIdentitySchema, record: projectNotebookRecordSchema,
  run: projectIdentityRunSchema.nullable(), sha256: digest, configSha256: digest }).strict();
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
 * 入口 / Entry: changed.
 * 功能：从当前输入或状态计算 `new AppError('Notebook 原项目、账号、boot、进程或完整运行域无法核对，请先停止原会话', 409, 'NOTEBOOK_SCOPE_CHANGED')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('Notebook 原项目、账号、boot、进程或完整运行域无法核对，请先停止原会话', 409, 'NOTEBOOK_SCOPE_CHANGED')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('Notebook 原项目、账号、boot、进程或完整运行域无法核对，请先停止原会话', 409, 'NOTEBOOK_SCOPE_CHANGED')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const changed = () => new AppError('Notebook 原项目、账号、boot、进程或完整运行域无法核对，请先停止原会话', 409, 'NOTEBOOK_SCOPE_CHANGED');
/**
 * 入口 / Entry: legacy.
 * 功能：从当前输入或状态计算 `new AppError('旧 Notebook 尚未接入项目账号；请管理员确认关闭原 root 会话及全部后代，并明确迁移项目目录后重建，原记录继续保留', 409, 'NOTEBOOK_IDENTITY_REQUIRED')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('旧 Notebook 尚未接入项目账号；请管理员确认关闭原 root 会话及全部后代，并明确迁移项目目录后重建，原记录继续保留', 409, 'NOTEBOOK_IDENTITY_REQUIRED')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('旧 Notebook 尚未接入项目账号；请管理员确认关闭原 root 会话及全部后代，并明确迁移项目目录后重建，原记录继续保留', 409, 'NOTEBOOK_IDENTITY_REQUIRED')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const legacy = () => new AppError('旧 Notebook 尚未接入项目账号；请管理员确认关闭原 root 会话及全部后代，并明确迁移项目目录后重建，原记录继续保留', 409, 'NOTEBOOK_IDENTITY_REQUIRED');
/**
 * 入口 / Entry: nativeMatches.
 * 功能：从当前输入或状态计算 `run.phase === 'active' && run.mode === 'inherit-current' && run.projectId === identity.projectId && run.registryId === identi…`，供调用方后续验证或使用。
 * Purpose: Computes `run.phase === 'active' && run.mode === 'inherit-current' && run.projectId === identity.projectId && run.registryId === identi…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: run: ProjectIdentityRun; identity: ProjectIdentity; record: ProjectNotebookRecord
 * 输出 / Returns: `run.phase === 'active' && run.mode === 'inherit-current' && run.projectId === identity.projectId && run.registryId === identi…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function nativeMatches(run: ProjectIdentityRun, identity: ProjectIdentity, record: ProjectNotebookRecord) {
  return run.phase === 'active' && run.mode === 'inherit-current' && run.projectId === identity.projectId &&
    run.registryId === identity.registryId && run.identityId === identity.identityId && run.revision === identity.revision &&
    run.runId === record.runId && run.bootId === record.bootId && run.cgroupName === record.scopeName &&
    record.inode !== null && run.cgroupInode === record.inode && run.namespace === (identity.networkIsolation === 'private' ? 'sk-' + identity.projectId : '');
}
export const notebookSessionSchema = z.object({
  vmId: z.uuid(), projectId: z.string().regex(/^(default|[a-f0-9]{16})$/),
  provider: notebookProviderSchema, directory: z.string().min(1).max(4096),
  guestPort: z.number().int().min(1024).max(65535), hostPort: z.number().int().min(1024).max(65535),
  token: z.string().regex(/^[a-f0-9]{64}$/), createdForward: z.boolean(),
  networkIsolation: z.enum(['host', 'private']).default('host'),
  status: z.enum(['starting', 'running', 'review']), startedAt: z.iso.datetime(), execution: executionSchema.optional(),
}).strict().superRefine((session, context) => {
  const execution = session.execution;
  if (session.networkIsolation === 'private' && session.createdForward || execution && (
      session.createdForward || execution.identity.phase !== 'active' || execution.identity.projectId !== session.projectId ||
      execution.record.projectId !== session.projectId || execution.identity.directory !== session.directory ||
      execution.identity.networkIsolation !== session.networkIsolation ||
      session.status === 'running' && (!execution.run || execution.record.phase !== 'running') ||
      execution.run && !nativeMatches(execution.run, execution.identity, execution.record)))
    context.addIssue({ code: 'custom', message: 'Notebook 完整账号运行归属不符' });
});
type Session = z.infer<typeof notebookSessionSchema>;
export type NotebookResponse = { ready: boolean; executed: boolean; message: string; installed?: boolean;
  projectId?: string; provider?: NotebookProvider; session?: { provider: NotebookProvider; status: string;
    hostPort: number; guestPort: number; directory?: string; startedAt?: string; needsReview?: boolean } | null };
const installedSchema = z.object({ vmId: z.uuid(), projectId: z.string().regex(/^(default|[a-f0-9]{16})$/),
  provider: notebookProviderSchema, identity: projectIdentitySchema, installedAt: z.iso.datetime() }).strict()
  .refine(value => value.identity.phase === 'active' && value.projectId === value.identity.projectId);
const storeSchema = z.object({ version: z.literal(1), sessions: z.array(notebookSessionSchema).max(128),
  environments: z.array(installedSchema).max(256).default([]) }).strict().superRefine((store, context) => {
  if (new Set(store.sessions.map(item => `${item.vmId}:${item.projectId}`)).size !== store.sessions.length ||
      new Set(store.environments.map(item => `${item.vmId}:${item.projectId}:${item.provider}`)).size !== store.environments.length)
    context.addIssue({ code: 'custom', message: 'Notebook 原项目归属记录重复' });
});
/**
 * 入口 / Entry: keyOf.
 * 功能：从当前输入或状态计算 ``${session.vmId}:${session.projectId}``，供调用方后续验证或使用。
 * Purpose: Computes ``${session.vmId}:${session.projectId}`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: session: Pick<Session, 'vmId' | 'projectId'>
 * 输出 / Returns: ``${session.vmId}:${session.projectId}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const keyOf = (session: Pick<Session, 'vmId' | 'projectId'>) => `${session.vmId}:${session.projectId}`;
/**
 * 入口 / Entry: binary.
 * 功能：从当前输入或状态计算 `session.directory.replace(/\/$/, '') + '/.sakura/notebooks/' + session.provider + '/venv/bin/' + session.provider`，供调用方后续验证或使用。
 * Purpose: Computes `session.directory.replace(/\/$/, '') + '/.sakura/notebooks/' + session.provider + '/venv/bin/' + session.provider` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: session: Pick<Session, 'directory' | 'provider'>
 * 输出 / Returns: `session.directory.replace(/\/$/, '') + '/.sakura/notebooks/' + session.provider + '/venv/bin/' + session.provider`.
 * 副作用 / Effects: `session.directory.replace`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const binary = (session: Pick<Session, 'directory' | 'provider'>) =>
  session.directory.replace(/\/$/, '') + '/.sakura/notebooks/' + session.provider + '/venv/bin/' + session.provider;
/**
 * 入口 / Entry: httpReady.
 * 功能：在管理绑定项目账户的 Notebook 会话中，执行此领域的具体处理步骤并返回其结果；本入口产生 `response.ok` / `false` 供上层消费（`notebook-environments.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `notebook-environments.ts`; this entry produces `response.ok` / `false` for its caller. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
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
    const response = await fetch(`http://127.0.0.1:${session.hostPort}${session.provider === 'jupyter' ? '/api/status' : '/health'}`,
      { headers: { authorization: session.provider === 'jupyter' ? 'token ' + session.token :
        'Basic ' + Buffer.from(':' + session.token).toString('base64') }, redirect: 'manual', signal: AbortSignal.timeout(2500) });
    await response.body?.cancel(); return response.ok;
  } catch { return false; }
}
type Scope = Pick<ProjectNotebookScope, 'status' | 'newIntent' | 'persistIntent' | 'start' | 'stop'>;
type Options = {
  scopes?: Pick<ProjectRunScopes, 'identity' | 'inherited' | 'active' | 'readonlyActive'>;
  identities?: Pick<ProjectIdentities, 'runReadonly'>;
  terminals?: Pick<ProjectTerminals, 'prepare'>;
  /**
   * 签名 / Signature: Options.processScope.
   * 功能：为管理绑定项目账户的 Notebook 会话声明 processScope 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for processScope in Options. Module responsibility: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
   * 输入 / Inputs: id: string; project: Project
   * 输出 / Returns: Scope.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  processScope?: (id: string, project: Project) => Scope;
  runTask?: typeof projectIdentityTask;
  adminTask?: typeof guestTask;
  bridges?: Pick<ProjectNetworkBridges, 'open' | 'stop' | 'close'>;
  /**
   * 签名 / Signature: Options.listener.
   * 功能：为管理绑定项目账户的 Notebook 会话声明 listener 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for listener in Options. Module responsibility: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
   * 输入 / Inputs: session: Session; signal: AbortSignal optional
   * 输出 / Returns: Promise<boolean>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  listener?: (session: Session, signal?: AbortSignal) => Promise<boolean>;
};
type Capture = { projectId: string; raw: Project; configSha256: string; project: Project;
  live: NonNullable<ReturnType<Machines['live']['get']>>; bootId: string; signal: AbortSignal };

/** Read kernel ownership only: no project file, command or environment is interpreted by root. */
/**
 * 入口 / Entry: notebookListenerCommand.
 * 功能：在管理绑定项目账户的 Notebook 会话中，执行此领域的具体处理步骤并返回其结果；本入口产生 `'# SAKURA_NOTEBOOK_LISTENER\nenv -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' + q…` 供上层消费（`notebook-environments.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `notebook-environments.ts`; this entry produces `'# SAKURA_NOTEBOOK_LISTENER\nenv -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' + q…` for its caller. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
 * 处理：通过 `nativeMatches`, `changed`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `nativeMatches`, `changed`, `quote`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: session: Session
 * 输出 / Returns: `'# SAKURA_NOTEBOOK_LISTENER\nenv -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' + q…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!execution?.run || !nativeMatches(execution.run, execution.identity, execution.record)`; 异常 / errors `changed()`.
 */
export function notebookListenerCommand(session: Session) {
  const execution = session.execution;
  if (!execution?.run || !nativeMatches(execution.run, execution.identity, execution.record)) throw changed();
  const { run, identity } = execution;
  const request = { bootId: run.bootId, cgroupName: run.cgroupName, cgroupDevice: run.cgroupDevice,
    cgroupInode: run.cgroupInode, networkDevice: run.networkDevice, networkInode: run.networkInode,
    namespace: run.namespace, uid: identity.uid, gid: identity.gid, port: session.guestPort };
  const source = `import glob,json,os,stat,fcntl
request=${JSON.stringify(request)}
def refuse(): raise ValueError('notebook listener ownership changed')
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
  return '# SAKURA_NOTEBOOK_LISTENER\nenv -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' + quote(source);
}

/** System dependency preparation never loads project configuration, Python or hooks. */
/**
 * 入口 / Entry: notebookToolsScript.
 * 功能：在管理绑定项目账户的 Notebook 会话中，执行此领域的具体处理步骤并返回其结果；本入口产生 `'exec /usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C PIP_CONFIG_FILE=/dev/n…` 供上层消费（`notebook-environments.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `notebook-environments.ts`; this entry produces `'exec /usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C PIP_CONFIG_FILE=/dev/n…` for its caller. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
 * 处理：通过 `z.uuid().parse`, `z.uuid`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `quote`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: distro: string; bootId: string
 * 输出 / Returns: `'exec /usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C PIP_CONFIG_FILE=/dev/n…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function notebookToolsScript(distro: string, bootId: string) {
  z.uuid().parse(bootId);
  const body = 'set -eu\ncd /\n' +
    'test "$(cat /proc/sys/kernel/random/boot_id)" = ' + quote(bootId) + '\n' +
    'if ! test -x /usr/bin/python3 || ! test -x /usr/bin/tmux || ! /usr/bin/python3 -I -m venv --help >/dev/null 2>&1 || ! /usr/bin/python3 -I -m pip --version >/dev/null 2>&1; then\n' +
    (distro === 'alpine' ? 'apk add --no-cache --timeout 30 python3 py3-pip tmux\n' :
      'export DEBIAN_FRONTEND=noninteractive\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update\n' +
      'apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y --no-install-recommends python3 python3-pip python3-venv tmux\n') +
    'fi\n/usr/bin/python3 -I -m venv --help >/dev/null\n/usr/bin/python3 -I -m pip --version >/dev/null\ntest -x /usr/bin/tmux';
  return 'exec /usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C PIP_CONFIG_FILE=/dev/null /bin/sh -ec ' + quote(body);
}

export class NotebookEnvironments {
  private state?: z.infer<typeof storeSchema>;
  private writes: Promise<unknown> = Promise.resolve();
  private active = new Set<string>();
  private launching = new Set<string>();
  private pending = new Set<Promise<unknown>>();
  private controls = new Map<string, Promise<unknown>>();
  private controller = new AbortController();
  private ownedTerminals?: ProjectTerminals;
  private bridges: NonNullable<Options['bridges']>;
  private scopes: NonNullable<Options['scopes']>;
  private identities: NonNullable<Options['identities']>;
  private closed = false;
  /**
   * 入口 / Entry: NotebookEnvironments.constructor.
   * 功能：建立 NotebookEnvironments 的管理绑定项目账户的 Notebook 会话上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the NotebookEnvironments context for this module's responsibility: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; file: default=join(DATA, 'notebook-environments.json'); probeHttp: (session: Session) => Promise<boolean> default=httpReady; options: Options default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.scopes`, `this.identities`, `this.bridges`.
   */
  constructor(private machines: Machines, private workspaces: WorkspacesV1,
    private file = join(DATA, 'notebook-environments.json'), private probeHttp: (session: Session) => Promise<boolean> = httpReady,
    private options: Options = {}) {
    this.scopes = options.scopes || new ProjectRunScopes(machines);
    this.identities = options.identities || new ProjectIdentities(machines);
    this.bridges = options.bridges || new ProjectNetworkBridges(machines, async (id, project, signal) => {
      const session = this.state?.sessions.find(item => item.vmId === id && item.projectId === (project._workspace || 'default'));
      if (!session || !await this.prove(session, project, signal)) throw changed();
    });
  }
  /**
   * 入口 / Entry: NotebookEnvironments.init.
   * 功能：在管理绑定项目账户的 Notebook 会话中，初始化并核对当前领域状态；处理结果记录到 `this.state`（`NotebookEnvironments`）。
   * Purpose: Initializes and verifies current domain state in `NotebookEnvironments`; the outcome is recorded in `this.state`. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
   * 处理：通过 `storeSchema.parse`, `readStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `storeSchema.parse`, `readStore`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.state`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    this.state = storeSchema.parse(await readStore(this.file, () => ({ version: 1, sessions: [], environments: [] })));
    // Reload never closes or advances a receipt. Starting and legacy records
    // remain available for an explicit original-owner stop or administrator review.
  }
  /**
   * 入口 / Entry: NotebookEnvironments.change.
   * 功能：在管理绑定项目账户的 Notebook 会话中，执行此领域的具体处理步骤并返回其结果；本入口产生 `operation` 供上层消费（`NotebookEnvironments`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NotebookEnvironments`; this entry produces `operation` for its caller. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: edit: (state: z.infer<typeof storeSchema>) => T
   * 输出 / Returns: `operation`.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async change<T>(edit: (state: z.infer<typeof storeSchema>) => T) {
    /**
     * 入口 / Entry: NotebookEnvironments.change.callback@236.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.writes.catch().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.writes.catch().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `result`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const operation = this.writes.catch(() => {}).then(async () => {
      const next = structuredClone(this.state!), result = edit(next);
      storeSchema.parse(next); await writeStore(this.file, next); this.state = next; return result;
    });
    this.writes = operation; return operation;
  }
  /**
   * 入口 / Entry: NotebookEnvironments.context.
   * 功能：在管理绑定项目账户的 Notebook 会话中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ vm, projectId, session: this.state!.sessions.find(item => item.vmId === id && item.projectId === projectId) }` 供上层消费（`NotebookEnvironments`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NotebookEnvironments`; this entry produces `{ vm, projectId, session: this.state!.sessions.find(item => item.vmId === id && item.projectId === projectId) }` for its caller. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
   * 处理：通过 `this.machines.get`, `this.workspaces.projects.current`, `inline.sessions.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.workspaces.projects.current`, `inline.sessions.find`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ vm, projectId, session: this.state!.sessions.find(item => item.vmId === id && item.projectId === projectId) }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private context(id: string, explicitProjectId?: string) {
    const vm = this.machines.get(id), projectId = explicitProjectId ?? this.workspaces.projects.current(id);
    return { vm, projectId, session: this.state!.sessions.find(item => item.vmId === id && item.projectId === projectId) };
  }
  /**
   * 入口 / Entry: NotebookEnvironments.current.
   * 功能：把本层请求转交 `this.state.sessions.find`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.state.sessions.find` and propagates the provider result or rejection.
   * 输入 / Inputs: session: Session
   * 输出 / Returns: `this.state?.sessions.find(item => keyOf(item) === keyOf(session) && item.startedAt === session.startedAt && item.token === se…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private current(session: Session) {
    return this.state?.sessions.find(item => keyOf(item) === keyOf(session) && item.startedAt === session.startedAt &&
      item.token === session.token && same(item.execution, session.execution));
  }
  /**
   * 入口 / Entry: NotebookEnvironments.scope.
   * 功能：从当前输入或状态计算 `this.options.processScope?.(session.vmId, project) || new ProjectNotebookScope(this.machines, session.vmId, project)`，供调用方后续验证或使用。
   * Purpose: Computes `this.options.processScope?.(session.vmId, project) || new ProjectNotebookScope(this.machines, session.vmId, project)` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: session: Session
   * 输出 / Returns: Scope；结果来自 / values from `this.options.processScope?.(session.vmId, project) || new ProjectNotebookScope(this.machines, session.vmId, project)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private scope(session: Session): Scope {
    const project = { _workspace: session.projectId, directory: session.directory, networkIsolation: session.networkIsolation } as Project;
    return this.options.processScope?.(session.vmId, project) || new ProjectNotebookScope(this.machines, session.vmId, project);
  }
  /**
   * 入口 / Entry: NotebookEnvironments.scoped.
   * 功能：把本层请求转交 `this.workspaces.projects.inScope`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.workspaces.projects.inScope` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; projectId: string; work: () => Promise<T>
   * 输出 / Returns: `this.workspaces.projects.inScope(id, projectId, work)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private scoped<T>(id: string, projectId: string, work: () => Promise<T>) {
    return this.workspaces.projects.inScope(id, projectId, work);
  }
  /**
   * 入口 / Entry: NotebookEnvironments.config.
   * 功能：把本层请求转交 `this.scoped`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.scoped` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; projectId: string
   * 输出 / Returns: `this.scoped(id, projectId, () => this.workspaces.config(id))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async config(id: string, projectId: string) { return this.scoped(id, projectId, () => this.workspaces.config(id)); }
  /**
   * 入口 / Entry: NotebookEnvironments.matchesProject.
   * 功能：从当前输入或状态计算 `(project._workspace || 'default') === session.projectId && project.directory === session.directory && (project.networkIsolati…`，供调用方后续验证或使用。
   * Purpose: Computes `(project._workspace || 'default') === session.projectId && project.directory === session.directory && (project.networkIsolati…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: session: Session; project: Project
   * 输出 / Returns: `(project._workspace || 'default') === session.projectId && project.directory === session.directory && (project.networkIsolati…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private matchesProject(session: Session, project: Project) {
    return (project._workspace || 'default') === session.projectId && project.directory === session.directory &&
      (project.networkIsolation || 'host') === session.networkIsolation &&
      (!session.execution || projectVersion(project) === session.execution.configSha256);
  }
  /**
   * 入口 / Entry: NotebookEnvironments.kernelBoot.
   * 功能：在管理绑定项目账户的 Notebook 会话中，执行此领域的具体处理步骤并返回其结果；本入口产生 `boot.data` 供上层消费（`NotebookEnvironments`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NotebookEnvironments`; this entry produces `boot.data` for its caller. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
   * 处理：通过 `this.machines.live.get`, `this.machines.exec`, `z.uuid().safeParse`, `z.uuid` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.live.get`, `this.machines.exec`, `z.uuid().safeParse`, `z.uuid`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `boot.data`.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `!instance || this.machines.live.get(id) !== instance || result.code !== 0 || !boot.success`; 异常 / errors `changed()`.
   */
  private async kernelBoot(id: string, signal?: AbortSignal) {
    const instance = this.machines.live.get(id), result = await this.machines.exec(id,
      'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/cat /proc/sys/kernel/random/boot_id', 10000, signal);
    const boot = z.uuid().safeParse(result.stdout.trim());
    if (!instance || this.machines.live.get(id) !== instance || result.code !== 0 || !boot.success) throw changed();
    return boot.data;
  }
  /**
   * 入口 / Entry: NotebookEnvironments.assertCaptured.
   * 功能：把本层请求转交 `this.scoped`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.scoped` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; captured: Capture; boot: default=true
   * 输出 / Returns: `this.scoped(id, captured.projectId, async () => { const current = () => { captured.signal.throwIfAborted(); if (this.closed |…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async assertCaptured(id: string, captured: Capture, boot = true) {
    /**
     * 入口 / Entry: NotebookEnvironments.assertCaptured.callback@271.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.scoped）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.scoped).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `(project._workspace || 'default') !== captured.projectId || projectVersion(project) !== captured.configSha256`; `boot && await this.kernelBoot(id, captured.signal) !== captured.bootId`; 异常 / errors `changed()`.
     */
    return this.scoped(id, captured.projectId, async () => {
      /**
       * 入口 / Entry: NotebookEnvironments.assertCaptured.current.
       * 功能：在管理绑定项目账户的 Notebook 会话中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`NotebookEnvironments`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `NotebookEnvironments`; the calls and state transitions below complete the operation. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
       * 处理：通过 `captured.signal.throwIfAborted`, `this.machines.state`, `this.machines.live.get`, `this.workspaces.projects.current` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `captured.signal.throwIfAborted`, `this.machines.state`, `this.machines.live.get`, `this.workspaces.projects.current`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `this.closed || this.machines.state(id) !== 'running' || this.machines.live.get(id) !== captured.live || this.workspaces.proje…`; 异常 / errors `changed()`.
       */
      const current = () => {
        captured.signal.throwIfAborted();
        if (this.closed || this.machines.state(id) !== 'running' || this.machines.live.get(id) !== captured.live ||
            this.workspaces.projects.current(id) !== captured.projectId) throw changed();
      };
      current();
      const project = await this.workspaces.config(id);
      current();
      if ((project._workspace || 'default') !== captured.projectId || projectVersion(project) !== captured.configSha256) throw changed();
      if (boot && await this.kernelBoot(id, captured.signal) !== captured.bootId) throw changed();
      current();
    });
  }
  /**
   * 入口 / Entry: NotebookEnvironments.prepared.
   * 功能：在管理绑定项目账户的 Notebook 会话中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await this.machines.locked(id, async () => { await this.assertCaptured(id, capture); return this.scoped(id, projectId, () => …` 供上层消费（`NotebookEnvironments`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NotebookEnvironments`; this entry produces `await this.machines.locked(id, async () => { await this.assertCaptured(id, capture); return this.scoped(id, projectId, () => …` for its caller. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
   * 处理：通过 `projectTerminalsFor`, `terminals.prepare`, `projectVersion`, `this.machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectTerminalsFor`, `terminals.prepare`, `projectVersion`, `this.machines.live.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; projectId: string; signal: AbortSignal; work: (capture: Capture) => Promise<T>
   * 输出 / Returns: `await this.machines.locked(id, async () => { await this.assertCaptured(id, capture); return this.scoped(id, projectId, () => …`.
   * 副作用 / Effects: `prepared.release`; 更新 / updates `this.ownedTerminals`.
   * 拒绝 / Refusals: 条件 / conditions `!original || !prepared.signal || prepared.projectId !== projectId || (original.project._workspace || 'default') !== projectId…`; 异常 / errors `changed()`.
   * 收尾：退出 try 区域时始终执行 `await prepared.release();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `await prepared.release();`; these steps also apply to exceptional exits.
   */
  private async prepared<T>(id: string, projectId: string, signal: AbortSignal, work: (capture: Capture) => Promise<T>) {
    const terminals = this.options.terminals || (this.ownedTerminals ||= projectTerminalsFor(this.machines, this.workspaces));
    const prepared = await terminals.prepare(id, projectId, null, false, signal, undefined, { mode: 'task' });
    try {
      const original = prepared.captured;
      if (!original || !prepared.signal || prepared.projectId !== projectId || (original.project._workspace || 'default') !== projectId ||
          projectVersion(original.project) !== original.configVersion || this.machines.live.get(id) !== original.live) throw changed();
      const raw = structuredClone(original.project);
      // Workspaces deliberately excludes scope from the serialized config.
      // Preserve it explicitly across both clones, independently of the digest.
      Object.defineProperty(raw, '_workspace', { value: original.project._workspace, enumerable: false });
      /**
       * 入口 / Entry: NotebookEnvironments.prepared.callback@296.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.scoped）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.scoped).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `cloned`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `this.workspaces.projects.current(id) !== projectId || (resolved._workspace || 'default') !== projectId || resolved.directory …`; 异常 / errors `changed()`.
       */
      const project = await this.scoped(id, projectId, async () => {
        const resolved = await this.workspaces.resolveProject(id, raw);
        if (this.workspaces.projects.current(id) !== projectId || (resolved._workspace || 'default') !== projectId ||
            resolved.directory !== raw.directory || resolved.networkIsolation !== raw.networkIsolation) throw changed();
        const cloned = structuredClone(resolved);
        Object.defineProperty(cloned, '_workspace', { value: original.project._workspace, enumerable: false });
        return cloned;
      });
      const capture: Capture = { raw, project, projectId, configSha256: original.configVersion,
        live: original.live, bootId: await this.kernelBoot(id, prepared.signal), signal: prepared.signal };
      return await this.machines.locked(id, async () => {
        await this.assertCaptured(id, capture); return this.scoped(id, projectId, () => work(capture));
      });
    } finally { await prepared.release(); }
  }
  /**
   * 入口 / Entry: NotebookEnvironments.control.
   * 功能：在管理绑定项目账户的 Notebook 会话中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await pending` 供上层消费（`NotebookEnvironments`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NotebookEnvironments`; this entry produces `await pending` for its caller. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
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
   * 入口 / Entry: NotebookEnvironments.prove.
   * 功能：在管理绑定项目账户的 Notebook 会话中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `listener && !this.closed && this.machines.state(session.vmId) === 'running' && this.machines.live.get(session.vmId) === insta…` 供上层消费（`NotebookEnvironments`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NotebookEnvironments`; this entry produces `false` / `listener && !this.closed && this.machines.state(session.vmId) === 'running' && this.machines.live.get(session.vmId) === insta…` for its caller. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
   * 处理：通过 `this.current`, `this.launching.has`, `keyOf`, `this.matchesProject` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.current`, `this.launching.has`, `keyOf`, `this.matchesProject`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || !current || current.status === 'review' || current.status !== 'running' && !this.laun…`; `!instance`; `status.status !== 'running' || !status.record || !same(status.record, execution.record) || status.bo…`.
   * 输入 / Inputs: session: Session; project: Project; signal: AbortSignal optional
   * 输出 / Returns: `false`; `listener && !this.closed && this.machines.state(session.vmId) === 'running' && this.machines.live.get(session.vmId) === insta…`.
   * 副作用 / Effects: `this.options.listener`; `this.machines.exec`; 更新 / updates `listener`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async prove(session: Session, project: Project, signal?: AbortSignal) {
    const current = this.current(session);
    if (this.closed || !current || current.status === 'review' || current.status !== 'running' &&
        !this.launching.has(keyOf(session) + ':' + session.execution?.record.runId) || !this.matchesProject(session, project) ||
        !session.execution?.run || this.machines.state(session.vmId) !== 'running') return false;
    const instance = this.machines.live.get(session.vmId), execution = session.execution;
    if (!instance) return false;
    const status = await this.scope(session).status(signal, execution.sha256);
    if (status.status !== 'running' || !status.record || !same(status.record, execution.record) || status.bootId !== execution.run!.bootId) return false;
    if (!await this.scopes.readonlyActive(session.vmId, session.projectId, execution.record.runId, signal)) return false;
    const run = await this.identities.runReadonly(session.vmId, execution.identity, execution.record.runId, signal);
    if (!same(run, execution.run) || !nativeMatches(run, execution.identity, execution.record)) return false;
    let listener: boolean;
    if (this.options.listener) listener = await this.options.listener(session, signal);
    else {
      const result = await this.machines.exec(session.vmId, notebookListenerCommand(session), 10000, signal);
      listener = result.code === 0 && z.object({ ready: z.boolean() }).strict().parse(JSON.parse(result.stdout)).ready;
    }
    const configured = await this.config(session.vmId, session.projectId), unchanged = this.current(session);
    signal?.throwIfAborted();
    return listener && !this.closed && this.machines.state(session.vmId) === 'running' &&
      this.machines.live.get(session.vmId) === instance && !!unchanged && unchanged.status !== 'review' &&
      this.matchesProject(session, configured);
  }
  /**
   * 入口 / Entry: NotebookEnvironments.restoreBridge.
   * 功能：把本层请求转交 `this.control`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.control` and propagates the provider result or rejection.
   * 输入 / Inputs: session: Session; project: Project; signal: AbortSignal optional
   * 输出 / Returns: `this.control(session, async () => { if (!await this.prove(session, project, signal)) throw changed(); await this.bridges.open…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private restoreBridge(session: Session, project: Project, signal?: AbortSignal) {
    return this.control(session, async () => {
      if (!await this.prove(session, project, signal)) throw changed();
      await this.bridges.open(session.vmId, project, session.guestPort, session.hostPort, signal, true);
      if (!this.current(session)) { await this.bridges.stop(session.vmId, session.projectId); throw changed(); }
    });
  }
  /**
   * 入口 / Entry: NotebookEnvironments.installed.
   * 功能：在管理绑定项目账户的 Notebook 会话中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `result.code === 0 && z.object({ installed: z.boolean() }).strict().parse(JSON.parse(result.stdout)).installed` 供上层消费（`NotebookEnvironments`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NotebookEnvironments`; this entry produces `false` / `result.code === 0 && z.object({ installed: z.boolean() }).strict().parse(JSON.parse(result.stdout)).installed` for its caller. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
   * 处理：通过 `this.machines.state`, `this.machines.exec`, `notebookInstalledCommand`, `z.object().strict().parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.state`, `this.machines.exec`, `notebookInstalledCommand`, `z.object().strict().parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!identity || this.machines.state(id) !== 'running'`.
   * 输入 / Inputs: id: string; identity: ProjectIdentity | undefined; provider: NotebookProvider; signal: AbortSignal optional
   * 输出 / Returns: `false`; `result.code === 0 && z.object({ installed: z.boolean() }).strict().parse(JSON.parse(result.stdout)).installed`.
   * 副作用 / Effects: `this.machines.exec`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async installed(id: string, identity: ProjectIdentity | undefined, provider: NotebookProvider, signal?: AbortSignal) {
    if (!identity || this.machines.state(id) !== 'running') return false;
    const result = await this.machines.exec(id, notebookInstalledCommand(identity, provider), 10000, signal);
    return result.code === 0 && z.object({ installed: z.boolean() }).strict().parse(JSON.parse(result.stdout)).installed;
  }
  /**
   * 入口 / Entry: NotebookEnvironments.view.
   * 功能：在管理绑定项目账户的 Notebook 会话中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ ready: running, executed: false, installed, projectId, session: session ? { provider: session.provider, directory: session.…` 供上层消费（`NotebookEnvironments`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `NotebookEnvironments`; this entry produces `{ ready: running, executed: false, installed, projectId, session: session ? { provider: session.provider, directory: session.…` for its caller. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
   * 处理：通过 `notebookInput.parse`, `this.context`, `this.config`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `notebookInput.parse`, `this.context`, `this.config`, `this.machines.state`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `session?.execution`; `session`.
   * 输入 / Inputs: id: string; input: unknown default={}; signal: AbortSignal optional
   * 输出 / Returns: `{ ready: running, executed: false, installed, projectId, session: session ? { provider: session.provider, directory: session.…`.
   * 副作用 / Effects: `this.installed`; `this.bridges.stop`; 更新 / updates `reachable`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; 异常 / errors `new AppError('Notebook 服务已关闭', 409)`.
   * 失败处理：catch 分支执行 `signal?.throwIfAborted();`; `await this.bridges.stop(id, projectId);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `signal?.throwIfAborted();`; `await this.bridges.stop(id, projectId);`; these statements determine whether a failure is absorbed or rejected again.
   */
  async view(id: string, input: unknown = {}, signal?: AbortSignal, explicitProjectId?: string) {
    if (this.closed) throw new AppError('Notebook 服务已关闭', 409);
    const options = notebookInput.parse(input), { projectId, session } = this.context(id, explicitProjectId), project = await this.config(id, projectId);
    const running = this.machines.state(id) === 'running';
    const known = this.state!.environments.find(item => item.vmId === id && item.projectId === projectId && item.provider === options.provider);
    const identity = known?.identity || (session?.provider === options.provider ? session.execution?.identity : undefined);
    const installed = identity?.directory === project.directory && identity.networkIsolation === (project.networkIsolation || 'host') &&
      await this.installed(id, identity, options.provider, signal) || false;
    let reachable = false;
    if (session?.execution) {
      try { await this.restoreBridge(session, project, signal); reachable = await this.probeHttp(session); }
      catch { signal?.throwIfAborted(); await this.bridges.stop(id, projectId); }
    } else if (session) await this.bridges.stop(id, projectId);
    return { ready: running, executed: false, installed, projectId,
      session: session ? { provider: session.provider, directory: session.directory, guestPort: session.guestPort,
        hostPort: session.hostPort, status: !session.execution || session.status !== 'running' ? 'review' : reachable ? 'running' : 'unhealthy',
        startedAt: session.startedAt, needsReview: !session.execution || session.status !== 'running' } : null,
      message: !running ? '请先启动实例。' : session && !session.execution ? legacy().message :
        'Notebook 使用项目账号和独立 home，通过本机回环桥接访问。' };
  }
  /**
   * 入口 / Entry: NotebookEnvironments.install.
   * 功能：在管理绑定项目账户的 Notebook 会话中，执行此领域的具体处理步骤并返回其结果；本入口产生 `identity` 供上层消费（`NotebookEnvironments`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NotebookEnvironments`; this entry produces `identity` for its caller. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
   * 处理：通过 `this.assertCaptured`, `this.scopes.identity`, `this.installed`, `admin` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.assertCaptured`, `this.scopes.identity`, `this.installed`, `admin`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `await this.installed(id, identity, provider, captured.signal)`; `cleanup.code === 0`; `metadata.phase !== 'closed'`.
   * 输入 / Inputs: id: string; captured: Capture; provider: NotebookProvider; log: (line: string) => void
   * 输出 / Returns: `identity`.
   * 副作用 / Effects: `this.installed`; `writeStore`; 更新 / updates `metadata.lease`, `metadata.phase`, `result`, `receipt`.
   * 拒绝 / Refusals: 条件 / conditions `tools.code !== 0`; `downloaded.code !== 0`; `lease.leaseId !== request.leaseId || lease.bootId !== captured.bootId || lease.provider !== provider`; 异常 / errors `new AppError('Notebook 系统依赖准备失败', 409, 'NOTEBOOK_PREPARE_FAILED')`; `new AppError('Notebook 固定管理员下载失败；已保留原 wheelhouse 租约', 409, 'NOTEBOOK_PREPARE_FAILED')`.
   * 收尾：退出 try 区域时始终执行 `output.flush();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `output.flush();`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `if (metadata.phase !== 'closed') { metadata.phase = 'review'; await writeStore(leaseFile, metadata); }`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (metadata.phase !== 'closed') { metadata.phase = 'review'; await writeStore(leaseFile, metadata); }`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async install(id: string, captured: Capture, provider: NotebookProvider, log: (line: string) => void, allowDownload = true) {
    await this.assertCaptured(id, captured);
    const identity = await this.scopes.identity(id, captured.project, captured.signal);
    await this.assertCaptured(id, captured);
    if (await this.installed(id, identity, provider, captured.signal)) return identity;
    if (!allowDownload) throw new AppError('离线 Notebook 环境未准备，未执行安装', 409, 'NOTEBOOK_OFFLINE_NOT_READY');
    const admin = this.options.adminTask || guestTask;
    const tools = await admin(this.machines, id, notebookToolsScript(this.machines.get(id).distro || 'alpine', captured.bootId), captured.signal, undefined, 180000);
    if (tools.code !== 0) throw new AppError('Notebook 系统依赖准备失败', 409, 'NOTEBOOK_PREPARE_FAILED');
    await this.assertCaptured(id, captured);
    const request = notebookWheelRequest(captured.bootId, provider), leaseFile = join(vmDir(id), 'project-notebooks', captured.projectId, 'wheelhouses', request.leaseId + '.json');
    const metadata: any = { version: 1, projectId: captured.projectId, identity, configSha256: captured.configSha256,
      request, phase: 'downloading' };
    await writeStore(leaseFile, metadata);
    try {
      log('正在准备固定下载环境中的 Notebook wheels…\n');
      const downloaded = await admin(this.machines, id, notebookWheelhouseCommand('download', request), captured.signal, undefined, 20 * 60000);
      if (downloaded.code !== 0) throw new AppError('Notebook 固定管理员下载失败；已保留原 wheelhouse 租约', 409, 'NOTEBOOK_PREPARE_FAILED');
      const lease = notebookWheelLeaseSchema.parse(JSON.parse(downloaded.stdout));
      if (lease.leaseId !== request.leaseId || lease.bootId !== captured.bootId || lease.provider !== provider) throw changed();
      metadata.lease = lease; metadata.phase = 'installing'; await writeStore(leaseFile, metadata);
      await this.assertCaptured(id, captured);
      const secrets = Object.values(captured.project.environment || {}).filter(value => value.length >= 4), output = privateLog(log, secrets);
      let result: Awaited<ReturnType<typeof projectIdentityTask>>;
      try {
        result = await (this.options.runTask || projectIdentityTask)(this.machines, id, captured.project,
          { command: notebookInstallExecution(identity, lease), environment: captured.project.environment }, captured.signal,
          output.write, 20 * 60000, undefined, undefined, { expectedLive: captured.live, expectedBootId: captured.bootId });
      } catch (error) {
        throw new AppError(redactValues(error instanceof Error ? error.message : String(error), secrets),
          error instanceof AppError ? error.status : 409, error instanceof AppError ? error.code : 'NOTEBOOK_INSTALL_FAILED');
      } finally { output.flush(); }
      // projectIdentityTask has confirmed its entire original task domain
      // closed before returning. Uncertain cleanup retains the immutable cache.
      await this.assertCaptured(id, captured);
      const cleanup = await admin(this.machines, id, notebookWheelhouseCommand('cleanup', lease), captured.signal, undefined, 60000);
      let receipt;
      try { if (cleanup.code === 0) receipt = z.object({ cleaned: z.literal(true), leaseId: z.uuid() }).strict().safeParse(JSON.parse(cleanup.stdout)); }
      catch { /* An unparseable acknowledgement cannot retire the original cache lease. */ }
      if (!receipt || !receipt.success || receipt.data.leaseId !== lease.leaseId)
        throw new AppError('Notebook wheelhouse 原租约清理未确认，已保留记录', 503, 'NOTEBOOK_PREPARE_CLEANUP_FAILED');
      metadata.phase = 'closed'; await writeStore(leaseFile, metadata);
      if (result.code !== 0) throw new AppError('Notebook 项目离线安装失败', 409, 'NOTEBOOK_INSTALL_FAILED');
      await this.assertCaptured(id, captured);
      if (!await this.installed(id, identity, provider, captured.signal)) throw new AppError('Notebook 项目账号安装回执未确认', 409, 'NOTEBOOK_INSTALL_FAILED');
      await this.change(state => {
        const prior = state.environments.findIndex(item => item.vmId === id && item.projectId === captured.projectId && item.provider === provider);
        const record = { vmId: id, projectId: captured.projectId, provider, identity, installedAt: new Date().toISOString() };
        if (prior >= 0) state.environments[prior] = record;
        else { if (state.environments.length >= 256) throw new AppError('Notebook 环境记录达到上限', 409); state.environments.push(record); }
      });
      log('Notebook 已由项目账号完成离线安装。\n'); return identity;
    } catch (error) {
      if (metadata.phase !== 'closed') { metadata.phase = 'review'; await writeStore(leaseFile, metadata); }
      throw error;
    }
  }
  /**
   * 入口 / Entry: NotebookEnvironments.stop.
   * 功能：把本层请求转交 `this.control`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.control` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; session: Session; signal: AbortSignal
   * 输出 / Returns: `this.control(session, async () => { signal.throwIfAborted(); if (!this.current(session)) throw changed(); if (!session.execut…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private stop(id: string, session: Session, signal: AbortSignal) {
    /**
     * 入口 / Entry: NotebookEnvironments.stop.callback@429.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.control）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.control).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.bridges.stop`; `this.scope().stop`.
     * 拒绝 / Refusals: 条件 / conditions `!this.current(session)`; `!session.execution`; `this.machines.state(id) !== 'running'`; 异常 / errors `changed()`; `legacy()`.
     * 失败处理：catch 分支执行 `throw new AppError('Notebook 完整运行域清理未确认，原记录继续保留：' + (error instanceof Error ? error.message : String(error)), 503, 'NOTEBOOK_…`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `throw new AppError('Notebook 完整运行域清理未确认，原记录继续保留：' + (error instanceof Error ? error.message : String(error)), 503, 'NOTEBOOK_…`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.control(session, async () => {
      signal.throwIfAborted(); if (!this.current(session)) throw changed(); if (!session.execution) throw legacy();
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例，再核对原 Notebook 完整运行域', 409);
      await this.change(state => { const row = state.sessions.find(item => keyOf(item) === keyOf(session));
        if (!row || !same(row.execution, session.execution)) throw changed(); row.status = 'review'; });
      await this.bridges.stop(id, session.projectId);
      try { await this.scope(session).stop(session.execution.record); }
      catch (error) { throw new AppError('Notebook 完整运行域清理未确认，原记录继续保留：' +
        (error instanceof Error ? error.message : String(error)), 503, 'NOTEBOOK_CLEANUP_FAILED'); }
      if (!this.current(session)) throw changed();
      await this.change(state => { state.sessions = state.sessions.filter(item => keyOf(item) !== keyOf(session) || item.startedAt !== session.startedAt); });
    });
  }
  /**
   * 入口 / Entry: NotebookEnvironments.start.
   * 功能：在管理绑定项目账户的 Notebook 会话中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: true, executed: true, session: { provider: prior.provider, status: 'running', hostPort: prior.hostPort, guestPort: p…` / `{ ready: true, executed: true, session: { provider: session.provider, status: 'running', hostPort: session.hostPort, guestPor…` 供上层消费（`NotebookEnvironments`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NotebookEnvironments`; this entry produces `{ ready: true, executed: true, session: { provider: prior.provider, status: 'running', hostPort: prior.hostPort, guestPort: p…` / `{ ready: true, executed: true, session: { provider: session.provider, status: 'running', hostPort: session.hostPort, guestPor…` for its caller. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
   * 处理：通过 `inline.sessions.find`, `this.matchesProject`, `this.restoreBridge`, `this.probeHttp` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.sessions.find`, `this.matchesProject`, `this.restoreBridge`, `this.probeHttp`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `prior`; `!session.execution!.run`; `await this.probeHttp(session)`.
   * 输入 / Inputs: id: string; input: Input; captured: Capture; log: (line: string) => void
   * 输出 / Returns: `{ ready: true, executed: true, session: { provider: prior.provider, status: 'running', hostPort: prior.hostPort, guestPort: p…`; `{ ready: true, executed: true, session: { provider: session.provider, status: 'running', hostPort: session.hostPort, guestPor…`.
   * 副作用 / Effects: `this.stop`; `this.install`; `createHash().update().digest`; `createHash().update`; `createHash`; 更新 / updates `session`.
   * 拒绝 / Refusals: 条件 / conditions `prior && prior.status === 'running' && prior.execution?.run`; `!this.matchesProject(prior, captured.raw) || prior.provider !== input.provider || prior.hostPort !== input.hostPort || prior.…`; `!await this.probeHttp(prior)`; 异常 / errors `new AppError('请先停止当前 Notebook 会话，再修改参数或配置', 409)`; `new AppError('Notebook 原运行已核对但入口不可达', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.launching.delete(launching);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.launching.delete(launching);`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `try { if (session && this.current(session)) await this.stop(id, session, new AbortController().signal); else await process.st…`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `try { if (session && this.current(session)) await this.stop(id, session, new AbortController().signal); else await process.st…`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async start(id: string, input: Input, captured: Capture, log: (line: string) => void, offline = false) {
    const { project, projectId, signal } = captured;
    let prior = this.state!.sessions.find(item => item.vmId === id && item.projectId === projectId);
    if (prior && prior.status === 'running' && prior.execution?.run) {
      if (!this.matchesProject(prior, captured.raw) || prior.provider !== input.provider || prior.hostPort !== input.hostPort || prior.guestPort !== input.guestPort)
        throw new AppError('请先停止当前 Notebook 会话，再修改参数或配置', 409);
      await this.restoreBridge(prior, captured.raw, signal);
      if (!await this.probeHttp(prior)) throw new AppError('Notebook 原运行已核对但入口不可达', 409);
      return { ready: true, executed: true, session: { provider: prior.provider, status: 'running', hostPort: prior.hostPort, guestPort: prior.guestPort }, message: 'Notebook 会话已经运行。' };
    }
    if (prior) await this.stop(id, prior, signal);
    const identity = await this.install(id, captured, input.provider, log, !offline);
    await this.assertCaptured(id, captured);
    if (this.machines.get(id).forwards.some(item => item.host === input.hostPort))
      throw new AppError('所选本机端口已有实例转发，请选择独立回环端口', 409);
    const partial: Session = { vmId: id, projectId, provider: input.provider, directory: project.directory,
      networkIsolation: project.networkIsolation || 'host', guestPort: input.guestPort, hostPort: input.hostPort,
      token: randomBytes(32).toString('hex'), createdForward: false, status: 'starting', startedAt: new Date().toISOString() };
    const process = this.scope(partial), status = await process.status(signal);
    if (!['absent', 'stopped'].includes(status.status) || status.bootId !== captured.bootId) throw changed();
    const binding = createHash('sha256').update(JSON.stringify(['notebook-uid-v1', captured.configSha256, input.provider,
      identity, input.guestPort, partial.token])).digest('hex');
    const intent = process.newIntent(binding, captured.bootId);
    const command = 'set -eu\numask 077\nmkdir -p "$HOME/.local/share/sakura-notebooks" "$HOME/.config/sakura-notebooks"\n' +
      (input.provider === 'jupyter' ?
        'export JUPYTER_CONFIG_DIR="$HOME/.config/sakura-notebooks/jupyter" JUPYTER_DATA_DIR="$HOME/.local/share/sakura-notebooks/jupyter" JUPYTER_RUNTIME_DIR="$HOME/.local/share/sakura-notebooks/runtime"\n' +
        `exec ${quote(binary(partial))} lab --no-browser --ip=127.0.0.1 --port=${input.guestPort} --ServerApp.port_retries=0 --ServerApp.root_dir=. --ServerApp.log_level=ERROR` :
        `exec ${quote(binary(partial))} edit --headless --host 127.0.0.1 --port ${input.guestPort} --token --token-password "$SAKURA_NOTEBOOK_TOKEN"`);
    const execution = { command, environment: { ...project.environment,
      ...(input.provider === 'jupyter' ? { JUPYTER_TOKEN: partial.token } : { SAKURA_NOTEBOOK_TOKEN: partial.token }) } };
    const { sha256 } = projectIdentityPayload(execution);
    let session: Session | undefined;
    const launching = `${id}:${projectId}:${intent.runId}`;
    this.launching.add(launching);
    try {
      session = { ...partial, execution: { identity, record: intent, run: null, sha256, configSha256: captured.configSha256 } };
      await this.change(state => { if (state.sessions.length >= 128) throw new AppError('Notebook 会话记录达到上限', 409); state.sessions.push(session!); });
      await process.persistIntent(intent); await this.assertCaptured(id, captured);
      const payload = await this.scopes.inherited(id, project, execution, { kind: 'service', runId: intent.runId, bootId: intent.bootId }, signal);
      if (!same(payload.identity, identity) || payload.sha256 !== sha256) throw changed();
      await this.assertCaptured(id, captured); const started = await process.start(intent, payload, signal);
      /**
       * 入口 / Entry: NotebookEnvironments.start.callback@483.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.change）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.change).
       * 输入 / Inputs: state
       * 输出 / Returns: `row`.
       * 副作用 / Effects: 更新 / updates `row.execution!.record`.
       * 拒绝 / Refusals: 条件 / conditions `!same(row.execution!.record, intent)`; 异常 / errors `changed()`.
       */
      session = await this.change(state => { const row = state.sessions.find(item => keyOf(item) === keyOf(session!))!;
        if (!same(row.execution!.record, intent)) throw changed(); row.execution!.record = started; return row; });
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        await this.assertCaptured(id, captured); const state = await process.status(signal, sha256);
        if (state.status !== 'running' || !same(state.record, started)) throw changed();
        if (await this.scopes.active(id, projectId, intent.runId, signal)) {
          const run = await this.identities.runReadonly(id, identity, intent.runId, signal);
          if (!nativeMatches(run, identity, started)) throw changed();
          if (!session.execution!.run) session = await this.change(state => { const row = state.sessions.find(item => keyOf(item) === keyOf(session!))!; row.execution!.run = run; return row; });
          // The task domain can be alive before Jupyter has opened its listener.
          // Keep the same immutable identity while waiting; never open an unproven bridge.
          if (!await this.prove(session, captured.raw, signal)) {
            await delay(500, undefined, { signal });
            continue;
          }
          await this.restoreBridge(session, captured.raw, signal);
          if (await this.probeHttp(session)) {
            await this.assertCaptured(id, captured);
            session = await this.change(state => { const row = state.sessions.find(item => keyOf(item) === keyOf(session!))!; row.status = 'running'; return row; });
            log('Notebook 已使用项目账号在本机回环端口就绪。\n');
            return { ready: true, executed: true, session: { provider: session.provider, status: 'running', hostPort: session.hostPort, guestPort: session.guestPort }, message: 'Notebook 已启动；使用下方按钮获取访问链接。' };
          }
        }
        await delay(500, undefined, { signal });
      }
      throw new AppError('Notebook 就绪检查超时', 409);
    } catch (error) {
      try {
        if (session && this.current(session)) await this.stop(id, session, new AbortController().signal);
        else await process.stop(intent);
      } catch (cleanupError) {
        if (session && this.current(session)) await this.change(state => { const row = state.sessions.find(item => keyOf(item) === keyOf(session!)); if (row) row.status = 'review'; });
        throw new AppError(`Notebook 启动失败：${error instanceof Error ? error.message : String(error)}；回滚清理未确认：${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}；原运行记录已保留`, 503, 'NOTEBOOK_CLEANUP_FAILED');
      }
      throw error;
    } finally { this.launching.delete(launching); }
  }
  /**
   * 入口 / Entry: NotebookEnvironments.run.
   * 功能：在管理绑定项目账户的 Notebook 会话中，执行此领域的具体处理步骤并返回其结果；本入口产生 `operation` 供上层消费（`NotebookEnvironments`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NotebookEnvironments`; this entry produces `operation` for its caller. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
   * 处理：通过 `notebookInput.parse`, `this.context`, `this.active.has`, `inline.sessions.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `notebookInput.parse`, `this.context`, `this.active.has`, `inline.sessions.some`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal; log: (line: string) => void
   * 输出 / Returns: Promise<NotebookResponse>；结果来自 / values from `operation`.
   * 副作用 / Effects: `this.active.add`; `AbortSignal.any`; `this.pending.add`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.active.has(key)`; `options.mode !== 'status' && this.state!.sessions.some(item => item.vmId === id && item.projectId === projectId && !item.exec…`; 异常 / errors `new AppError('Notebook 服务已关闭', 409)`; `new AppError('此项目的 Notebook 操作仍在进行', 409)`.
   */
  async run(id: string, input: unknown, signal: AbortSignal, log: (line: string) => void, explicitProjectId?: string, offline = false): Promise<NotebookResponse> {
    if (this.closed) throw new AppError('Notebook 服务已关闭', 409);
    const options = notebookInput.parse(input), { projectId } = this.context(id, explicitProjectId), key = `${id}:${projectId}`;
    if (this.active.has(key)) throw new AppError('此项目的 Notebook 操作仍在进行', 409);
    if (options.mode !== 'status' && this.state!.sessions.some(item => item.vmId === id && item.projectId === projectId && !item.execution))
      throw legacy();
    this.active.add(key);
    const abort = AbortSignal.any([signal, this.controller.signal]);
    /**
     * 入口 / Entry: NotebookEnvironments.run.callback@523.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view(id, options, abort)`; `this.prepared(id, projectId, abort, async captured => { if (options.mode === 'start') return this.start(id, options, captured…`; `this.machines.locked(id, async () => { const session = this.state!.sessions.find(item => item.vmId === id && item.projectId =…`.
     * 副作用 / Effects: `abort.throwIfAborted`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const operation = (async () => {
      abort.throwIfAborted(); if (options.mode === 'status') return this.view(id, options, abort, projectId);
      if (options.mode === 'start' || options.mode === 'install') return this.prepared(id, projectId, abort, async captured => {
        if (options.mode === 'start') return this.start(id, options, captured, log, offline);
        await this.install(id, captured, options.provider, log);
        return { ready: true, executed: true, installed: true, provider: options.provider, message: 'Notebook 环境已安装；现在可启动会话。' };
      });
      return this.machines.locked(id, async () => {
        const session = this.state!.sessions.find(item => item.vmId === id && item.projectId === projectId);
        if (session) await this.stop(id, session, abort);
        return { ready: true, executed: true, session: null, message: 'Notebook 会话已停止。' };
      });
    })();
    this.pending.add(operation);
    void operation.finally(() => { this.pending.delete(operation); this.active.delete(key); }).catch(() => {});
    return operation;
  }
  /**
   * 入口 / Entry: NotebookEnvironments.link.
   * 功能：在管理绑定项目账户的 Notebook 会话中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ provider: session.provider, url: session.provider === 'jupyter' ? `${base}lab?token=${session.token}` : `${base}?access_tok…` 供上层消费（`NotebookEnvironments`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `NotebookEnvironments`; this entry produces `{ provider: session.provider, url: session.provider === 'jupyter' ? `${base}lab?token=${session.token}` : `${base}?access_tok…` for its caller. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
   * 处理：通过 `this.context`, `legacy`, `changed`, `this.restoreBridge` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.context`, `legacy`, `changed`, `this.restoreBridge`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ provider: session.provider, url: session.provider === 'jupyter' ? `${base}lab?token=${session.token}` : `${base}?access_tok…`.
   * 副作用 / Effects: `this.bridges.stop`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `!session || !session.execution`; `!await this.probeHttp(session) || !this.current(session)`; 异常 / errors `new AppError('Notebook 服务已关闭', 409)`; `session ? legacy() : changed()`.
   * 失败处理：catch 分支执行 `await this.bridges.stop(id, session.projectId);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await this.bridges.stop(id, session.projectId);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async link(id: string, explicitProjectId?: string) {
    if (this.closed) throw new AppError('Notebook 服务已关闭', 409);
    const { session } = this.context(id, explicitProjectId); if (!session || !session.execution) throw session ? legacy() : changed();
    try {
      await this.restoreBridge(session, await this.config(id, session.projectId));
      if (!await this.probeHttp(session) || !this.current(session)) throw changed();
      const base = `http://127.0.0.1:${session.hostPort}/`;
      return { provider: session.provider, url: session.provider === 'jupyter' ? `${base}lab?token=${session.token}` : `${base}?access_token=${session.token}` };
    } catch (error) { await this.bridges.stop(id, session.projectId); throw error; }
  }
  /**
   * 入口 / Entry: NotebookEnvironments.close.
   * 功能：在管理绑定项目账户的 Notebook 会话中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`NotebookEnvironments`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `NotebookEnvironments`; the outcome is recorded in `this.closed`. Module context: Owns project-account Notebook sessions; connections and stops verify original boot and complete run scope.
   * 处理：通过 `this.controller.abort`, `this.bridges.close`, `Promise.allSettled`, `this.controls.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.controller.abort`, `this.bridges.close`, `Promise.allSettled`, `this.controls.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.controller.abort`; `this.bridges.close`; `this.ownedTerminals.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true; this.controller.abort();
    await this.bridges.close(); await Promise.allSettled(this.pending); await Promise.allSettled(this.controls.values());
    await this.writes; await this.ownedTerminals?.close();
  }
}
