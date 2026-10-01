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
const run = async (command: string, timeout = 30000) => {
  const result = await nativeExec(vm.id, command, timeout);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  return result.stdout.trim();
};
const py = (source: string) => '/usr/bin/python3 -I -S -c ' + quote(source);
const request = (command: string) => {
  const line = command.split('\n').find(value => value.startsWith('# SAKURA_PROJECT_SERVICE_REQUEST='));
  return line ? JSON.parse(Buffer.from(line.split('=')[1], 'base64').toString()) : null;
};
const failConnection = async (command: string) => {
  const live = machines.live.get(vm.id)!, saved = live.sshPort;
  live.sshPort = await freePort();
  try { await assert.rejects(nativeExec(vm.id, command, 350), /ECONNREFUSED|refused|timed out/); }
  finally { live.sshPort = saved; }
};
const pidAlive = async (pid: number, ticks?: string) =>
  (await run(py(`try:\n fields=open('/proc/${pid}/stat').read().rsplit(') ',1)[1].split()\n print(fields[0] not in ['Z','X']${ticks ? ` and fields[19]==${JSON.stringify(ticks)}` : ''})\nexcept FileNotFoundError: print(False)`))) === 'True';
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
const children = async (directory: string) => {
  const values: any[] = [];
  for (const name of ['main', 'setsid', 'doublefork']) {
    const file = directory + '/' + name + '.json';
    await waitFile(file);
    values.push(JSON.parse(await run('cat ' + quote(file))));
  }
  return values;
};
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
    machines.exec = (async (id, command, timeout, signal, output, agent) => {
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
    machines.execInput = (async (id, command, input, ...rest) => {
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
    machines.exec = (async (id, command, timeout, signal, output, agent) => {
      const result = await nativeExec(id, command, timeout, signal, output, agent);
      const op = request(command)?.op;
      if (result.code === 0 && op === 'prepare' && partial === 'prepare') throw new Error('owned caller lost after ' + partial);
      return result;
    }) as typeof machines.exec;
    machines.execInput = (async (id, command, input, ...rest) => {
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
    machines.exec = (async (id, command, timeout, signal, output, agent) => {
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
    machines.exec = (async (id, command, timeout, signal, output, agent) => {
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
