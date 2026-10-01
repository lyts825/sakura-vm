import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, realpath, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyReleaseManifest } from './release-manifest.mjs';

assert.ok(process.argv[2], 'Pass the stopped fixture from the successful native Wayland smoke.');
const data = await realpath(resolve(process.argv[2]));
assert.equal(dirname(data), await realpath(resolve('.data/linux-clipboard-test-temp')));
assert.match(basename(data), /^sakura-x11-[A-Za-z0-9_-]+$/);
const proof = JSON.parse(await readFile(join(data, 'native-wayland-evidence.json'), 'utf8'));
assert.equal(proof.passed, true, 'The native Wayland smoke must succeed first.');
assert.equal(proof.vmStopped, true);
assert.ok(!proof.error);
assert.match(proof.programDirectory, /^\/usr\/local\/lib\/sakura-wayland-test\/[a-f0-9]{32}$/);
assert.match(proof.project, /^\/var\/tmp\/sakura-wayland-smoke-[a-f0-9]{32}$/);
const records = JSON.parse(await readFile(join(data, 'machines.json'), 'utf8'));
assert.equal(records.length, 1);
const vm = records[0];
assert.equal(vm.id, proof.vmId);
assert.equal(vm.name, 'x11-clipboard-debian');
assert.equal(vm.distro, 'debian');
const serverRoot = resolve(process.argv[3] || '.');
if (process.argv[3]) await verifyReleaseManifest(serverRoot);
const manifest = JSON.parse(await readFile(join(serverRoot, '.sakura-server/assets/wayland-clipboard/manifest.json'), 'utf8'));
assert.equal(manifest.build, proof.build, 'Use the same final production sources as the successful native smoke.');
const serverSha256 = createHash('sha256').update(await readFile(join(serverRoot, '.sakura-server/index.js'))).digest('hex');
const pluginFile = join(data, 'plugins.json');
const previous = await readFile(pluginFile).catch(error => {
  if (error.code !== 'ENOENT') throw error;
});
await writeFile(pluginFile, JSON.stringify({ schemaVersion: 3, plugins: ['desktop'], packs: [] }));
const listener = createServer();
await new Promise((done, fail) => listener.once('error', fail).listen(0, '127.0.0.1', done));
const port = listener.address().port;
await new Promise(done => listener.close(done));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['.sakura-server/index.js'], {
  cwd: serverRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, SAKURA_DATA_DIR: data, SAKURA_PORT: String(port),
    SAKURA_IMAGE_DIR: resolve('.data/images'), SAKURA_IMAGE_PATH: resolve('.data/images/debian-12.qcow2') },
});
let output = '', sdk, token = '', stopped = false, started = false, passed = false, failure = null;
const sessions = [], path = { vmId: vm.id }, operation = 'desktop.wayland-clipboard-action';
server.stdout.on('data', chunk => output = (output + chunk).slice(-65536));
server.stderr.on('data', chunk => output = (output + chunk).slice(-65536));
const exited = new Promise((done, fail) => { server.once('exit', done); server.once('error', fail); });
async function http(pathname, method = 'GET', body) {
  const response = await fetch(origin + pathname, { method,
    headers: { 'x-sakura-token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  assert.equal(response.ok, true, await response.clone().text());
  return response.json();
}
const view = () => sdk.call('desktop.wayland-clipboard-get', { path, query: { project: 'default' } });
const action = body => sdk.call(operation, { path, query: { project: 'default' }, body });
async function guest(command) {
  const result = await sdk.call('core.vms.exec', { path, body: { scope: 'instance', command } });
  assert.equal(result.code, 0, result.stderr + result.stdout);
  return result.stdout.trim();
}
const quoted = value => "'" + value.replaceAll("'", "'\\''") + "'";
async function marker(file) {
  for (let n = 0; n < 100; ++n) {
    const result = await sdk.call('core.vms.exec', { path, body: {
      scope: 'instance', command: `test -f ${quoted(file)} && cat ${quoted(file)}` } });
    if (result.code === 0) return result.stdout.trim();
    await delay(100);
  }
  throw Error('Native Wayland result marker did not arrive.');
}
const focus = () => guest('sleep .4\nenv DISPLAY=:1 XAUTHORITY=/run/sakura-desktop/Xauthority xdotool mousemove 640 400 click 1 key F8');
try {
  for (let n = 0; n < 150 && !token; ++n) {
    assert.equal(server.exitCode, null, output);
    try {
      const response = await fetch(origin + '/api/bootstrap', { signal: AbortSignal.timeout(1000) });
      if (response.ok) token = (await response.json()).token;
    } catch {}
    if (!token) await delay(200);
  }
  assert.ok(token, output);
  const generated = await http('/api/sdk');
  const { SakuraClient } = await import('data:text/javascript;base64,' + Buffer.from(generated.content).toString('base64'));
  sdk = new SakuraClient({ baseUrl: origin });
  const spec = await http('/api/openapi'), endpoint = spec.paths['/api/vms/{vmId}/wayland-clipboard'];
  assert.equal(endpoint.get.operationId, 'desktop.wayland-clipboard-get');
  assert.equal(endpoint.post.operationId, operation);
  assert.equal(endpoint.get['x-sakura-enabled'], true);
  await assert.rejects(action({ action: 'refresh', unexpected: true }), error => error.status === 400);
  assert.equal((await view()).ready, false);
  await sdk.call('core.vms.start', { path });
  started = true;
  const bootDeadline = Date.now() + 300000;
  while ((await sdk.call('core.vms.get', { path })).status !== 'running') {
    assert.ok(Date.now() < bootDeadline, 'Owned fixture startup timed out.');
    await delay(1000);
  }
  await http(`/api/vms/${vm.id}/desktop?project=default`, 'POST', {
    action: 'start', preferences: { sessionType: 'wayland' } });
  const desktopDeadline = Date.now() + 300000;
  for (;;) {
    const desktop = await http(`/api/vms/${vm.id}/desktop?project=default`);
    assert.notEqual(desktop.status, 'error', desktop.error || desktop.log);
    if (desktop.status === 'ready') {
      assert.equal(desktop.preferences.sessionType, 'wayland'); break;
    }
    assert.ok(Date.now() < desktopDeadline, 'Production native Plasma startup timed out.');
    await delay(1000);
  }
  let state = await view();
  assert.equal(state.ready, true, state.error);
  assert.equal(state.build, proof.build);
  const image = proof.programDirectory + '/fixture-qt';
  const identity = await action({ action: 'identify', image });
  const rule = { copy: false, paste: true, files: false, sensitive: true, maxTextBytes: 4096 };
  const nonce = randomUUID().replaceAll('-', ''), root = proof.project + '/http-' + nonce;
  const body = Buffer.from('Compiled HTTP / SDK native Wayland 完整正文 ' + nonce);
  await guest(`umask 022\nprintf '%s' '${body.toString('base64')}' | base64 -d > ${quoted(root + '-body')}`);
  state = await action({ action: 'save', version: state.version, application: { ...identity, rule } });
  assert.ok(!state.error, state.error);
  await assert.rejects(action({ action: 'launch', version: state.version - 1, image }), error => error.status === 409);
  const owner = await action({ action: 'launch', version: state.version, image,
    args: ['owner', root + '-body', root + '-ready', 'text/plain;charset=utf-8'] });
  sessions.push(owner.id);
  assert.equal(owner.state, 'running', owner.error);
  await focus();
  assert.match(await marker(root + '-ready'), /^READY wayland/);
  for (let n = 0; n < 30; ++n) {
    if ((await view()).sessions.find(row => row.id === owner.id).blockedCopy > 0) break;
    await delay(100);
  }
  assert.ok((await view()).sessions.find(row => row.id === owner.id).blockedCopy > 0);
  state = await action({ action: 'save', version: state.version, application: { ...identity, rule: { ...rule, copy: true } } });
  assert.ok(!state.error, state.error);
  await action({ action: 'stop', id: owner.id });
  const allowedOwner = await action({ action: 'launch', version: state.version, image,
    args: ['owner', root + '-body', root + '-allowed-ready', 'text/plain;charset=utf-8'] });
  sessions.push(allowedOwner.id);
  assert.equal(allowedOwner.state, 'running', allowedOwner.error);
  await focus();
  assert.match(await marker(root + '-allowed-ready'), /^READY wayland/);
  const sink = await action({ action: 'launch', version: state.version, image,
    args: ['probe', '/dev/null', root + '-received', 'text/plain;charset=utf-8'] });
  sessions.push(sink.id);
  await focus();
  assert.equal(await marker(root + '-received'), body.toString('hex'));
  for (const id of sessions) {
    await action({ action: 'stop', id });
    assert.equal((await view()).sessions.find(row => row.id === id).state, 'stopped');
    await action({ action: 'forget', id });
  }
  assert.equal((await view()).sessions.some(row => sessions.includes(row.id)), false);
  passed = true;
  console.log('Compiled HTTP and generated SDK: native Plasma, exact build, identities, strict bodies, stale versions, native copy denial, full copy/paste and owned cleanup passed');
} catch (error) {
  failure = (error instanceof Error ? error.message : String(error)).slice(0, 2048);
  throw error;
} finally {
  if (sdk) {
    for (const id of sessions) await action({ action: 'stop', id }).catch(() => {});
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
  await writeFile(join(data, 'compiled-wayland-http-evidence.json'), JSON.stringify({
    vmId: vm.id, build: manifest.build, serverRoot, serverSha256,
    passed: passed && stopped, vmStopped: stopped, error: failure,
    finishedAt: new Date().toISOString(),
    checks: ['strict generated SDK bodies', 'stale version refusal', 'production native Plasma discovery',
      'pinned executable identity', 'native copy refusal', 'hot policy update', 'complete native clipboard body', 'owned session cleanup'],
  }, null, 2) + '\n');
  if (started) assert.equal(stopped, true, 'Owned fixture shutdown was not confirmed.');
}
