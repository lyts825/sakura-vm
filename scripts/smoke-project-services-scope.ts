/** 烟雾验收：验证项目服务进程的 UID 作用域、启动依赖与停止清理。
 * Smoke acceptance for project service UID scopes, startup dependencies and stopped cleanup. */
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
assert.equal(dirname(root), parent);
assert.match(basename(root), /^sakura-guest-task-[A-Za-z0-9_-]+$/);
const prior = JSON.parse(await readFile(join(root, 'guest-task-cgroup-evidence.json'), 'utf8'));
assert.equal(prior.distro, distro);
assert.equal(prior.vmStopped, true);
assert.equal(prior.error, undefined);
process.env.TEMP = process.env.TMP = parent;
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/' + {
  alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2',
}[distro]);
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { projectSchema, Workspaces } = await import('../server/workspaces.ts');
const { runServices, serviceSession, serviceLog } = await import('../server/project-services.ts');
const { ProjectServiceScopes, projectServiceScopePaths } = await import('../server/project-service-scope.ts');
const { ProjectRunScopes } = await import('../server/project-run-scope.ts');
const { ensureProjectNetworkScript } = await import('../server/project-network-isolation.ts');
const { quote } = await import('../server/files.ts');
const { freePort } = await import('../server/qmp.ts');
const machines = new Machines(await createRuntime());
await machines.init();
assert.equal(machines.records.size, 1);
const vm = [...machines.records.values()][0];
assert.equal(vm.id, prior.vmId);
assert.equal(vm.name, 'guest-task-cgroup-smoke');
assert.equal(vm.distro, distro);
assert.equal(machines.state(vm.id), 'stopped');
const workspaces = new Workspaces(machines);
const nativeExec = machines.exec.bind(machines), nativeInput = machines.execInput.bind(machines);
/** 在本验收夹具的指定实例中执行传入脚本，使用函数中的超时约束并断言退出码为零，返回捕获的标准输出；失败附来宾诊断而不被当作空输出。
 * Execute the supplied script in the specified fixture VM under this function’s timeout, assert exit code zero and return captured stdout; failures include guest diagnostics rather than become empty output. */
const run = async (command: string, timeout = 30000) => {
  const result = await nativeExec(vm.id, command, timeout);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  return result.stdout.trim();
};
/** 生成隔离 Python 命令，将整段源码作为单个字面参数；-I/-S 避免用户环境和 site 初始化改变观测，执行权限由外层来宾入口控制。
 * Build an isolated Python command with the source as one literal argument; -I/-S exclude user environment/site initialization, while the outer guest entry controls execution authority. */
const py = (source: string) => '/usr/bin/python3 -I -S -c ' + quote(source);
/** 从固定请求标记行解码原生控制 JSON，未包含标记返回 null；用于精确故障阶段识别，正文不重新执行。
 * Decode native-control JSON from its fixed request-marker line, returning null if absent; identify exact fault phases without reexecuting bodies. */
const request = (command: string) => {
  const line = command.split('\n').find(value => value.startsWith('# SAKURA_PROJECT_SERVICE_REQUEST='));
  return line ? JSON.parse(Buffer.from(line.split('=')[1], 'base64').toString()) : null;
};
/** 暂时把原 live SSH 端口指向未监听端口，断言连接拒绝/超时，finally 恢复原端口以验证回复丢失后的恢复。
 * Temporarily point the original live SSH port at an unlistened port, assert refusal/timeout and restore it in finally to exercise recovery after lost replies. */
const failConnection = async (command: string) => {
  const live = machines.live.get(vm.id)!, saved = live.sshPort;
  live.sshPort = await freePort();
  try { await assert.rejects(nativeExec(vm.id, command, 350), /ECONNREFUSED|refused|timed out/); }
  finally { live.sshPort = saved; }
};
/** 检查 PID 非僵尸/死亡，可选 ticks 必须匹配，缺失返回 false，防止重用 PID 伪造原后代。
 * Check the PID is nonzombie/nondead, match optional birth ticks and return false on absence to avoid reused-PID evidence. */
const pidAlive = async (pid: number, ticks?: string) =>
  (await run(py(`try:\n fields=open('/proc/${pid}/stat').read().rsplit(') ',1)[1].split()\n print(fields[0] not in ['Z','X']${ticks ? ` and fields[19]==${JSON.stringify(ticks)}` : ''})\nexcept FileNotFoundError: print(False)`))) === 'True';
/** 有限次轮询自有应用的结果文件，出现后返回；期限内未发布则失败，避免使用上一阶段缺失结果。
 * Poll the owned application result file for a bounded number of attempts, returning when published and failing on absence rather than using missing prior-stage evidence. */
const waitFile = async (file: string) => {
  for (let attempt = 0; attempt < 120; ++attempt) {
    if ((await nativeExec(vm.id, 'test -f ' + quote(file), 5000)).code === 0) return;
    await delay(50);
  }
  throw new Error('Owned application did not publish ' + file);
};
const base = '/workspace/service-scope-smoke';
const proof: any = { version: 1, vmId: vm.id, distro, fixture: root, sourceSha256: {}, cases: [] };
for (const source of ['server/project-services.ts', 'server/project-service-scope.ts'])
  proof.sourceSha256[source] = createHash('sha256').update(await readFile(resolve(source))).digest('hex');
/** 等待自有主进程及脱离组/会话子进程各自发布记录，返回精确出生身份数组供完整域清理核查。
 * Await reports from the owned main/process-group/session-detached children and return exact birth-identity records for whole-domain cleanup verification. */
const children = async (directory: string) => {
  const values: any[] = [];
  for (const name of ['main', 'setsid', 'doublefork']) {
    const file = directory + '/' + name + '.json';
    await waitFile(file);
    values.push(JSON.parse(await run('cat ' + quote(file))));
  }
  return values;
};
/** 生成忽略 SIGTERM 的服务及 setsid/双 fork 后代，发布精确出生与环境记录，供依赖失败/停止清理验证。
 * Generate a SIGTERM-ignoring service/setsid/double-fork children publishing birth/environment records for dependency-failure/stop cleanup checks. */
const app = (directory: string) => py(`import json,os,signal,time
signal.signal(signal.SIGTERM,signal.SIG_IGN)
def report(name):
 fields=open('/proc/self/stat').read().rsplit(') ',1)[1].split()
 record={'name':name,'pid':os.getpid(),'startTicks':fields[19],'group':os.getpgrp(),'session':os.getsid(0),'cgroup':open('/proc/self/cgroup').read().strip(),'environment':os.environ.get('SAKURA_SCOPE_TEST')}
 with open(${JSON.stringify(directory)}+'/'+name+'.json','w') as stream: json.dump(record,stream)
def stay():
 while True: time.sleep(1)
report('main')
if os.fork()==0:
 os.setsid(); report('setsid'); stay()
first=os.fork()
if first==0:
 os.setsid()
 if os.fork()!=0: os._exit(0)
 report('doublefork'); stay()
os.waitpid(first,0)
stay()`);
/** 创建唯一私有服务目录，按可选依赖配置 db/api 与故意失败的 ready 条件，授权正式项目身份后保存配置。
 * Create a unique private service directory with optional db/api dependency/failing readiness, authorize production project identity and save settings. */
const projectFor = async (label: string, dependencies = false) => {
  const directory = base + '/' + label + '-' + randomUUID();
  await run('mkdir -p ' + quote(directory) + (dependencies ? ' ' + quote(directory + '/db') : ''));
  const project = projectSchema.parse({ directory, networkIsolation: 'private', environment: { SAKURA_SCOPE_TEST: label }, services: dependencies ? [
    { name: 'db', command: app(directory + '/db'), timeout: 5 },
    { name: 'api', command: app(directory), dependsOn: ['db'], ready: 'false', timeout: 5 },
  ] : [{ name: 'api', command: app(directory), timeout: 5 }] });
  const identities = new ProjectRunScopes(machines), identity = await identities.reserve(vm.id, project);
  for (const path of [directory, ...(dependencies ? [directory + '/db'] : [])]) {
    assert.ok(path.startsWith(base + '/'));
    // An explicit fixture grant, never a production automatic migration.
    await run(py(`import os,stat\np=${JSON.stringify(path)};assert os.path.realpath(p)==p\ni=os.lstat(p);assert stat.S_ISDIR(i.st_mode) and i.st_uid==0\nos.chown(p,${identity.uid},${identity.gid},follow_symlinks=False);os.chmod(p,0o700)`));
  }
  await identities.identity(vm.id, project);
  return { directory, project };
};
/** 逐个验证捕获的原子进程身份已经死亡，任何自有后代存活都会使整域清理验收失败。
 * Verify each captured original process identity is dead; any surviving owned descendant fails whole-domain cleanup acceptance. */
const verifyChildrenStopped = async (values: any[]) => {
  for (const child of values) assert.equal(await pidAlive(child.pid, child.startTicks), false, 'Owned child remained: ' + JSON.stringify(child));
};
let unrelated: any;
try {
  await machines.start(vm.id);
  const deadline = Date.now() + 270000;
  while (machines.state(vm.id) !== 'running') {
    if (Date.now() > deadline || ['stopped', 'error'].includes(machines.state(vm.id))) throw new Error(machines.logs.get(vm.id));
    await delay(300);
  }
  const seedProject = projectSchema.parse({ directory: base, networkIsolation: 'private' });
  await run('set -eu\nmkdir -p ' + quote(base) + '\n' + ensureProjectNetworkScript(seedProject, distro), 60000);
  const unrelatedFile = base + '/unrelated-' + randomUUID() + '.json';
  await run('setsid ' + py(`import json,os,time\nrecord={'pid':os.getpid(),'ticks':open('/proc/self/stat').read().rsplit(') ',1)[1].split()[19]}\nopen(${JSON.stringify(unrelatedFile)},'w').write(json.dumps(record))\nwhile True:time.sleep(1)`) + ' </dev/null >/dev/null 2>&1 &');
  await waitFile(unrelatedFile);
  unrelated = JSON.parse(await run('cat ' + quote(unrelatedFile)));
  console.log('Owned ' + distro + ' persistent service scope fixture: ' + root);
  for (const mode of ['normal', 'first-stop-failure', 'stop-ack-lost', 'all-stop-failures', 'prepare-ack-lost', 'pane-ack-lost', 'commit-ack-lost', 'cancel-after-commit', 'prepared-timeout', 'ready-failure']) {
    const { project, directory } = await projectFor(mode, mode === 'ready-failure');
    const scopes = new ProjectServiceScopes(machines, vm.id, project);
    const controller = new AbortController();
    const values: any[] = [];
    let stops = 0, committed = false, startFailure: any;
    const events: string[] = [];
    if (mode === 'ready-failure') {
      await runServices(machines, vm.id, project, 'start', () => {}, controller.signal, 'db');
      const dependency = await scopes.status('db');
      values.push(...await children(directory + '/db'));
      events.push('existing-dependency-' + dependency.record!.runId);
    }
    machines.exec = (/** 服务 COMMIT 前核实完整 host pane/cgroup 票据且应用未执行，再按模式注入 prepare/commit/stop 确认丢失或取消；真实连接失败保留清理错误。
 * Before service COMMIT prove complete host pane/cgroup receipts and absent application execution, then inject prepare/commit/stop ACK loss or cancellation by mode; real connection failures retain cleanup errors. */ async (id, command, timeout, signal, output, agent) => {
      const input = request(command);
      if (input?.op === 'stop') {
        ++stops;
        if ((mode === 'first-stop-failure' && stops === 1) || mode === 'all-stop-failures' || mode === 'prepared-timeout') {
          await failConnection(command);
          events.push('real-stop-connection-failed');
          throw new Error('owned service cleanup SSH connection failed');
        }
      }
      if (input?.op === 'commit') {
        assert.equal((await nativeExec(vm.id, 'test -f ' + quote(directory + '/main.json'), 5000)).code, 1, 'Application executed before host COMMIT');
        const host = JSON.parse(await readFile(scopes.receipt(input.name), 'utf8'));
        assert.equal(host.panePid, input.record.panePid);
        assert.equal(host.inode, input.record.inode);
        assert.equal(await run('cat /proc/' + host.panePid + '/cgroup'), '0::/' + host.scopeName);
        events.push('full-host-receipt-and-cgroup-confirmed-before-commit');
        if (mode === 'prepared-timeout') throw new Error('owned COMMIT withheld');
      }
      const result = await nativeExec(id, command, timeout, signal, output, agent);
      if (input?.op === 'prepare' && mode === 'prepare-ack-lost' && result.code === 0) throw new Error('owned prepare acknowledgement lost');
      if (input?.op === 'commit' && result.code === 0) {
        committed = true;
        if (mode === 'commit-ack-lost' || mode === 'cancel-after-commit') {
          values.push(...await children(directory));
          if (mode === 'commit-ack-lost') throw new Error('owned commit acknowledgement lost');
          controller.abort(new Error('owned service cancellation'));
        }
      }
      if (input?.op === 'stop' && mode === 'stop-ack-lost' && stops === 1 && result.code === 0) throw new Error('owned stop acknowledgement lost');
      return result;
    }) as typeof machines.exec;
    machines.execInput = (/** 服务 pane 真实 start 完成后按模式丢一次 stdin 回应，原正文与其他调用不变，检验未确认 pane 的精确回滚。
 * Lose one stdin reply by mode only after real service-pane start, leaving original body/other calls unchanged to test exact rollback of an unacknowledged pane. */ async (id, command, input, ...rest) => {
      const result = await nativeInput(id, command, input, ...rest);
      if (request(command)?.op === 'start' && mode === 'pane-ack-lost' && result.code === 0)
        throw new Error('owned pane acknowledgement lost');
      return result;
    }) as typeof machines.execInput;
    if (['prepare-ack-lost', 'pane-ack-lost', 'commit-ack-lost', 'cancel-after-commit', 'prepared-timeout', 'ready-failure'].includes(mode)) {
      await assert.rejects(runServices(machines, vm.id, project, 'start', () => {}, controller.signal, 'api'), (error: any) => { startFailure = error; return true; });
      if (mode === 'prepared-timeout') {
        assert.equal(startFailure.code, 'SERVICE_CLEANUP_FAILED');
        assert.equal(stops, 3);
        const host = JSON.parse(await readFile(scopes.receipt('api'), 'utf8'));
        const expire = Date.now() + 38000;
        while (await pidAlive(host.panePid, host.paneStartTicks)) {
          if (Date.now() > expire) throw new Error('Uncommitted pane did not end within its finite timeout');
          await delay(500);
        }
        assert.equal((await nativeExec(vm.id, 'test -f ' + quote(directory + '/main.json'))).code, 1);
        assert.equal(JSON.parse(await readFile(scopes.receipt('api'), 'utf8')).phase, 'prepared');
        events.push('uncommitted-pane-ended-without-project-code-and-receipt-retained');
        machines.exec = nativeExec;
        await runServices(machines, vm.id, project, 'stop', () => {}, new AbortController().signal, 'api');
      } else {
        assert.notEqual(startFailure.code, 'SERVICE_CLEANUP_FAILED', startFailure.message);
        assert.equal((await scopes.status('api')).status, 'stopped');
        if (mode === 'prepare-ack-lost' || mode === 'pane-ack-lost') {
          assert.equal((await nativeExec(vm.id, 'test -f ' + quote(directory + '/main.json'))).code, 1);
          events.push('project-code-never-ran');
        }
        if (mode === 'ready-failure') {
          assert.match(startFailure.message, /就绪检查超时/);
          const dependency = await scopes.status('db');
          assert.ok(events.includes('existing-dependency-' + dependency.record!.runId));
          for (const child of values) assert.equal(await pidAlive(child.pid, child.startTicks), true);
          events.push('existing-dependency-preserved');
          values.length = 0;
          values.push(...await children(directory));
          await verifyChildrenStopped(values);
          machines.exec = nativeExec;
          await runServices(machines, vm.id, project, 'stop', () => {}, new AbortController().signal);
        } else await verifyChildrenStopped(values);
      }
    } else {
      await runServices(machines, vm.id, project, 'start', () => {}, controller.signal, 'api');
      assert.equal(committed, true);
      values.push(...await children(directory));
      const state = await scopes.status('api');
      assert.equal(state.status, 'running');
      for (const child of values) {
        assert.equal(child.cgroup, '0::/' + state.record!.scopeName);
        assert.equal(child.environment, mode);
      }
      assert.notEqual(values[0].session, values[1].session);
      assert.notEqual(values[0].session, values[2].session);
      if (mode === 'all-stop-failures') {
        const hostBefore = await readFile(scopes.receipt('api'), 'utf8');
        await assert.rejects(runServices(machines, vm.id, project, 'stop', () => {}, controller.signal), { code: 'SERVICE_CLEANUP_FAILED' });
        assert.equal(stops, 3);
        assert.equal(await readFile(scopes.receipt('api'), 'utf8'), hostBefore);
        for (const child of values) assert.equal(await pidAlive(child.pid, child.startTicks), true);
        machines.exec = nativeExec;
        events.push('persistent-ready-service-not-killed-after-unconfirmed-control');
      }
      await runServices(machines, vm.id, project, 'stop', () => {}, controller.signal);
      await verifyChildrenStopped(values);
      if (mode === 'first-stop-failure' || mode === 'stop-ack-lost') assert.equal(stops, 2);
      if (mode === 'normal') await runServices(machines, vm.id, project, 'stop', () => {}, controller.signal);
      assert.equal((await scopes.status('api')).status, 'stopped');
    }
    machines.exec = nativeExec; machines.execInput = nativeInput;
    assert.equal(await pidAlive(unrelated.pid, unrelated.ticks), true);
    proof.cases.push({ name: mode, stops, events, children: values, failure: startFailure?.message });
    console.log('PASS ' + mode + ': owned persistent scope lifecycle and unrelated process preserved.');
  }
  for (const changed of ['runId', 'bootId', 'inode'] as const) {
    const { project, directory } = await projectFor('replaced-' + changed);
    const scopes = new ProjectServiceScopes(machines, vm.id, project), controller = new AbortController();
    await runServices(machines, vm.id, project, 'start', () => {}, controller.signal);
    const values = await children(directory), record = (await scopes.status('api')).record!;
    const ownerFile = projectServiceScopePaths(project, 'api').guest + '/owner.json';
    const original = await run('cat ' + quote(ownerFile)), altered = JSON.parse(original);
    altered[changed] = changed === 'inode' ? String(Number(altered.inode) + 100000) : randomUUID();
    if (changed === 'runId') altered.scopeName = 'sakura-service-' + altered.runId;
    await run('printf %s ' + quote(JSON.stringify(altered)) + ' > ' + quote(ownerFile));
    const hostBefore = await readFile(scopes.receipt('api'), 'utf8');
    await assert.rejects(scopes.stop(record), { code: 'SERVICE_CLEANUP_FAILED' });
    assert.equal(await readFile(scopes.receipt('api'), 'utf8'), hostBefore);
    for (const child of values) assert.equal(await pidAlive(child.pid, child.startTicks), true);
    await run('printf %s ' + quote(original) + ' > ' + quote(ownerFile));
    await runServices(machines, vm.id, project, 'stop', () => {}, controller.signal);
    await verifyChildrenStopped(values);
    proof.cases.push({ name: 'replaced-' + changed, rejectedBeforeSignaling: true, children: values });
    console.log('PASS replaced-' + changed + ': real guest owner mismatch refused before signaling.');
  }
  for (const partial of ['prepare', 'pane']) {
    const { project, directory } = await projectFor('partial-host-' + partial);
    const scopes = new ProjectServiceScopes(machines, vm.id, project), controller = new AbortController();
    const initial = await scopes.status('api'), intent = scopes.intent(project.services![0], initial.bootId);
    machines.exec = (/** 真实 prepare 成功后在指定部分事务模式中模拟调用方丢失；已形成的原生准备票据仍须被恢复与清理。
 * Model caller loss after real prepare succeeds in the selected partial-transaction mode; the resulting original native preparation receipt still requires recovery/cleanup. */ async (id, command, timeout, signal, output, agent) => {
      const result = await nativeExec(id, command, timeout, signal, output, agent);
      const op = request(command)?.op;
      if (result.code === 0 && op === 'prepare' && partial === 'prepare') throw new Error('owned caller lost after ' + partial);
      return result;
    }) as typeof machines.exec;
    machines.execInput = (/** 真实 pane start 成功后模拟调用方在 pane 阶段丢失，保留入场副作用并验证后续恢复能定位该原 pane。
 * Model caller loss at pane stage only after real start succeeds, retaining admission side effects so recovery must locate that original pane. */ async (id, command, input, ...rest) => {
      const result = await nativeInput(id, command, input, ...rest);
      if (result.code === 0 && request(command)?.op === 'start' && partial === 'pane') throw new Error('owned caller lost after ' + partial);
      return result;
    }) as typeof machines.execInput;
    await scopes.persistIntent(intent);
    const payload = await new ProjectRunScopes(machines).inherited(vm.id, project,
      { command: app(directory), environment: project.environment },
      { kind: 'service', runId: intent.runId, bootId: intent.bootId });
    await assert.rejects(scopes.start(intent, payload, controller.signal), /owned caller lost/);
    machines.exec = nativeExec; machines.execInput = nativeInput;
    const before = JSON.parse(await readFile(scopes.receipt('api'), 'utf8'));
    assert.equal(before.phase, partial === 'prepare' ? 'intent' : 'prepared');
    assert.equal(before.panePid, null);
    assert.equal((await nativeExec(vm.id, 'test -f ' + quote(directory + '/main.json'))).code, 1);
    await runServices(machines, vm.id, project, 'stop', () => {}, controller.signal);
    assert.equal((await scopes.status('api')).status, 'stopped');
    proof.cases.push({ name: 'partial-host-' + partial, interruptedCallerRecovered: true, projectCodeNeverRan: true });
    console.log('PASS partial-host-' + partial + ': later manual stop recovered the persisted intent and guest ownership.');
  }
  {
    const { project, directory } = await projectFor('late-prepare-cancelled');
    const controller = new AbortController(), scopes = new ProjectServiceScopes(machines, vm.id, project);
    let deferred = '';
    machines.exec = (/** 截住自有 prepare 命令并延后交付，其他 exec 透明转发；用于证明已失败事务的迟到 prepare 不能复活正文。
 * Intercept/delay the owned prepare command while forwarding other exec transparently, proving late prepare delivery cannot revive a failed transaction’s body. */ async (id, command, timeout, signal, output, agent) => {
      if (request(command)?.op === 'prepare') { deferred = command; throw new Error('owned prepare delivery delayed'); }
      return nativeExec(id, command, timeout, signal, output, agent);
    }) as typeof machines.exec;
    await assert.rejects(runServices(machines, vm.id, project, 'start', () => {}, controller.signal), /owned prepare delivery delayed/);
    machines.exec = nativeExec;
    assert.ok(deferred);
    const late = await nativeExec(vm.id, deferred);
    assert.notEqual(late.code, 0);
    assert.match(late.stderr, /启动已取消/);
    assert.equal((await scopes.status('api')).status, 'stopped');
    assert.equal((await nativeExec(vm.id, 'test -f ' + quote(directory + '/main.json'))).code, 1);
    proof.cases.push({ name: 'late-prepare-cancelled', cancelledBeforeReceiptFenceVerified: true, projectCodeNeverRan: true });
    console.log('PASS late-prepare-cancelled: a deferred remote prepare could not run after confirmed cancellation.');
  }
  {
    const { project, directory } = await projectFor('exited-main-pane');
    const scopes = new ProjectServiceScopes(machines, vm.id, project), controller = new AbortController();
    await runServices(machines, vm.id, project, 'start', () => {}, controller.signal);
    const values = await children(directory);
    await run(py(`import os,signal\npid=${values[0].pid}\nfd=os.pidfd_open(pid)\nassert open('/proc/'+str(pid)+'/stat').read().rsplit(') ',1)[1].split()[19]==${JSON.stringify(values[0].startTicks)}\nsignal.pidfd_send_signal(fd,signal.SIGKILL)\nos.close(fd)`));
    await delay(300);
    assert.equal((await scopes.status('api')).status, 'exited');
    assert.equal(await pidAlive(values[1].pid, values[1].startTicks), true);
    assert.equal(await pidAlive(values[2].pid, values[2].startTicks), true);
    await assert.rejects(runServices(machines, vm.id, project, 'start', () => {}, controller.signal), /主 pane 已退出/);
    await runServices(machines, vm.id, project, 'stop', () => {}, controller.signal);
    await verifyChildrenStopped(values);
    proof.cases.push({ name: 'exited-main-pane', detachedChildrenRetainedOwnership: true, explicitStopConfirmed: true });
    console.log('PASS exited-main-pane: detached descendants remain owned after the tmux pane ends.');
  }
  {
    const { project, directory } = await projectFor('replacement-after-lost-stop');
    const scopes = new ProjectServiceScopes(machines, vm.id, project), controller = new AbortController();
    await runServices(machines, vm.id, project, 'start', () => {}, controller.signal);
    const values = await children(directory), record = (await scopes.status('api')).record!;
    const scope = '/sys/fs/cgroup/' + record.scopeName, marker = directory + '/replacement.json';
    let replaced = false;
    machines.exec = (/** 真实 stop 成功后建立同名新 cgroup 和无关自有进程，再丢原回应；重试必须识别原 inode 消失并保护替代域，不能按名字杀新对象。
 * After real stop succeeds create a same-name new cgroup/unrelated owned process and lose the old reply; retries must recognize original-inode disappearance and preserve replacement domains rather than kill by name. */ async (id, command, timeout, signal, output, agent) => {
      const result = await nativeExec(id, command, timeout, signal, output, agent);
      if (request(command)?.op === 'stop' && result.code === 0 && !replaced) {
        replaced = true;
        await run('mkdir ' + quote(scope));
        await run('setsid ' + py(`import json,os,time\nopen(${JSON.stringify(scope + '/cgroup.procs')},'w').write(str(os.getpid()))\nopen(${JSON.stringify(marker)},'w').write(json.dumps({'pid':os.getpid(),'ticks':open('/proc/self/stat').read().rsplit(') ',1)[1].split()[19],'inode':str(os.stat(${JSON.stringify(scope)}).st_ino)}))\nwhile True:time.sleep(1)`) + ' </dev/null >/dev/null 2>&1 &');
        await waitFile(marker);
        throw new Error('owned stop ACK lost after replacement scope created');
      }
      return result;
    }) as typeof machines.exec;
    await assert.rejects(runServices(machines, vm.id, project, 'stop', () => {}, controller.signal), { code: 'SERVICE_CLEANUP_FAILED' });
    machines.exec = nativeExec;
    const replacement = JSON.parse(await run('cat ' + quote(marker)));
    assert.notEqual(replacement.inode, record.inode);
    assert.equal(await pidAlive(replacement.pid, replacement.ticks), true);
    await verifyChildrenStopped(values);
    await run(py(`import os,time\npath=${JSON.stringify(scope)}\nassert str(os.stat(path).st_ino)==${JSON.stringify(replacement.inode)}\nopen(path+'/cgroup.kill','w').write('1')\nwhile 'populated 1' in open(path+'/cgroup.events').read():time.sleep(0.05)\nos.rmdir(path)`));
    await scopes.stop(record);
    proof.cases.push({ name: 'replacement-after-lost-stop', originalChildrenEnded: true, replacementPreserved: true, oldInode: record.inode, newInode: replacement.inode });
    console.log('PASS replacement-after-lost-stop: retried cleanup preserved the new kernel cgroup and its owned process.');
  }
  {
    const { project, directory } = await projectFor('workspaces-binding');
    await workspaces.save(vm.id, project);
    const controller = new AbortController(), scopes = new ProjectServiceScopes(machines, vm.id, project);
    await runServices(machines, vm.id, project, 'start', () => {}, controller.signal);
    const values = await children(directory);
    await run(py(`import os,signal\npid=${values[0].pid}\nfd=os.pidfd_open(pid)\nassert open('/proc/'+str(pid)+'/stat').read().rsplit(') ',1)[1].split()[19]==${JSON.stringify(values[0].startTicks)}\nsignal.pidfd_send_signal(fd,signal.SIGKILL)\nos.close(fd)`));
    await delay(300);
    await run('printf %s ' + quote('owned service application trace\n') + ' >> ' + quote(serviceLog('api', project)));
    const runtime = await workspaces.runtime(vm.id);
    assert.equal(runtime.status, 'exited');
    assert.equal(runtime.services![0].status, 'exited');
    assert.match(runtime.services![0].log, /owned service application trace/);
    for (const next of [
      { ...project, services: [] }, { ...project, directory: directory + '-changed' },
      { ...project, networkIsolation: 'host' },
      { ...project, services: [{ ...project.services![0], command: 'sleep 600' }] },
    ]) await assert.rejects(workspaces.save(vm.id, next), { code: 'SERVICE_SCOPE_CHANGED' });
    await runServices(machines, vm.id, project, 'stop', () => {}, controller.signal);
    await verifyChildrenStopped(values);
    assert.equal((await workspaces.runtime(vm.id)).status, 'stopped');
    await workspaces.save(vm.id, { ...project, directory: directory + '-changed', networkIsolation: 'host', services: [] });
    proof.cases.push({ name: 'workspaces-binding', exitedStatusAndLogPreserved: true, removalDirectoryNetworkCommandRefusedWhileOwned: true, editsAllowedAfterConfirmedStop: true });
    console.log('PASS workspaces-binding: runtime and config guards retained the exited scope until confirmed cleanup.');
  }
  {
    const name = 'legacy', project = projectSchema.parse({ directory: base, services: [{ name, command: 'sleep 600' }] });
    const session = serviceSession(name, project);
    await run('tmux new-session -d -s ' + session + ' sleep 600');
    await workspaces.save(vm.id, project);
    const legacyRuntime = await workspaces.runtime(vm.id);
    assert.equal(legacyRuntime.services![0].status, 'migration-required');
    await assert.rejects(workspaces.save(vm.id, { ...project, services: [] }), { code: 'SERVICE_SCOPE_UNMANAGED' });
    const pane = await run("tmux list-panes -t =" + session + " -F '#{pane_pid}'");
    for (const action of ['start', 'stop'] as const)
      await assert.rejects(runServices(machines, vm.id, project, action, () => {}, new AbortController().signal), { code: 'SERVICE_SCOPE_UNMANAGED' });
    assert.equal(await pidAlive(Number(pane)), true);
    await run('tmux kill-session -t =' + session);
    proof.cases.push({ name: 'unknown-legacy-session', startAndStopRefused: true, ownedLegacyPanePreserved: true });
    console.log('PASS unknown-legacy-session: no inferred ownership or false cleanup success.');
  }
} catch (error) {
  proof.error = String(error); throw error;
} finally {
  machines.exec = nativeExec; machines.execInput = nativeInput;
  await workspaces.close();
  await machines.close();
  proof.vmStopped = machines.state(vm.id) === 'stopped'; proof.stoppedAt = new Date().toISOString();
  await writeFile(join(root, 'project-services-uid-scope-evidence.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log('Persistent UID service scope proof:', join(root, 'project-services-uid-scope-evidence.json'));
}
