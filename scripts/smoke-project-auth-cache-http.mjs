import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyReleaseManifest } from './release-manifest.mjs';

// Only reuse a stopped, owned auth fixture. Do not run a second controller.
assert.equal(process.argv.length, 4, 'Pass a stopped auth fixture and a prepared release directory.');
const data = await realpath(resolve(process.argv[2]));
assert.equal(dirname(data), await realpath(resolve('.data/dependency-auth-test-temp')));
assert.match(basename(data), /^sakura-auth-cache-[A-Za-z0-9_-]+$/);
const records = JSON.parse(await readFile(join(data, 'machines.json'), 'utf8'));
assert.equal(records.length, 1);
const vm = records[0];
assert.equal(vm.name, 'auth-cache-smoke');
assert.ok(['alpine', 'debian', 'ubuntu'].includes(vm.distro));
const prior = JSON.parse(await readFile(join(data, 'authenticated-prefetch-evidence.json'), 'utf8'));
assert.equal(prior.vmId, vm.id);
assert.equal(prior.distro, vm.distro);
const release = await realpath(resolve(process.argv[3]));
const manifest = await verifyReleaseManifest(release);
assert.equal(existsSync(join(release, 'server', 'dependency-download-broker.py')), false);
assert.ok(manifest.files.some((file) => file.path === '.sakura-server/assets/dependency-download-broker.py'));
const pluginsFile = join(data, 'plugins.json');
const previous = await readFile(pluginsFile).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
const listener = createServer();
await new Promise((done, fail) => listener.once('error', fail).listen(0, '127.0.0.1', done));
const port = listener.address().port;
await new Promise((done) => listener.close(done));
await writeFile(
  pluginsFile,
  JSON.stringify({ schemaVersion: 3, plugins: ['automation', 'network', 'secrets'], packs: [] }),
);
const server = spawn(process.execPath, ['.sakura-server/index.js'], {
  cwd: release,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    SAKURA_DATA_DIR: data,
    SAKURA_PORT: String(port),
    SAKURA_IMAGE_DIR: resolve('.data/images'),
    SAKURA_IMAGE_PATH: resolve(
      '.data/images/' +
        {
          alpine: 'alpine-3.23.qcow2',
          debian: 'debian-12.qcow2',
          ubuntu: 'ubuntu-24.04.qcow2',
        }[vm.distro],
    ),
  },
});
let output = '',
  token = '',
  sdk;
server.stdout.on('data', (chunk) => (output += chunk));
server.stderr.on('data', (chunk) => (output += chunk));
const exited = new Promise((done, fail) => server.once('exit', done).once('error', fail));
const origin = `http://127.0.0.1:${port}`;
const path = { vmId: vm.id };
const projectRoot = '/workspace/sakura-http-cache-' + randomBytes(8).toString('hex');
const npmDirectory = projectRoot + '/npm',
  pipDirectory = projectRoot + '/pip';
let projectId, previousActive;
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
let tokens = { npm: '', pip: '' };
const privateValues = [];
const redact = (text) =>
  privateValues.reduce((result, value) => result.replaceAll(value, '[owned token]'), text);
const jobs = [];
async function request(endpoint, method = 'GET', body) {
  const response = await fetch(origin + endpoint, {
    method,
    headers: { 'x-sakura-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.ok, true, redact(await response.clone().text()));
  return response.json();
}
const guest = async (command) => {
  const result = await sdk.call('core.vms.exec', { path, body: { scope: 'instance', command } });
  assert.equal(result.code, 0, redact(result.stderr || result.stdout));
  return result.stdout.trim();
};
const writeGuest = async (file, contents) =>
  guest(
    'python3 -I -c ' +
      quote(
        'import base64,os\np=' +
          JSON.stringify(file) +
          '\nos.umask(0o077)\nwith open(p,"wb") as out: out.write(base64.b64decode(' +
          JSON.stringify(Buffer.from(contents).toString('base64')) +
          '))',
      ),
  );
async function dev(manager, operation) {
  const started = Date.now();
  await request(`/api/vms/${vm.id}/advanced?project=${projectId}`, 'POST', {
    action: 'dev',
    manager,
    operation,
  });
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    const job = (await request(`/api/vms/${vm.id}/advanced?project=${projectId}`)).devJob;
    if (job && Date.parse(job.startedAt) >= started && job.status !== 'running') {
      for (const value of privateValues)
        assert.ok(!JSON.stringify(job).includes(value), 'Owned credential in job output');
      assert.equal(job.status, 'done', job.error + '\n' + job.log);
      jobs.push({ manager, operation, status: job.status });
      console.log(`Compiled ${manager} ${operation}: ${job.status}`);
      return;
    }
    await delay(200);
  }
  throw new Error('Compiled dependency job did not complete');
}
try {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !token) {
    assert.equal(server.exitCode, null, output);
    try {
      const response = await fetch(origin + '/api/bootstrap', { signal: AbortSignal.timeout(1000) });
      if (response.ok) token = (await response.json()).token;
    } catch {}
    if (!token) await delay(200);
  }
  assert.ok(token, output);
  const source = await request('/api/sdk');
  const { SakuraClient } = await import(
    'data:text/javascript;base64,' + Buffer.from(source.content).toString('base64')
  );
  sdk = new SakuraClient({ baseUrl: origin });
  await sdk.call('core.vms.start', { path });
  const bootDeadline = Date.now() + 300_000;
  let running = false;
  while (Date.now() < bootDeadline) {
    const state = await sdk.call('core.vms.get', { path });
    if (state.status === 'running') {
      running = true;
      break;
    }
    assert.notEqual(state.status, 'error', state.error);
    await delay(300);
  }
  assert.ok(running, 'Owned fixture did not start');
  console.log('Started owned fixture through compiled HTTP/SDK');
  await guest(`umask 077; mkdir -p /run/sakura-auth-fixture ${quote(npmDirectory)} ${quote(pipDirectory)}`);
  tokens = JSON.parse(
    await guest(
      'python3 -I -c ' +
        quote(
          'import json,os,secrets\nos.umask(0o077)\ntokens={"npm":"owned-http-npm-"+secrets.token_hex(24),"pip":"owned-http-pip-"+secrets.token_hex(24)}\nwith open("/run/sakura-auth-fixture/tokens.json","x") as out: json.dump(tokens,out)\nprint(json.dumps(tokens))',
        ),
    ),
  );
  privateValues.push(...Object.values(tokens), Buffer.from('reader:' + tokens.pip).toString('base64'));
  await writeGuest(
    '/run/sakura-auth-fixture/registry.py',
    await readFile('scripts/project-auth-cache-fixture.py', 'utf8'),
  );
  await guest(
    // The core command API cleans its whole group on completion. The owned
    // registry is a separate fixture service, terminated with this test VM.
    'setsid nohup env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin python3 -I /run/sakura-auth-fixture/registry.py </dev/null >/run/sakura-auth-fixture/registry.log 2>&1 &',
  );
  const ready = JSON.parse(
    await guest(
      'for i in $(seq 1 100); do if [ -s /run/sakura-auth-fixture/ready.json ]; then cat /run/sakura-auth-fixture/ready.json; exit 0; fi; sleep 0.1; done; exit 1',
    ),
  );
  const endpoint = `http://127.0.0.1:${ready.port}`;
  await request(`/api/vms/${vm.id}/secrets`, 'PUT', { name: 'npm-read', value: tokens.npm });
  await request(`/api/vms/${vm.id}/secrets`, 'PUT', { name: 'pip-read', value: tokens.pip });
  if ((await request(`/api/vms/${vm.id}/network`)).appliedAt)
    await request(`/api/vms/${vm.id}/network`, 'POST', { action: 'restore' });
  const preview = await request(`/api/vms/${vm.id}/network`, 'POST', {
    action: 'preview',
    config: {
      dependencyDownloads: {
        npm: { kind: 'bearer', endpoint: endpoint + '/npm/', tokenSecret: 'npm-read' },
        pip: {
          kind: 'basic',
          endpoint: endpoint + '/python/simple/',
          username: 'reader',
          passwordSecret: 'pip-read',
        },
      },
    },
  });
  await request(`/api/vms/${vm.id}/network`, 'POST', {
    action: 'apply',
    config: preview.config,
    token: preview.token,
  });
  const npmManifest = {
    name: 'owned-http-auth-project',
    version: '1.0.0',
    dependencies: { '@sakura-owned/auth-probe': '1.0.0' },
  };
  await writeGuest(npmDirectory + '/package.json', JSON.stringify(npmManifest));
  await writeGuest(
    npmDirectory + '/package-lock.json',
    JSON.stringify({
      name: npmManifest.name,
      version: npmManifest.version,
      lockfileVersion: 3,
      packages: {
        '': npmManifest,
        'node_modules/@sakura-owned/auth-probe': {
          version: '1.0.0',
          resolved: endpoint + '/npm/-/auth-probe-1.0.0.tgz',
          integrity: ready.integrity1,
        },
      },
    }),
  );
  await writeGuest(pipDirectory + '/requirements.txt', 'owned-auth-probe==1.0.0\n');
  previousActive = (await request(`/api/vms/${vm.id}/projects`)).active;
  const created = await request(`/api/vms/${vm.id}/projects`, 'POST', {
    action: 'create',
    name: 'Compiled auth ' + basename(projectRoot),
    config: { directory: npmDirectory, networkIsolation: 'private', environment: {}, secrets: {} },
  });
  projectId = created.active;
  assert.match(projectId, /^[a-f0-9]{16}$/);
  for (const manager of ['npm', 'pip']) {
    const directory = manager === 'npm' ? npmDirectory : pipDirectory;
    await request(`/api/vms/${vm.id}/project?project=${projectId}`, 'PUT', {
      directory,
      networkIsolation: 'private',
      environment: {},
      secrets: {},
    });
    await dev(manager, 'prefetch-dependencies');
    await dev(manager, 'install-cached-dependencies');
  }
  await guest('test -f ' + quote(npmDirectory + '/node_modules/@sakura-owned/auth-probe/index.js'));
  await guest(
    `ip netns exec sk-${projectId} ${quote(pipDirectory + '/.sakura/venv/bin/python')} -I -c ` +
      quote('import owned_auth_probe,owned_public_probe; assert owned_auth_probe.VALUE == "owned wheel"'),
  );
  assert.equal(await guest('find /run -maxdepth 1 -name "sakura-dependency-auth.*" -print'), '');
  assert.equal(
    await guest(`find /var/cache/sakura/project-deps/${projectId} -maxdepth 1 -name ".staging.*" -print`),
    '',
  );
  const requests = JSON.parse(await guest('cat /run/sakura-auth-fixture/requests.json'));
  for (const scope of ['npm', 'pip'])
    assert.ok(requests.some((item) => item.scope === scope && item.authorized && item.hadAuthorization));
  assert.ok(
    requests.some((item) => item.scope === 'public' && item.path.endsWith('.whl') && !item.hadAuthorization),
  );
  assert.ok(!requests.some((item) => item.scope === 'public' && item.hadAuthorization));
  for (const value of privateValues) assert.ok(!output.includes(value));
  await writeFile(
    join(data, 'authenticated-prefetch-http-evidence.json'),
    JSON.stringify(
      {
        version: 1,
        vmId: vm.id,
        projectId,
        distro: vm.distro,
        release,
        fingerprint: manifest.fingerprint,
        brokerFromReleaseAsset: true,
        jobs,
        requests,
        credentialDirectories: 0,
        stagingDirectories: 0,
      },
      null,
      2,
    ),
  );
  console.log(
    'Compiled release HTTP/SDK: credential-scoped npm/pip prefetch, public wheel without auth, private offline install and exact cleanup passed',
  );
} finally {
  if (previousActive)
    await request(`/api/vms/${vm.id}/projects`, 'POST', {
      action: 'select',
      projectId: previousActive,
    }).catch(() => {});
  // Flush fixture writes before stopping QEMU; a forced stop does not promise
  // filesystem durability and must not manufacture stale stages on the next run.
  if (sdk) await guest('sync').catch(() => {});
  if (sdk) await sdk.call('core.vms.stop', { path, body: { force: true } }).catch(() => {});
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([exited, delay(20_000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await exited;
  if (previous) await writeFile(pluginsFile, previous);
  else await rm(pluginsFile, { force: true });
  assert.equal((await verifyReleaseManifest(release)).fingerprint, manifest.fingerprint);
}
