import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, realpath, writeFile, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyReleaseManifest } from './release-manifest.mjs';

const flags = process.argv.slice(2).filter(value => value.startsWith('--'));
assert.ok(flags.every(value => value === '--no-addons'), 'Unknown smoke option.');
const args = process.argv.slice(2).filter(value => !value.startsWith('--'));
assert.ok(args.length >= 1 && args.length <= 2, 'Pass a stopped main-scope fixture and optional release root.');
const data = await realpath(resolve(args[0]));
assert.equal(dirname(data), await realpath(resolve('.data/network-remaining-test-temp')));
assert.match(basename(data), /^sakura-guest-task-[A-Za-z0-9_-]+$/);
const prior = JSON.parse(await readFile(join(data, 'project-main-scope-evidence.json'), 'utf8'));
assert.equal(prior.vmStopped, true);
assert.ok(!prior.error);
assert.ok(prior.cases.length > 0);
const expectedSources = ['server/project-main.ts', 'server/project-service-scope.ts',
  'server/project-services.ts', 'server/workspaces.ts'];
assert.deepEqual(Object.keys(prior.sourceSha256).sort(), expectedSources.sort());
for (const [name, digest] of Object.entries(prior.sourceSha256)) {
  assert.equal(createHash('sha256').update(await readFile(resolve(name))).digest('hex'), digest, name);
}
const sourceSha256 = { ...prior.sourceSha256, 'server/jobs.ts':
  createHash('sha256').update(await readFile(resolve('server/jobs.ts'))).digest('hex') };
const records = JSON.parse(await readFile(join(data, 'machines.json'), 'utf8'));
assert.equal(records.length, 1);
const vm = records[0];
assert.equal(vm.id, prior.vmId);
assert.equal(vm.name, 'guest-task-cgroup-smoke');
assert.equal(vm.distro, prior.distro);
const serverRoot = resolve(args[1] || '.');
const release = args[1] ? await verifyReleaseManifest(serverRoot) : null;
const serverSha256 = createHash('sha256').update(await readFile(join(serverRoot, '.sakura-server/index.js'))).digest('hex');
const pluginFile = join(data, 'plugins.json');
const previous = await readFile(pluginFile).catch(error => {
  if (error.code !== 'ENOENT') throw error;
});
await writeFile(pluginFile, JSON.stringify({ schemaVersion: 3, plugins: ['projects'], packs: [] }));
const listener = createServer();
await new Promise((done, fail) => listener.once('error', fail).listen(0, '127.0.0.1', done));
const port = listener.address().port;
await new Promise(done => listener.close(done));
const origin = 'http://127.0.0.1:' + port;
const childArgs = flags.includes('--no-addons') ? ['--no-addons'] : [];
childArgs.push('.sakura-server/index.js');
const server = spawn(process.execPath, childArgs, {
  cwd: serverRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, SAKURA_DATA_DIR: data, SAKURA_PORT: String(port),
    SAKURA_IMAGE_DIR: resolve('.data/images'), SAKURA_IMAGE_PATH: resolve('.data/images/' + {
      alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2',
    }[vm.distro]) },
});
let output = '', sdk, token = '', previousActive = '', stopped = false, started = false, failure = null;
const projects = [], checks = [], path = { vmId: vm.id };
server.stdout.on('data', chunk => output = (output + chunk).slice(-65536));
server.stderr.on('data', chunk => output = (output + chunk).slice(-65536));
const exited = new Promise((done, fail) => { server.once('exit', done); server.once('error', fail); });
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
async function http(url, method = 'GET', body) {
  const result = await fetch(origin + url, { method,
    headers: { 'x-sakura-token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  assert.equal(result.ok, true, await result.clone().text());
  return result.json();
}
async function guest(command) {
  const result = await sdk.call('core.vms.exec', { path, body: { scope: 'instance', command } });
  assert.equal(result.code, 0, result.stderr + result.stdout);
  return result.stdout.trim();
}
const py = source => '/usr/bin/python3 -I -S -c ' + quote(source);
const methods = { view: 'GET', save: 'PUT', action: 'POST', runtime: 'GET' };
const call = (operation, project, body) => sdk.request('/api/vms/' + vm.id + '/' +
  (operation === 'runtime' ? 'project-runtime' : 'project'), {
    method: methods[operation], query: { project }, ...(body ? { body } : {}),
  });
async function action(project, operation) {
  const initial = await call('action', project, { action: operation });
  const deadline = Date.now() + 240000;
  for (;;) {
    const view = await call('view', project);
    assert.equal(view.job.id, initial.id);
    if (view.job.status !== 'running') return view.job;
    assert.ok(Date.now() < deadline, 'Project job timed out.');
    assert.equal(server.exitCode, null, output);
    await delay(100);
  }
}
async function waitFile(file) {
  for (let n = 0; n < 150; ++n) {
    const result = await sdk.call('core.vms.exec', { path, body: {
      scope: 'instance', command: 'test -f ' + quote(file) + ' && cat ' + quote(file) } });
    if (result.code === 0) return JSON.parse(result.stdout);
    await delay(100);
  }
  throw Error('Owned main process marker did not arrive.');
}
const app = directory => py([
  'import json,os,signal,time',
  'signal.signal(signal.SIGTERM,signal.SIG_IGN)',
  'signal.signal(signal.SIGHUP,signal.SIG_IGN)',
  'def report(name):',
  " fields=open('/proc/self/stat').read().rsplit(') ',1)[1].split()",
  " record={'pid':os.getpid(),'ticks':fields[19],'group':os.getpgrp(),'session':os.getsid(0),",
  "  'net':os.readlink('/proc/self/ns/net'),'cgroup':open('/proc/self/cgroup').read().strip(),",
  "  'environment':os.environ.get('SAKURA_OWNED_MAIN_TEST')}",
  ' path=' + JSON.stringify(directory) + "+'/'+name+'.json'",
  " with open(path+'.tmp','w') as stream:json.dump(record,stream);stream.flush();os.fsync(stream.fileno())",
  " os.replace(path+'.tmp',path)",
  'def stay():',
  ' while True:time.sleep(1)',
  "report('main')",
  'if os.fork()==0:',
  " os.setsid();report('setsid');stay()",
  'first=os.fork()',
  'if first==0:',
  ' os.setsid()',
  ' if os.fork()!=0:os._exit(0)',
  " report('doublefork');stay()",
  'os.waitpid(first,0)',
  'stay()',
].join('\n'));
const alive = process => guest(py([
  'try:',
  " fields=open('/proc/" + process.pid + "/stat').read().rsplit(') ',1)[1].split()",
  " print(fields[0] not in ['Z','X'] and fields[19]==" + JSON.stringify(process.ticks) + ')',
  'except FileNotFoundError:print(False)',
].join('\n')));
try {
  for (let n = 0; n < 150 && !token; ++n) {
    assert.equal(server.exitCode, null, output);
    try {
      const result = await fetch(origin + '/api/bootstrap', { signal: AbortSignal.timeout(1000) });
      if (result.ok) token = (await result.json()).token;
    } catch {}
    if (!token) await delay(200);
  }
  assert.ok(token, output);
  const generated = await http('/api/sdk');
  const { SakuraClient } = await import('data:text/javascript;base64,' + Buffer.from(generated.content).toString('base64'));
  sdk = new SakuraClient({ baseUrl: origin });
  const spec = await http('/api/openapi');
  for (const suffix of ['project', 'project-runtime']) {
    const route = spec['x-sakura-route-prefixes'].find(item => item.owner === 'projects' &&
      item.path === '/api/vms/:vmId/' + suffix);
    assert.equal(route?.enabled, true, 'Project route is enabled in the compiled document.');
    assert.equal(route.projectScoped, true);
  }
  await sdk.call('core.vms.start', { path });
  started = true;
  const bootDeadline = Date.now() + 300000;
  while ((await sdk.call('core.vms.get', { path })).status !== 'running') {
    assert.ok(Date.now() < bootDeadline, 'Owned VM startup timed out.');
    await delay(1000);
  }
  previousActive = (await http('/api/vms/' + vm.id + '/projects')).active;
  for (const label of ['main', 'neighbor']) {
    const directory = '/workspace/main-http-' + randomUUID();
    const config = { directory, template: 'none', repository: '', setup: '', command: app(directory),
      networkIsolation: 'private', environment: { SAKURA_OWNED_MAIN_TEST: label } };
    const created = await http('/api/vms/' + vm.id + '/projects', 'POST', {
      action: 'create', name: 'Owned main HTTP ' + label + ' ' + randomUUID().slice(0, 8), config });
    const projectId = created.active;
    projects.push(projectId);
    await assert.rejects(call('action', projectId, { action: 'start', unexpected: true }), error => error.status === 400);
    const job = await action(projectId, 'start');
    assert.equal(job.status, 'done', job.error || job.log);
    const processes = [];
    for (const name of ['main', 'setsid', 'doublefork']) processes.push(await waitFile(directory + '/' + name + '.json'));
    const ownerPath = '/run/sakura-project-main/' + projectId + '/owner.json';
    const owner = JSON.parse(await guest('cat ' + quote(ownerPath)));
    assert.equal(owner.kind, 'main');
    assert.equal(owner.version, 2);
    assert.equal(owner.phase, 'running');
    const net = await guest('ip netns exec sk-' + projectId + ' readlink /proc/self/ns/net');
    for (const process of processes) {
      assert.equal(process.net, net);
      assert.equal(process.environment, label);
      assert.equal(process.cgroup, '0::/' + owner.scopeName);
    }
    const runtime = await call('runtime', projectId);
    assert.equal(runtime.status, 'running');
    assert.equal(runtime.main.status, 'running');
    checks.push({ name: label + '-registered-processes', projectId, processes, owner });
    if (label === 'main') {
      assert.equal((await action(projectId, 'start')).status, 'done');
      assert.equal(JSON.parse(await guest('cat ' + quote(ownerPath))).runId, owner.runId);
      await assert.rejects(call('save', projectId, { ...config, command: 'sleep 600' }), error => error.status === 409);
      checks.push({ name: 'idempotent-start-and-binding-edit-refusal' });
    }
  }
  const current = checks.find(item => item.name === 'main-registered-processes');
  const neighbor = checks.find(item => item.name === 'neighbor-registered-processes');
  const ownerPath = '/run/sakura-project-main/' + current.projectId + '/owner.json';
  await guest(py([
    'import json,os',
    'path=' + JSON.stringify(ownerPath),
    "record=json.load(open(path));assert record['runId']==" + JSON.stringify(current.owner.runId),
    "record['bootId']=" + JSON.stringify(randomUUID()),
    "with open(path+'.tmp','w') as stream:json.dump(record,stream)",
    "os.chmod(path+'.tmp',0o600);os.replace(path+'.tmp',path)",
  ].join('\n')));
  const failed = await action(current.projectId, 'stop');
  assert.equal(failed.status, 'error');
  assert.equal(failed.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED');
  assert.equal((await call('runtime', current.projectId)).main.status, 'unconfirmed');
  for (const process of [...current.processes, ...neighbor.processes]) assert.equal(await alive(process), 'True');
  await guest(py([
    'import json,os',
    'path=' + JSON.stringify(ownerPath),
    'original=' + JSON.stringify(JSON.stringify(current.owner)),
    "assert json.load(open(path))['runId']==" + JSON.stringify(current.owner.runId),
    "with open(path+'.tmp','w') as stream:stream.write(original)",
    "os.chmod(path+'.tmp',0o600);os.replace(path+'.tmp',path)",
  ].join('\n')));
  checks.push({ name: 'changed-ownership-failed-job-and-neighbor-preservation', errorCode: failed.errorCode });
  await guest(py([
    'import os,signal',
    'pid=' + current.processes[0].pid,
    'fd=os.pidfd_open(pid)',
    "assert open('/proc/'+str(pid)+'/stat').read().rsplit(') ',1)[1].split()[19]==" + JSON.stringify(current.processes[0].ticks),
    'signal.pidfd_send_signal(fd,signal.SIGKILL);os.close(fd)',
  ].join('\n')));
  for (let n = 0; n < 50; ++n) {
    if ((await call('runtime', current.projectId)).main.status === 'exited') break;
    await delay(100);
  }
  assert.equal((await call('runtime', current.projectId)).status, 'exited');
  assert.equal((await action(current.projectId, 'stop')).status, 'done');
  assert.equal((await call('runtime', current.projectId)).main.status, 'stopped');
  for (const process of current.processes) assert.equal(await alive(process), 'False');
  for (const process of neighbor.processes) assert.equal(await alive(process), 'True');
  checks.push({ name: 'exited-pane-full-cleanup-and-neighbor-preservation' });
  assert.equal((await action(neighbor.projectId, 'stop')).status, 'done');
  for (const process of neighbor.processes) assert.equal(await alive(process), 'False');
  checks.push({ name: 'neighbor-cleanup' });
  console.log('Compiled main HTTP/SDK: private namespaces, registered detached descendants, idempotence, config guard, failed cleanup Job and exact retry passed.');
} catch (error) {
  failure = (error instanceof Error ? error.message : String(error)).slice(0, 4096);
  throw error;
} finally {
  if (sdk) {
    for (const project of projects) await action(project, 'stop').catch(() => {});
    if (previousActive) await http('/api/vms/' + vm.id + '/projects', 'POST', {
      action: 'select', projectId: previousActive }).catch(() => {});
    await guest('sync').catch(() => {});
    await sdk.call('core.vms.stop', { path, body: { force: true } }).catch(() => {});
    stopped = (await sdk.call('core.vms.get', { path }).catch(() => null))?.status === 'stopped';
  }
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([exited, delay(20000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await exited;
  if (previous) await writeFile(pluginFile, previous);
  else await rm(pluginFile, { force: true });
  await writeFile(join(data, 'compiled-project-main-http-evidence.json'), JSON.stringify({
    version: 1, vmId: vm.id, distro: vm.distro, serverRoot, serverSha256, sourceSha256,
    client: { node: process.version, execArgv: process.execArgv },
    fingerprint: release?.fingerprint, serverRuntime: childArgs.includes('--no-addons') ? 'no-addons' : 'default',
    serverExitCode: server.exitCode, serverSignalCode: server.signalCode,
    serverOutput: failure ? output.slice(-16384) : undefined,
    passed: !failure && stopped, vmStopped: stopped, error: failure, checks,
    finishedAt: new Date().toISOString(),
  }, null, 2) + '\n');
  if (started) assert.equal(stopped, true, 'Owned fixture shutdown was not confirmed.');
  if (release) assert.equal((await verifyReleaseManifest(serverRoot)).fingerprint, release.fingerprint);
}
