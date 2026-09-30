import assert from 'node:assert/strict';
import { fork, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { cpus, freemem, tmpdir, totalmem } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { generate } from 'selfsigned';
import { z } from 'zod';

const distro = process.argv[2] || 'alpine';
const images: Record<string, string> = { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' };
assert.ok(images[distro], 'unsupported smoke distro');
const witnessEntry = resolve('.sakura-witness/ha-witness.js');
await access(witnessEntry).catch(() => { throw new Error('Run npm run build before test:ha-failover'); });
const root = await mkdtemp(join(tmpdir(), 'sakura-ha-failover-'));
const sourceRoot = join(root, 'source'), targetRoot = join(root, 'target');
await Promise.all([mkdir(sourceRoot), mkdir(targetRoot)]);
const image = resolve('.data/images', images[distro]);
process.env.SAKURA_DATA_DIR = sourceRoot;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = image;
if (process.platform === 'linux' && !process.env.SAKURA_QEMU_DIR) process.env.SAKURA_QEMU_DIR = '/usr/bin';
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { HostPeers } = await import('../server/host-peers.ts');
const { Bundles } = await import('../server/bundles.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { SnapshotReplications } = await import('../server/snapshot-replications.ts');
const { HaHostFailover } = await import('../server/ha-host-failover.ts');
const { HaWitnessClient } = await import('../server/ha-witness-client.ts');
const { checkHaWitnessDeployment } = await import('../server/ha-witness-preflight.ts');
const { freePort } = await import('../server/qmp.ts');

type Reply = { id?: number; type?: 'ready' | 'error'; ok?: boolean; error?: string;
  port?: number; fingerprint?: string; hostId?: string; code?: string;
  applicationUrl?: string; applicationFingerprint?: string; result?: unknown };
const pending = new Map<number, { resolve: (reply: Reply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let worker: ChildProcess | undefined, witness: ChildProcess | undefined;
let engine: Awaited<ReturnType<typeof createRuntime>> | undefined;
let machines: InstanceType<typeof Machines> | undefined, peers: InstanceType<typeof HostPeers> | undefined;
let workspaces: InstanceType<typeof Workspaces> | undefined, hostHa: InstanceType<typeof HaHostFailover> | undefined;
let vmId = '', targetVmId = '', workerOutput = '', witnessOutput = '', sequence = 0;
const servers: Server[] = [];
const appToken = randomBytes(32).toString('hex'), sourceToken = randomBytes(32).toString('hex'),
  trafficToken = randomBytes(32).toString('hex'), systemUuid = randomUUID();
let reportedSystemUuid = systemUuid, forceOffCount = 0, activeVmId = '', allowTraffic = false, trafficAttempts = 0;

async function waitUntil(label: string, check: () => Promise<boolean>, timeout = 300_000) {
  const deadline = Date.now() + timeout;
  while (true) {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error(`${label} timed out\n${workerOutput}\n${witnessOutput}`);
    await delay(500);
  }
}
function request(action: string, payload: Record<string, unknown> = {}) {
  const id = ++sequence;
  return new Promise<Reply>((done, fail) => {
    const timer = setTimeout(() => { pending.delete(id); fail(new Error(`Target ${action} timed out: ${workerOutput}`)); }, 90_000);
    pending.set(id, { resolve: done, reject: fail, timer });
    worker!.send({ id, action, ...payload }, (error) => {
      if (error) { clearTimeout(timer); pending.delete(id); fail(error); }
    });
  });
}
async function input(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length; assert.ok(size <= 4096); chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((done, fail) => server.listen(0, '127.0.0.1', done).once('error', fail));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return `https://127.0.0.1:${address.port}/`;
}
async function stopProcess(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once('exit', () => done()));
  child.kill('SIGTERM');
  const deadline = Date.now() + 30_000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await delay(100);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await exited;
}
async function runWitness(args: string[]) {
  const child = spawn(process.execPath, [witnessEntry, ...args], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SAKURA_DATA_DIR: join(root, 'witness-runtime') } });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream!.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  const code = await new Promise<number | null>((done, fail) => {
    child.once('error', fail); child.once('exit', done);
  });
  assert.equal(code, 0, output);
  return output;
}
function startWitness(configPath: string) {
  witnessOutput = '';
  witness = spawn(process.execPath, [witnessEntry, configPath], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SAKURA_DATA_DIR: join(root, 'witness-runtime') } });
  for (const stream of [witness.stdout, witness.stderr]) stream!.on('data', (chunk: Buffer) => {
    witnessOutput = (witnessOutput + chunk.toString()).slice(-6000);
  });
  witness.on('error', (error) => { witnessOutput += error.message; });
}

try {
  worker = fork(resolve('scripts/ha-failover-target-worker.ts'), [], { cwd: process.cwd(),
    execArgv: ['--import', 'tsx'], env: { ...process.env, SAKURA_DATA_DIR: targetRoot,
      SAKURA_HA_TEST_APP_TOKEN: appToken }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  for (const stream of [worker.stdout, worker.stderr]) stream!.on('data', (chunk: Buffer) => {
    workerOutput = (workerOutput + chunk.toString()).slice(-6000);
  });
  const ready = await new Promise<Reply>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`Target startup timed out: ${workerOutput}`)), 60_000);
    worker!.on('error', (error) => { clearTimeout(timer); fail(error); });
    worker!.on('message', (reply: Reply) => {
      if (reply.type === 'ready') { clearTimeout(timer); done(reply); }
      else if (reply.type === 'error') { clearTimeout(timer); fail(new Error(reply.error)); }
      else if (reply.id !== undefined) {
        const waiter = pending.get(reply.id); if (!waiter) return;
        clearTimeout(waiter.timer); pending.delete(reply.id);
        reply.ok ? waiter.resolve(reply) : waiter.reject(new Error(reply.error));
      }
    });
    worker!.once('exit', (code) => {
      clearTimeout(timer); fail(new Error(`Target exited ${code}: ${workerOutput}`));
      for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Target exited')); }
      pending.clear();
    });
  });
  assert.ok(ready.port && ready.fingerprint && ready.hostId && ready.code && ready.applicationUrl && ready.applicationFingerprint);
  engine = await createRuntime(); machines = new Machines(engine); await machines.init();
  const status = async () => ({ platform: process.platform, arch: process.arch, cpus: cpus().length,
    memoryTotal: totalmem(), memoryFree: freemem(), load: [0, 0, 0],
    vmCount: machines!.records.size, runningVms: machines!.live.size });
  const peerFile = join(sourceRoot, 'source-peer.json');
  peers = new HostPeers(status, peerFile, 'HA integration source'); await peers.init(false);
  await peers.configure({ operation: 'connect', url: `https://127.0.0.1:${ready.port}/`,
    fingerprint: ready.fingerprint, code: ready.code });
  await request('grant', { requesterId: peers.view().hostId });
  const outbound = peers.view().outbound[0]; assert.equal(outbound.remoteId, ready.hostId);
  const vm = await machines.create({ name: `ha-source-${distro}`, distro, accelerator: 'auto',
    memoryMiB: distro === 'alpine' ? 512 : 1024, cpus: 2, diskGiB: 4, template: 'none', forwards: [] });
  vmId = vm.id;
  console.log(`Booting ${distro} source to prepare the historical application snapshot`);
  await machines.start(vmId);
  await waitUntil('source boot', async () => machines!.state(vmId) !== 'starting');
  assert.equal(machines.state(vmId), 'running', machines.logs.get(vmId));
  const install = await machines.exec(vmId, distro === 'alpine' ? 'apk add --no-cache python3' :
    'command -v python3 >/dev/null || { export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y python3; }', 300_000);
  assert.equal(install.code, 0, install.stderr);
  const applicationScript = `import http.server, json, os, pathlib
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"ready": pathlib.Path("/workspace/ha-ready").exists(),
            "marker": pathlib.Path("/workspace/ha-data").read_text(),
            "bootId": pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip(), "pid": os.getpid()}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *args): pass
http.server.HTTPServer(("127.0.0.1", 18080), Handler).serve_forever()
`;
  await machines.writeGuestFile(vmId, '/usr/local/bin/sakura-ha-smoke.py', applicationScript, false);
  await machines.writeGuestFile(vmId, '/workspace/ha-data', 'historical-ha-data', false);
  if (distro === 'alpine') {
    await machines.writeGuestFile(vmId, '/etc/init.d/sakura-ha-smoke', `#!/sbin/openrc-run
command=/usr/bin/python3
command_args=/usr/local/bin/sakura-ha-smoke.py
command_background=yes
pidfile=/run/sakura-ha-smoke.pid
depend() { after localmount; }
`, false);
  } else {
    await machines.writeGuestFile(vmId, '/etc/systemd/system/sakura-ha-smoke.service', `[Unit]
Description=Sakura HA smoke HTTP application
After=local-fs.target
[Service]
ExecStart=/usr/bin/python3 /usr/local/bin/sakura-ha-smoke.py
Restart=on-failure
[Install]
WantedBy=multi-user.target
`, false);
  }
  const prepared = await machines.exec(vmId, distro === 'alpine' ?
    'chmod 755 /etc/init.d/sakura-ha-smoke && rc-update add sakura-ha-smoke default && rc-service sakura-ha-smoke start' :
    'systemctl daemon-reload && systemctl enable --now sakura-ha-smoke', 30_000);
  assert.equal(prepared.code, 0, prepared.stderr);
  workspaces = new Workspaces(machines); await workspaces.save(vmId, { directory: '/workspace/ha-project', command: 'printf ha-project' });
  const synced = await machines.exec(vmId, 'sync', 15_000); assert.equal(synced.code, 0);
  await machines.stop(vmId, true);
  const snapshot = await machines.snapshot(vmId, 'historical-app');
  const replications = new SnapshotReplications(machines, new Bundles(machines), peers); await replications.init();
  const copied = await replications.run(vmId, { peerId: outbound.id, snapshotId: snapshot.id,
    targetName: `ha-standby-${distro}` }, new AbortController().signal);
  targetVmId = copied.remoteVmId;
  assert.equal(copied.ready, true);
  const standby = (await request('inspect', { targetVmId })).result as { status: string; ordinaryStartDenied: boolean };
  assert.equal(standby.status, 'stopped'); assert.equal(standby.ordinaryStartDenied, true);
  assert.equal(((await request('lock')).result as { locked: boolean }).locked, true);
  console.log('Snapshot copied and receipt checked over pinned TLS; target web session locked');

  const cert = await generate([{ name: 'commonName', value: 'localhost' }], {
    keyType: 'ec', curve: 'P-256', algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - 60_000), notAfterDate: new Date(Date.now() + 3600_000) });
  const tls = { cert: cert.cert, key: cert.private }, fingerprint = new X509Certificate(cert.cert).fingerprint256;
  const bmcUrl = await listen(createServer(tls, (req, res) => void (async () => {
    try {
      if (req.headers.authorization !== `Basic ${Buffer.from('test-bmc:test-password').toString('base64')}`)
        throw new Error('Unauthorized BMC request');
      if (req.method === 'POST') {
        assert.equal(req.url, '/redfish/v1/Systems/1/Actions/ComputerSystem.Reset');
        assert.deepEqual(await input(req), { ResetType: 'ForceOff' });
        assert.equal(reportedSystemUuid, systemUuid); forceOffCount++;
        await machines!.stop(vmId, true);
      } else assert.equal(req.url, '/redfish/v1/Systems/1');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ UUID: reportedSystemUuid, PowerState: machines!.live.has(vmId) ? 'On' : 'Off' }));
    } catch (error) { res.writeHead(503); res.end(JSON.stringify({ error: (error as Error).message })); }
  })()));
  const trafficUrl = await listen(createServer(tls, (req, res) => void (async () => {
    try {
      const url = new URL(req.url!, 'https://localhost');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/app') {
        assert.equal(req.method, 'GET'); assert.equal(activeVmId, targetVmId);
        res.end(JSON.stringify((await request('http', { targetVmId: activeVmId })).result)); return;
      }
      if (req.headers.authorization !== `Bearer ${trafficToken}`) throw new Error('Unauthorized traffic request');
      if (req.method === 'POST') {
        assert.equal(url.pathname, '/activate');
        assert.deepEqual(await input(req), { sourceVmId: vmId, targetVmId });
        trafficAttempts++;
        if (!allowTraffic) { res.end(JSON.stringify({ accepted: false, activeVmId })); return; }
        assert.equal(machines!.live.has(vmId), false);
        const app = (await request('http', { targetVmId })).result as { ready: boolean };
        assert.equal(app.ready, true); activeVmId = targetVmId;
        res.end(JSON.stringify({ accepted: true, activeVmId }));
      } else {
        assert.equal(url.pathname, '/status'); assert.equal(url.searchParams.get('sourceVmId'), vmId);
        res.end(JSON.stringify({ activeVmId }));
      }
    } catch (error) { res.writeHead(503); res.end(JSON.stringify({ error: (error as Error).message })); }
  })()));
  const certFile = join(root, 'cert.pem'), keyFile = join(root, 'key.pem'), configPath = join(root, 'witness.json');
  await writeFile(certFile, cert.cert); await writeFile(keyFile, cert.private);
  const paired = JSON.parse(await readFile(peerFile, 'utf8')).outbound.find((item: { id: string }) => item.id === outbound.id);
  const config = { version: 1, listen: { host: '127.0.0.1', port: await freePort(), certFile, keyFile },
    stateFile: join(root, 'witness-state.json'), sourceToken, vms: [{ sourceHostId: peers.view().hostId,
      sourceVmId: vmId, targetHostId: ready.hostId, failureThreshold: 2,
      redfish: { baseUrl: bmcUrl, systemPath: '/redfish/v1/Systems/1', systemUuid,
        username: 'test-bmc', password: 'test-password', fingerprint },
      target: { baseUrl: `https://127.0.0.1:${ready.port}/`, fingerprint: ready.fingerprint, token: paired.token },
      application: { url: ready.applicationUrl, token: appToken, fingerprint: ready.applicationFingerprint },
      traffic: { baseUrl: trafficUrl, token: trafficToken, fingerprint } }] };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  await runWitness(['--initialize', configPath]);
  const initialPreflight = JSON.parse(await runWitness(['--preflight', configPath])); assert.equal(initialPreflight.ok, true);
  startWitness(configPath);
  const client = new HaWitnessClient({ version: 1, url: `https://127.0.0.1:${config.listen.port}/`, fingerprint, token: sourceToken });
  const identity = { sourceHostId: peers.view().hostId, sourceVmId: vmId };
  await waitUntil('witness startup', async () => client.status(identity).then(() => true, () => false), 60_000);
  const policies = async () => ({ [vmId]: { enabled: true, options: {
    targetHostId: ready.hostId, failureThreshold: 2, maxReplicaAgeMinutes: 60, autoHostFailover: true } } });
  hostHa = new HaHostFailover(machines, peers, replications, policies, client);
  machines.setHaStartGuard((id) => hostHa!.authorizeStart(id));
  await machines.enrollHaWitness(vmId, ready.hostId, 2);
  await machines.start(vmId);
  await waitUntil('enrolled source boot', async () => machines!.state(vmId) !== 'starting');
  assert.equal(machines.state(vmId), 'running');
  const changed = await machines.exec(vmId, 'printf current-only-data > /workspace/ha-data; sync', 10_000); assert.equal(changed.code, 0);
  await hostHa.sample(); assert.equal(hostHa.view(vmId).armed, true, JSON.stringify(hostHa.view(vmId)));
  const preflight = await checkHaWitnessDeployment(config); assert.equal(preflight.ok, true, JSON.stringify(preflight));
  reportedSystemUuid = randomUUID();
  console.log('Source heartbeats withheld; wrong BMC UUID must keep the real target stopped');
  await waitUntil('identity rejection', async () => {
    const status = await client.status(identity); return status.phase === 'fencing' && !!status.error;
  }, 90_000);
  assert.equal(forceOffCount, 0); assert.equal(machines.state(vmId), 'running');
  assert.equal(((await request('inspect', { targetVmId })).result as { status: string }).status, 'stopped');
  reportedSystemUuid = systemUuid;
  await waitUntil('source fenced and target booted', async () => {
    const status = await client.status(identity);
    if (status.phase !== 'fenced') return false;
    return ((await request('inspect', { targetVmId })).result as { status: string }).status === 'running';
  });
  assert.equal(forceOffCount, 1); assert.equal(machines.state(vmId), 'stopped');
  assert.equal(activeVmId, ''); assert.equal(trafficAttempts, 0);
  await assert.rejects(machines.start(vmId), /见证节点未确认来源启动/);
  const booted = (await request('http', { targetVmId })).result as { ready: boolean; marker: string };
  assert.equal(booted.marker, 'historical-ha-data'); assert.equal(booted.ready, false);
  console.log('Real source powered off; real standby application booted from its historical snapshot; source restart denied');

  console.log('Restarting compiled witness while the target application is unready');
  await stopProcess(witness); startWitness(configPath);
  await waitUntil('durable witness restart', async () => client.status(identity).then((status) => status.phase === 'fenced', () => false), 60_000);
  await assert.rejects(machines.start(vmId), /见证节点未确认来源启动/);
  await request('ready', { targetVmId });
  console.log('Witness restart retained the source fence; guest readiness enabled, traffic remains denied');
  await waitUntil('traffic rejection', async () => trafficAttempts > 0, 60_000);
  assert.equal((await client.status(identity)).phase, 'fenced'); assert.equal(activeVmId, '');
  allowTraffic = true;
  await waitUntil('traffic promotion', async () => (await client.status(identity)).phase === 'promoted', 60_000);
  assert.equal(activeVmId, targetVmId); assert.equal(forceOffCount, 1);
  const { haHttpsRequest } = await import('../server/ha-witness-http.ts');
  const routed = await haHttpsRequest(new URL('/app', trafficUrl).toString(), 'GET', undefined, { fingerprint }) as { marker: string; ready: boolean };
  assert.equal(routed.marker, 'historical-ha-data'); assert.equal(routed.ready, true);
  assert.equal((await checkHaWitnessDeployment(config)).ok, true);
  await assert.rejects(hostHa.rejoin(vmId, true), /HTTP 502/);
  assert.equal((await client.status(identity)).phase, 'promoted');
  assert.equal(((await request('inspect', { targetVmId })).result as { status: string }).status, 'running');
  await assert.rejects(machines.start(vmId), /见证节点未确认来源启动/);
  await request('stop', { targetVmId });
  const released = await hostHa.rejoin(vmId, true); assert.equal(released.released, true);
  const retired = (await request('inspect', { targetVmId })).result as { retired: boolean; ordinaryStartDenied: boolean };
  assert.equal(retired.retired, true); assert.equal(retired.ordinaryStartDenied, true);
  await assert.rejects(peers.activateReplica(outbound.id, { transferId: copied.transferId,
    remoteVmId: targetVmId, sha256: copied.sha256, sourceVmId: vmId, snapshotId: snapshot.id }), /HTTP 409/);
  await machines.start(vmId);
  await waitUntil('source rejoin boot', async () => machines!.state(vmId) !== 'starting');
  assert.equal(machines.state(vmId), 'running');
  assert.equal(await machines.readGuestFile(vmId, '/workspace/ha-data'), 'current-only-data');
  console.log(`PASS ${distro}: production receiver, real snapshot/VM/HTTP application, compiled witness restart, UUID rejection, fencing, readiness/traffic retry and durable target retirement (BMC simulated locally)`);
} catch (error) {
  console.error('HA integration failed:', (error as Error).stack);
  throw error;
} finally {
  await hostHa?.close(); await stopProcess(witness);
  await workspaces?.close(); await machines?.close(); await peers?.close(); await engine?.runtime.close();
  if (worker && worker.exitCode === null && worker.signalCode === null) {
    await request('shutdown').catch(() => {});
    await waitUntil('target shutdown', async () => worker!.exitCode !== null || worker!.signalCode !== null, 30_000);
  }
  for (const server of servers) if (server.listening)
    await new Promise<void>((done) => server.close(() => done()));
  const [resolved, temporary] = await Promise.all([realpath(root), realpath(tmpdir())]);
  assert.equal(dirname(resolved).toLowerCase(), temporary.toLowerCase());
  assert.ok(basename(resolved).startsWith('sakura-ha-failover-'));
  await rm(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
