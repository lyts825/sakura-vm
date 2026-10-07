/** 烟雾验收：验证主进程项目 UID 作用域、旧启动代次停止与替代对象保护。
 * Smoke acceptance for main-process project UID scope, old-generation stopping and replacement-object protection. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.argv.length, 4, 'Pass alpine|debian|ubuntu and a stopped owned guest-task fixture.');
const distro = process.argv[2];
assert.ok(['alpine', 'debian', 'ubuntu'].includes(distro));
const parent = await realpath(resolve('.data/network-remaining-test-temp'));
const root = await realpath(resolve(process.argv[3]));
assert.equal(dirname(root), parent); assert.match(basename(root), /^sakura-guest-task-[A-Za-z0-9_-]+$/);
const prior = JSON.parse(await readFile(join(root, 'guest-task-cgroup-evidence.json'), 'utf8'));
const serviceProof = JSON.parse(await readFile(join(root, 'project-services-scope-evidence.json'), 'utf8'));
assert.equal(prior.distro, distro); assert.equal(prior.vmStopped, true); assert.equal(prior.error, undefined);
assert.equal(serviceProof.vmId, prior.vmId); assert.equal(serviceProof.vmStopped, true); assert.equal(serviceProof.error, undefined);
assert.equal(serviceProof.cases.length, 20);
process.env.TEMP = process.env.TMP = parent;
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/' + {
  alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2',
}[distro]);
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces, projectSchema, projectLog } = await import('../server/workspaces.ts');
const { ProjectMainScope, ProjectServiceScopes, projectMainScopePaths } = await import('../server/project-service-scope.ts');
const { mainSession } = await import('../server/project-main.ts');
const { serviceSchema, serviceSession } = await import('../server/project-services.ts');
const { projectNetworkNamespace } = await import('../server/project-network-isolation.ts');
const { ProjectRunScopes } = await import('../server/project-run-scope.ts');
const { quote } = await import('../server/files.ts');
const { freePort } = await import('../server/qmp.ts');
const machines = new Machines(await createRuntime());
await machines.init();
assert.equal(machines.records.size, 1);
const vm = [...machines.records.values()][0];
assert.equal(vm.id, prior.vmId); assert.equal(vm.name, 'guest-task-cgroup-smoke'); assert.equal(vm.distro, distro);
assert.equal(machines.state(vm.id), 'stopped');
const token = 'owned-main-fixture-secret';
const spaces = new Workspaces(machines, { secrets: { /** 保存延迟 Promise 的完成信号，供已观测到的主进程生命周期事件解除等待。
 * Hold the deferred promise completion signal used to release waits after observed main-process lifecycle events. */ resolve: async () => ({ TOKEN: token }) } as any });
const nativeExec = machines.exec.bind(machines), nativeInput = machines.execInput.bind(machines);
const sources = ['server/project-service-scope.ts', 'server/project-main.ts', 'server/project-services.ts', 'server/workspaces.ts'];
const proof: any = { version: 1, vmId: vm.id, distro, fixture: root, client: { node: process.version, execArgv: process.execArgv },
  sourceSha256: {}, cases: [] };
for (const source of sources) proof.sourceSha256[source] = createHash('sha256').update(await readFile(resolve(source))).digest('hex');
/** 在本验收夹具的指定实例中执行传入脚本，使用函数中的超时约束并断言退出码为零，返回捕获的标准输出；失败附来宾诊断而不被当作空输出。
 * Execute the supplied script in the specified fixture VM under this function’s timeout, assert exit code zero and return captured stdout; failures include guest diagnostics rather than become empty output. */
const run = async (command: string, timeout = 30000) => {
  const result = await nativeExec(vm.id, command, timeout);
  assert.equal(result.code, 0, result.stderr + result.stdout); return result.stdout.trim();
};
/** 生成隔离 Python 命令，将整段源码作为单个字面参数；-I/-S 避免用户环境和 site 初始化改变观测，执行权限由外层来宾入口控制。
 * Build an isolated Python command with the source as one literal argument; -I/-S exclude user environment/site initialization, while the outer guest entry controls execution authority. */
const py = (source: string) => '/usr/bin/python3 -I -S -c ' + quote(source);
/** 从固定请求标记行解码原生控制 JSON，未包含标记返回 null；用于精确故障阶段识别，正文不重新执行。
 * Decode native-control JSON from its fixed request-marker line, returning null if absent; identify exact fault phases without reexecuting bodies. */
const request = (command: string) => {
  const line = command.split('\n').find(value => value.startsWith('# SAKURA_PROJECT_MAIN_REQUEST='));
  return line ? JSON.parse(Buffer.from(line.split('=')[1], 'base64').toString()) : null;
};
/** 暂时把原 live SSH 端口指向未监听端口，断言连接拒绝/超时，finally 恢复原端口以验证回复丢失后的恢复。
 * Temporarily point the original live SSH port at an unlistened port, assert refusal/timeout and restore it in finally to exercise recovery after lost replies. */
const failConnection = async (command: string) => {
  const live = machines.live.get(vm.id)!, saved = live.sshPort; live.sshPort = await freePort();
  try { await assert.rejects(nativeExec(vm.id, command, 350), /ECONNREFUSED|refused|timed out/); }
  finally { live.sshPort = saved; }
};
/** 读取指定自有 PID 的出生 ticks、cgroup 和网络域为 JSON，供前后精确身份比较。
 * Read the owned PID’s birth ticks/cgroup/network as JSON for exact before/after identity comparison. */
const proc = async (pid: number) => JSON.parse(await run(py(`import json,os\nf=open('/proc/${pid}/stat').read().rsplit(') ',1)[1].split()\nprint(json.dumps({'pid':${pid},'ticks':f[19],'cgroup':open('/proc/${pid}/cgroup').read().strip(),'network':os.readlink('/proc/${pid}/ns/net')}))`)));
/** 核对原 PID 的出生 ticks 且状态不为僵尸/死亡，消失返回 false；HTTP 包装返回来宾文本，由场景比较。
 * Check original PID birth ticks/nonzombie-nondead state and return false on disappearance; the HTTP wrapper returns guest text for scenario comparison. */
const alive = async (value: { pid: number; ticks: string }) => (await run(py(`try:\n f=open('/proc/${value.pid}/stat').read().rsplit(') ',1)[1].split()\n print(f[0] not in ['Z','X'] and f[19]==${JSON.stringify(value.ticks)})\nexcept FileNotFoundError: print(False)`))) === 'True';
/** 先打开 pidfd 再验证 /proc 出生 ticks，一致才发送 SIGKILL；通过稳定句柄避免 PID 重用误杀。
 * Open pidfd/verify /proc birth ticks before SIGKILL, using a stable handle to avoid PID-reuse mistakes. */
const killOwned = async (value: { pid: number; ticks: string }) => run(py(`import os,signal\npid=${value.pid};fd=os.pidfd_open(pid)\nassert open('/proc/'+str(pid)+'/stat').read().rsplit(') ',1)[1].split()[19]==${JSON.stringify(value.ticks)}\nsignal.pidfd_send_signal(fd,signal.SIGKILL);os.close(fd)`));
/** 有限次轮询自有应用的结果文件，出现后返回；期限内未发布则失败，避免使用上一阶段缺失结果。
 * Poll the owned application result file for a bounded number of attempts, returning when published and failing on absence rather than using missing prior-stage evidence. */
const waitFile = async (file: string) => {
  for (let attempt = 0; attempt < 120; ++attempt) {
    if ((await nativeExec(vm.id, 'test -f ' + quote(file), 5000)).code === 0) return;
    await delay(50);
  }
  throw new Error('Owned application did not publish ' + file);
};
const base = '/workspace/main-scope-smoke';
/** 保留正式项目身份，仅对本夹具根下无链接的 root/项目所有目录授权为 0700，最后正式核验身份。
 * Reserve production project identity, authorize only physical root-or-project-owned directories below this fixture root as 0700 and verify identity through production. */
const authorizeFixtureDirectory = async (project: ReturnType<typeof projectSchema.parse>, paths: string[]) => {
  const scopes = new ProjectRunScopes(machines), identity = await scopes.reserve(vm.id, project);
  // This test explicitly authorizes only its newly created owned directories.
  // Production start never grants or recursively changes existing permissions.
  for (const path of paths) {
    assert.ok(path.startsWith(base + '/'));
    await run(py(`import os,stat\np=${JSON.stringify(path)};assert os.path.realpath(p)==p\ni=os.lstat(p);assert stat.S_ISDIR(i.st_mode) and i.st_uid in [0,${identity.uid}]\nos.chown(p,${identity.uid},${identity.gid},follow_symlinks=False);os.chmod(p,0o700)`));
  }
  await scopes.identity(vm.id, project);
};
/** 等待自有主进程及脱离组/会话子进程各自发布记录，返回精确出生身份数组供完整域清理核查。
 * Await reports from the owned main/process-group/session-detached children and return exact birth-identity records for whole-domain cleanup verification. */
const children = async (directory: string) => {
  const values: any[] = [];
  for (const name of ['main', 'newgroup', 'setsid', 'doublefork']) {
    await waitFile(directory + '/' + name + '.json');
    values.push(JSON.parse(await run('cat ' + quote(directory + '/' + name + '.json'))));
  }
  return values;
};
/** 生成忽略 SIGTERM 且含新组/setsid/双 fork 后代的应用，报告 PID+ticks/域/环境，验证强制整域收敛。
 * Generate an app ignoring SIGTERM with new-group/setsid/double-fork children reporting PID+ticks/domain/environment for forced whole-domain convergence. */
const app = (directory: string, exitMain = false) => py(`import json,os,signal,time
signal.signal(signal.SIGTERM,signal.SIG_IGN)
def report(name):
 f=open('/proc/self/stat').read().rsplit(') ',1)[1].split()
 record={'name':name,'pid':os.getpid(),'ticks':f[19],'group':os.getpgrp(),'session':os.getsid(0),'cgroup':open('/proc/self/cgroup').read().strip(),'network':os.readlink('/proc/self/ns/net'),'privateEnvironment':os.environ.get('TOKEN')==${JSON.stringify(token)}}
 with open(${JSON.stringify(directory)}+'/'+name+'.json','w') as stream:json.dump(record,stream)
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
${exitMain ? 'os._exit(0)' : 'stay()'}`);
/** 分配唯一自有目录并保存私有网络项目，绑定秘密和重复 setup 标记，再按正式身份授权后返回配置。
 * Allocate an owned unique directory/save a private-network project with secret/repeated-setup marker, authorize production identity and return settings. */
const projectFor = async (label: string, exitMain = false) => {
  const directory = base + '/' + label + '-' + randomUUID(); await run('mkdir -p ' + quote(directory));
  const project = projectSchema.parse({ directory, command: app(directory, exitMain), networkIsolation: 'private',
    environment: { TOKEN: token, SAKURA_MAIN_LABEL: label }, secrets: { TOKEN: 'owned-main-token' },
    setup: 'echo initialized >> ' + quote(directory + '/setup-runs') });
  await spaces.save(vm.id, project); await authorizeFixtureDirectory(project, [directory]); return { project, directory };
};
/** 执行项目主进程/服务操作并等待正式任务结束，检查私密标记不在日志/错误中后返回任务记录。
 * Execute a project main/service operation and await production job completion, returning its record only after checking logs/errors exclude private markers. */
const job = async (action: 'start' | 'stop', service?: string) => {
  const value = await spaces.run(vm.id, action, service); await spaces.jobs.wait(spaces.projects.key(vm.id));
  assert.equal((value.error || '').includes(token), false); assert.equal(value.log.includes(token), false); return value;
};
/** 等待项目操作并要求终态 done，错误附任务诊断；返回正式记录供后续身份核验。
 * Await project work/require final done, reporting job diagnostics on failure and returning the production record for identity checks. */
const requireDone = async (action: 'start' | 'stop', service?: string) => {
  const value = await job(action, service); assert.equal(value.status, 'done', value.error + '\n' + value.log); return value;
};
/** 逐个验证捕获的原子进程身份已经死亡，任何自有后代存活都会使整域清理验收失败。
 * Verify each captured original process identity is dead; any surviving owned descendant fails whole-domain cleanup acceptance. */
const allStopped = async (values: any[]) => {
  for (const child of values) assert.equal(await alive(child), false, 'Owned child survived: ' + JSON.stringify(child));
};
/** 启动自有实例并在四分半内等 running，停止/错误和超时附日志失败。
 * Start the owned VM/wait four-and-a-half minutes for running, failing stopped/error/timeout with logs. */
const startVM = async () => {
  await machines.start(vm.id);
  const deadline = Date.now() + 270000;
  while (machines.state(vm.id) !== 'running') {
    if (Date.now() > deadline || ['stopped', 'error'].includes(machines.state(vm.id))) throw new Error(machines.logs.get(vm.id));
    await delay(300);
  }
};
let outside: any, tmuxServer: any;
/** 验证域外对照与 root tmux server 仍是原存活对象且 cgroup 不变，证明主域停止没有越界。
 * Verify outside controls/root tmux remain original live objects with unchanged cgroup, proving main-domain stop did not cross ownership boundaries. */
const preserveOutside = async () => {
  assert.equal(await alive(outside), true); assert.equal(await alive(tmuxServer), true);
  assert.equal((await proc(tmuxServer.pid)).cgroup, tmuxServer.cgroup);
};
try {
  await startVM();
  await run('mkdir -p ' + quote(base) + '\ntest -x /usr/bin/python3\ntest -x /usr/bin/tmux');
  // OpenRC mounts its standard managed cgroups service on the first scoped
  // operation. Establish that mount before taking the external tmux baseline.
  if (distro === 'alpine') await run('/sbin/rc-service cgroups start');
  const external = 'sakura-main-external-' + randomUUID().slice(0, 8);
  await run('tmux new-session -d -s ' + external + ' /bin/sleep 3600');
  outside = await proc(Number(await run("tmux list-panes -t =" + external + ": -F '#{pane_pid}'")));
  tmuxServer = await proc(Number(await run("tmux display-message -p '#{pid}'")));
  assert.equal(tmuxServer.cgroup.includes('/sakura-'), false);
  proof.externalRootTmux = { server: tmuxServer, pane: outside };
  console.log('Owned ' + distro + ' main scope fixture with existing external root tmux server:', root);
  for (const mode of ['normal', 'first-stop-failure', 'stop-ack-lost', 'all-stop-failures',
    'prepare-ack-lost', 'pane-ack-lost', 'commit-ack-lost', 'cancel-after-commit', 'prepared-timeout', 'cancel-cleanup-failed', 'startup-exit']) {
    const { project, directory } = await projectFor(mode, mode === 'startup-exit');
    const scope = new ProjectMainScope(machines, vm.id, project), values: any[] = [], events: string[] = [];
    let stops = 0;
    machines.exec = (/** 在 main prepare/COMMIT/stop 边界注入确认丢失、取消和真实连接失败；COMMIT 前核验 durable host 票据与原 cgroup 且正文未开始，故障后保留原执行结果的真实性。
 * Inject lost ACKs, cancellation and real connection failures at main prepare/COMMIT/stop boundaries; before COMMIT prove durable host receipts/original cgroup and absent body execution, preserving whether real operations already completed. */ async (id, command, timeout, signal, output, agent) => {
      const input = request(command);
      if (input?.op === 'stop') {
        ++stops;
        if ((mode === 'first-stop-failure' && stops === 1) || mode === 'all-stop-failures' ||
          mode === 'prepared-timeout' || mode === 'cancel-cleanup-failed') {
          await failConnection(command); events.push('real-cleanup-connection-failed'); throw new Error(token + ' owned main cleanup SSH connection failed');
        }
      }
      if (input?.op === 'commit') {
        assert.equal((await nativeExec(vm.id, 'test -f ' + quote(directory + '/main.json'), 5000)).code, 1);
        const host = JSON.parse(await readFile(scope.receipt(), 'utf8'));
        assert.equal(host.version, 2); assert.equal(host.kind, 'main'); assert.equal('name' in host, false);
        assert.equal(host.panePid, input.record.panePid); assert.equal(host.inode, input.record.inode);
        assert.equal(JSON.stringify(host).includes(token), false);
        assert.equal(await run('cat /proc/' + host.panePid + '/cgroup'), '0::/' + host.scopeName);
        events.push('durable-main-identity-and-cgroup-before-project-code');
        if (mode === 'prepared-timeout') throw new Error(token + ' owned COMMIT withheld');
      }
      const result = await nativeExec(id, command, timeout, signal, output, agent);
      if (input?.op === 'prepare' && mode === 'prepare-ack-lost' && result.code === 0) throw new Error(token + ' owned prepare ACK lost');
      if (input?.op === 'commit' && result.code === 0 && ['commit-ack-lost', 'cancel-after-commit', 'cancel-cleanup-failed', 'startup-exit'].includes(mode)) {
        values.push(...await children(directory));
        if (mode === 'commit-ack-lost') throw new Error(token + ' owned commit ACK lost');
        if (mode === 'cancel-after-commit' || mode === 'cancel-cleanup-failed') spaces.jobs.cancel(spaces.projects.key(vm.id));
      }
      if (input?.op === 'stop' && mode === 'stop-ack-lost' && stops === 1 && result.code === 0) throw new Error('owned stopped ACK lost');
      return result;
    }) as typeof machines.exec;
    machines.execInput = (/** 真实启动 pane 后仅在指定模式丢 start 回包，其他 stdin 操作原样转发，验证回滚寻找原 pane 而非重复创建。
 * Lose the start reply only after real pane creation in the selected mode and forward other stdin operations unchanged, testing rollback of the original pane instead of duplicate creation. */ async (id, command, input, ...rest) => {
      const result = await nativeInput(id, command, input, ...rest);
      if (request(command)?.op === 'start' && mode === 'pane-ack-lost' && result.code === 0)
        throw new Error(token + ' owned pane ACK lost');
      return result;
    }) as typeof machines.execInput;
    const started = await job('start');
    if (['normal', 'first-stop-failure', 'stop-ack-lost', 'all-stop-failures'].includes(mode)) {
      assert.equal(started.status, 'done', started.error + '\n' + started.log); values.push(...await children(directory));
      const before = (await scope.status()).record!;
      assert.equal(before.version, 2); assert.equal(before.kind, 'main'); assert.equal('name' in before, false);
      for (const child of values) { assert.equal(child.cgroup, '0::/' + before.scopeName); assert.equal(child.privateEnvironment, true); }
      assert.notEqual(values[0].group, values[1].group); assert.notEqual(values[0].session, values[2].session);
      assert.notEqual(values[0].session, values[3].session);
      const privateNetwork = await run('ip netns exec ' + projectNetworkNamespace(project) + ' ' + py(`import os\nprint(os.readlink('/proc/self/ns/net'))`));
      for (const child of values) assert.equal(child.network, privateNetwork);
      assert.notEqual(privateNetwork, tmuxServer.network);
      const view = await spaces.runtime(vm.id); assert.equal(view.status, 'running'); assert.equal(view.main?.status, 'running');
      if (mode === 'normal') {
        await requireDone('start'); assert.equal((await scope.status()).record!.runId, before.runId);
        assert.equal(await run('wc -l < ' + quote(directory + '/setup-runs')), '1');
      }
      if (mode === 'all-stop-failures') {
        const host = await readFile(scope.receipt(), 'utf8'), stopped = await job('stop');
        assert.equal(stopped.status, 'error'); assert.equal(stopped.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED'); assert.equal(stops, 3);
        assert.equal(await readFile(scope.receipt(), 'utf8'), host);
        for (const child of values) assert.equal(await alive(child), true);
        assert.equal((await nativeExec(vm.id, 'ip netns exec ' + projectNetworkNamespace(project) + ' true')).code, 0);
        events.push('failed-stop-preserved-processes-receipt-and-namespace'); machines.exec = nativeExec;
      }
      await requireDone('stop'); await allStopped(values);
      if (mode === 'first-stop-failure' || mode === 'stop-ack-lost') assert.equal(stops, 2);
      const stoppedRun = JSON.parse(await readFile(scope.receipt(), 'utf8')).runId;
      await requireDone('stop'); assert.equal(JSON.parse(await readFile(scope.receipt(), 'utf8')).runId, stoppedRun);
      if (mode === 'normal') {
        await machines.suspend(vm.id);
        await spaces.save(vm.id, { ...project, environment: {}, secrets: {}, command: '' });
        await machines.resume(vm.id); await spaces.save(vm.id, project);
        events.push('confirmed-stopped-main-permits-paused-binding-edits');
      }
    } else {
      if (mode === 'cancel-after-commit') assert.equal(started.status, 'cancelled');
      else assert.equal(started.status, 'error', started.log);
      if (mode === 'prepared-timeout' || mode === 'cancel-cleanup-failed') {
        assert.equal(started.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED'); assert.equal(stops, 3);
        if (mode === 'prepared-timeout') {
          const host = JSON.parse(await readFile(scope.receipt(), 'utf8')), expiry = Date.now() + 38000;
          while (await alive({ pid: host.panePid, ticks: host.paneStartTicks })) {
            if (Date.now() > expiry) throw new Error('Uncommitted main pane did not end within its finite timeout'); await delay(500);
          }
          assert.equal((await nativeExec(vm.id, 'test -f ' + quote(directory + '/main.json'))).code, 1);
          assert.equal(JSON.parse(await readFile(scope.receipt(), 'utf8')).phase, 'prepared');
          events.push('uncommitted-main-timeout-without-project-code');
        } else {
          for (const child of values) assert.equal(await alive(child), true);
          assert.equal(JSON.parse(await readFile(scope.receipt(), 'utf8')).phase, 'running');
          events.push('cancelled-job-reports-cleanup-error-with-running-receipt');
        }
      } else {
        assert.notEqual(started.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED');
        assert.equal(JSON.parse(await readFile(scope.receipt(), 'utf8')).phase, 'stopped');
        if (mode === 'prepare-ack-lost' || mode === 'pane-ack-lost') {
          assert.equal((await nativeExec(vm.id, 'test -f ' + quote(directory + '/main.json'))).code, 1); events.push('project-code-never-ran');
        }
      }
      machines.exec = nativeExec; await requireDone('stop'); await allStopped(values);
    }
    machines.exec = nativeExec; machines.execInput = nativeInput; await preserveOutside();
    proof.cases.push({ name: mode, stopAttempts: stops, events, childEvidence: values, outsidePreserved: true });
    console.log('PASS ' + mode + ': main lifecycle, escaped process groups and external tmux preserved.');
  }
  for (const field of ['runId', 'bootId', 'inode', 'panePid', 'paneStartTicks'] as const) {
    const { project, directory } = await projectFor('replaced-' + field); await requireDone('start');
    const scope = new ProjectMainScope(machines, vm.id, project), values = await children(directory), original = (await scope.status()).record!;
    const owner = projectMainScopePaths(project).guest + '/owner.json', changed: any = { ...original };
    changed[field] = field.endsWith('Id') ? randomUUID() : field === 'panePid' ? original.panePid! + 1 : '777777';
    if (field === 'runId') changed.scopeName = 'sakura-main-' + changed.runId;
    await run(py(`import json\nopen(${JSON.stringify(owner)},'w').write(${JSON.stringify(JSON.stringify(changed))})`));
    const before = await readFile(scope.receipt(), 'utf8'), stopped = await job('stop');
    assert.equal(stopped.status, 'error'); assert.equal(stopped.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED');
    assert.equal(await readFile(scope.receipt(), 'utf8'), before);
    for (const child of values) assert.equal(await alive(child), true);
    await run(py(`import json\nopen(${JSON.stringify(owner)},'w').write(${JSON.stringify(JSON.stringify(original))})`));
    await requireDone('stop'); await allStopped(values); await preserveOutside();
    proof.cases.push({ name: 'replaced-' + field, refusedBeforeSignal: true, hostReceiptRetained: true, childEvidence: values });
    console.log('PASS replaced-' + field + ': exact main ownership rejected before signaling.');
  }
  {
    const { project, directory } = await projectFor('late-prepare-cancelled'); let deferred = '';
    machines.exec = (/** 截住自有 prepare 命令并延后交付，其他 exec 透明转发；用于证明已失败事务的迟到 prepare 不能复活正文。
 * Intercept/delay the owned prepare command while forwarding other exec transparently, proving late prepare delivery cannot revive a failed transaction’s body. */ async (id, command, timeout, signal, output, agent) => {
      if (request(command)?.op === 'prepare') { deferred = command; throw new Error('owned prepare delivery delayed'); }
      return nativeExec(id, command, timeout, signal, output, agent);
    }) as typeof machines.exec;
    const started = await job('start'); assert.equal(started.status, 'error'); assert.equal(started.errorCode, 'PROJECT_MAIN_SCOPE_CHANGED');
    machines.exec = nativeExec; assert.ok(deferred);
    const late = await nativeExec(vm.id, deferred); assert.notEqual(late.code, 0); assert.match(late.stderr, /启动已取消/);
    assert.equal((await nativeExec(vm.id, 'test -f ' + quote(directory + '/main.json'))).code, 1);
    assert.equal((await new ProjectMainScope(machines, vm.id, project).status()).status, 'stopped');
    await requireDone('stop'); await preserveOutside(); proof.cases.push({ name: 'late-prepare-cancelled', cancellationFenceVerified: true });
    console.log('PASS late-prepare-cancelled: delayed main prepare cannot run after confirmed rollback.');
  }
  {
    const { project, directory } = await projectFor('exited-binding-guards'); await requireDone('start');
    const values = await children(directory), scope = new ProjectMainScope(machines, vm.id, project), record = (await scope.status()).record!;
    await killOwned(values[0]); await delay(300);
    await run('printf %s ' + quote('owned main application trace\n') + ' >> ' + quote(projectLog(project)));
    const runtime = await spaces.runtime(vm.id); assert.equal(runtime.status, 'exited'); assert.equal(runtime.main?.status, 'exited'); assert.match(runtime.log, /owned main application trace/);
    const blocked: string[] = [];
    for (const [name, update] of Object.entries({ command: { command: 'sleep 601' }, environment: { environment: { TOKEN: 'replacement' } },
      secrets: { secrets: { TOKEN: 'replacement-key' } }, runtimes: { runtimes: { node: '22.1.0' } }, directory: { directory: directory + '-changed' },
      network: { networkIsolation: 'host' }, services: { services: [{ name: 'main', command: 'sleep 600' }] } })) {
      await assert.rejects(spaces.save(vm.id, { ...project, ...update }), { code: 'PROJECT_MAIN_SCOPE_CHANGED' }); blocked.push(name);
    }
    const started = await job('start'); assert.equal(started.status, 'error'); assert.equal(started.errorCode, 'PROJECT_MAIN_SCOPE_CHANGED');
    assert.equal((await scope.metadata())!.runId, record.runId);
    for (const child of values.slice(1)) assert.equal(await alive(child), true);
    await requireDone('stop'); await allStopped(values);
    await spaces.save(vm.id, { ...project, command: 'sleep 601', environment: {}, secrets: {}, directory: directory + '-changed', networkIsolation: 'host' });
    assert.equal((await spaces.runtime(vm.id)).main?.status, 'stopped'); await preserveOutside();
    proof.cases.push({ name: 'exited-binding-guards', blocked, stoppedEditsAllowed: true, detachedDescendantsCleaned: true, childEvidence: values });
    console.log('PASS exited-binding-guards: no configuration bypass after the main pane exits.');
  }
  {
    const { project, directory } = await projectFor('replacement-after-lost-stop'); await requireDone('start');
    const scope = new ProjectMainScope(machines, vm.id, project), values = await children(directory), record = (await scope.status()).record!;
    const path = '/sys/fs/cgroup/' + record.scopeName, marker = directory + '/replacement.json'; let replaced = false;
    machines.exec = (/** 真实 stop 成功后建立同名新 cgroup 和无关自有进程，再丢原回应；重试必须识别原 inode 消失并保护替代域，不能按名字杀新对象。
 * After real stop succeeds create a same-name new cgroup/unrelated owned process and lose the old reply; retries must recognize original-inode disappearance and preserve replacement domains rather than kill by name. */ async (id, command, timeout, signal, output, agent) => {
      const result = await nativeExec(id, command, timeout, signal, output, agent);
      if (request(command)?.op === 'stop' && result.code === 0 && !replaced) {
        replaced = true; await run('mkdir ' + quote(path));
        await run('setsid ' + py(`import json,os,time\nopen(${JSON.stringify(path + '/cgroup.procs')},'w').write(str(os.getpid()))\nopen(${JSON.stringify(marker)},'w').write(json.dumps({'pid':os.getpid(),'ticks':open('/proc/self/stat').read().rsplit(') ',1)[1].split()[19],'inode':str(os.stat(${JSON.stringify(path)}).st_ino)}))\nwhile True:time.sleep(1)`) + ' </dev/null >/dev/null 2>&1 &');
        await waitFile(marker); throw new Error('owned stop ACK lost after replacement scope created');
      }
      return result;
    }) as typeof machines.exec;
    const stopped = await job('stop'); assert.equal(stopped.status, 'error'); assert.equal(stopped.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED'); machines.exec = nativeExec;
    const replacement = JSON.parse(await run('cat ' + quote(marker))); assert.notEqual(replacement.inode, record.inode);
    assert.equal(await alive(replacement), true); await allStopped(values);
    await run(py(`import os,time\np=${JSON.stringify(path)}\nassert str(os.stat(p).st_ino)==${JSON.stringify(replacement.inode)}\nopen(p+'/cgroup.kill','w').write('1')\nwhile 'populated 1' in open(p+'/cgroup.events').read():time.sleep(0.05)\nos.rmdir(p)`));
    await requireDone('stop'); await preserveOutside(); proof.cases.push({ name: 'replacement-after-lost-stop', replacementPreserved: true, oldInode: record.inode, newInode: replacement.inode });
    console.log('PASS replacement-after-lost-stop: old main cleanup cannot stop a new kernel scope.');
  }
  {
    const { project, directory } = await projectFor('replacement-pane'); await requireDone('start');
    const values = await children(directory); let replacement: any;
    machines.exec = (/** 原 stop 完成后创建同名 tmux 新 pane，再故意丢回应；测试精确出生票据保护新 pane，旧事务重试不能重获同名会话所有权。
 * Create a same-name new tmux pane after original stop and deliberately lose the reply, testing birth-ticket protection so retrying an old transaction cannot acquire ownership of the new session. */ async (id, command, timeout, signal, output, agent) => {
      const result = await nativeExec(id, command, timeout, signal, output, agent);
      if (request(command)?.op === 'stop' && result.code === 0 && !replacement) {
        await run('tmux new-session -d -s ' + mainSession(project) + ' /bin/sleep 3600');
        replacement = await proc(Number(await run("tmux list-panes -t =" + mainSession(project) + ": -F '#{pane_pid}'")));
        throw new Error('owned old stop reply lost after replacement pane');
      }
      return result;
    }) as typeof machines.exec;
    const stopped = await job('stop'); assert.equal(stopped.status, 'error'); assert.equal(stopped.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED'); machines.exec = nativeExec;
    assert.equal(await alive(replacement), true); await allStopped(values); await killOwned(replacement); await delay(200);
    await requireDone('stop'); await preserveOutside(); proof.cases.push({ name: 'replacement-pane', replacementPreserved: true });
    console.log('PASS replacement-pane: old main stop cannot kill a new same-name pane.');
  }
  {
    const { project, directory } = await projectFor('independent-main-service'); await run('mkdir -p ' + quote(directory + '/service'));
    await authorizeFixtureDirectory(project, [directory + '/service']);
    const service = serviceSchema.parse({ name: 'main', command: app(directory + '/service') }), mixed = { ...project, services: [service] };
    await spaces.save(vm.id, mixed); await requireDone('start');
    const resolved = await spaces.resolvedConfig(vm.id), services = new ProjectServiceScopes(machines, vm.id, resolved);
    const serviceValues = await children(directory + '/service'), serviceRecord = (await services.status('main')).record!;
    assert.equal(serviceRecord.version, 1);
    const restored = new ProjectServiceScopes(machines, vm.id, resolved); assert.equal((await restored.metadata('main'))!.runId, serviceRecord.runId);
    const scope = new ProjectMainScope(machines, vm.id, resolved), intent = scope.intent(serviceRecord.bootId);
    await scope.persistIntent(intent);
    const payload = await new ProjectRunScopes(machines).inherited(vm.id, resolved,
      { command: resolved.command, environment: resolved.environment },
      { kind: 'main', runId: intent.runId, bootId: intent.bootId });
    await scope.start(intent, payload, new AbortController().signal);
    const mainValues = await children(directory), mainRecord = (await scope.status()).record!;
    assert.notEqual(mainRecord.session, serviceRecord.session); assert.notEqual(mainRecord.scopeName, serviceRecord.scopeName);
    assert.notEqual(scope.receipt(), restored.receipt('main')); assert.equal(JSON.stringify(mainRecord).includes(token), false);
    await requireDone('stop', 'main'); await allStopped(serviceValues);
    for (const child of mainValues) assert.equal(await alive(child), true);
    assert.equal((await nativeExec(vm.id, 'ip netns exec ' + projectNetworkNamespace(resolved) + ' true')).code, 0);
    for (const name of ['main', 'newgroup', 'setsid', 'doublefork'])
      await run('rm -f ' + quote(directory + '/service/' + name + '.json'));
    await requireDone('start'); const secondServiceValues = await children(directory + '/service');
    machines.exec = (/** 只对 main stop 注入真实 SSH 连接失败并保留其他操作，验证混合托管/非托管入口清理失败时不猜测 PID 或隐去错误。
 * Inject real SSH connection failure only for main stop while preserving other operations, testing that mixed managed/unmanaged cleanup neither guesses PIDs nor hides failure. */ async (id, command, timeout, signal, output, agent) => {
      if (request(command)?.op === 'stop') { await failConnection(command); throw new Error(token + ' owned mixed main cleanup connection failed'); }
      return nativeExec(id, command, timeout, signal, output, agent);
    }) as typeof machines.exec;
    const stopped = await job('stop'); assert.equal(stopped.status, 'error'); assert.equal(stopped.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED'); machines.exec = nativeExec;
    await allStopped(secondServiceValues); assert.equal((await restored.metadata('main'))!.phase, 'stopped');
    for (const child of mainValues) assert.equal(await alive(child), true);
    assert.equal((await scope.metadata())!.phase, 'running');
    assert.equal((await nativeExec(vm.id, 'ip netns exec ' + projectNetworkNamespace(resolved) + ' true')).code, 0);
    await requireDone('stop'); await allStopped(mainValues); await preserveOutside();
    proof.cases.push({ name: 'independent-main-service', serviceV1Recovered: true, realServiceNamedMainIndependent: true,
      namedStopPreservedMain: true, failedWholeStopPreservedMainReceiptAndNamespace: true });
    console.log('PASS independent-main-service: v1 service and v2 main lifetimes are distinct.');
  }
  {
    const name = 'Owned legacy main ' + randomUUID().slice(0, 8);
    const catalog = await spaces.projects.create(vm.id, name, async () => spaces.save(vm.id, { directory: base, command: 'sleep 3600' }).then(() => {}));
    await spaces.projects.with(vm.id, catalog.active, async () => {
      const project = await spaces.config(vm.id); await run('tmux new-session -d -s ' + mainSession(project) + ' /bin/sleep 3600');
      const legacy = await proc(Number(await run("tmux list-panes -t =" + mainSession(project) + ": -F '#{pane_pid}'")));
      const runtime = await spaces.runtime(vm.id); assert.equal(runtime.status, 'unconfirmed'); assert.equal(runtime.main?.status, 'unmanaged');
      await assert.rejects(spaces.save(vm.id, { ...project, command: 'sleep 3601' }), { code: 'PROJECT_MAIN_SCOPE_UNMANAGED' });
      for (const action of ['start', 'stop'] as const) { const value = await job(action); assert.equal(value.status, 'error'); assert.equal(value.errorCode, 'PROJECT_MAIN_SCOPE_UNMANAGED'); }
      assert.equal(await alive(legacy), true); await killOwned(legacy); await delay(200); await requireDone('stop');
    });
    await spaces.projects.update(vm.id, 'default'); await preserveOutside();
    proof.cases.push({ name: 'unknown-legacy-main', runtimeMigrationMetadata: true, startStopAndBindingRefused: true, legacyPanePreserved: true });
    console.log('PASS unknown-legacy-main: migration is explicit and no process ownership was inferred.');
  }
  {
    const catalog = await spaces.projects.create(vm.id, 'Owned empty legacy main ' + randomUUID().slice(0, 8),
      async () => spaces.save(vm.id, { directory: base, command: '' }).then(() => {}));
    const blocked: string[] = [];
    await spaces.projects.with(vm.id, catalog.active, /** 创建自有旧 tmux main，暂停时变更按 scope changed 拒绝、恢复后按 unmanaged 拒绝；正式 stop 也必须报错且保留原进程，夹具精确清理后才允许完成。
 * Create an owned legacy tmux main; reject edits as scope-changed while suspended and unmanaged after resume, and require formal stop failure preserving the process until exact fixture cleanup permits completion. */ async () => {
      const project = await spaces.config(vm.id); await run('tmux new-session -d -s ' + mainSession(project) + ' /bin/sleep 3600');
      const legacy = await proc(Number(await run("tmux list-panes -t =" + mainSession(project) + ": -F '#{pane_pid}'")));
      const updates = { command: { command: 'sleep 3601' }, environment: { environment: { NEW_VALUE: 'owned' } },
        secrets: { secrets: { TOKEN: 'owned-main-token' } }, runtimes: { runtimes: { node: '22.1.0' } }, directory: { directory: base + '/new' },
        network: { networkIsolation: 'private' }, services: { services: [{ name: 'api', command: 'sleep 3600' }] } };
      await machines.suspend(vm.id);
      for (const update of Object.values(updates))
        await assert.rejects(spaces.save(vm.id, { ...project, ...update }), { code: 'PROJECT_MAIN_SCOPE_CHANGED' });
      await machines.resume(vm.id);
      const runtime = await spaces.runtime(vm.id); assert.equal(runtime.status, 'unconfirmed'); assert.equal(runtime.main?.status, 'unmanaged');
      for (const [name, update] of Object.entries(updates)) {
        await assert.rejects(spaces.save(vm.id, { ...project, ...update }), { code: 'PROJECT_MAIN_SCOPE_UNMANAGED' }); blocked.push(name);
      }
      const stopped = await job('stop'); assert.equal(stopped.status, 'error'); assert.equal(stopped.errorCode, 'PROJECT_MAIN_SCOPE_UNMANAGED');
      assert.equal(await alive(legacy), true); assert.equal((await spaces.config(vm.id)).command, '');
      await killOwned(legacy); await delay(200); await requireDone('stop');
    });
    await spaces.projects.update(vm.id, 'default'); await preserveOutside();
    proof.cases.push({ name: 'empty-command-legacy-main', pausedBindingRefusedBeforeGuestAccess: true,
      runningBindingGuards: blocked, emptyConfigPreserved: true, legacyPanePreserved: true });
    console.log('PASS empty-command-legacy-main: saved empty commands never exempt old panes from running or paused binding guards.');
  }
  {
    const catalog = await spaces.projects.create(vm.id, 'Owned paused legacy service ' + randomUUID().slice(0, 8),
      async () => spaces.save(vm.id, { directory: base, command: '', services: [
        { name: 'legacy', command: 'sleep 3600' }, { name: 'second', command: 'sleep 3600' },
      ] }).then(() => {}));
    await spaces.projects.with(vm.id, catalog.active, async () => {
      const project = await spaces.config(vm.id), session = serviceSession('legacy', project);
      await run('tmux new-session -d -s ' + session + ' /bin/sleep 3600');
      const legacy = await proc(Number(await run("tmux list-panes -t =" + session + ": -F '#{pane_pid}'")));
      await machines.suspend(vm.id);
      for (const services of [[{ ...project.services![0], command: 'sleep 3601' }, project.services![1]], [project.services![1]]])
        await assert.rejects(spaces.save(vm.id, { ...project, services }), { code: 'SERVICE_SCOPE_UNMANAGED' });
      await machines.resume(vm.id); assert.equal(await alive(legacy), true);
      assert.equal((await spaces.config(vm.id)).services?.length, 2); assert.equal((await spaces.config(vm.id)).services?.[0].command, 'sleep 3600');
      const stopped = await job('stop', 'legacy'); assert.equal(stopped.status, 'error'); assert.equal(stopped.errorCode, 'SERVICE_SCOPE_UNMANAGED');
      assert.equal(await alive(legacy), true); await killOwned(legacy); await delay(200); await requireDone('stop', 'legacy');
    });
    await spaces.projects.update(vm.id, 'default'); await preserveOutside();
    proof.cases.push({ name: 'paused-unknown-legacy-service', pausedCommandAndPartialRemovalRefused: true,
      oldConfigurationPreserved: true, namedStopRefusedWithoutOwnership: true, legacyPanePreserved: true });
    console.log('PASS paused-unknown-legacy-service: unknown paused service bindings remain reachable until explicit migration.');
  }
  {
    const { project, directory } = await projectFor('same-boot-missing-owner'); await requireDone('start');
    const scope = new ProjectMainScope(machines, vm.id, project), record = (await scope.status()).record!, values = await children(directory);
    const owner = projectMainScopePaths(project).guest + '/owner.json', before = await readFile(scope.receipt(), 'utf8');
    await run(py(`import json,os\np=${JSON.stringify(owner)}\nassert json.load(open(p))['runId']==${JSON.stringify(record.runId)}\nos.unlink(p)`));
    const stopped = await job('stop'); assert.equal(stopped.status, 'error'); assert.equal(stopped.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED');
    assert.equal(await readFile(scope.receipt(), 'utf8'), before);
    for (const child of values) assert.equal(await alive(child), true);
    await run(py(`open(${JSON.stringify(owner)},'w').write(${JSON.stringify(JSON.stringify(record))})`));
    await requireDone('stop'); await allStopped(values); await preserveOutside();
    proof.cases.push({ name: 'same-boot-missing-owner', liveScopeRefused: true, receiptRetained: true, childEvidence: values });
    console.log('PASS same-boot-missing-owner: absence never bypasses a still-populated current-boot scope.');
  }
  {
    const { project, directory } = await projectFor('reboot-repeated-stop'); await requireDone('start');
    const oldScope = new ProjectMainScope(machines, vm.id, project), old = (await oldScope.status()).record!;
    const previousLive = machines.live.get(vm.id), oldValues = await children(directory), before = await readFile(oldScope.receipt(), 'utf8');
    await preserveOutside(); await machines.stop(vm.id); assert.equal(machines.state(vm.id), 'stopped'); await startVM();
    assert.notEqual(machines.live.get(vm.id), previousLive);
    if (distro === 'alpine') await run('/sbin/rc-service cgroups start');
    const nextBoot = await run('cat /proc/sys/kernel/random/boot_id'); assert.notEqual(nextBoot, old.bootId);
    const path = '/sys/fs/cgroup/' + old.scopeName, marker = directory + '/new-boot-scope.json';
    await run('mkdir ' + quote(path));
    await run('setsid ' + py(`import json,os,time\nopen(${JSON.stringify(path + '/cgroup.procs')},'w').write(str(os.getpid()))\nopen(${JSON.stringify(marker)},'w').write(json.dumps({'pid':os.getpid(),'ticks':open('/proc/self/stat').read().rsplit(') ',1)[1].split()[19],'inode':str(os.stat(${JSON.stringify(path)}).st_ino)}))\nwhile True:time.sleep(1)`) + ' </dev/null >/dev/null 2>&1 &');
    await waitFile(marker); const replacement = JSON.parse(await run('cat ' + quote(marker)));
    let stopped = await job('stop'); assert.equal(stopped.status, 'error'); assert.equal(stopped.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED');
    assert.equal(await alive(replacement), true); assert.equal(await readFile(oldScope.receipt(), 'utf8'), before);
    await run(py(`import os,time\np=${JSON.stringify(path)}\nassert str(os.stat(p).st_ino)==${JSON.stringify(replacement.inode)}\nopen(p+'/cgroup.kill','w').write('1')\nwhile 'populated 1' in open(p+'/cgroup.events').read():time.sleep(0.05)\nos.rmdir(p)`));
    await run('tmux new-session -d -s ' + old.session + ' /bin/sleep 3600');
    const replacementPane = await proc(Number(await run("tmux list-panes -t =" + old.session + ": -F '#{pane_pid}'")));
    stopped = await job('stop'); assert.equal(stopped.status, 'error'); assert.equal(stopped.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED');
    assert.equal(await alive(replacementPane), true); assert.equal(await readFile(oldScope.receipt(), 'utf8'), before);
    await killOwned(replacementPane); await delay(200);
    const owner = projectMainScopePaths(project).guest + '/owner.json', newRun = randomUUID();
    const newOwner = { ...old, runId: newRun, bootId: nextBoot, scopeName: 'sakura-main-' + newRun, phase: 'prepared', inode: '424242',
      sessionId: null, paneId: null, panePid: null, paneStartTicks: null };
    await run(py(`open(${JSON.stringify(owner)},'w').write(${JSON.stringify(JSON.stringify(newOwner))})`));
    stopped = await job('stop'); assert.equal(stopped.status, 'error'); assert.equal(stopped.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED');
    assert.equal(await readFile(oldScope.receipt(), 'utf8'), before);
    assert.equal(JSON.parse(await run('cat ' + quote(owner))).runId, newRun);
    await run(py(`import json,os\np=${JSON.stringify(owner)}\nassert json.load(open(p))['runId']==${JSON.stringify(newRun)}\nos.unlink(p)`));
    let probes = 0, stopSignals = 0;
    machines.exec = (/** 记录 stop 信号并只让首次重启探针连接真实失败，其他 exec 保持原行为，验证重启观测失败不能触发猜测式退役。
 * Record stop signals and fail only the first real reboot-probe connection while preserving other exec, proving failed reboot observation cannot trigger guessed retirement. */ async (id, command, timeout, signal, output, agent) => {
      if (request(command)?.op === 'stop') ++stopSignals;
      if (request(command)?.op === 'probe-reboot' && ++probes === 1) { await failConnection(command); throw new Error(token + ' owned reboot probe connection failed'); }
      return nativeExec(id, command, timeout, signal, output, agent);
    }) as typeof machines.exec;
    await requireDone('stop'); assert.equal(probes, 2); await requireDone('stop'); assert.equal(probes, 3); assert.equal(stopSignals, 0);
    machines.exec = nativeExec;
    assert.deepEqual(await oldScope.metadata(), { ...old, phase: 'stopped' });
    const view = await spaces.runtime(vm.id); assert.equal(view.status, 'stopped'); assert.equal(view.main?.status, 'absent');
    for (const name of ['main', 'newgroup', 'setsid', 'doublefork']) await run('rm -f ' + quote(directory + '/' + name + '.json'));
    await requireDone('start'); const currentValues = await children(directory), current = new ProjectMainScope(machines, vm.id, project);
    const currentRun = (await current.status()).record!; assert.equal(currentRun.bootId, nextBoot); assert.notEqual(currentRun.runId, old.runId);
    await assert.rejects(oldScope.stop(old), { code: 'PROJECT_MAIN_CLEANUP_FAILED' });
    await assert.rejects(current.stop(old), { code: 'PROJECT_MAIN_CLEANUP_FAILED' });
    for (const child of currentValues) assert.equal(await alive(child), true);
    await requireDone('stop'); await allStopped(currentValues);
    proof.cases.push({ name: 'reboot-repeated-stop', oldBoot: old.bootId, currentBoot: nextBoot, oldChildEvidence: oldValues,
      replacementScopePreserved: true, replacementPanePreserved: true, newGuestOwnerPreserved: true,
      firstProbeConnectionFailureRetried: true, retiredStopSignals: stopSignals, repeatedStopConfirmed: true,
      oldLiveRollbackRefused: true, oldRunRollbackRefused: true, newRunStartedAndStopped: true });
    console.log('PASS reboot-repeated-stop: exact absence retires the old boot without affecting replacement objects or a new run.');
  }
  for (const source of sources) assert.equal(createHash('sha256').update(await readFile(resolve(source))).digest('hex'), proof.sourceSha256[source]);
} catch (error) {
  proof.error = String(error); throw error;
} finally {
  machines.exec = nativeExec; machines.execInput = nativeInput; await spaces.close(); await machines.close();
  proof.vmStopped = machines.state(vm.id) === 'stopped'; proof.stoppedAt = new Date().toISOString();
  await writeFile(join(root, 'project-main-uid-scope-evidence.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log('Main UID scope proof:', join(root, 'project-main-uid-scope-evidence.json'));
}
