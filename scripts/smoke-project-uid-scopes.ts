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
runtime.run = (async (...args: Parameters<typeof nativeRuntimeRun>) => {
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
const run = async (command: string, timeout = 30000) => { const result = await nativeExec(vm.id, command, timeout); assert.equal(result.code, 0, result.stderr + result.stdout); return result.stdout.trim(); };
const py = (source: string) => '/usr/bin/python3 -I -S -c ' + quote(source);
const savedProject = await spaces.config(vm.id);
const base = /^\/workspace\/uid-scope-[a-f0-9-]{36}$/.test(savedProject.directory)
  ? savedProject.directory : '/workspace/uid-scope-' + invocation;
const caseDirectory = (label: string) => base + '/' + label + '-' + invocation;
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
const waitFile = async (path: string) => { for (let i = 0; i < 120; ++i) { if ((await nativeExec(vm.id, 'test -f ' + quote(path), 5000)).code === 0) return; await delay(50); } throw new Error('Owned fixture did not publish ' + path); };
const children = async (label: string) => { const values: any[] = []; for (const name of ['main', 'newgroup', 'setsid', 'doublefork']) { const file = caseDirectory(label) + '/' + name + '.json'; await waitFile(file); values.push(JSON.parse(await run('cat ' + quote(file)))); } return values; };
const alive = async (child: any) => (await run(py(`try:\n f=open('/proc/${child.pid}/stat').read().rsplit(') ',1)[1].split();print(f[0] not in ['Z','X'] and f[19]==${JSON.stringify(child.ticks)})\nexcept FileNotFoundError:print(False)`))) === 'True';
const allStopped = async (values: any[]) => { for (const child of values) assert.equal(await alive(child), false); };
const project = (label: string, exitMain = false) => projectSchema.parse({ directory: base, command: app(label, exitMain), networkIsolation: 'private', environment: { TOKEN: canary }, setup: py(`import json,os\nopen('setup.json','w').write(json.dumps({'uid':os.getuid(),'home':os.environ.get('HOME')}))`) });
const job = async (action: 'start' | 'stop', service?: string) => { const value = await spaces.run(vm.id, action, service); await spaces.jobs.wait(spaces.projects.key(vm.id)); assert.equal((value.error || '').includes(canary), false); assert.equal(value.log.includes(canary), false); return value; };
const done = async (action: 'start' | 'stop', service?: string) => { const value = await job(action, service); assert.equal(value.status, 'done', value.error + '\n' + value.log); return value; };
const check = async (name: string, action: () => Promise<unknown>) => { const startedAt = new Date().toISOString(); const evidence = await action(); proof.cases.push({ name, startedAt, finishedAt: new Date().toISOString(), evidence }); await writeFile(join(root, `project-uid-scopes-evidence-${invocation}.json`), JSON.stringify(proof, null, 2) + '\n'); console.log('PASS ' + distro + ' ' + name); };
const request = (command: string) => { const line = command.split('\n').find(value => /^# SAKURA_PROJECT_(MAIN|SERVICE)_REQUEST=/.test(value)); return line ? JSON.parse(Buffer.from(line.split('=')[1], 'base64').toString()) : null; };
let outside: any, rootTmux: any, identity: any;
const preserve = async () => { assert.equal(await alive(outside), true); assert.equal(await alive(rootTmux), true); };
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
  machines.exec = (async (id, command, ...rest) => { commands.push(command); return nativeExec(id, command, ...rest); }) as typeof machines.exec;
  machines.execInput = (async (id, command, input, ...rest) => { commands.push(command); return nativeInput(id, command, input, ...rest); }) as typeof machines.execInput;
  await check('main-uid-setup-transport-and-idempotence', async () => {
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
  for (const mode of ['prepare', 'pane', 'commit', 'first-stop']) await check('main-' + mode + '-lost-connection-recovery', async () => {
    const p = project(mode); await spaces.save(vm.id, p); let injected = 0; const original = machines.exec;
    const inject = (command: string, result: { code: number }) => { const input = request(command); if (input?.op === (mode === 'pane' ? 'start' : mode) && result.code === 0 && ++injected === 1) throw new Error('owned ' + mode + ' reply lost'); };
    machines.exec = (async (id, command, ...rest) => {
      if (mode === 'first-stop' && request(command)?.op === 'stop' && ++injected === 1) {
        const live = machines.live.get(vm.id)!, saved = live.sshPort; live.sshPort = await freePort();
        try { await assert.rejects(nativeExec(id, command, 350), /refused|ECONNREFUSED|timed out/); } finally { live.sshPort = saved; }
        throw new Error('owned first cleanup connection failed');
      }
      const result = await original(id, command, ...rest); inject(command, result); return result;
    }) as typeof machines.exec;
    const originalInput = machines.execInput;
    machines.execInput = (async (id, command, input, ...rest) => { const result = await originalInput(id, command, input, ...rest); inject(command, result); return result; }) as typeof machines.execInput;
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
  await check('service-main-isolation-and-uid-readiness', async () => {
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
  for (const mode of ['prepare', 'pane', 'commit', 'first-stop']) await check('service-' + mode + '-lost-connection-recovery', async () => {
    const label = 'service-' + mode, p = { ...project(label), services: [{ name: 'api', command: app(label), dependsOn: [], ready: '', timeout: 5 }] };
    await spaces.save(vm.id, p); let injected = 0; const original = machines.exec, originalInput = machines.execInput;
    const values: any[] = [];
    const inject = async (command: string, result: { code: number }) => {
      const input = request(command);
      if (input?.record?.version !== 1 || input.op !== (mode === 'pane' ? 'start' : mode) || result.code !== 0 || ++injected !== 1) return;
      if (mode === 'commit') values.push(...await children(label));
      throw new Error('owned service ' + mode + ' reply lost');
    };
    machines.exec = (async (id, command, ...rest) => {
      if (mode === 'first-stop' && request(command)?.record?.version === 1 && request(command)?.op === 'stop' && ++injected === 1) {
        const live = machines.live.get(vm.id)!, saved = live.sshPort; live.sshPort = await freePort();
        try { await assert.rejects(nativeExec(id, command, 350), /refused|ECONNREFUSED|timed out/); } finally { live.sshPort = saved; }
        throw new Error('owned first service cleanup connection failed');
      }
      const result = await original(id, command, ...rest); await inject(command, result); return result;
    }) as typeof machines.exec;
    machines.execInput = (async (id, command, input, ...rest) => { const result = await originalInput(id, command, input, ...rest); await inject(command, result); return result; }) as typeof machines.execInput;
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
  await check('network-release-lost-reply-and-same-boot-new-generation', async () => {
    const p = project('network-old'); await spaces.save(vm.id, p); await done('start');
    const oldValues = await children('network-old'), core = new ProjectIdentities(machines), oldNetwork = await core.network(vm.id, identity);
    assert.ok(oldNetwork); let lost = 0; const original = machines.exec;
    machines.exec = (async (id, command, ...rest) => {
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
  await check('checkout-setup-and-main-use-project-account', async () => {
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
  await check('cold-reboot-retires-exact-main-and-service-tickets', async () => {
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
