import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createSshKey, seedIso } from '../server/seed.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-live-target-smoke-'));
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_PATH = join(process.cwd(), '.data', 'images', 'alpine-3.23.qcow2');
if (process.platform === 'linux' && !process.env.SAKURA_QEMU_DIR)
  process.env.SAKURA_QEMU_DIR = '/usr/bin';
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
const { LiveMigrationReceiver } = await import('../server/live-migration-receiver.ts');
const { HostPeers } = await import('../server/host-peers.ts');
const { qmp } = await import('../server/qmp.ts');
const { freePort } = await import('../server/qmp.ts');
let engine: Awaited<ReturnType<typeof createRuntime>> | undefined;
let machines: InstanceType<typeof Machines> | undefined;
let sourcePeers: InstanceType<typeof HostPeers> | undefined;
let targetPeers: InstanceType<typeof HostPeers> | undefined;
let targetVmId: string | undefined;
let migrationSession: string | undefined;
try {
  engine = await createRuntime();
  machines = new Machines(engine);
  await machines.init();
  const peerStatus = async () => ({ platform: process.platform, arch: process.arch,
    cpus: 4, memoryTotal: 8 * 1024 ** 3, memoryFree: 4 * 1024 ** 3,
    load: [0, 0, 0], vmCount: 1, runningVms: 0 });
  const peerPort = await freePort();
  const targetPeerFile = join(root, 'target-peer.json');
  targetPeers = new HostPeers(peerStatus, targetPeerFile, 'Target');
  await targetPeers.init(false);
  await targetPeers.configure({ operation: 'listener', listener: {
    enabled: true, host: '127.0.0.1', port: peerPort,
  } });
  await targetPeers.close();
  targetPeers = new HostPeers(peerStatus, targetPeerFile, 'Target');
  await targetPeers.init(true);
  sourcePeers = new HostPeers(peerStatus, join(root, 'source-peer.json'), 'Source');
  await sourcePeers.init(false);
  const code = await targetPeers.configure({ operation: 'create-code' });
  if (!('pairing' in code) || !code.pairing) throw new Error('Missing peer code');
  await sourcePeers.configure({ operation: 'connect',
    url: `https://127.0.0.1:${peerPort}/`,
    fingerprint: targetPeers.view().fingerprint, code: code.pairing.value });
  const inboundId = targetPeers.view().incoming[0].id;
  const outboundId = sourcePeers.view().outbound[0].id;
  await targetPeers.configure({ operation: 'allow-import', id: inboundId, enabled: true });
  await targetPeers.configure({ operation: 'allow-activate', id: inboundId, enabled: true });
  const receiver = new LiveMigrationReceiver(machines, targetPeers);
  targetPeers.setLiveMigrationReceiver({ prepare: (input) => receiver.prepare(input) });
  const key = createSshKey().privateText;
  const seed = seedIso({ 'meta-data': 'migration smoke', 'user-data': 'smoke setup' });
  const prepared = await sourcePeers.prepareLiveTarget(outboundId, {
    sourceVmId: randomUUID(), transferId: randomUUID(),
    config: createSchema.parse({ name: 'migration-target', accelerator: 'tcg',
      memoryMiB: 256, cpus: 1, diskGiB: 2 }), key, seedBase64: seed.toString('base64'),
  });
  targetVmId = prepared.targetVmId;
  migrationSession = prepared.sessionId;
  assert.equal(machines.state(targetVmId), 'paused');
  assert.equal(machines.get(targetVmId).liveMigrationOrigin?.status, 'prepared');
  assert.equal(await readFile(join(vmDir(targetVmId), 'id_rsa'), 'utf8'), key);
  assert.deepEqual(await readFile(join(vmDir(targetVmId), 'seed.iso')), seed);
  const qmpPort = machines.live.get(targetVmId)!.qmpPort;
  assert.equal((await qmp(qmpPort, 'query-status') as { running: boolean }).running, false);
  assert.equal((await sourcePeers.targetMigrationQmp(outboundId, migrationSession,
    'query-status') as { running: boolean }).running, false);
  await assert.rejects(machines.start(targetVmId), /尚未接收客户机状态/);
  console.log('A paired TLS request created a real Sakura QEMU target in deferred incoming mode, retained source identity, exposed restricted QMP and remained paused.');
} finally {
  if (migrationSession) targetPeers?.closeMigrationSession(migrationSession);
  if (machines && targetVmId) {
    await machines.stop(targetVmId, true).catch(() => {});
    await machines.delete(targetVmId).catch(() => {});
  }
  await machines?.close();
  await sourcePeers?.close();
  await targetPeers?.close();
  await engine?.runtime.close();
  const [resolved, temporary] = await Promise.all([realpath(root), realpath(tmpdir())]);
  if (dirname(resolved).toLowerCase() !== temporary.toLowerCase() ||
      !basename(resolved).startsWith('sakura-live-target-smoke-'))
    throw new Error('Refusing unexpected smoke cleanup path');
  await rm(resolved, { recursive: true, force: true });
}
