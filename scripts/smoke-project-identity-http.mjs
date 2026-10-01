import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { verifyReleaseManifest } from './release-manifest.mjs';

assert.equal(process.argv.length, 4, 'Pass the released execution fixture and verified release root.');
assert.ok(!process.execArgv.includes('--no-addons'), 'This smoke verifies the default Node runtime.');
const data = await realpath(resolve(process.argv[2]));
assert.equal(dirname(data), await realpath(resolve('.data/boot-persistence-test-temp')));
assert.equal(basename(data), 'sakura-boot-persistence-53hCt6');
const prior = JSON.parse(await readFile(join(data, 'project-execution-identity-evidence.json'), 'utf8'));
assert.equal(prior.passed, true); assert.equal(prior.cleanup.vmStopped, true);
const vmId = '24230cbf-609b-4823-a6b4-9f599a122dc8';
const records = JSON.parse(await readFile(join(data, 'machines.json'), 'utf8'));
assert.equal(records.length, 1); assert.equal(records[0].id, vmId);
assert.equal(records[0].distro, 'debian'); assert.equal(prior.vmId, vmId);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [file, digest] of Object.entries(prior.sourceSha256))
  assert.equal(sha(await readFile(resolve(file))), digest, file);
const extraSources = ['plugins/projects/server.ts', 'plugins/projects/manifest.ts', 'server/index.ts',
  'server/access-control.ts', 'server/project-permissions.ts', 'server/jobs.ts', 'scripts/smoke-project-identity-http.mjs'];
const sources = { ...prior.sourceSha256 };
for (const file of extraSources) sources[file] = sha(await readFile(resolve(file)));
const serverRoot = await realpath(resolve(process.argv[3]));
const release = await verifyReleaseManifest(serverRoot);
const serverSha256 = sha(await readFile(join(serverRoot, '.sakura-server/index.js')));
const native = JSON.parse(await readFile(join(serverRoot, '.sakura-server/assets/project-identity/manifest.json'), 'utf8'));
for (const file of native.files)
  assert.equal(sha(await readFile(resolve('native/project-identity', file.name))), file.sha256);
const proofPath = join(data, 'compiled-project-identity-http-' + randomUUID() + '.json');
const proof = { version: 1, vmId, distro: 'debian', serverRoot, serverSha256,
  fingerprint: release.fingerprint, identityBuild: native.build, sourceSha256: sources,
  client: { node: process.version, pid: process.pid, execArgv: process.execArgv }, serverRuntime: 'default',
  startedAt: new Date().toISOString(), checks: [], cleanup: {} };
const saved = new Map();
for (const name of ['plugins.json', 'access-control.json', 'project-permissions.json']) {
  const path = join(data, name);
  const bytes = await readFile(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (bytes) assert.ok(bytes.length <= 2 * 1024 * 1024);
  saved.set(path, bytes);
}
const accountState = saved.get(join(data, 'access-control.json'));
assert.ok(!accountState || JSON.parse(accountState).enabled === false, 'Owned fixture must start without account mode.');
await writeFile(join(data, 'plugins.json'), JSON.stringify({ schemaVersion: 3,
  plugins: ['projects', 'service-health'], packs: [] }));
const listener = createServer();
await new Promise((done, fail) => listener.once('error', fail).listen(0, '127.0.0.1', done));
const port = listener.address().port;
await new Promise(done => listener.close(done));
const origin = 'http://127.0.0.1:' + port;
const server = spawn(process.execPath, ['.sakura-server/index.js'], {
  cwd: serverRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, SAKURA_DATA_DIR: data, SAKURA_PORT: String(port),
    SAKURA_IMAGE_DIR: resolve('.data/images'), SAKURA_IMAGE_PATH: resolve('.data/images/debian-12.qcow2') },
});
proof.serverPid = server.pid;
await writeFile(proofPath, JSON.stringify({ ...proof, passed: false }, null, 2) + '\n', { flag: 'wx' });
let output = '', sdk, Client, stopped = false, started = false, previousActive, bootstrapToken = '';
const projects = [];
const sockets = new Set();
server.stdout.on('data', bytes => output = (output + bytes).slice(-65536));
server.stderr.on('data', bytes => output = (output + bytes).slice(-65536));
const exited = new Promise((done, fail) => { server.once('exit', done); server.once('error', fail); });
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const py = source => '/usr/bin/python3 -I -S -c ' + quote(source);
const path = { vmId };
const route = (name, project, method = 'GET', body, client = sdk) => client.request('/api/vms/' + vmId + '/' + name,
  { method, query: { project }, ...(body === undefined ? {} : { body }) });
async function guest(command) {
  const result = await sdk.call('core.vms.exec', { path, body: { scope: 'instance', command } });
  assert.equal(result.code, 0, result.stderr + result.stdout); return result.stdout.trim();
}
async function action(project, action, service) {
  const initial = await route('project', project, 'POST', { action, ...(service ? { service } : {}) });
  const deadline = Date.now() + 240000;
  for (;;) {
    const view = await route('project', project);
    assert.equal(view.job.id, initial.id);
    if (view.job.status !== 'running') return view.job;
    assert.ok(Date.now() < deadline, 'Project job timed out.');
    assert.equal(server.exitCode, null, output); await delay(100);
  }
}
async function done(project, operation, service) {
  const job = await action(project, operation, service);
  assert.equal(job.status, 'done', job.error || job.log); return job;
}
async function marker(file) {
  for (let n = 0; n < 150; n++) {
    const result = await sdk.call('core.vms.exec', { path, body: { scope: 'instance',
      command: 'test -f ' + quote(file) + ' && cat ' + quote(file) } });
    if (result.code === 0) return JSON.parse(result.stdout);
    await delay(100);
  }
  throw Error('Owned project marker did not arrive.');
}
const report = (file, stay = false) => py([
  'import json,os,time',
  "value={'uid':os.getuid(),'gid':os.getgid(),'groups':os.getgroups(),'home':os.environ['HOME'],",
  " 'cwd':os.getcwd(),'net':os.readlink('/proc/self/ns/net'),'cgroup':open('/proc/self/cgroup').read().strip(),",
  " 'environment':os.environ.get('OWNED_HTTP_CANARY')}",
  'with open(' + JSON.stringify(file) + ",'w') as stream:json.dump(value,stream);stream.flush();os.fsync(stream.fileno())",
  ...(stay ? ['while True:time.sleep(1)'] : []),
].join('\n'));
const validateAccount = (value, project) => {
  assert.equal(value.uid, project.identity.uid); assert.equal(value.gid, project.identity.gid);
  assert.deepEqual(value.groups, []); assert.equal(value.home, project.identity.home);
  assert.equal(value.cwd, project.directory); assert.equal(value.environment, project.config.environment.OWNED_HTTP_CANARY);
  assert.match(value.cgroup, /^0::\/sakura-(?:main|service|task)-[a-f0-9-]{36}$/);
};
async function directTerminal(projectId) {
  const query = new URLSearchParams({ project: projectId, token: bootstrapToken });
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/ws/' + vmId + '/terminal?' + query,
    { handshakeTimeout: 10000 });
  sockets.add(socket); socket.once('close', () => sockets.delete(socket));
  let failure, ready = false;
  socket.on('error', error => { failure = error; });
  socket.on('message', raw => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === 'error') failure = Error(message.data);
      if (message.type === 'ready') {
        if (message.data.projectId !== projectId) failure = Error('Direct terminal admitted the wrong project.');
        else ready = true;
      }
    } catch (error) { failure = error; }
  });
  const deadline = Date.now() + 180000;
  while (!ready) {
    if (failure) throw failure;
    assert.notEqual(socket.readyState, WebSocket.CLOSED, 'Direct terminal closed before admission.');
    assert.ok(Date.now() < deadline, 'Direct terminal admission timed out.'); await delay(100);
  }
  return socket;
}
async function closeTerminal(socket) {
  if (socket.readyState === WebSocket.CLOSED) return;
  const closed = new Promise(done => socket.once('close', done)); socket.close();
  await Promise.race([closed, delay(5000)]);
  if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  await closed;
}
try {
  for (let n = 0; n < 150; n++) {
    assert.equal(server.exitCode, null, output);
    try {
      const response = await fetch(origin + '/api/bootstrap', { signal: AbortSignal.timeout(1000) });
      if (response.ok) { bootstrapToken = (await response.json()).token; break; }
    } catch {}
    await delay(200);
  }
  assert.ok(bootstrapToken);
  const generated = await fetch(origin + '/api/sdk', { headers: { 'x-sakura-token': bootstrapToken } });
  assert.equal(generated.status, 200, 'Generated SDK requires the bootstrap credential.');
  const sdkFile = await generated.json();
  Client = (await import('data:text/javascript;base64,' + Buffer.from(sdkFile.content).toString('base64'))).SakuraClient;
  sdk = new Client({ baseUrl: origin });
  const spec = await sdk.request('/api/openapi');
  for (const suffix of ['project', 'project-runtime', 'project-directory-migration']) {
    const route = spec['x-sakura-route-prefixes'].find(item => item.owner === 'projects' && item.path === '/api/vms/:vmId/' + suffix);
    assert.equal(route?.enabled, true); assert.equal(route.projectScoped, true);
  }
  assert.equal((await fetch(origin + '/api/vms/' + vmId + '/project-directory-migration')).status, 401);
  proof.checks.push({ name: 'compiled-project-routes-and-generated-sdk', passed: true });
  await sdk.call('core.vms.start', { path }); started = true;
  const deadline = Date.now() + 300000;
  while ((await sdk.call('core.vms.get', { path })).status !== 'running') {
    assert.ok(Date.now() < deadline); await delay(500);
  }
  previousActive = (await sdk.request('/api/vms/' + vmId + '/projects')).active;
  for (const label of ['main', 'neighbor']) {
    const directory = '/srv/projects/identity-http-' + randomUUID();
    await guest('mkdir -m 700 -- ' + quote(directory));
    const config = { directory, template: 'none', repository: '', networkIsolation: 'private',
      environment: { OWNED_HTTP_CANARY: randomUUID() }, setup: report(directory + '/setup.json'),
      command: report(directory + '/main.json', true) };
    const created = await sdk.request('/api/vms/' + vmId + '/projects', { method: 'POST',
      body: { action: 'create', name: 'Owned identity HTTP ' + label + ' ' + randomUUID().slice(0, 8), config } });
    const project = { id: created.active, directory, config }; projects.push(project);
    assert.equal((await route('project-directory-migration', project.id)).plan, null);
    const preview = await route('project-directory-migration', project.id, 'POST', { action: 'preview', version: 1 });
    assert.equal(preview.projectId, project.id); assert.equal(preview.plan.state, 'preview');
    assert.equal(await guest('stat -c %u ' + quote(directory)), '0');
    const apply = { action: 'apply', version: 1, reviewed: true,
      planId: preview.plan.proposal.planId, sha256: preview.plan.sha256 };
    if (label === 'main') {
      const terminal = await directTerminal(project.id);
      try {
        for (const body of [{ action: 'preview', version: 1 }, apply])
          await assert.rejects(route('project-directory-migration', project.id, 'POST', body),
            error => error.status === 409 && error.code === 'PROJECT_DIRECTORY_RUNS_MUST_STOP');
        assert.equal(await guest('stat -c %u ' + quote(directory)), '0');
      } finally { await closeTerminal(terminal); }
      proof.checks.push({ name: 'compiled-direct-terminal-connection-blocks-preview-and-apply', passed: true });
    }
    await assert.rejects(route('project-directory-migration', project.id, 'POST', { ...apply, reviewed: false }), error => error.status === 400);
    await assert.rejects(route('project-directory-migration', project.id, 'POST', { ...apply, sha256: '0'.repeat(64) }), error => error.status === 409);
    assert.equal(await guest('stat -c %u ' + quote(directory)), '0');
    const result = await route('project-directory-migration', project.id, 'POST', apply);
    assert.equal(result.plan.state, 'applied'); assert.equal(result.lastFailure, null);
    project.identity = result.plan.activatedIdentity; assert.notEqual(project.identity.uid, 0);
    assert.equal(await guest('stat -c %u:%g:%a ' + quote(directory)), project.identity.uid + ':' + project.identity.gid + ':700');
    await done(project.id, 'start');
    validateAccount(await marker(directory + '/setup.json'), project);
    project.main = await marker(directory + '/main.json'); validateAccount(project.main, project);
    project.owner = JSON.parse(await guest('cat /run/sakura-project-main/' + project.id + '/owner.json'));
    assert.equal(project.main.cgroup, '0::/' + project.owner.scopeName);
    assert.equal((await route('project-runtime', project.id)).main.status, 'running');
  }
  proof.checks.push({ name: 'reviewed-directory-migration-and-independent-project-uids',
    accounts: projects.map(project => ({ projectId: project.id, identity: project.identity })), passed: true });
  const [main, neighbor] = projects;
  assert.notEqual(main.identity.uid, neighbor.identity.uid); assert.notEqual(main.main.net, neighbor.main.net);
  await done(main.id, 'start');
  assert.equal(JSON.parse(await guest('cat /run/sakura-project-main/' + main.id + '/owner.json')).runId, main.owner.runId);
  await assert.rejects(route('project', main.id, 'PUT', { ...main.config, command: 'sleep 600' }), error => error.status === 409);
  proof.checks.push({ name: 'uid-main-idempotence-private-network-and-config-protection', passed: true });

  const ownerFile = '/run/sakura-project-main/' + main.id + '/owner.json';
  await guest(py('import json,os\np=' + JSON.stringify(ownerFile) + '\nr=json.load(open(p));r["bootId"]=' +
    JSON.stringify(randomUUID()) + '\nwith open(p+".tmp","w") as f:json.dump(r,f)\nos.chmod(p+".tmp",0o600);os.replace(p+".tmp",p)\n'));
  const failed = await action(main.id, 'stop');
  assert.equal(failed.status, 'error'); assert.equal(failed.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED');
  assert.equal((await route('project-runtime', main.id)).main.status, 'unconfirmed');
  assert.equal((await route('project-runtime', neighbor.id)).main.status, 'running');
  await guest(py('import os\np=' + JSON.stringify(ownerFile) + '\nwith open(p+".tmp","w") as f:f.write(' +
    JSON.stringify(JSON.stringify(main.owner)) + ')\nos.chmod(p+".tmp",0o600);os.replace(p+".tmp",p)\n'));
  const oldEpoch = JSON.parse(await guest('cat /run/sakura-project-identities/networks/' + main.id + '.generation.json'));
  assert.equal(oldEpoch.phase, 'active'); const oldGeneration = oldEpoch.network;
  await done(main.id, 'stop'); await guest('test ! -e /run/netns/sk-' + main.id);
  assert.equal((await route('project-runtime', neighbor.id)).main.status, 'running');
  await done(main.id, 'start');
  const newEpoch = JSON.parse(await guest('cat /run/sakura-project-identities/networks/' + main.id + '.generation.json'));
  assert.equal(newEpoch.phase, 'active'); const newGeneration = newEpoch.network;
  assert.equal(oldGeneration.bootId, newGeneration.bootId); assert.notEqual(oldGeneration.generation, newGeneration.generation);
  proof.checks.push({ name: 'failed-cleanup-retry-and-same-boot-new-network-generation', oldGeneration, newGeneration, passed: true });
  await done(main.id, 'stop');
  const serviceConfig = { ...main.config, command: '', services: [{ name: 'api',
    command: report(main.directory + '/service.json', true), ready: report(main.directory + '/ready.json'), timeout: 5,
    health: { command: report(main.directory + '/health.json'), interval: 5, timeout: 10, failures: 1, restart: false } }] };
  await route('project', main.id, 'PUT', serviceConfig); await done(main.id, 'start');
  for (const name of ['service', 'ready', 'health']) validateAccount(await marker(main.directory + '/' + name + '.json'), main);
  let healthy = false;
  for (let n = 0; n < 100; n++) {
    const view = await route('health', main.id);
    if (view.services[0].status === 'healthy') { healthy = true; break; } await delay(100);
  }
  assert.equal(healthy, true);
  proof.checks.push({ name: 'compiled-service-ready-and-health-run-under-project-account', passed: true });
  const exec = await sdk.call('core.vms.exec', { path, query: { project: main.id }, body: {
    command: 'id -u; printf "owned-error" >&2; exit 23' } });
  assert.equal(exec.scope, 'project'); assert.equal(exec.projectId, main.id);
  assert.equal(Number(exec.stdout), main.identity.uid); assert.equal(exec.code, 23); assert.equal(exec.stderr, 'owned-error');
  proof.checks.push({ name: 'compiled-core-command-uid-and-nonzero-result', passed: true });

  const password = 'owned-http-' + randomUUID();
  await sdk.request('/api/access/enable', { method: 'POST', body: { password } });
  await sdk.login('owner', password);
  const memberPassword = 'owned-member-' + randomUUID(), viewerPassword = 'owned-viewer-' + randomUUID();
  const member = await sdk.request('/api/access/members', { method: 'POST', body: { username: 'owned_member', password: memberPassword } });
  await sdk.request('/api/access/project-permissions', { method: 'PUT', query: { vmId, projectId: main.id },
    body: { roles: [{ id: 'operator', name: 'Owned operator', permissions: ['read', 'write', 'execute'] }],
      grants: [{ accountId: member.id, roleId: 'operator' }] } });
  await sdk.request('/api/access/users', { method: 'POST', body: { username: 'owned_viewer', password: viewerPassword,
    vmIds: [vmId], expiresAt: Date.now() + 3600000 } });
  const memberClient = new Client({ baseUrl: origin }), viewerClient = new Client({ baseUrl: origin });
  await memberClient.login('owned_member', memberPassword); await viewerClient.login('owned_viewer', viewerPassword);
  assert.equal((await route('project', main.id, 'GET', undefined, memberClient)).project.directory, main.directory);
  for (const client of [memberClient, viewerClient]) {
    await assert.rejects(route('project-directory-migration', main.id, 'GET', undefined, client), error => error.status === 403);
    await assert.rejects(route('project-directory-migration', main.id, 'POST', { action: 'preview', version: 1 }, client), error => error.status === 403);
  }
  assert.equal((await route('project-directory-migration', main.id)).plan.state, 'applied');
  proof.checks.push({ name: 'migration-owner-only-with-otherwise-authorized-project-member', passed: true });
  await done(main.id, 'stop'); await done(neighbor.id, 'stop');
  for (const project of projects) {
    await guest('test ! -e /run/netns/sk-' + project.id);
    const runtime = await route('project-runtime', project.id);
    assert.equal(runtime.status, 'stopped');
  }
  proof.checks.push({ name: 'both-projects-fully-stopped-and-networks-released', passed: true });
} catch (error) {
  proof.error = (error instanceof Error ? error.message : String(error)).slice(0, 8192);
  console.error(proof.error);
} finally {
  proof.cleanup.vmStarted = started;
  if (!started && !sdk) stopped = true;
  for (const socket of sockets) await closeTerminal(socket);
  if (sdk) {
    for (const project of projects) await action(project.id, 'stop').catch(() => {});
    if (previousActive) await sdk.request('/api/vms/' + vmId + '/projects', { method: 'POST',
      body: { action: 'select', projectId: previousActive } }).catch(() => {});
    await guest('/bin/sync').then(() => { proof.cleanup.synced = true; }).catch(() => {});
    await sdk.call('core.vms.stop', { path, body: { force: true } }).catch(() => {});
    stopped = (await sdk.call('core.vms.get', { path }).catch(() => null))?.status === 'stopped';
  }
  if (server.exitCode === null) {
    server.kill('SIGTERM'); await Promise.race([exited, delay(15000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await exited;
  for (const [path, bytes] of saved) {
    if (bytes) await writeFile(path, bytes); else await rm(path, { force: true });
  }
  proof.cleanup.hostSettingsRestored = true; proof.cleanup.vmStopped = stopped;
  proof.serverExitCode = server.exitCode; proof.serverSignalCode = server.signalCode;
  proof.sourceUnchanged = true;
  for (const [file, digest] of Object.entries(sources))
    if (sha(await readFile(resolve(file))) !== digest) proof.sourceUnchanged = false;
  proof.releaseUnchanged = (await verifyReleaseManifest(serverRoot)).fingerprint === release.fingerprint;
  proof.finishedAt = new Date().toISOString();
  proof.passed = !proof.error && proof.checks.length === 9 && stopped && proof.cleanup.synced && proof.sourceUnchanged && proof.releaseUnchanged;
  if (proof.error) proof.serverOutput = output.slice(-16384);
  await writeFile(proofPath, JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ proof: proofPath, passed: proof.passed, checks: proof.checks.length, vmStopped: stopped }));
  if (!proof.passed || (started && !stopped)) process.exitCode = 1;
}
