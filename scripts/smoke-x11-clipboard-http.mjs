import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, realpath, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyReleaseManifest } from './release-manifest.mjs';

// Reuse only the owned fixture retained by smoke-x11-clipboard.ts. Never attach
// a second Machines controller while that script or another server is running.
assert.ok(process.argv[2], 'Provide the retained, stopped X11 smoke fixture');
const data = await realpath(resolve(process.argv[2]));
assert.equal(dirname(data), await realpath(tmpdir()));
assert.match(basename(data), /^sakura-x11-/);
const records = JSON.parse(await readFile(join(data, 'machines.json'), 'utf8'));
assert.equal(records.length, 1);
const vm = records[0];
assert.match(vm.name, /^x11-clipboard-/);
assert.equal(vm.distro, 'debian');
const serverRoot = resolve(process.argv[3] || '.');
if (process.argv[3]) await verifyReleaseManifest(serverRoot);
const pluginsFile = join(data, 'plugins.json');
const previous = await readFile(pluginsFile).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
await writeFile(pluginsFile, JSON.stringify({ schemaVersion: 3, plugins: ['desktop'], packs: [] }));
const listener = createServer();
await new Promise((done, fail) => listener.once('error', fail).listen(0, '127.0.0.1', done));
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['.sakura-server/index.js'], {
  cwd: serverRoot,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    SAKURA_DATA_DIR: data,
    SAKURA_PORT: String(port),
    SAKURA_IMAGE_DIR: resolve('.data/images'),
    SAKURA_IMAGE_PATH: resolve('.data/images/debian-12.qcow2'),
  },
});
let output = '',
  sdk;
server.stdout.on('data', (chunk) => (output += chunk));
server.stderr.on('data', (chunk) => (output += chunk));
const exited = new Promise((done, fail) => {
  server.once('exit', done);
  server.once('error', fail);
});
let token = '';
async function request(path) {
  const response = await fetch(origin + path, {
    headers: { 'x-sakura-token': token },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
const path = { vmId: vm.id },
  operation = 'desktop.x11-clipboard-action';
async function view() {
  return sdk.call('desktop.x11-clipboard-get', { path });
}
async function action(body) {
  return sdk.call(operation, { path, query: { project: 'default' }, body });
}
async function guest(command) {
  const result = await sdk.call('core.vms.exec', { path, body: { scope: 'instance', command } });
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
try {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    assert.equal(server.exitCode, null, output);
    try {
      const response = await fetch(origin + '/api/bootstrap', { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        token = (await response.json()).token;
        break;
      }
    } catch {}
    await delay(200);
  }
  assert.ok(token, output);
  const source = await request('/api/sdk');
  const { SakuraClient } = await import(
    'data:text/javascript;base64,' + Buffer.from(source.content).toString('base64')
  );
  sdk = new SakuraClient({ baseUrl: origin });
  const specification = await request('/api/openapi');
  assert.equal(
    specification.paths['/api/vms/{vmId}/x11-clipboard'].get.operationId,
    'desktop.x11-clipboard-get',
  );
  assert.equal(specification.paths['/api/vms/{vmId}/x11-clipboard'].post.operationId, operation);
  assert.equal(specification.paths['/api/vms/{vmId}/x11-clipboard'].get['x-sakura-enabled'], true);
  await assert.rejects(
    sdk.call(operation, { path, body: { action: 'refresh', unexpected: true } }),
    (error) => error.status === 400,
  );
  assert.equal((await view()).ready, false);
  await sdk.call('core.vms.start', { path });
  const bootDeadline = Date.now() + 300000;
  let ready = false,
    progress = Date.now();
  while (Date.now() < bootDeadline) {
    const state = await sdk.call('core.vms.get', { path });
    if (state.status === 'running') {
      const desktop = await request(`/api/vms/${vm.id}/desktop?project=default`);
      assert.notEqual(desktop.status, 'error', desktop.error);
      if (desktop.status === 'ready') {
        ready = true;
        break;
      }
    }
    if (Date.now() >= progress) {
      console.log('Compiled KDE preparation:', state.status);
      progress = Date.now() + 45000;
    }
    await delay(500);
  }
  assert.ok(ready, 'The retained KDE desktop did not recover');
  const native = await view();
  assert.equal(native.ready, true, native.error);
  const image = '/usr/local/lib/sakura-x11-test/fixture';
  const identity = await action({ action: 'identify', image });
  const rule = { copy: false, paste: true, files: false, sensitive: true, maxTextBytes: 4096 };
  const saved = await action({ action: 'save', version: native.version, application: { ...identity, rule } });
  assert.ok(!saved.error, saved.error);
  await assert.rejects(
    action({ action: 'launch', version: native.version, image }),
    (error) => error.status === 409,
  );
  const marker = '/home/sakura-desktop/sakura-x11-http-' + randomUUID();
  const launched = await action({
    action: 'launch',
    version: saved.version,
    image,
    args: [
      'xlib',
      'owner',
      'UTF8_STRING',
      '/usr/local/lib/sakura-x11-test/data.txt',
      'CLIPBOARD',
      'ordinary',
      marker,
    ],
  });
  assert.equal(launched.state, 'running', launched.error);
  assert.equal(launched.projectId, 'default');
  assert.ok(launched.processes.every((row) => row.loaded));
  // Copy was disabled before startup, so this owned fixture cannot acquire
  // the selection. Its readiness marker must report that actual X11 refusal.
  let answer = '';
  for (let i = 0; i < 100; i++) {
    const result = await sdk.call('core.vms.exec', {
      path,
      body: { scope: 'instance', command: `test -f '${marker}' && cat '${marker}'` },
    });
    if (result.code === 0) {
      answer = result.stdout.trim();
      break;
    }
    await delay(100);
  }
  assert.equal(answer, 'REFUSED');
  const row = (await view()).sessions.find((row) => row.id === launched.id);
  assert.ok(row.blockedCopy > 0);
  await action({ action: 'stop', id: launched.id });
  assert.equal((await view()).sessions.find((row) => row.id === launched.id).state, 'stopped');
  await action({ action: 'forget', id: launched.id });
  assert.ok(!(await view()).sessions.some((row) => row.id === launched.id));
  await guest(`rm -f '${marker}'`);
  console.log(
    'Compiled HTTP and generated SDK: recovery, identity, persisted rules, strict bodies, stale versions, controlled launch, native refusal and session cleanup passed',
  );
} finally {
  if (sdk) await sdk.call('core.vms.stop', { path, body: { force: true } }).catch(() => {});
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([exited, delay(20000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await exited;
  if (previous) await writeFile(pluginsFile, previous);
  else await rm(pluginsFile, { force: true });
}
