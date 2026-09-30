import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';

const distro = process.argv[2] || 'debian';
const images: Record<string, string> = {
  alpine: 'alpine-3.23.qcow2',
  debian: 'debian-12.qcow2',
  ubuntu: 'ubuntu-24.04.qcow2',
};
assert.ok(images[distro], 'unsupported smoke distro');
// The exact official release asset and its published SHA-256 are pinned. This
// test cache is separate from both user installations and disposable VM data.
const envoyVersion = '1.39.1',
  envoySha256 = '002c6e1c69ed0fa0ea381887247cadadfaec9481375fa8d8d2b1731eeabf40b8';
const asset = `envoy-${envoyVersion}-linux-x86_64`,
  cache = resolve('.data', asset);
await mkdir(dirname(cache), { recursive: true });
try {
  await readFile(cache);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  const response = await fetch(
    `https://github.com/envoyproxy/envoy/releases/download/v${envoyVersion}/${asset}`,
    { signal: AbortSignal.timeout(300_000) },
  );
  assert.ok(response.ok, `Envoy download HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), envoySha256);
  await writeFile(cache, bytes, { flag: 'wx' });
}
assert.equal(
  createHash('sha256')
    .update(await readFile(cache))
    .digest('hex'),
  envoySha256,
  'Envoy cache digest mismatch',
);

const directory = await mkdtemp(join(tmpdir(), 'sakura-service-mesh-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images', images[distro]);
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { ServiceMesh } = await import('../server/service-mesh.ts');
const { ProjectNetworkBridges } = await import('../server/project-network-bridges.ts');
const { meshProjectCommand, meshConfigPath, meshSession } = await import('../server/service-mesh-guest.ts');
const { Secrets } = await import('../server/secrets.ts');
const { quote } = await import('../server/files.ts');
const engine = await createRuntime();
let machines: InstanceType<typeof Machines> | undefined;
let workspaces: InstanceType<typeof Workspaces> | undefined;
let mesh: InstanceType<typeof ServiceMesh> | undefined;
let bridges: InstanceType<typeof ProjectNetworkBridges> | undefined;
let vmId = '',
  enabled = true;
const secret = 'sakura-mesh-secret-' + randomUUID();
const policy = { name: 'frontend', listenPort: 15001, upstreamPort: 18080 };
const upstream = `import http.server,json,os
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body=json.dumps({'scope':os.environ.get('MESH_SCOPE'),'directory':os.getcwd(),
            'namespace':os.readlink('/proc/self/ns/net')}).encode()
        self.send_response(200)
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self,*args): pass
http.server.HTTPServer(('127.0.0.1',${policy.upstreamPort}),Handler).serve_forever()`;

async function command(script: string, timeout = 15_000) {
  const result = await machines!.exec(vmId, script, timeout);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
async function boot() {
  await machines!.start(vmId);
  const deadline = Date.now() + 300_000;
  while (machines!.state(vmId) === 'starting' && Date.now() < deadline) await delay(100);
  assert.equal(machines!.state(vmId), 'running', machines!.logs.get(vmId));
}
const within = <T>(project: string, work: () => Promise<T>) => workspaces!.projects.with(vmId, project, work);
const action = (project: string, mode: 'start' | 'stop' | 'save', signal?: AbortSignal) =>
  within(project, () => mesh!.action(vmId, { mode, ...(mode === 'save' ? { policy } : {}) }, 'run', signal));
const status = (project: string) => within(project, () => mesh!.status(vmId));
async function startUpstream(projectId: string) {
  const project = await within(projectId, () => workspaces!.resolvedConfig(vmId));
  await command(
    `tmux new-session -d -s sakura-smoke-upstream-${projectId} ` +
      quote(meshProjectCommand(project, `exec python3 -I -S -u -c ${quote(upstream)}`)),
  );
}
async function stopUpstream(projectId: string) {
  await command(
    `if tmux has-session -t =sakura-smoke-upstream-${projectId} 2>/dev/null; then ` +
      `tmux kill-session -t =sakura-smoke-upstream-${projectId}; fi`,
  );
}
async function response(projectId: string, scope: string) {
  console.log(`${distro}: checking ${scope} proxy traffic`);
  const project = await within(projectId, () => workspaces!.config(vmId));
  const request = `import urllib.request
print(urllib.request.urlopen('http://127.0.0.1:${policy.listenPort}',timeout=2).read().decode())`;
  const deadline = Date.now() + 15_000;
  while (true) {
    const result = await machines!
      .exec(vmId, meshProjectCommand(project, `exec python3 -I -S -c ${quote(request)}`), 5000)
      .catch((error) => {
        throw new Error(`proxy request SSH failed for ${scope}`, { cause: error });
      });
    if (result.code === 0) {
      const body = JSON.parse(result.stdout);
      assert.equal(body.scope, scope);
      assert.equal(body.directory, project.directory);
      return body as { scope: string; directory: string; namespace: string };
    }
    assert.ok(Date.now() < deadline, result.stderr);
    await delay(100);
  }
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function run() {
  try {
    machines = new Machines(engine);
    await machines.init();
    const vm = await machines.create({
      name: `service-mesh-${distro}`,
      distro,
      memoryMiB: 2048,
      cpus: 2,
      diskGiB: 8,
      accelerator: 'auto',
      forwards: [],
    });
    vmId = vm.id;
    await boot();
    console.log(`${distro}: installing test dependencies and pinned Envoy ${envoyVersion}`);
    await command(
      distro === 'alpine'
        ? 'apk add --no-cache python3 tmux iproute2 libstdc++ gcompat'
        : 'export DEBIAN_FRONTEND=noninteractive; apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update && ' +
            'apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y python3 tmux iproute2 libstdc++6 libgcc-s1',
      240_000,
    );
    await machines.sftp(vmId, async (ftp) => {
      await pipeline(
        createReadStream(cache),
        ftp.createWriteStream('/usr/local/bin/envoy', { flags: 'wx', mode: 0o755 }),
      );
    });
    await command(
      `chmod 755 /usr/local/bin/envoy\n` +
        `test "$(sha256sum /usr/local/bin/envoy | cut -d' ' -f1)" = ${envoySha256}`,
    );
    const version = await machines.exec(vmId, 'envoy --version', 30_000);
    if (version.code !== 0) {
      assert.equal(distro, 'alpine', version.stderr);
      assert.match(version.stderr, /symbol not found/, 'unexpected Envoy prerequisite failure');
      workspaces = new Workspaces(machines);
      await workspaces.save(vmId, { directory: '/workspace/mesh', networkIsolation: 'private' });
      mesh = new ServiceMesh(machines, workspaces);
      await mesh.init();
      await action('default', 'save');
      await assert.rejects(action('default', 'start'), /symbol not found/);
      const refused = await status('default');
      assert.equal(refused.sidecarRunning, false);
      assert.equal(refused.envoyUsable, false);
      assert.equal(refused.ready, false);
      console.log(
        `alpine: incompatible official Envoy ${envoyVersion} refused without a sidecar; dependency rejection passed, real proxy traffic remains unverified`,
      );
      return;
    }
    assert.ok(version.stdout.includes(envoyVersion));
    console.log(`${distro}: ${version.stdout.trim()}`);
    const secrets = process.platform === 'win32' ? new Secrets(machines) : undefined;
    if (secrets) await secrets.save(vmId, { name: 'mesh-key', value: secret });
    workspaces = new Workspaces(machines, { secrets });
    await workspaces.save(vmId, { directory: '/workspace/shared', environment: { MESH_SCOPE: 'host' } });
    const alphaDirectory = "/workspace/private 'alpha space";
    const alpha = (
      await workspaces.projects.create(vmId, 'Private A', async () => {
        await workspaces!.save(vmId, {
          directory: alphaDirectory,
          networkIsolation: 'private',
          environment: { MESH_SCOPE: 'alpha' },
          ...(secrets ? { secrets: { TOKEN: 'mesh-key' } } : {}),
        });
      })
    ).active;
    const beta = (
      await workspaces.projects.create(vmId, 'Private B', async () => {
        await workspaces!.save(vmId, {
          directory: '/workspace/private-beta',
          networkIsolation: 'private',
          environment: { MESH_SCOPE: 'beta' },
        });
      })
    ).active;
    const create = () => new ServiceMesh(machines!, workspaces!, undefined, async () => enabled);
    mesh = create();
    await mesh.init();
    bridges = new ProjectNetworkBridges(machines);
    for (const project of ['default', alpha, beta]) {
      console.log(`${distro}: saving and starting sidecar for ${project}`);
      await action(project, 'save');
      const started = await action(project, 'start');
      assert.equal(started.bindingValid, true);
      assert.ok(started.runId);
      assert.ok(!JSON.stringify(started).includes(secret));
      await startUpstream(project);
      console.log(`${distro}: sidecar ${project} is bound and upstream started`);
    }
    const hostBody = await response('default', 'host'),
      alphaBody = await response(alpha, 'alpha'),
      betaBody = await response(beta, 'beta');
    assert.notEqual(alphaBody.namespace, hostBody.namespace);
    assert.notEqual(alphaBody.namespace, betaBody.namespace);
    const a = await status(alpha),
      b = await status(beta);
    assert.equal(a.processes.length, 1);
    assert.equal(b.processes.length, 1);
    await command(`set -eu
test "$(readlink /proc/${a.processes[0]}/ns/net)" = ${quote(alphaBody.namespace)}
test "$(readlink /proc/${b.processes[0]}/ns/net)" = ${quote(betaBody.namespace)}
test "$(ip -n sk-${alpha} -o -4 route show | wc -l)" -eq 0
test "$(ip -n sk-${alpha} -o -6 route show | wc -l)" -eq 0`);
    if (secrets)
      await command(
        `python3 -I -S -c ${quote(`import os
values=open('/proc/${a.processes[0]}/environ','rb').read().split(bytes([0]))
assert ${JSON.stringify('TOKEN=' + secret)}.encode() in values`)} `,
      );
    const blocked = await machines.exec(
      vmId,
      meshProjectCommand(
        await within(alpha, () => workspaces!.config(vmId)),
        `exec python3 -I -S -c ${quote("import socket\nsocket.create_connection(('203.0.113.1',80),1)")}`,
      ),
      5000,
    );
    assert.notEqual(blocked.code, 0, 'private sidecar project reached an external address');
    const bridgePort = await freePort();
    console.log(`${distro}: checking local SSH bridge`);
    await bridges.open(
      vmId,
      await within(alpha, () => workspaces!.config(vmId)),
      policy.listenPort,
      bridgePort,
    );
    const bridged = await fetch(`http://127.0.0.1:${bridgePort}`, { signal: AbortSignal.timeout(15_000) });
    assert.equal((await bridged.json()).scope, 'alpha');
    await bridges.stop(vmId, alpha);
    console.log(`${distro}: checking live config guards and controller restart`);
    await within(alpha, async () => {
      const project = await workspaces!.config(vmId);
      await assert.rejects(
        workspaces!.save(vmId, { ...project, directory: '/workspace/moved' }),
        /停止.*边车/,
      );
      await assert.rejects(workspaces!.save(vmId, { ...project, networkIsolation: 'host' }), /停止.*边车/);
    });
    await assert.rejects(
      mesh.configure(vmId, false, async () => {
        enabled = false;
      }),
      /停止所有项目/,
    );
    await mesh.close();
    mesh = create();
    await mesh.init();
    assert.equal(
      (await status(alpha)).runId,
      a.runId,
      'controller restart must preserve the original binding',
    );
    await machines.suspend(vmId);
    console.log(`${distro}: checking paused guest guards`);
    assert.equal((await status(alpha)).sidecarStateKnown, false);
    await assert.rejects(action(alpha, 'save'), /恢复实例/);
    await assert.rejects(
      mesh.configure(vmId, false, async () => {
        enabled = false;
      }),
      /恢复实例/,
    );
    await machines.resume(vmId);
    assert.equal((await status(alpha)).bindingValid, true);
    console.log(
      `${distro}: three concurrent Envoys, project traffic, same ports, directory/environment${secrets ? '/secrets' : ''}, host bridge, restart and pause guards passed`,
    );

    // A valid JSON file with changed bytes must still invalidate the binding.
    await command(`printf ' ' >> ${quote(meshConfigPath(alpha))}`);
    assert.equal((await status(alpha)).bindingValid, false);
    await action(alpha, 'stop');
    assert.equal((await status(alpha)).sidecarRunning, false);
    assert.equal((await status(beta)).bindingValid, true);
    await action(alpha, 'start');
    await response(alpha, 'alpha');
    await action(alpha, 'stop');

    // A session without binding metadata is never silently reused.
    const legacy =
      `exec ip netns exec sk-${alpha} /usr/local/bin/envoy -c ${quote(meshConfigPath(alpha))} ` +
      `--disable-hot-restart --concurrency 1 --log-level warning`;
    await command(
      `tmux new-session -d -s ${meshSession(alpha)} -c ${quote(alphaDirectory)} ${quote(legacy)}`,
    );
    await response(alpha, 'alpha');
    assert.equal((await status(alpha)).bindingValid, false);
    await assert.rejects(action(alpha, 'start'), /先停止/);
    await action(alpha, 'stop');
    await response(beta, 'beta');

    // A detached real Envoy retains the fixed managed config path; cleanup finds
    // it even when tmux has already gone, and signals its pidfd rather than a PID.
    const detachedId = randomUUID();
    const detached = `cd ${quote(alphaDirectory)}\nexport SAKURA_MESH_RUN_ID=${detachedId}\n${legacy}`;
    await command(`setsid sh -c ${quote(detached)} </dev/null >/tmp/sakura-mesh-orphan.log 2>&1 &`);
    await response(alpha, 'alpha');
    const orphan = await status(alpha);
    assert.equal(orphan.sidecarRunning, true);
    assert.equal(orphan.bindingValid, false);
    await within(alpha, async () => {
      await assert.rejects(
        workspaces!.save(vmId, { directory: '/workspace/moved', networkIsolation: 'private' }),
        /停止.*边车/,
      );
    });
    await action(alpha, 'stop');
    assert.equal((await status(alpha)).sidecarRunning, false);
    await response(beta, 'beta');

    const abort = new AbortController(),
      originalExec = machines.exec.bind(machines);
    machines.exec = async (...args: Parameters<typeof originalExec>) => {
      const result = await originalExec(...args);
      if (args[1].includes(`tmux new-session -d -s ${meshSession(alpha)}`)) abort.abort();
      return result;
    };
    try {
      await assert.rejects(action(alpha, 'start', abort.signal));
    } finally {
      machines.exec = originalExec;
    }
    assert.equal((await status(alpha)).sidecarRunning, false);
    await response(beta, 'beta');
    await command(`ip -n sk-${alpha} route add blackhole 203.0.113.0/24`);
    try {
      await assert.rejects(action(alpha, 'start'), /路由/);
    } finally {
      await command(`ip -n sk-${alpha} route del blackhole 203.0.113.0/24`);
    }
    assert.equal((await status(alpha)).sidecarRunning, false);
    console.log(
      `${distro}: changed config, legacy session, detached process, cancellation and polluted namespace refused or cleaned; other project retained`,
    );

    for (const project of ['default', alpha, beta]) {
      await action(project, 'stop');
      await stopUpstream(project);
    }
    await mesh.configure(vmId, false, async () => {
      enabled = false;
    });
    await assert.rejects(action(alpha, 'start'), /已禁用/);
    await mesh.configure(vmId, true, async () => {
      enabled = true;
    });
    await command('sync');
    await machines.stop(vmId, true);
    await boot();
    for (const project of ['default', alpha, beta]) {
      assert.equal((await status(project)).sidecarRunning, false, 'sidecars do not auto-start at guest boot');
      assert.ok((await status(project)).policy, 'saved policy must survive boot');
    }
    await action(alpha, 'start');
    await startUpstream(alpha);
    await response(alpha, 'alpha');
    await action(alpha, 'stop');
    await stopUpstream(alpha);
    console.log(
      `${distro}: manual recovery after real VM reboot passed; Envoy ${envoyVersion} service-mesh smoke passed`,
    );
  } catch (error) {
    console.error(`${distro}: service-mesh smoke failed`, error);
    if (machines && vmId && machines.state(vmId) === 'running') {
      const diagnostic = await machines
        .exec(
          vmId,
          'dmesg | tail -n 8; ps -eo pid,ppid,pgid,stat,comm; journalctl -u ssh -n 8 --no-pager',
          10_000,
        )
        .catch(() => null);
      if (diagnostic)
        console.error('Guest diagnostics:', (diagnostic.stdout + diagnostic.stderr).slice(-4000));
    }
    throw error;
  } finally {
    await bridges?.close();
    await mesh?.close();
    await workspaces?.close();
    if (machines) {
      if (vmId && machines.live.has(vmId)) await machines.stop(vmId, true).catch(() => {});
      await machines.close();
    } else await engine.runtime.close();
    const target = await realpath(directory);
    assert.equal(dirname(target), await realpath(tmpdir()));
    assert.ok(basename(target).startsWith('sakura-service-mesh-'));
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
await run();
