import assert from 'node:assert/strict';
import { randomUUID, X509Certificate } from 'node:crypto';
import { createServer, type Server } from 'node:https';
import { cpus, freemem, totalmem } from 'node:os';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import { z } from 'zod';

if (process.platform === 'linux' && !process.env.SAKURA_QEMU_DIR)
  process.env.SAKURA_QEMU_DIR = '/usr/bin';
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { HostPeers } = await import('../server/host-peers.ts');
const { Bundles } = await import('../server/bundles.ts');
const { createHostImportReceiver } = await import('../server/host-import-receiver.ts');
const { SessionLock } = await import('../server/session-lock.ts');
const { freePort } = await import('../server/qmp.ts');

type Request = { id: number; action: 'grant' | 'inspect' | 'ready' | 'write' | 'http' | 'stop' | 'lock' | 'shutdown';
  requesterId?: string; targetVmId?: string };
const send = (payload: unknown) => process.send?.(payload);
let engine: Awaited<ReturnType<typeof createRuntime>> | undefined;
let machines: InstanceType<typeof Machines> | undefined;
let peers: InstanceType<typeof HostPeers> | undefined;
let application: Server | undefined;
let session: InstanceType<typeof SessionLock> | undefined;
let work: Promise<unknown> = Promise.resolve();
let closing: Promise<void> | undefined;
const appToken = process.env.SAKURA_HA_TEST_APP_TOKEN!;
assert.match(appToken, /^[a-f0-9]{64}$/);

async function guestHttp(id: string) {
  z.uuid().parse(id);
  const result = await machines!.exec(id,
    `python3 -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:18080/health", timeout=3).read().decode())'`,
    10_000);
  if (result.code !== 0) throw new Error(result.stderr || 'Guest HTTP application unavailable');
  return z.object({ ready: z.boolean(), marker: z.string(), bootId: z.uuid(), pid: z.number().int() })
    .strict().parse(JSON.parse(result.stdout));
}

function close() {
  return closing ||= (async () => {
    if (application?.listening) await new Promise<void>((done) => application!.close(() => done()));
    await machines?.close(); await peers?.close(); await session?.close(); await engine?.runtime.close();
  })();
}

try {
  engine = await createRuntime(); machines = new Machines(engine); await machines.init();
  const status = async () => ({ platform: process.platform, arch: process.arch,
    cpus: cpus().length, memoryTotal: totalmem(), memoryFree: freemem(), load: [0, 0, 0],
    vmCount: machines!.records.size, runningVms: machines!.live.size });
  const port = await freePort(), file = join(process.env.SAKURA_DATA_DIR!, 'target-peer.json');
  peers = new HostPeers(status, file, 'HA integration target'); await peers.init(false);
  await peers.configure({ operation: 'listener', listener: { enabled: true, host: '127.0.0.1', port } });
  await peers.close(); peers = new HostPeers(status, file, 'HA integration target'); await peers.init(true);
  const bundles = new Bundles(machines);
  session = new SessionLock(); await session.init(false);
  peers.setImportReceiver(createHostImportReceiver(machines, { bundles: () => bundles,
    migrationBlocked: () => false,
    requireSessionUnlocked: () => session!.requireUnlocked() }));
  const cert = await generate([{ name: 'commonName', value: 'localhost' }], {
    keyType: 'ec', curve: 'P-256', algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - 60_000), notAfterDate: new Date(Date.now() + 3600_000) });
  application = createServer({ cert: cert.cert, key: cert.private }, (req, res) => void (async () => {
    try {
      if (req.headers.authorization !== `Bearer ${appToken}`) {
        res.writeHead(401); res.end(); return;
      }
      const url = new URL(req.url!, 'https://localhost');
      assert.equal(req.method, 'GET'); assert.equal(url.pathname, '/health');
      const id = z.uuid().parse(url.searchParams.get('vmId'));
      let ready = false;
      if (machines!.state(id) === 'running')
        ready = await guestHttp(id).then((value) => value.ready &&
          ['historical-ha-data', 'target-only-write'].includes(value.marker), () => false);
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ready, vmId: id }));
    } catch { res.writeHead(503); res.end(); }
  })());
  await new Promise<void>((done) => application!.listen(0, '127.0.0.1', done));
  const address = application.address(); assert.ok(address && typeof address !== 'string');
  const code = await peers.configure({ operation: 'create-code' }); assert.ok('pairing' in code && code.pairing);
  send({ type: 'ready', port, fingerprint: peers.view().fingerprint, hostId: peers.view().hostId,
    code: code.pairing.value, applicationUrl: `https://127.0.0.1:${address.port}/health`,
    applicationFingerprint: new X509Certificate(cert.cert).fingerprint256 });
  process.on('message', (raw: Request) => {
    work = work.then(async () => {
      try {
        let result: unknown;
        if (raw.action === 'grant') {
          const inbound = peers!.view().incoming.find((item) => item.requesterId === raw.requesterId);
          assert.ok(inbound);
          await peers!.configure({ operation: 'allow-import', id: inbound.id, enabled: true });
          await peers!.configure({ operation: 'allow-failover', id: inbound.id, enabled: true });
        } else if (raw.action === 'lock') {
          await session!.configure({ enabled: true, idleMinutes: 240, newPassword: randomUUID() });
          result = session!.lock(); assert.equal(session!.view().locked, true);
          assert.throws(() => session!.requireUnlocked(), /控制面已锁定/);
        }
        else if (raw.action === 'inspect') {
          const id = z.uuid().parse(raw.targetVmId), vm = machines!.get(id);
          let ordinaryStartDenied = false;
          try { await machines!.start(id); } catch { ordinaryStartDenied = true; }
          result = { status: machines!.state(id), ordinaryStartDenied,
            retired: !!vm.haRetirement, origin: vm.migrationOrigin,
            ...(machines!.state(id) === 'running' ? { application: await guestHttp(id) } : {}) };
        } else if (raw.action === 'ready') {
          const response = await machines!.exec(z.uuid().parse(raw.targetVmId), 'touch /workspace/ha-ready', 10_000);
          assert.equal(response.code, 0, response.stderr);
        } else if (raw.action === 'write') {
          const response = await machines!.exec(z.uuid().parse(raw.targetVmId),
            'printf target-only-write > /workspace/ha-data; sync', 10_000);
          assert.equal(response.code, 0, response.stderr);
        } else if (raw.action === 'http') result = await guestHttp(z.uuid().parse(raw.targetVmId));
        else if (raw.action === 'stop') await machines!.stop(z.uuid().parse(raw.targetVmId), true);
        else if (raw.action === 'shutdown') {
          await close(); send({ id: raw.id, ok: true }); process.disconnect(); return;
        } else throw new Error('Unknown worker action');
        send({ id: raw.id, ok: true, result });
      } catch (error) { send({ id: raw.id, ok: false, error: (error as Error).message }); }
    });
  });
  process.once('disconnect', () => void work.finally(close));
} catch (error) {
  send({ type: 'error', error: (error as Error).stack }); await close(); process.disconnect(); process.exitCode = 1;
}
