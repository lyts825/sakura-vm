/** 烟雾验收：验证项目 UID 的主进程、任务和服务作用域以及旧启动代次清理。
 * Smoke acceptance for project-UID main/task/service scopes and old-boot-generation cleanup. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.argv.length, 4, 'Pass alpine|debian|ubuntu and a stopped owned guest-task fixture.');
const distro = process.argv[2]; assert.ok(['alpine', 'debian', 'ubuntu'].includes(distro));
const parent = await realpath(resolve('.data/network-remaining-test-temp')), root = await realpath(resolve(process.argv[3]));
assert.equal(dirname(root), parent); assert.match(basename(root), /^sakura-guest-task-[A-Za-z0-9_-]+$/);
const prior = JSON.parse(await readFile(join(root, 'guest-task-cgroup-evidence.json'), 'utf8'));
assert.equal(prior.distro, distro); assert.equal(prior.vmStopped, true); assert.equal(prior.error, undefined);
for (const file of ['project-main-scope-evidence.json', 'project-services-scope-evidence.json']) {
  const evidence = JSON.parse(await readFile(join(root, file), 'utf8'));
  assert.equal(evidence.vmId, prior.vmId); assert.equal(evidence.vmStopped, true); assert.equal(evidence.error, undefined);
}
process.env.TEMP = process.env.TMP = parent; process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/' + { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' }[distro]);
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces, projectSchema, projectLog } = await import('../server/workspaces.ts');
const { serviceLog } = await import('../server/project-services.ts');
const { ProjectMainScope, ProjectServiceScopes, projectMainScopePaths } = await import('../server/project-service-scope.ts');
const { ProjectRunScopes, projectIdentityTask } = await import('../server/project-run-scope.ts');
const { ProjectIdentities } = await import('../server/project-identity.ts');
const { vmDir } = await import('../server/model.ts');
const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
const { quote } = await import('../server/files.ts');
const { freePort } = await import('../server/qmp.ts');
const runtime = await createRuntime(), nativeRuntimeRun = runtime.run.bind(runtime), qemuExecutions: any[] = [];
runtime.run = (/** 只对 argv 指向本自有根的 QEMU 记录参数摘要、起止和 settled，其他 runtime 原样转发；finally 记录真实调用结算用于退出验收。
 * Record argv digest/start/end/settled only for QEMU targeting this owned root and forward other runtime calls unchanged; finally records real-call settlement for exit acceptance. */ async (...args: Parameters<typeof nativeRuntimeRun>) => {
  if (args[0] !== 'sakura-qemu' || !args[1].some(value => value.includes(root))) return nativeRuntimeRun(...args);
  const execution = { startedAt: new Date().toISOString(), argvSha256: createHash('sha256').update(JSON.stringify(args[1])).digest('hex'),
    settled: false, endedAt: '' };
  qemuExecutions.push(execution);
  try { return await nativeRuntimeRun(...args); }
  finally { execution.settled = true; execution.endedAt = new Date().toISOString(); }
}) as typeof runtime.run;
const machines = new Machines(runtime); await machines.init(); assert.equal(machines.records.size, 1);
const vm = [...machines.records.values()][0]; assert.equal(vm.id, prior.vmId); assert.equal(vm.distro, distro);
assert.equal(vm.name, 'guest-task-cgroup-smoke'); assert.equal(machines.state(vm.id), 'stopped');
const invocation = randomUUID(), canary = 'owned-uid-secret-' + invocation;
const ownedSources = ['server/project-main.ts', 'server/project-services.ts', 'server/project-service-scope.ts', 'server/workspaces.ts'];
const sources = [...ownedSources, 'server/project-run-scope.ts', 'server/guest-task.ts', 'server/project-identity.ts',
  'server/project-directory-migration.ts', 'native/project-identity/controller.py', 'native/project-identity/launcher.c', 'native/project-identity/protocol.h'];
const proof: any = { version: 1, vmId: vm.id, distro, fixture: root, invocation, client: { node: process.version, execArgv: process.execArgv, pid: process.pid }, sourceSha256: {}, cases: [], startedAt: new Date().toISOString() };
proof.scriptSha256 = createHash('sha256').update(await readFile(resolve('scripts/smoke-project-uid-scopes.ts'))).digest('hex');
proof.qemuExecutions = qemuExecutions;
proof.packagedIdentity = JSON.parse(await readFile(resolve('.sakura-server/assets/project-identity/manifest.json'), 'utf8'));
for (const path of sources) proof.sourceSha256[path] = createHash('sha256').update(await readFile(resolve(path))).digest('hex');
await writeFile(join(root, `project-uid-scopes-evidence-${invocation}.json`), JSON.stringify(proof, null, 2) + '\n');
const spaces = new Workspaces(machines), identities = new ProjectRunScopes(machines);
const nativeExec = machines.exec.bind(machines), nativeInput = machines.execInput.bind(machines), commands: string[] = [];
/** 在本验收夹具的指定实例中执行传入脚本，使用函数中的超时约束并断言退出码为零，返回捕获的标准输出；失败附来宾诊断而不被当作空输出。
 * Execute the supplied script in the specified fixture VM under this function’s timeout, assert exit code zero and return captured stdout; failures include guest diagnostics rather than become empty output. */
const run = async (command: string, timeout = 30000) => { const result = await nativeExec(vm.id, command, timeout); assert.equal(result.code, 0, result.stderr + result.stdout); return result.stdout.trim(); };
/** 生成隔离 Python 命令，将整段源码作为单个字面参数；-I/-S 避免用户环境和 site 初始化改变观测，执行权限由外层来宾入口控制。
 * Build an isolated Python command with the source as one literal argument; -I/-S exclude user environment/site initialization, while the outer guest entry controls execution authority. */
const py = (source: string) => '/usr/bin/python3 -I -S -c ' + quote(source);
const savedProject = await spaces.config(vm.id);
const base = /^\/workspace\/uid-scope-[a-f0-9-]{36}$/.test(savedProject.directory)
  ? savedProject.directory : '/workspace/uid-scope-' + invocation;
/** 以场景名和本轮 invocation 构造独占自有结果目录，防止不同运行共享标记。
 * Build an owned result directory from case name/invocation so separate runs cannot share markers. */
const caseDirectory = (label: string) => base + '/' + label + '-' + invocation;
/** 生成真实项目 UID 主进程与脱离组/会话后代，报告账号/Home/环境/cgroup/网络；可让主进程提前退出以验证后代仍被整域管理。
 * Generate project-UID main/group-or-session-detached children reporting account/home/environment/cgroup/network, optionally exiting the main early to verify retained descendant ownership. */
const app = (label: string, exitMain = false) => `mkdir -p ${quote(caseDirectory(label))}\n` + py(`import json,os,signal,time
signal.signal(signal.SIGTERM,signal.SIG_IGN)
def report(name):
 f=open('/proc/self/stat').read().rsplit(') ',1)[1].split()
 value={'name':name,'pid':os.getpid(),'ticks':f[19],'uid':os.getuid(),'euid':os.geteuid(),'gid':os.getgid(),'home':os.environ.get('HOME'),'cwd':os.getcwd(),'secret':os.environ.get('TOKEN')==${JSON.stringify(canary)},'cgroup':open('/proc/self/cgroup').read().strip(),'network':os.readlink('/proc/self/ns/net')}
 with open(${JSON.stringify(caseDirectory(label))}+'/'+name+'.json','w') as stream:json.dump(value,stream)
def stay():
 while True:time.sleep(1)
report('main')
if os.fork()==0:
 os.setpgid(0,0);report('newgroup');stay()
if os.fork()==0:
 os.setsid();report('setsid');stay()
first=os.fork()
if first==0:
 os.setsid()
 if os.fork()!=0:os._exit(0)
 report('doublefork');stay()
os.waitpid(first,0)
${exitMain ? `while not os.path.exists(${JSON.stringify(caseDirectory(label) + '/release-main')}):time.sleep(.1)\nos._exit(0)` : 'stay()'}`);
/** 有限次轮询自有应用的结果文件，出现后返回；期限内未发布则失败，避免使用上一阶段缺失结果。
 * Poll the owned application result file for a bounded number of attempts, returning when published and failing on absence rather than using missing prior-stage evidence. */
const waitFile = async (path: string) => { for (let i = 0; i < 120; ++i) { if ((await nativeExec(vm.id, 'test -f ' + quote(path), 5000)).code === 0) return; await delay(50); } throw new Error('Owned fixture did not publish ' + path); };
/** 等待自有主进程及脱离组/会话子进程各自发布记录，返回精确出生身份数组供完整域清理核查。
 * Await reports from the owned main/process-group/session-detached children and return exact birth-identity records for whole-domain cleanup verification. */
const children = async (label: string) => { const values: any[] = []; for (const name of ['main', 'newgroup', 'setsid', 'doublefork']) { const file = caseDirectory(label) + '/' + name + '.json'; await waitFile(file); values.push(JSON.parse(await run('cat ' + quote(file)))); } return values; };
/** 核对原 PID 的出生 ticks 且状态不为僵尸/死亡，消失返回 false；HTTP 包装返回来宾文本，由场景比较。
 * Check original PID birth ticks/nonzombie-nondead state and return false on disappearance; the HTTP wrapper returns guest text for scenario comparison. */
const alive = async (child: any) => (await run(py(`try:\n f=open('/proc/${child.pid}/stat').read().rsplit(') ',1)[1].split();print(f[0] not in ['Z','X'] and f[19]==${JSON.stringify(child.ticks)})\nexcept FileNotFoundError:print(False)`))) === 'True';
/** 逐个验证捕获的原子进程身份已经死亡，任何自有后代存活都会使整域清理验收失败。
 * Verify each captured original process identity is dead; any surviving owned descendant fails whole-domain cleanup acceptance. */
const allStopped = async (values: any[]) => { for (const child of values) assert.equal(await alive(child), false); };
/** 用生产 schema 建立私有网络与秘密项目，setup 记录实际 UID/Home，正文使用本场景应用。
 * Build a production-schema private-network/secret project whose setup reports actual UID/home and whose body runs the case application. */
const project = (label: string, exitMain = false) => projectSchema.parse({ directory: base, command: app(label, exitMain), networkIsolation: 'private', environment: { TOKEN: canary }, setup: py(`import json,os\nopen('setup.json','w').write(json.dumps({'uid':os.getuid(),'home':os.environ.get('HOME')}))`) });
/** 执行项目主进程/服务操作并等待正式任务结束，检查私密标记不在日志/错误中后返回任务记录。
 * Execute a project main/service operation and await production job completion, returning its record only after checking logs/errors exclude private markers. */
const job = async (action: 'start' | 'stop', service?: string) => { const value = await spaces.run(vm.id, action, service); await spaces.jobs.wait(spaces.projects.key(vm.id)); assert.equal((value.error || '').includes(canary), false); assert.equal(value.log.includes(canary), false); return value; };
/** 等待项目操作并要求终态 done，错误附任务诊断；返回正式记录供后续身份核验。
 * Await project work/require final done, reporting job diagnostics on failure and returning the production record for identity checks. */
const done = async (action: 'start' | 'stop', service?: string) => { const value = await job(action, service); assert.equal(value.status, 'done', value.error + '\n' + value.log); return value; };
/** 按名称执行异步断言，成功后记录返回证据并落盘；异常直接传播，不记录通过。
 * By case name, run asynchronous assertions and retain returned evidence on success with persistence; propagate errors without recording a pass. */
const check = async (name: string, action: /** 执行一个身份边界用例的异步动作并返回观测，调用方保存时间/通过证据并传播异常；失败仍进入统一精确清理。
 * Execute an asynchronous identity-boundary case and return observations; the caller persists timing/pass evidence and propagates exceptions into unified exact cleanup. */ () => Promise<unknown>) => { const startedAt = new Date().toISOString(); const evidence = await action(); proof.cases.push({ name, startedAt, finishedAt: new Date().toISOString(), evidence }); await writeFile(join(root, `project-uid-scopes-evidence-${invocation}.json`), JSON.stringify(proof, null, 2) + '\n'); console.log('PASS ' + distro + ' ' + name); };
/** 从固定请求标记行解码原生控制 JSON，未包含标记返回 null；用于精确故障阶段识别，正文不重新执行。
 * Decode native-control JSON from its fixed request-marker line, returning null if absent; identify exact fault phases without reexecuting bodies. */
const request = (command: string) => { const line = command.split('\n').find(value => /^# SAKURA_PROJECT_(MAIN|SERVICE)_REQUEST=/.test(value)); return line ? JSON.parse(Buffer.from(line.split('=')[1], 'base64').toString()) : null; };
let outside: any, rootTmux: any, identity: any;
/** 断言域外进程与 root tmux 仍存活，证明 UID 运行域清理未越界。
 * Assert outside processes/root tmux remain alive to prove UID-domain cleanup did not cross boundaries. */
const preserve = async () => { assert.equal(await alive(outside), true); assert.equal(await alive(rootTmux), true); };
/** 先正式 setup 确保 root 私有日志，再保存精确对象并由项目身份替换为 root-secret 链接；验证日志入口不跟随链接并最终按对象身份恢复。
 * Run production setup for root-private logs, preserve their exact objects and replace via project identity with root-secret links; verify log entries do not follow links and restore by object identity. */
const rootLogGuard = async (p: ReturnType<typeof projectSchema.parse>, name?: string) => {
  // Whole-project stop retired the private network; use the real setup entry
  // to admit the test's UID tasks without restarting any main/service command.
  const preparation = await spaces.run(vm.id, 'setup'); await spaces.jobs.wait(spaces.projects.key(vm.id));
  assert.equal(preparation.status, 'done', preparation.error + '\n' + preparation.log);
  assert.equal(preparation.log.includes(canary), false);
  const path = name ? serviceLog(name, p) : projectLog(p), limit = name ? 8192 : 16384;
  const folder = '/tmp/sakura-owned-runtime-log-' + randomUUID(), parked = folder + '/original.log', secret = folder + '/root-secret';
  // The secret belongs only to this fixture. Its bytes use stdin, never a root argv.
  const secretValue = 'owned-root-only-log-secret-' + randomUUID();
  const created = await nativeInput(vm.id, py(`import json,os,stat,sys\np=${JSON.stringify(path)};b=${JSON.stringify(parked)};s=${JSON.stringify(secret)}\ni=os.lstat(p);assert stat.S_ISREG(i.st_mode) and i.st_uid==0 and i.st_nlink==1 and stat.S_IMODE(i.st_mode)==0o600\nos.mkdir(${JSON.stringify(folder)},0o700);os.rename(p,b)\nf=os.open(s,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)\ntry:os.write(f,sys.stdin.buffer.read(128))\nfinally:os.close(f)\nprint(json.dumps({'dev':str(i.st_dev),'inode':str(i.st_ino),'size':i.st_size}))`), Buffer.from(secretValue), 30000);
  assert.equal(created.code, 0, created.stderr); const original = JSON.parse(created.stdout);
  let linkCreated = false, restored = false;
  /** 仅删除本项目身份创建且目标一致的链接，再核验停放 root 日志的 device/inode 后原子归位，防止恢复覆盖替代对象。
   * Delete only the project-owned link with the exact target, verify parked root-log device/inode and atomically restore without overwriting replacements. */
  const restore = async () => {
    if (linkCreated && !restored) {
      const removed = await projectIdentityTask(machines, vm.id, p,
        { command: py(`import os,stat\np=${JSON.stringify(path)};i=os.lstat(p)\nassert stat.S_ISLNK(i.st_mode) and i.st_uid==os.getuid() and os.readlink(p)==${JSON.stringify(secret)}\nos.unlink(p)`) }, new AbortController().signal);
      assert.equal(removed.code, 0, removed.stderr);
    }
    if (!restored) {
      await run(py(`import os,stat\np=${JSON.stringify(path)};b=${JSON.stringify(parked)};i=os.lstat(b)\nassert stat.S_ISREG(i.st_mode) and i.st_uid==0 and str(i.st_dev)==${JSON.stringify(original.dev)} and str(i.st_ino)==${JSON.stringify(original.inode)} and not os.path.lexists(p)\nos.rename(b,p)`));
      restored = true;
    }
  };
  try {
    const linked = await projectIdentityTask(machines, vm.id, p,
      { command: py(`import os\nos.symlink(${JSON.stringify(secret)},${JSON.stringify(path)})`) }, new AbortController().signal);
    assert.equal(linked.code, 0, linked.stderr); linkCreated = true;
    const unreadable = await projectIdentityTask(machines, vm.id, p,
      { command: 'test ! -r ' + quote(secret) }, new AbortController().signal);
    assert.equal(unreadable.code, 0);
    const link = JSON.parse(await run(py(`import json,os,stat\ni=os.lstat(${JSON.stringify(path)});print(json.dumps({'uid':i.st_uid,'symlink':stat.S_ISLNK(i.st_mode)}))`)));
    assert.equal(link.uid, identity.uid); assert.equal(link.symlink, true);
    const refused = await spaces.runtime(vm.id); assert.equal(refused.status, 'unconfirmed');
    assert.equal(JSON.stringify(refused).includes(secretValue), false);
    assert.match(name ? refused.services![0].log : refused.log, /日志读取未确认/);
    await restore();
    const suffix = 'owned-runtime-log-tail-' + invocation, appended = 'A'.repeat(limit + 256) + suffix;
    const written = await nativeInput(vm.id, py(`import os,stat,sys\nf=os.open(${JSON.stringify(path)},os.O_WRONLY|os.O_APPEND|os.O_NOFOLLOW)\ntry:\n i=os.fstat(f);assert stat.S_ISREG(i.st_mode) and i.st_uid==0 and i.st_nlink==1 and stat.S_IMODE(i.st_mode)==0o600 and str(i.st_dev)==${JSON.stringify(original.dev)} and str(i.st_ino)==${JSON.stringify(original.inode)}\n os.write(f,sys.stdin.buffer.read(20000))\nfinally:os.close(f)`), Buffer.from(appended), 30000);
    assert.equal(written.code, 0, written.stderr);
    const approved = await spaces.runtime(vm.id), text = name ? approved.services![0].log : approved.log;
    assert.equal(approved.status, 'stopped'); assert.equal(text, appended.slice(-limit));
    return { path, original, projectUid: link.uid, rootSecretReadableByProject: false,
      symlinkRefusedWithoutDisclosure: true, approvedBytes: Buffer.byteLength(text), limit };
  } finally {
    await restore();
    await run(py(`import os,stat\nf=os.open(${JSON.stringify(path)},os.O_WRONLY|os.O_NOFOLLOW)\ntry:\n i=os.fstat(f);assert str(i.st_dev)==${JSON.stringify(original.dev)} and str(i.st_ino)==${JSON.stringify(original.inode)} and i.st_uid==0\n os.ftruncate(f,${original.size})\nfinally:os.close(f)\ns=${JSON.stringify(secret)};i=os.lstat(s);assert stat.S_ISREG(i.st_mode) and i.st_uid==0 and stat.S_IMODE(i.st_mode)==0o600\nos.unlink(s);os.rmdir(${JSON.stringify(folder)})`));
  }
};
try {
  await machines.start(vm.id); const deadline = Date.now() + 270000;
  while (machines.state(vm.id) !== 'running') { if (Date.now() > deadline || ['stopped', 'error'].includes(machines.state(vm.id))) throw new Error(machines.logs.get(vm.id)); await delay(300); }
  if (distro === 'alpine') await run('/sbin/rc-service cgroups start');
  // A prior failed owned test may retain exact scope/account receipts. Retire
  // them through the real public stop path before changing any binding.
  await done('stop');
  await run('test -d ' + quote(base) + ' || mkdir -m 700 ' + quote(base)); await spaces.save(vm.id, project('initial'));
  await check('explicit-directory-permissions', async () => {
    const before = JSON.parse(await run(py(`import json,os,stat\ni=os.stat(${JSON.stringify(base)});print(json.dumps([i.st_uid,stat.S_IMODE(i.st_mode)]))`)));
    if (before[0] !== 0) { identity = await identities.identity(vm.id, project('initial')); assert.deepEqual(before, [identity.uid, 0o700]); return { before, uid: identity.uid, reusedReviewedDirectory: true }; }
    assert.deepEqual(before, [0, 0o700]); await assert.rejects(identities.identity(vm.id, project('initial')), { code: 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED' });
    const migrations = new ProjectDirectoryMigrations(machines, spaces), preview = await migrations.preview(vm.id); assert.ok(preview.plan);
    await migrations.apply(vm.id, { action: 'apply', version: 1, reviewed: true, planId: preview.plan.proposal.planId, sha256: preview.plan.sha256 });
    identity = await identities.identity(vm.id, project('initial')); assert.ok(identity.uid >= 20000);
    return { before, uid: identity.uid, home: identity.home, explicitPlan: preview.plan.proposal.planId };
  });
  const outsideFile = '/tmp/sakura-uid-outside-' + invocation + '.json', session = 'sakura-uid-outside-' + invocation;
  await run('tmux new-session -d -s ' + session + ' ' + quote(py(`import json,os,time\nf=open('/proc/self/stat').read().rsplit(') ',1)[1].split();open(${JSON.stringify(outsideFile)},'w').write(json.dumps({'pid':os.getpid(),'ticks':f[19]}))\nwhile True:time.sleep(1)`)));
  await waitFile(outsideFile); outside = JSON.parse(await run('cat ' + quote(outsideFile)));
  rootTmux = JSON.parse(await run(py(`import json,subprocess\npid=int(subprocess.check_output(['/usr/bin/tmux','display-message','-p','#{pid}']).decode());f=open('/proc/'+str(pid)+'/stat').read().rsplit(') ',1)[1].split();print(json.dumps({'pid':pid,'ticks':f[19]}))`)));
  machines.exec = (/** 保存每条 exec 控制命令再透明执行原 root 通道，后续断言可证明 pending 期间没有发出任何 guest 操作。
 * Record each exec control command before transparently calling original root transport so later assertions can prove no guest operations occurred while pending. */ async (id, command, ...rest) => { commands.push(command); return nativeExec(id, command, ...rest); }) as typeof machines.exec;
  machines.execInput = (/** 保存 stdin 控制命令而不把正文转为 argv，沿原 execInput 返回结果，供 root 命令泄漏与入场计数检查。
 * Record stdin-control commands without moving body into argv and preserve original execInput results for root-command leakage/admission counts. */ async (id, command, input, ...rest) => { commands.push(command); return nativeInput(id, command, input, ...rest); }) as typeof machines.execInput;
  await check('main-uid-setup-transport-and-idempotence', /** 验证 main/setup 均为项目 UID/Home 且保护帧 root 0600/目录0700，root argv 无 canary；重复 start 复用 runId、重复 stop 幂等并清所有原子进程。
 * Verify main/setup use project UID/Home with root-0600 protected frames/0700 directory and canary-free root argv; repeat start reuses runId and repeat stop is idempotent with complete original-process closure. */ async () => {
    await done('start'); const values = await children('initial'), scope = new ProjectMainScope(machines, vm.id, project('initial')), record = (await scope.status()).record!;
    for (const child of values) { assert.equal(child.uid, identity.uid); assert.equal(child.euid, identity.uid); assert.equal(child.gid, identity.gid); assert.equal(child.home, identity.home); assert.equal(child.secret, true); assert.equal(child.cgroup, '0::/' + record.scopeName); }
    const setup = JSON.parse(await run('cat ' + quote(base + '/setup.json'))); assert.equal(setup.uid, identity.uid); assert.equal(setup.home, identity.home);
    const frame = projectMainScopePaths(project('initial')).guest + '/input-' + record.runId + '.bin';
    const metadata = JSON.parse(await run(py(`import json,os,stat\np=${JSON.stringify(frame)};i=os.stat(p);f=open(p,'rb');h=json.loads(f.readline());print(json.dumps({'uid':i.st_uid,'mode':stat.S_IMODE(i.st_mode),'parentMode':stat.S_IMODE(os.stat(os.path.dirname(p)).st_mode),'header':h}))`)));
    assert.equal(metadata.uid, 0); assert.equal(metadata.mode, 0o600); assert.equal(metadata.parentMode, 0o700);
    const argv = await run(py(`import os\nfor p in os.listdir('/proc'):\n if p.isdigit():\n  try:\n   if os.stat('/proc/'+p).st_uid==0: print(open('/proc/'+p+'/cmdline','rb').read().decode(errors='replace'))\n  except OSError:pass`)); assert.equal(argv.includes(canary), false);
    assert.equal((await spaces.runtime(vm.id)).status, 'running'); await done('start'); assert.equal((await scope.metadata())!.runId, record.runId);
    await done('stop'); await allStopped(values); await done('stop');
    const runtimeLog = await rootLogGuard(project('initial'));
    await preserve(); return { values, record, setup, transport: metadata, runtimeLog, rootArgvContainsSecret: false };
  });
  for (const mode of ['prepare', 'pane', 'commit', 'first-stop']) await check('main-' + mode + '-lost-connection-recovery', /** 按阶段模拟 main 确认丢失或首次真实 stop 连接失败，finally 恢复两种传输包装；最终主机/身份票据必须 stopped，不得留下未确认 run。
 * Model main ACK loss by stage or the first real stop-connection failure, restoring both transport wrappers in finally; require terminal stopped host/identity receipts with no unconfirmed run. */ async () => {
    const p = project(mode); await spaces.save(vm.id, p); let injected = 0; const original = machines.exec;
    /** 识别固定主/服务控制操作的首次成功回复并主动抛丢失错误；必要时先捕获已启动后代，验证恢复能撤销完整原域。
     * Identify the first successful main/service control reply and inject loss, capturing started descendants where needed to verify recovery revokes the entire original domain. */
    const inject = (command: string, result: { code: number }) => { const input = request(command); if (input?.op === (mode === 'pane' ? 'start' : mode) && result.code === 0 && ++injected === 1) throw new Error('owned ' + mode + ' reply lost'); };
    machines.exec = (/** 首次 stop 临时切到未监听 SSH 端口并实际验证连接失败，finally 恢复原 live 端口；其他调用真实完成后再按阶段丢 ACK。
 * For first stop temporarily use an unlistened SSH port and prove actual connection failure, restoring the original live port in finally; other calls execute for real before stage-specific ACK loss. */ async (id, command, ...rest) => {
      if (mode === 'first-stop' && request(command)?.op === 'stop' && ++injected === 1) {
        const live = machines.live.get(vm.id)!, saved = live.sshPort; live.sshPort = await freePort();
        try { await assert.rejects(nativeExec(id, command, 350), /refused|ECONNREFUSED|timed out/); } finally { live.sshPort = saved; }
        throw new Error('owned first cleanup connection failed');
      }
      const result = await original(id, command, ...rest); inject(command, result); return result;
    }) as typeof machines.exec;
    const originalInput = machines.execInput;
    machines.execInput = (/** 真实 stdin 操作完成后执行阶段故障钩子，保持正文原样，确认丢失不能被理解成没有入场副作用。
 * Invoke stage fault injection after real stdin execution, preserving the body so ACK loss cannot be interpreted as absence of admission side effects. */ async (id, command, input, ...rest) => { const result = await originalInput(id, command, input, ...rest); inject(command, result); return result; }) as typeof machines.execInput;
    try { const started = await job('start'); if (mode === 'first-stop') { assert.equal(started.status, 'done'); const values = await children(mode); await done('stop'); await allStopped(values); assert.equal(injected, 2); } else { assert.equal(started.status, 'error'); assert.equal(started.errorCode, 'PROJECT_MAIN_SCOPE_CHANGED'); } }
    finally { machines.exec = original; machines.execInput = originalInput; }
    const record = await new ProjectMainScope(machines, vm.id, p).metadata(); assert.equal(record!.phase, 'stopped'); assert.equal(await identities.readonlyActive(vm.id, 'default', record!.runId), false); await preserve(); return { record, injected };
  });
  await check('main-pane-exit-retains-and-cleans-uid-descendants', async () => {
    const p = project('exited', true); await spaces.save(vm.id, p); await done('start');
    const values = await children('exited'); await run('touch ' + quote(caseDirectory('exited') + '/release-main'));
    let view = await spaces.runtime(vm.id); const deadline = Date.now() + 10000;
    while (view.status !== 'exited' && Date.now() < deadline) { await delay(100); view = await spaces.runtime(vm.id); }
    assert.equal(view.status, 'exited'); for (const child of values.slice(1)) assert.equal(await alive(child), true);
    await assert.rejects(spaces.save(vm.id, { ...p, command: 'sleep 601' }), { code: 'PROJECT_MAIN_SCOPE_CHANGED' });
    const record = await new ProjectMainScope(machines, vm.id, p).metadata(); await done('stop'); await allStopped(values); await preserve(); return { values, record, bindingEditRejected: true };
  });
  await check('service-main-isolation-and-uid-readiness', /** 服务和就绪检查都须项目 UID，另建立并行 main；关名为 main 的服务只杀其域且保留并行 main，随后全 stop 清理，两种作用域不能按名称混同。
 * Require project UID for service/readiness and create a parallel main; stopping the service named main kills only its domain, preserving parallel main until full stop so scopes cannot be conflated by name. */ async () => {
    const p = { ...project('service-case'), services: [{ name: 'main', command: app('service-main'), dependsOn: [], ready: py(`import json,os\nopen('ready.json','w').write(json.dumps({'uid':os.getuid(),'home':os.environ.get('HOME')}))`), timeout: 5 }] };
    await spaces.save(vm.id, p); await done('start'); const scopes = new ProjectServiceScopes(machines, vm.id, p), service = (await scopes.status('main')).record!;
    const values = await children('service-main'); for (const child of values) { assert.equal(child.uid, identity.uid); assert.equal(child.cgroup, '0::/' + service.scopeName); }
    const ready = JSON.parse(await run('cat ' + quote(base + '/ready.json'))); assert.equal(ready.uid, identity.uid); assert.equal(ready.home, identity.home);
    const main = new ProjectMainScope(machines, vm.id, p), intent = main.intent(service.bootId); await main.persistIntent(intent);
    const payload = await identities.inherited(vm.id, p, { command: app('parallel-main'), environment: p.environment }, { kind: 'main', runId: intent.runId, bootId: intent.bootId });
    await main.start(intent, payload, new AbortController().signal); const mainValues = await children('parallel-main'); assert.equal(await identities.active(vm.id, 'default', intent.runId), true);
    assert.notEqual(service.session, intent.session); assert.notEqual(service.scopeName, intent.scopeName);
    await done('stop', 'main'); await allStopped(values); for (const child of mainValues) assert.equal(await alive(child), true);
    await done('stop'); await allStopped(mainValues);
    const runtimeLog = await rootLogGuard(p, 'main');
    await preserve(); return { service, main: await main.metadata(), values, mainValues, ready, runtimeLog };
  });
  for (const mode of ['prepare', 'pane', 'commit', 'first-stop']) await check('service-' + mode + '-lost-connection-recovery', /** 按 prepare/pane/commit 阶段或首次 stop 注入服务失败，要求精确回滚且无残余 UID 子进程；prepare/pane 失败不得执行正文，finally 恢复传输函数。
 * Inject service failure at prepare/pane/commit or first stop, requiring exact rollback/no UID descendants; prepare/pane failure must not execute the body, and finally restores transport functions. */ async () => {
    const label = 'service-' + mode, p = { ...project(label), services: [{ name: 'api', command: app(label), dependsOn: [], ready: '', timeout: 5 }] };
    await spaces.save(vm.id, p); let injected = 0; const original = machines.exec, originalInput = machines.execInput;
    const values: any[] = [];
    /** 识别固定主/服务控制操作的首次成功回复并主动抛丢失错误；必要时先捕获已启动后代，验证恢复能撤销完整原域。
     * Identify the first successful main/service control reply and inject loss, capturing started descendants where needed to verify recovery revokes the entire original domain. */
    const inject = async (command: string, result: { code: number }) => {
      const input = request(command);
      if (input?.record?.version !== 1 || input.op !== (mode === 'pane' ? 'start' : mode) || result.code !== 0 || ++injected !== 1) return;
      if (mode === 'commit') values.push(...await children(label));
      throw new Error('owned service ' + mode + ' reply lost');
    };
    machines.exec = (/** 仅对版本1服务票据的首次 stop 制造真实拒绝连接，恢复端口后其他请求正常转发并异步运行阶段注入，避免故障污染 main。
 * Create a real refused connection only for first stop of a version-one service receipt, restoring the port and forwarding other requests before asynchronous stage injection so faults do not contaminate main. */ async (id, command, ...rest) => {
      if (mode === 'first-stop' && request(command)?.record?.version === 1 && request(command)?.op === 'stop' && ++injected === 1) {
        const live = machines.live.get(vm.id)!, saved = live.sshPort; live.sshPort = await freePort();
        try { await assert.rejects(nativeExec(id, command, 350), /refused|ECONNREFUSED|timed out/); } finally { live.sshPort = saved; }
        throw new Error('owned first service cleanup connection failed');
      }
      const result = await original(id, command, ...rest); await inject(command, result); return result;
    }) as typeof machines.exec;
    machines.execInput = (/** 真实 execInput 完成后等待服务阶段故障钩子，再返回原结果；完整等待保证故障观察与事务副作用有明确顺序。
 * Await the service-stage fault hook after real execInput before returning original results, ordering fault observation after transaction side effects. */ async (id, command, input, ...rest) => { const result = await originalInput(id, command, input, ...rest); await inject(command, result); return result; }) as typeof machines.execInput;
    try {
      const started = await job('start');
      if (mode === 'first-stop') { assert.equal(started.status, 'done', started.error); values.push(...await children(label)); await done('stop'); assert.equal(injected, 2); }
      else { assert.equal(started.status, 'error'); assert.notEqual(started.errorCode, 'SERVICE_CLEANUP_FAILED', started.error); }
    } finally { machines.exec = original; machines.execInput = originalInput; }
    const record = await new ProjectServiceScopes(machines, vm.id, p).metadata('api');
    assert.equal(record!.phase, 'stopped'); assert.equal(await identities.readonlyActive(vm.id, 'default', record!.runId), false);
    if (mode === 'prepare' || mode === 'pane') assert.equal((await nativeExec(vm.id, 'test -f ' + quote(caseDirectory(label) + '/main.json'))).code, 1);
    await allStopped(values); await done('stop'); await preserve(); return { record, injected, values };
  });
  await check('private-readiness-failure-preserves-existing-dependency', async () => {
    const p = { ...project('dependency'), services: [{ name: 'db', command: app('db'), dependsOn: [], ready: '', timeout: 5 }, { name: 'api', command: app('api'), dependsOn: ['db'], ready: 'false', timeout: 5 }] };
    await spaces.save(vm.id, p); await done('start', 'db'); const scopes = new ProjectServiceScopes(machines, vm.id, p), old = (await scopes.metadata('db'))!, db = await children('db');
    assert.equal((await job('start', 'api')).status, 'error'); assert.deepEqual(await scopes.metadata('db'), old); for (const child of db) assert.equal(await alive(child), true);
    await allStopped(await children('api')); await done('stop'); await allStopped(db); await preserve(); return { dependencyRun: old.runId };
  });
  await check('protected-frame-replacement-refuses-cleanup', async () => {
    const p = project('frame-replacement'); await spaces.save(vm.id, p); await done('start'); const values = await children('frame-replacement');
    const scope = new ProjectMainScope(machines, vm.id, p), record = (await scope.status()).record!, frame = projectMainScopePaths(p).guest + '/input-' + record.runId + '.bin', parked = frame + '.owned-' + invocation;
    await run(py(`import os,shutil\np=${JSON.stringify(frame)};b=${JSON.stringify(parked)};os.rename(p,b);shutil.copyfile(b,p);os.chmod(p,0o600)`));
    const result = await job('stop'); assert.equal(result.status, 'error'); assert.equal(result.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED'); await allStopped(values); assert.equal((await scope.metadata())!.phase, 'running');
    await run(py(`import os\np=${JSON.stringify(frame)};b=${JSON.stringify(parked)};os.unlink(p);os.rename(b,p)`));
    await done('stop'); await preserve(); return { retainedRunId: record.runId, replacementRefused: true };
  });
  await check('input-budget-refuses-before-code', async () => {
    await assert.rejects(projectIdentityTask(machines, vm.id, project('budget'), { command: 'true', environment: Object.fromEntries(Array.from({ length: 32 }, (_, i) => ['LONG_' + i, 'x'.repeat(4096)])) }, new AbortController().signal));
    await identities.guard(vm.id, 'default'); return { limit: 65536, noRunCreated: true };
  });
  await check('network-release-lost-reply-and-same-boot-new-generation', /** 网络已真实释放却丢 ACK 时 host 保留 pending 并禁止任何 guest 新入场；同 intent 重试后建新 generation，迟到旧释放不得杀新子进程或改新网络。
 * After real network release with lost ACK retain host pending and block all guest admission; retry the same intent before creating a new generation, and prove late old release neither kills fresh children nor changes their network. */ async () => {
    const p = project('network-old'); await spaces.save(vm.id, p); await done('start');
    const oldValues = await children('network-old'), core = new ProjectIdentities(machines), oldNetwork = await core.network(vm.id, identity);
    assert.ok(oldNetwork); let lost = 0; const original = machines.exec;
    machines.exec = (/** 先执行正式控制命令，仅对首次成功 release-network 丢回应；保留原释放副作用而制造 host 不确定状态，其他请求透明返回。
 * Execute formal control first and lose only the first successful release-network reply, retaining native side effects to create host uncertainty while returning other requests unchanged. */ async (id, command, ...rest) => {
      const result = await original(id, command, ...rest), encoded = command.match(/\/controller\.py'\s+'([A-Za-z0-9+/=]+)'$/)?.[1];
      const input = encoded ? JSON.parse(Buffer.from(encoded, 'base64').toString()) : null;
      if (input?.action === 'release-network' && result.code === 0 && ++lost === 1) throw new Error('owned network release reply lost after guest commit');
      return result;
    }) as typeof machines.exec;
    try {
      const stopped = await job('stop'); assert.equal(stopped.status, 'error'); assert.equal(stopped.errorCode, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
    } finally { machines.exec = original; }
    assert.equal(lost, 1); await allStopped(oldValues);
    const journalFile = join(vmDir(vm.id), 'project-identities/default.json'), pending = JSON.parse(await readFile(journalFile, 'utf8')).networkRelease;
    assert.equal(pending.phase, 'pending'); assert.deepEqual(pending.intent.lease.network, oldNetwork);
    const before = commands.length, rejected = await job('start'); assert.equal(rejected.errorCode, 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING');
    assert.equal(commands.length, before, 'No guest control or package installation may run during pending network retirement.');
    await done('stop'); assert.equal(JSON.parse(await readFile(journalFile, 'utf8')).networkRelease.phase, 'released');
    const next = { ...p, command: app('network-new') }; await spaces.save(vm.id, next); await done('start');
    const newValues = await children('network-new'), newNetwork = await core.network(vm.id, identity); assert.ok(newNetwork);
    assert.equal(newNetwork.bootId, oldNetwork.bootId); assert.notEqual(newNetwork.generation, oldNetwork.generation);
    await identities.releaseNetwork(vm.id, 'default', pending.intent);
    for (const child of newValues) assert.equal(await alive(child), true);
    assert.deepEqual(await core.network(vm.id, identity), newNetwork);
    await done('stop'); await allStopped(newValues); await preserve();
    return { oldNetwork, newNetwork, lostReplies: lost, originalReleaseId: pending.intent.releaseId, pendingAdmissionRejected: true, lateOldReleasePreservedNewGeneration: true };
  });
  await check('checkout-setup-and-main-use-project-account', /** 以项目 UID 创建自有本地仓库，私有网络 checkout 先拒绝且不运行 setup；host 模式经受保护环境做 URL 替换后验证 checkout/setup/main 的 UID、Home 和所有权，无仓库地址进入 root argv。
 * Create an owned local repository as project UID; private-network checkout rejects before setup, while host mode uses protected-environment URL rewriting and verifies checkout/setup/main UID, Home and ownership with repository URLs absent from root argv. */ async () => {
    const source = base + '/git-source-' + invocation, target = base + '/git-checkout-' + invocation;
    const setup = `mkdir -m 700 ${quote(source)} ${quote(target)}\n` +
      `git -C ${quote(source)} init -q\nprintf '%s\\n' 'owned local repository' > ${quote(source + '/tracked.txt')}\n` +
      `git -C ${quote(source)} add tracked.txt\ngit -C ${quote(source)} -c user.name=Sakura -c user.email=fixture@local.invalid commit -q -m owned-fixture\n` +
      py(`import json,os\nopen(${JSON.stringify(source + '/account.json')},'w').write(json.dumps({'uid':os.getuid(),'home':os.environ.get('HOME')}))`);
    const prepare = { ...project('checkout-prepare'), setup }; await spaces.save(vm.id, prepare); await done('start');
    await children('checkout-prepare'); const original = JSON.parse(await run('cat ' + quote(source + '/account.json')));
    assert.equal(original.uid, identity.uid); assert.equal(original.home, identity.home); await done('stop');
    // Keep the product's HTTPS-only schema. This fixture's protected project
    // Git environment rewrites only its unique URL to the owned local source.
    const repository = 'https://owned-fixture.invalid/' + invocation + '/repository';
    const privateProject = { ...project('checkout-private'), directory: target, repository,
      environment: { TOKEN: canary, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'url.file://' + source + '.insteadOf', GIT_CONFIG_VALUE_0: repository },
      setup: py(`import json,os\nopen('checkout-setup.json','w').write(json.dumps({'uid':os.getuid(),'home':os.environ.get('HOME'),'cwd':os.getcwd()}))`) };
    await spaces.save(vm.id, privateProject); const blocked = await job('start');
    assert.equal(blocked.status, 'error'); assert.equal(blocked.errorCode, 'PROJECT_PRIVATE_REPOSITORY_REQUIRED');
    assert.equal((await nativeExec(vm.id, 'test -e ' + quote(target + '/checkout-setup.json'))).code, 1);
    const hostProject = { ...privateProject, networkIsolation: 'host' as const, command: app('checkout-host') };
    await spaces.save(vm.id, hostProject); await done('start'); identity = await identities.identity(vm.id, hostProject);
    const values = await children('checkout-host'), prepared = JSON.parse(await run('cat ' + quote(target + '/checkout-setup.json')));
    assert.equal(prepared.uid, identity.uid); assert.equal(prepared.home, identity.home); assert.equal(prepared.cwd, target);
    assert.equal(await run('cat ' + quote(target + '/tracked.txt')), 'owned local repository');
    const owner = JSON.parse(await run(py(`import json,os\nprint(json.dumps({'uid':os.stat(${JSON.stringify(target + '/.git')}).st_uid}))`)));
    assert.equal(owner.uid, identity.uid);
    for (const child of values) { assert.equal(child.uid, identity.uid); assert.equal(child.home, identity.home); assert.equal(child.cwd, target); }
    assert.equal(commands.some(command => command.includes(repository)), false);
    await done('stop'); await allStopped(values); await preserve();
    return { source, target, original, prepared, repositoryOwner: owner, privateRepositoryGuard: blocked.errorCode, rootArgvRepositoryAbsent: true, values };
  });
  await check('cold-reboot-retires-exact-main-and-service-tickets', /** 真实 VM 重启使旧 main/service 票据退役，重复 stop 必须只读确认旧 boot 资源消失；新 start 使用当前 boot 和新 runId，再精确关闭。
 * Real VM reboot retires old main/service receipts; repeated stop must confirm old-boot absence without retargeting, then fresh start uses current boot/new runId before exact closure. */ async () => {
    const p = { ...project('reboot-service'), services: [{ name: 'reboot', command: app('reboot-service'), dependsOn: [], ready: '', timeout: 5 }] };
    await spaces.save(vm.id, p); await done('start');
    const services = new ProjectServiceScopes(machines, vm.id, p), service = (await services.status('reboot')).record!;
    assert.equal(await identities.active(vm.id, 'default', service.runId), true);
    const main = new ProjectMainScope(machines, vm.id, p), intent = main.intent(service.bootId); await main.persistIntent(intent);
    await main.start(intent, await identities.inherited(vm.id, p, { command: app('reboot-main'), environment: p.environment }, { kind: 'main', runId: intent.runId, bootId: intent.bootId }), new AbortController().signal);
    await children('reboot-main'); const old = (await main.status()).record!;
    assert.equal(await identities.active(vm.id, 'default', old.runId), true);
    await machines.stop(vm.id, true); assert.equal(machines.state(vm.id), 'stopped'); await machines.start(vm.id);
    const deadline = Date.now() + 270000;
    while (machines.state(vm.id) !== 'running') { if (Date.now() > deadline || ['stopped', 'error'].includes(machines.state(vm.id))) throw new Error(machines.logs.get(vm.id)); await delay(300); }
    if (distro === 'alpine') await run('/sbin/rc-service cgroups start');
    const bootId = await run('cat /proc/sys/kernel/random/boot_id'); assert.notEqual(bootId, old.bootId);
    await done('stop'); await done('stop');
    assert.equal((await new ProjectServiceScopes(machines, vm.id, p).metadata('reboot'))!.phase, 'stopped');
    assert.equal((await new ProjectMainScope(machines, vm.id, p).metadata())!.phase, 'stopped');
    assert.equal(await identities.readonlyActive(vm.id, 'default', old.runId), false);
    assert.equal(await identities.readonlyActive(vm.id, 'default', service.runId), false);
    await done('start'); const latest = (await new ProjectServiceScopes(machines, vm.id, p).status('reboot')).record!;
    assert.notEqual(latest.runId, service.runId); assert.equal(latest.bootId, bootId); await done('stop');
    // These explicitly owned unrelated processes belonged to the old boot.
    outside = null; rootTmux = null;
    return { oldMain: old.runId, oldService: service.runId, oldBoot: old.bootId, bootId, newService: latest.runId, repeatedStop: true };
  });
  assert.equal(commands.some(command => command.includes(canary) || command.includes(Buffer.from(canary).toString('base64'))), false);
  for (const path of sources) assert.equal(createHash('sha256').update(await readFile(resolve(path))).digest('hex'), proof.sourceSha256[path], path + ' changed during this proof.');
  assert.equal(createHash('sha256').update(await readFile(resolve('scripts/smoke-project-uid-scopes.ts'))).digest('hex'), proof.scriptSha256);
  proof.finalSourceSha256 = {}; for (const path of sources) proof.finalSourceSha256[path] = createHash('sha256').update(await readFile(resolve(path))).digest('hex');
  if (outside) { await preserve(); await run(py(`import os,signal\np=${outside.pid};fd=os.pidfd_open(p);assert open('/proc/'+str(p)+'/stat').read().rsplit(') ',1)[1].split()[19]==${JSON.stringify(outside.ticks)};signal.pidfd_send_signal(fd,signal.SIGKILL);os.close(fd)`)); await delay(200); }
  proof.rootArgvBodyAbsent = true;
} catch (error) { proof.error = String(error); proof.failureRuntime = await spaces.runtime(vm.id).catch(failure => String(failure)); throw error; }
finally {
  machines.exec = nativeExec; machines.execInput = nativeInput; await spaces.close(); await machines.close();
  proof.vmStopped = machines.state(vm.id) === 'stopped'; proof.liveEntries = machines.live.size; proof.stoppedAt = new Date().toISOString();
  proof.ownedQemuSettled = qemuExecutions.every(value => value.settled);
  if (!proof.vmStopped || proof.liveEntries || !proof.ownedQemuSettled) proof.error ||= 'Owned VM cleanup did not settle completely.';
  const file = join(root, `project-uid-scopes-evidence-${invocation}.json`); await writeFile(file, JSON.stringify(proof, null, 2) + '\n'); console.log('UID scope proof:', file);
  if (!proof.error) await writeFile(join(root, 'project-uid-scopes-latest.json'), JSON.stringify({ file, vmId: vm.id, distro, vmStopped: proof.vmStopped, cases: proof.cases.length }, null, 2) + '\n');
}
