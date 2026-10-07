/**
 * 模块职责：部署固定仓库下载代理并准备项目检出，核对对象回执和受控下载目录后交付。
 * Module purpose: Deploys fixed repository brokers and prepares checkout, verifying object receipts and staging paths before handoff.
 */
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { ROOT, vmDir } from './paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import type { Project } from './project-config.ts';
import { quote } from './shell.ts';
import { guestTask } from './guest-task.ts';
import type { ResolvedDependencyAuthentication } from './dependency-downloads.ts';
import { dependencyDownloadEnvironment } from './project-dependency-cache.ts';
import { projectIdentitySchema, type ProjectIdentity } from './project-identity.ts';
import { ProjectRunScopes, projectIdentityTask } from './project-run-scope.ts';
import { readStore, writeStore } from './local-store.ts';
import { repositoryAuthorizationScope, repositoryUrl } from './repository-url.ts';
export { repositoryAuthorizationScope, repositoryUrl } from './repository-url.ts';

let source: Promise<string> | undefined;
/**
 * 入口 / Entry: repositoryBrokerSource.
 * 功能：在部署固定仓库下载代理并准备项目检出中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(source ||= readFile(join(ROOT, 'server/project-repository-broker.py'), 'utf8').catch(error => { if (error.code !== 'ENOENT')…` 供上层消费（`project-repository.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-repository.ts`; this entry produces `(source ||= readFile(join(ROOT, 'server/project-repository-broker.py'), 'utf8').catch(error => { if (error.code !== 'ENOENT')…` for its caller. Module context: Deploys fixed repository brokers and prepares checkout, verifying object receipts and staging paths before handoff.
 * 处理：通过 `readFile().catch`, `readFile`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `readFile().catch`, `readFile`, `join`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `(source ||= readFile(join(ROOT, 'server/project-repository-broker.py'), 'utf8').catch(error => { if (error.code !== 'ENOENT')…`.
 * 副作用 / Effects: 更新 / updates `source`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function repositoryBrokerSource() {
  return (source ||= readFile(join(ROOT, 'server/project-repository-broker.py'), 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return readFile(join(ROOT, '.sakura-server/assets/project-repository-broker.py'), 'utf8');
  }));
}
const digest = z.string().regex(/^[a-f0-9]{64}$/), decimal = z.string().regex(/^[1-9][0-9]*$/);
const downloadSchema = z.object({ version: z.literal(1), head: z.string().max(1024).nullable(),
  commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).nullable(),
  bundleSha256: digest.nullable(), bundleBytes: z.number().int().min(0).max(512 * 1024 * 1024),
  device: decimal, inode: decimal }).strict().superRefine((value, ctx) => {
  if ((value.head !== null && (!value.head.startsWith('refs/heads/') || /[\x00-\x20\x7f]/.test(value.head))) ||
      (value.commit === null ? value.bundleSha256 !== null || value.bundleBytes !== 0 : value.bundleSha256 === null || value.bundleBytes === 0))
    ctx.addIssue({ code: 'custom', message: 'Git 对象回执不完整' });
});
export type RepositoryDownload = z.infer<typeof downloadSchema>;
const ownerSchema = z.object({ version: z.literal(1), runId: z.uuid(), nonce: digest, bootId: z.uuid(),
  sourceSha256: digest, identity: projectIdentitySchema }).strict();
const stateSchema = z.object({ version: z.literal(1), phase: z.enum(['pending', 'closed']), owner: ownerSchema,
  download: downloadSchema.nullable() }).strict();
type DownloadState = z.infer<typeof stateSchema>;
/**
 * 入口 / Entry: stagePath.
 * 功能：在部署固定仓库下载代理并准备项目检出中，执行此领域的具体处理步骤并返回其结果；本入口产生 `'/run/sakura-repository-download.' + z.uuid().parse(runId).replaceAll('-', '')` 供上层消费（`project-repository.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-repository.ts`; this entry produces `'/run/sakura-repository-download.' + z.uuid().parse(runId).replaceAll('-', '')` for its caller. Module context: Deploys fixed repository brokers and prepares checkout, verifying object receipts and staging paths before handoff.
 * 处理：通过 `z.uuid().parse().replaceAll`, `z.uuid().parse`, `z.uuid` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `z.uuid().parse().replaceAll`, `z.uuid().parse`, `z.uuid`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: runId: string
 * 输出 / Returns: `'/run/sakura-repository-download.' + z.uuid().parse(runId).replaceAll('-', '')`.
 * 副作用 / Effects: `z.uuid().parse().replaceAll`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const stagePath = (runId: string) => '/run/sakura-repository-download.' + z.uuid().parse(runId).replaceAll('-', '');
const fixedEnvironment = '/usr/bin/env -i PATH=/usr/bin:/bin HOME=/ LANG=C LC_ALL=C';

// The only executable bytes in this frame are the captured, hash-checked system
// broker source. Repository URL and authorization remain JSON data on stdin.
export const repositoryBootstrap = `import hashlib,json,os,stat,sys
stage,sha,boot=sys.argv[1:]
assert open('/proc/sys/kernel/random/boot_id').read().strip()==boot
parent=os.lstat('/run');assert stat.S_ISDIR(parent.st_mode) and parent.st_uid==0 and not parent.st_mode&0o022
raw=sys.stdin.buffer.read(131073);assert len(raw)<=131072
value=json.loads(raw);assert set(value)=={'owner','source','request'}
source=value['source'].encode('utf-8');assert hashlib.sha256(source).hexdigest()==sha
owner=value['owner'];assert owner['sourceSha256']==sha and owner['bootId']==boot
assert stage=='/run/sakura-repository-download.'+owner['runId'].replace('-','')
request=value['request'];assert len(json.dumps(request).encode('utf-8'))<=16384
os.umask(0o077);os.mkdir(stage,0o700);info=os.lstat(stage)
owner_record={'owner':owner,'device':str(info.st_dev),'inode':str(info.st_ino)}
for name,data in [('owner.json',json.dumps(owner_record).encode('utf-8')),('broker.py',source),('request.json',json.dumps(request).encode('utf-8'))]:
 fd=os.open(stage+'/'+name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  with os.fdopen(fd,'wb',closefd=False) as target: target.write(data);target.flush();os.fsync(fd)
 finally: os.close(fd)
fd=os.open(stage,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
try: os.fsync(fd)
finally: os.close(fd)
os.execv('/usr/bin/python3',['/usr/bin/python3','-I','-S',stage+'/broker.py',stage])
`;

// Cleanup never enters a project directory. It requires the original root-owned
// nonce receipt, boot and removed downloader cgroup; unknown objects are retained.
export const repositoryCleanup = `import json,os,re,stat,sys
value=json.loads(sys.argv[1]);owner=value['owner'];stage='/run/sakura-repository-download.'+owner['runId'].replace('-','')
assert re.fullmatch('/run/sakura-repository-download.[a-f0-9]{32}',stage)
parent=os.open('/run',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
try:
 parent_info=os.fstat(parent);assert parent_info.st_uid==0 and not parent_info.st_mode&0o022
 name=stage.rsplit('/',1)[1];boot=open('/proc/sys/kernel/random/boot_id').read().strip()
 if boot!=owner['bootId']:
  assert not os.path.lexists(stage);print('retired-by-boot');sys.exit(0)
 assert any(line.split()[4]=='/sys/fs/cgroup' and ' - cgroup2 ' in line for line in open('/proc/self/mountinfo'))
 assert not os.path.lexists('/sys/fs/cgroup/sakura-task-'+owner['runId'])
 try: root=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
 except FileNotFoundError: print('absent');sys.exit(0)
 try:
  info=os.fstat(root);assert info.st_uid==0 and info.st_gid in (0,owner['identity']['gid']) and stat.S_IMODE(info.st_mode) in (0o700,0o710)
  expected=value['download']
  if expected is not None: assert (str(info.st_dev),str(info.st_ino))==(expected['device'],expected['inode'])
  names=os.listdir(root)
  assert set(names)<=set(['owner.json','broker.py','request.json','repository.git','repository.bundle','home','empty'])
  if names:
   fd=os.open('owner.json',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=root)
   try:
    entry=os.fstat(fd);assert stat.S_ISREG(entry.st_mode) and entry.st_uid==0 and entry.st_gid==0 and stat.S_IMODE(entry.st_mode)==0o600 and entry.st_size<=8192
    record=json.loads(os.read(fd,8193));assert record=={'owner':owner,'device':str(info.st_dev),'inode':str(info.st_ino)}
   finally: os.close(fd)
  count=[0];tree=[]
  def inspect(directory,prefix=''):
   for child in os.listdir(directory):
    count[0]+=1;assert count[0]<=32768
    entry=os.stat(child,dir_fd=directory,follow_symlinks=False)
    assert entry.st_dev==info.st_dev and entry.st_uid==0 and not entry.st_mode&0o022
    assert stat.S_ISDIR(entry.st_mode) or stat.S_ISREG(entry.st_mode)
    path=prefix+child;tree.append((path,entry.st_dev,entry.st_ino,stat.S_ISDIR(entry.st_mode)))
    if stat.S_ISDIR(entry.st_mode):
     fd=os.open(child,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=directory)
     try: assert os.fstat(fd).st_ino==entry.st_ino;inspect(fd,path+'/')
     finally: os.close(fd)
  inspect(root)
  for path,device,inode,is_dir in reversed(tree):
   entry=os.stat(path,dir_fd=root,follow_symlinks=False);assert (entry.st_dev,entry.st_ino)==(device,inode)
   if is_dir: os.rmdir(path,dir_fd=root)
   else: os.unlink(path,dir_fd=root)
  current=os.stat(name,dir_fd=parent,follow_symlinks=False);assert (current.st_dev,current.st_ino)==(info.st_dev,info.st_ino)
  os.rmdir(name,dir_fd=parent);os.fsync(parent);print('closed')
 finally: os.close(root)
finally: os.close(parent)
`;

/**
 * 入口 / Entry: repositoryCheckoutCommand.
 * 功能：在部署固定仓库下载代理并准备项目检出中，执行此领域的具体处理步骤并返回其结果；本入口产生 `command` 供上层消费（`project-repository.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-repository.ts`; this entry produces `command` for its caller. Module context: Deploys fixed repository brokers and prepares checkout, verifying object receipts and staging paths before handoff.
 * 处理：通过 `repositoryUrl.parse`, `inline.test`, `downloadSchema.parse`, `projectIdentitySchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `repositoryUrl.parse`, `inline.test`, `downloadSchema.parse`, `projectIdentitySchema.parse`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `download.bundleSha256`.
 * 输入 / Inputs: repository: string; stage: string; download: RepositoryDownload; identity: ProjectIdentity
 * 输出 / Returns: `command`.
 * 副作用 / Effects: `downloadSchema.parse`; `download.head.slice`; 更新 / updates `repository`, `download`, `identity`, `command`.
 * 拒绝 / Refusals: 条件 / conditions `!/^\/run\/sakura-repository-download\.[a-f0-9]{32}$/.test(stage)`; 异常 / errors `new AppError('Git 下载目录无效', 409)`.
 */
export function repositoryCheckoutCommand(repository: string, stage: string, download: RepositoryDownload, identity: ProjectIdentity) {
  repository = new URL(repositoryUrl.parse(repository)).href;
  if (!/^\/run\/sakura-repository-download\.[a-f0-9]{32}$/.test(stage))
    throw new AppError('Git 下载目录无效', 409);
  download = downloadSchema.parse(download); identity = projectIdentitySchema.parse(identity);
  const clean = `/usr/bin/env -i PATH=/usr/bin:/bin HOME=${quote(identity.home)} LANG=C LC_ALL=C GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false SSH_ASKPASS=/bin/false`;
  const git = `${clean} /usr/bin/git --no-pager -c core.hooksPath=/dev/null -c core.fsmonitor=false -c credential.helper= -c protocol.allow=never -c protocol.file.allow=always -c maintenance.auto=false -c gc.auto=0`;
  let command = `set -eu\nif [ -e .git ] || [ -L .git ]; then echo '首次检出期间出现了另一个仓库，请重新核对' >&2; exit 73; fi\n`;
  command += `${clean} /usr/bin/python3 -I -S -c 'import os; assert not os.listdir("."), "首次检出要求项目目录为空"'\n`;
  if (download.bundleSha256) {
    command += `test "$(/usr/bin/sha256sum ${quote(stage + '/repository.bundle')} | cut -d ' ' -f 1)" = ${quote(download.bundleSha256)}\n`;
    const branch = download.head ? ' --branch=' + quote(download.head.slice('refs/heads/'.length)) : '';
    command += `${git} clone --no-checkout --no-hardlinks --template=${quote(stage + '/empty')}${branch} -- ${quote(stage + '/repository.bundle')} .\n`;
    command += `test "$(${git} rev-parse --verify HEAD)" = ${quote(download.commit!)}\n`;
    command += `${git} remote set-url -- origin ${quote(repository)}\n${git} checkout --force HEAD\n`;
  } else {
    command += `${git} init --template=${quote(stage + '/empty')}${download.head ? ' --initial-branch=' + quote(download.head.slice('refs/heads/'.length)) : ''} .\n`;
    command += `${git} remote add -- origin ${quote(repository)}\n`;
  }
  return command;
}

const initialRepositoryCheck = `/usr/bin/env -i PATH=/usr/bin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ${quote(`import os,sys\nif os.path.lexists('.git'): print('existing')\nelif os.listdir('.'): print('nonempty')\nelse: print('empty')`)}`;

/** Shared networking downloads fixed object data; all worktree code stays at the project UID. */
/**
 * 入口 / Entry: prepareProjectRepository.
 * 功能：部署限定仓库下载器，在原项目范围预取 Git 对象并交付检出材料。
 * Purpose: Deploys a scoped repository downloader, prefetches Git objects and hands off checkout material in the original project scope.
 * 设计：仓库和凭证分别校验，客户机 boot 固定；下载对象回执和暂存身份一致后才交付，finally 按原归属清理。
 * Design: Repository/credential validation pins guest boot; object receipts/staging identity precede handoff and finally cleans original ownership.
 * 输入 / Inputs: machines: Machines; vmId: string; project: Project; configuration: () => Promise<{ authentication?: ResolvedDependencyAuthentication; environment: Recor…; signal: AbortSignal; log: (text: string) => void optional
 * 输出 / Returns: `machines.locked(`project-repository:${vmId}:${id}`, async () => { signal.throwIfAborted(); const live = machines.live.get(vmI…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function prepareProjectRepository(machines: Machines, vmId: string, project: Project,
  configuration: () => Promise<{ authentication?: ResolvedDependencyAuthentication; environment: Record<string, string> }>,
  signal: AbortSignal, log?: (text: string) => void) {
  const repository = new URL(repositoryUrl.parse(project.repository)).href;
  const scopes = new ProjectRunScopes(machines), id = project._workspace || 'default';
  /**
   * 入口 / Entry: prepareProjectRepository.callback@152.
   * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（machines.locked）。
   * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (machines.locked).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `machines.exec`; `createHash().update().digest`; `createHash().update`; `createHash`; `writeStore`; 更新 / updates `state`, `unresolvedTask`.
   * 拒绝 / Refusals: 条件 / conditions `!live`; `previous !== null`; `parsed.owner.identity.projectId !== id`; 异常 / errors `new AppError('Git 预取需要运行中的客户机', 409)`; `new AppError('Git 下载资源项目不符', 409)`.
   * 收尾：退出 try 区域时始终执行 `input.fill(0);`; `if (!unresolvedTask) await cleanup(state);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `input.fill(0);`; `if (!unresolvedTask) await cleanup(state);`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `unresolvedTask = error instanceof AppError && ['GUEST_TASK_CLEANUP_FAILED', 'PROJECT_IDENTITY_CLEANUP_FAILED'].includes(error…`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `unresolvedTask = error instanceof AppError && ['GUEST_TASK_CLEANUP_FAILED', 'PROJECT_IDENTITY_CLEANUP_FAILED'].includes(error…`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  return machines.locked(`project-repository:${vmId}:${id}`, async () => {
    signal.throwIfAborted();
    const live = machines.live.get(vmId);
    if (!live) throw new AppError('Git 预取需要运行中的客户机', 409);
    const stateFile = join(vmDir(vmId), 'project-repository-' + id + '.json');
    /**
     * 入口 / Entry: prepareProjectRepository.unchanged.
     * 功能：在部署固定仓库下载代理并准备项目检出中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`project-repository.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-repository.ts`; the calls and state transitions below complete the operation. Module context: Deploys fixed repository brokers and prepares checkout, verifying object receipts and staging paths before handoff.
     * 处理：通过 `machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `machines.live.get`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `machines.live.get(vmId) !== live`; 异常 / errors `new AppError('Git 下载所属客户机已变化，原记录保留', 503, 'PROJECT_REPOSITORY_CLEANUP_FAILED')`.
     */
    const unchanged = () => {
      if (machines.live.get(vmId) !== live) throw new AppError('Git 下载所属客户机已变化，原记录保留', 503, 'PROJECT_REPOSITORY_CLEANUP_FAILED');
    };
    /**
     * 入口 / Entry: prepareProjectRepository.cleanup.
     * 功能：在部署固定仓库下载代理并准备项目检出中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`project-repository.ts`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `project-repository.ts`; the calls and state transitions below complete the operation. Module context: Deploys fixed repository brokers and prepares checkout, verifying object receipts and staging paths before handoff.
     * 处理：通过 `unchanged`, `machines.exec`, `quote`, `inline.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `unchanged`, `machines.exec`, `quote`, `inline.includes`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: state: DownloadState
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `machines.exec`; `writeStore`.
     * 拒绝 / Refusals: 条件 / conditions `result.code !== 0 || !['closed', 'absent', 'retired-by-boot'].includes(result.stdout.trim())`; 异常 / errors `new AppError('Git 下载资源归属或全域停止未能确认，原记录保留', 503, 'PROJECT_REPOSITORY_CLEANUP_FAILED')`.
     */
    const cleanup = async (state: DownloadState) => {
      unchanged();
      const result = await machines.exec(vmId,
        `${fixedEnvironment} /usr/bin/python3 -I -S -c ${quote(repositoryCleanup)} ${quote(JSON.stringify(state))}`, 40_000);
      unchanged();
      if (result.code !== 0 || !['closed', 'absent', 'retired-by-boot'].includes(result.stdout.trim()))
        throw new AppError('Git 下载资源归属或全域停止未能确认，原记录保留', 503, 'PROJECT_REPOSITORY_CLEANUP_FAILED');
      await writeStore(stateFile, { ...state, phase: 'closed' });
    };
    const previous = await readStore<unknown>(stateFile, () => null);
    if (previous !== null) {
      const parsed = stateSchema.parse(previous);
      if (parsed.owner.identity.projectId !== id) throw new AppError('Git 下载资源项目不符', 409);
      if (parsed.phase !== 'closed') {
        await scopes.recoverStoppedTasks(vmId, id);
        await cleanup(parsed);
      }
    }
    const check = await projectIdentityTask(machines, vmId, project, { command: initialRepositoryCheck }, signal, undefined,
      60_000, undefined, undefined, { expectedLive: live });
    if (check.code !== 0 || !['existing', 'empty', 'nonempty'].includes(check.stdout.trim()))
      throw new AppError('无法在项目账号内核对仓库目录', 409, 'PROJECT_REPOSITORY_CHECK_FAILED');
    if (check.stdout.trim() === 'existing') return;
    if (check.stdout.trim() === 'nonempty')
      throw new AppError('首次 Git 检出要求项目目录为空；请保留现有内容并选择空目录', 409, 'PROJECT_REPOSITORY_DIRECTORY_NOT_EMPTY');
    const identity = await scopes.identity(vmId, project, signal);
    const boot = await machines.exec(vmId, `${fixedEnvironment} /bin/cat /proc/sys/kernel/random/boot_id`, 10_000, signal);
    unchanged();
    const bootId = z.uuid().parse(boot.stdout.trim());
    if (boot.code !== 0) throw new AppError('无法固定 Git 下载开机身份', 409);
    const broker = await repositoryBrokerSource(), sourceSha256 = createHash('sha256').update(broker).digest('hex');
    const { authentication, environment } = await configuration();
    if (authentication && !repositoryAuthorizationScope(repository, authentication.endpoint))
      throw new AppError('Git 仓库不在所选认证下载端点内', 409);
    const owner = ownerSchema.parse({ version: 1, runId: randomUUID(), nonce: randomBytes(32).toString('hex'), bootId, sourceSha256, identity });
    const stage = stagePath(owner.runId);
    let state: DownloadState = { version: 1, phase: 'pending', owner, download: null };
    const input = Buffer.from(JSON.stringify({ owner, source: broker, request: { repository,
      authentication: authentication ? { endpoint: authentication.endpoint, authorization: authentication.authorization } : null, gid: identity.gid } }));
    if (input.length > 128 * 1024) throw new AppError('Git 下载输入超过运输上限', 413);
    await writeStore(stateFile, state);
    let unresolvedTask = false;
    try {
      unchanged();
      log?.('正在通过受限入口预取 Git 对象…\n');
      const proxy = Object.entries(dependencyDownloadEnvironment(environment)).filter(([key]) => /^(?:HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy)$/.test(key))
        .map(([key, value]) => `${key}=${quote(value)}`).join(' ');
      const result = await guestTask(machines, vmId,
        `${fixedEnvironment} ${proxy} /usr/bin/python3 -I -S -c ${quote(repositoryBootstrap)} ${quote(stage)} ${sourceSha256} ${bootId}`,
        signal, undefined, 600_000, undefined, undefined, { runId: owner.runId, input });
      unchanged();
      if (result.code !== 0) throw new AppError('Git 对象预取失败，请检查固定 smart-HTTP 地址、凭据与下载上限', 409, 'PROJECT_REPOSITORY_DOWNLOAD_FAILED');
      state = { ...state, download: downloadSchema.parse(JSON.parse(result.stdout)) };
      await writeStore(stateFile, state);
      const current = await scopes.identity(vmId, project, signal);
      if (JSON.stringify(current) !== JSON.stringify(identity)) throw new AppError('Git 检出前项目账号绑定已变化', 409);
      const checkedOut = await projectIdentityTask(machines, vmId, project,
        { command: repositoryCheckoutCommand(repository, stage, state.download!, identity) }, signal, log,
        600_000, undefined, undefined, { expectedLive: live, expectedBootId: bootId });
      if (checkedOut.code !== 0)
        throw new AppError(checkedOut.stderr.slice(-2000) || '项目账号 Git 检出失败', 409, 'PROJECT_REPOSITORY_CHECKOUT_FAILED');
      log?.('已由项目账号完成 Git 检出。\n');
    } catch (error) {
      unresolvedTask = error instanceof AppError && ['GUEST_TASK_CLEANUP_FAILED', 'PROJECT_IDENTITY_CLEANUP_FAILED'].includes(error.code || '');
      throw error;
    } finally {
      input.fill(0);
      if (!unresolvedTask) await cleanup(state);
    }
  });
}
