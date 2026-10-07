/** 烟雾验收：验证生产接收器和编译见证的故障转移、持久 fencing 与目标恢复；BMC 在本机模拟。
 * Smoke acceptance for production receivers/compiled witnesses, durable fencing and target recovery; BMC is modeled locally. */
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
const pending = new Map<number, { resolve: /** 以请求 ID 匹配的目标 worker 成功回复兑现等待者；Promise 不接纳其他请求或未完成启动的状态。
 * Resolve a waiter with the target worker’s successful reply matched by request ID; unrelated replies or incomplete startup cannot fulfill it. */ (reply: Reply) => void; reject: /** 以目标 worker 错误、退出或截止失败拒绝当前请求，调用方同时移除 pending 槽与计时资源。
 * Reject the current request on target-worker error, exit or deadline, with the caller removing its pending slot/timer resources. */ (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let worker: ChildProcess | undefined, witness: ChildProcess | undefined, observer: ChildProcess | undefined;
let engine: Awaited<ReturnType<typeof createRuntime>> | undefined;
let machines: InstanceType<typeof Machines> | undefined, peers: InstanceType<typeof HostPeers> | undefined;
let workspaces: InstanceType<typeof Workspaces> | undefined, hostHa: InstanceType<typeof HaHostFailover> | undefined;
let vmId = '', targetVmId = '', workerOutput = '', witnessOutput = '', observerOutput = '', sequence = 0;
const servers: Server[] = [];
const appToken = randomBytes(32).toString('hex'), sourceToken = randomBytes(32).toString('hex'),
  trafficToken = randomBytes(32).toString('hex'), systemUuid = randomUUID();
let reportedSystemUuid = systemUuid, forceOffCount = 0, activeVmId = '', allowTraffic = false, trafficAttempts = 0;

/** 在给定总期限内轮询异步条件，成功返回；失败附标签、目标与见证进程日志帮助定位故障阶段。
 * Poll the async predicate within one total deadline, returning on success or failing with label/target/witness logs for phase diagnosis. */
async function waitUntil(label: string, check: () => Promise<boolean>, timeout = 300_000) {
  const deadline = Date.now() + timeout;
  while (true) {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error(`${label} timed out\n${workerOutput}\n${witnessOutput}`);
    await delay(500);
  }
}
/** 分配单调请求 ID 并登记 IPC 等待者，九十秒无回包失败；发送错误和期限都移除等待项及计时器。
 * Assign a monotonic request ID/register an IPC waiter with a ninety-second deadline; send errors/expiry remove waiter/timer state. */
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
/** 限制 HTTPS 夹具 JSON 请求体至 4096 字节，完整读取后解析，超限拒绝而不累积无限输入。
 * Bound fixture HTTPS JSON bodies to 4096 bytes, parse after full read and reject overflow without unbounded accumulation. */
async function input(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length; assert.ok(size <= 4096); chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
/** 登记本次 HTTPS 监听器后绑定回环随机端口，返回实际 URL；绑定错误拒绝，登记表供 finally 统一关闭。
 * Register this HTTPS listener/bind a random loopback port and return its actual URL; reject bind errors and retain it for finally teardown. */
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((done, fail) => server.listen(0, '127.0.0.1', done).once('error', fail));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return `https://127.0.0.1:${address.port}/`;
}
/** 只停止传入的自有 child，等待三十秒后升级 SIGKILL，并等待 exit 证明物理退出。
 * Stop only the supplied owned child, escalate to SIGKILL after thirty seconds and await exit as physical-termination evidence. */
async function stopProcess(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once('exit', () => done()));
  child.kill('SIGTERM');
  const deadline = Date.now() + 30_000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await delay(100);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await exited;
}
/** 在独立 witness-runtime 启动一次见证 CLI 并合并两路输出，要求退出零再返回日志。
 * Run one witness CLI in separate witness-runtime state, merge both streams and require zero exit before returning output. */
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
/** 以给定配置启动持续见证进程，保留六千字符日志尾与启动错误，关闭由外层管理。
 * Start the continuous witness with its configuration, retaining a six-thousand-character diagnostic tail/spawn errors while outer teardown owns closure. */
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
  const ready = await new Promise<Reply>(/** 在 60 秒启动截止内分流 ready/error 和按 ID 的业务回复；worker 退出时拒绝并清空全部 pending，逐个清理计时器，避免等待者永久悬挂。
 * Within a sixty-second startup deadline route ready/error and ID-matched work replies; worker exit rejects/clears every pending waiter and timer so none remains suspended. */ (done, fail) => {
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
  /** 报告真实主机资源和本夹具实例数，作为 HA 对等状态采样输入。
   * Report real host resources/fixture VM counts as HA peer-status sample input. */
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
  activeVmId = vmId;
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
  const bmcUrl = await listen(createServer(tls, (req, res) => void (/** 模拟受 Basic 认证的 Redfish BMC，仅允许精确系统 UUID 的 ForceOff 并真实停止源 VM；响应电源状态取实际 live，错误统一 503。
 * Model a Basic-authenticated Redfish BMC allowing ForceOff only for the exact system UUID and actually stopping the source VM; derive power state from live state and return 503 on errors. */ async () => {
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
  const trafficUrl = await listen(createServer(tls, (req, res) => void (/** 模拟流量控制器的拒绝/接纳边界：令牌和源/目标匹配后，还须源 VM 已停且目标应用已就绪才切换 activeVmId；应用路径读取真实目标 worker。
 * Model traffic-controller refusal/admission: after token/source/target checks require stopped source VM and ready target application before switching activeVmId; the application path reads the real target worker. */ async () => {
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
  /** 只为本次实例提供明确目标主机的自动故障转移策略，门槛为两次失败且副本最多六十分钟。
   * Provide automatic failover policy only for this VM/explicit target, with two failures and at most a sixty-minute replica age. */
  const policies = async () => ({ [vmId]: { enabled: true, options: {
    targetHostId: ready.hostId, failureThreshold: 2, maxReplicaAgeMinutes: 60, autoHostFailover: true } } });
  hostHa = new HaHostFailover(machines, peers, replications, policies, client);
  machines.beforeHaStart((id) => hostHa!.authorizeStart(id));
  await machines.enrollHaWitness(vmId, ready.hostId, 2);
  await machines.start(vmId);
  await waitUntil('enrolled source boot', async () => machines!.state(vmId) !== 'starting');
  assert.equal(machines.state(vmId), 'running');
  const changed = await machines.exec(vmId, 'printf current-only-data > /workspace/ha-data; sync', 10_000); assert.equal(changed.code, 0);
  await hostHa.sample(); assert.equal(hostHa.view(vmId).armed, true, JSON.stringify(hostHa.view(vmId)));
  const preflight = await checkHaWitnessDeployment(config); assert.equal(preflight.ok, true, JSON.stringify(preflight));
  const planFile = join(root, 'drill-plan.json'), observationsFile = join(root, 'drill-observations.jsonl');
  await runWitness(['--drill-plan', configPath, vmId, '--output', planFile]);
  const plan = JSON.parse(await readFile(planFile, 'utf8'));
  assert.equal(plan.replica.sourceVmId, vmId); assert.equal(plan.replica.remoteVmId, targetVmId);
  observer = spawn(process.execPath, [witnessEntry, '--observe', configPath,
    '--plan', planFile, '--output', observationsFile, '--timeout-seconds', '600'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SAKURA_DATA_DIR: join(root, 'observer-runtime') } });
  for (const stream of [observer.stdout, observer.stderr]) stream!.on('data', (chunk: Buffer) => {
    observerOutput = (observerOutput + chunk.toString()).slice(-6000);
  });
  await waitUntil('compiled observer baseline', async () => {
    assert.equal(observer!.exitCode, null, observerOutput);
    const text = await readFile(observationsFile, 'utf8').catch(() => '');
    return text.split('\n').slice(0, -1).filter(Boolean).some((line) => {
      const row = JSON.parse(line); return row.type === 'baseline' && row.sample.ok;
    });
  }, 30_000);
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
  assert.equal(activeVmId, vmId); assert.equal(trafficAttempts, 0);
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
  assert.equal((await client.status(identity)).phase, 'fenced'); assert.equal(activeVmId, vmId);
  allowTraffic = true;
  await waitUntil('traffic promotion', async () => (await client.status(identity)).phase === 'promoted', 60_000);
  assert.equal(activeVmId, targetVmId); assert.equal(forceOffCount, 1);
  const { haHttpsRequest } = await import('../server/ha-witness-http.ts');
  const routed = await haHttpsRequest(new URL('/app', trafficUrl).toString(), 'GET', undefined, { fingerprint }) as { marker: string; ready: boolean };
  assert.equal(routed.marker, 'historical-ha-data'); assert.equal(routed.ready, true);
  assert.equal((await checkHaWitnessDeployment(config)).ok, true);
  await waitUntil('compiled observer completion', async () => observer!.exitCode !== null, 30_000);
  assert.equal(observer.exitCode, 0, observerOutput);
  const observed = (await readFile(observationsFile, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const observationResult = observed.at(-1);
  assert.equal(observationResult.promotionObserved, true); assert.equal(observationResult.ok, true);
  assert.equal(observationResult.physicalNodeIndependenceVerified, false);
  assert.ok(observed.some((row) => row.type === 'baseline' && row.sample.sourceStartAllowed === true));
  assert.ok(observed.filter((row) => row.type === 'observation' && row.sample.phase === 'promoted' &&
    row.sample.stable && row.sample.ok && row.sample.sourceStartAllowed === false).length >= 2);
  console.log('Compiled drill-plan and observer captured a source baseline and two stable promoted samples; physical independence remains false');
  await request('write', { targetVmId });
  const written = (await request('http', { targetVmId })).result as { marker: string; bootId: string };
  assert.equal(written.marker, 'target-only-write');
  const cutoversBeforeRestart = trafficAttempts;
  await request('stop', { targetVmId });
  await waitUntil('promoted target restart with retained writes', async () => {
    const app = await request('http', { targetVmId }).then((value) =>
      value.result as { marker: string; bootId: string; ready: boolean }, () => null);
    const status = await client.status(identity);
    return !!app && app.bootId !== written.bootId && app.marker === 'target-only-write' &&
      app.ready && status.phase === 'promoted' && !status.error;
  });
  assert.equal(trafficAttempts, cutoversBeforeRestart); assert.equal(forceOffCount, 1);
  console.log('Compiled witness restarted the same real target with its new writes retained and no repeated traffic cutover');
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
  console.log(`PASS ${distro}: production receiver, real snapshot/VM/HTTP application, compiled witness restart, UUID rejection, fencing, readiness/traffic retry, read-only drill observation, same-target restart retaining writes and durable target retirement (BMC simulated locally)`);
} catch (error) {
  console.error('HA integration failed:', (error as Error).stack);
  throw error;
} finally {
  await stopProcess(observer); await hostHa?.close(); await stopProcess(witness);
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
