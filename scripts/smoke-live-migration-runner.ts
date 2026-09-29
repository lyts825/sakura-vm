import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = await mkdtemp(join(tmpdir(), 'sakura-live-runner-smoke-'));
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_PATH = join(process.cwd(), '.data', 'images', 'alpine-3.23.qcow2');
if (process.platform === 'linux' && !process.env.SAKURA_QEMU_DIR)
  process.env.SAKURA_QEMU_DIR = '/usr/bin';
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { HostPeers } = await import('../server/host-peers.ts');
const { LiveMigrationReceiver } = await import('../server/live-migration-receiver.ts');
const { LiveMigrationRunner } = await import('../server/live-migration-runner.ts');
const { freePort, qmp } = await import('../server/qmp.ts');
let engine: Awaited<ReturnType<typeof createRuntime>> | undefined;
let source: InstanceType<typeof Machines> | undefined;
let target: InstanceType<typeof Machines> | undefined;
let sourcePeers: InstanceType<typeof HostPeers> | undefined;
let targetPeers: InstanceType<typeof HostPeers> | undefined;
let sourceVmId: string | undefined;
let targetVmId: string | undefined;
try {
  engine = await createRuntime();
  source = new Machines(engine);
  target = new Machines(engine);
  await source.init();
  await target.init();
  const peerStatus = async () => ({ platform: process.platform, arch: process.arch,
    cpus: 4, memoryTotal: 8 * 1024 ** 3, memoryFree: 4 * 1024 ** 3,
    load: [0, 0, 0], vmCount: 1, runningVms: 0 });
  const port = await freePort();
  const targetFile = join(root, 'target-peer.json');
  targetPeers = new HostPeers(peerStatus, targetFile, 'Target');
  await targetPeers.init(false);
  await targetPeers.configure({ operation: 'listener', listener: {
    enabled: true, host: '127.0.0.1', port,
  } });
  await targetPeers.close();
  targetPeers = new HostPeers(peerStatus, targetFile, 'Target');
  await targetPeers.init(true);
  sourcePeers = new HostPeers(peerStatus, join(root, 'source-peer.json'), 'Source');
  await sourcePeers.init(false);
  const code = await targetPeers.configure({ operation: 'create-code' });
  if (!('pairing' in code) || !code.pairing) throw new Error('Missing pairing code');
  await sourcePeers.configure({ operation: 'connect',
    url: `https://127.0.0.1:${port}/`,
    fingerprint: targetPeers.view().fingerprint, code: code.pairing.value });
  const inboundId = targetPeers.view().incoming[0].id;
  const outbound = sourcePeers.view().outbound[0];
  await targetPeers.configure({ operation: 'allow-import', id: inboundId, enabled: true });
  await targetPeers.configure({ operation: 'allow-activate', id: inboundId, enabled: true });
  const receiver = new LiveMigrationReceiver(target, targetPeers);
  targetPeers.setLiveMigrationReceiver({
    prepare: (input) => receiver.prepare(input),
    complete: (input) => receiver.complete(input),
    abort: (input) => receiver.abort(input),
    status: (input) => Promise.resolve(receiver.status(input)),
  });
  const vm = await source.create({ name: 'migration-source', accelerator: 'tcg',
    memoryMiB: 256, cpus: 1, diskGiB: 2 });
  sourceVmId = vm.id;
  await source.start(vm.id);
  const bootDeadline = Date.now() + 120_000;
  while (source.state(vm.id) !== 'running') {
    if (Date.now() >= bootDeadline) throw new Error('Source guest did not become ready');
    await delay(500);
  }
  assert.equal((await source.exec(vm.id,
    'printf sakura-live-migration > /tmp/sakura-migration-marker', 15_000)).code, 0);
  let lastMigrationStatus = '';
  const tracedQmp = (async (qmpPort: number, command: string,
    args?: Record<string, unknown>, timeoutMs?: number) => {
    try {
      const result = await qmp(qmpPort, command, args, timeoutMs);
      if (!command.startsWith('query-')) console.log('Source QMP:', command);
      if (command === 'query-migrate') {
        const status = (result as { status?: string }).status || 'none';
        if (status !== lastMigrationStatus) {
          console.log('Source migration:', status);
          lastMigrationStatus = status;
        }
      }
      return result;
    } catch (error) {
      console.error('Source QMP failed:', command, String(error));
      throw error;
    }
  }) as typeof qmp;
  const runner = new LiveMigrationRunner(source, sourcePeers, tracedQmp);
  let result: Awaited<ReturnType<typeof runner.run>>;
  try {
    result = await runner.run(vm.id, {
      targetHostId: outbound.remoteId, targetName: 'migration-target',
    }, undefined, (line) => process.stdout.write(line));
  } catch (error) {
    await delay(2000);
    console.error('Source QEMU:', source.state(vm.id),
      source.live.get(vm.id)?.qmpPort, source.get(vm.id).lastError,
      source.logs.get(vm.id)?.slice(-4000));
    for (const targetVm of target.records.values())
      console.error('Target QEMU:', target.state(targetVm.id),
        target.live.get(targetVm.id)?.qmpPort,
        target.logs.get(targetVm.id)?.slice(-4000));
    throw error;
  }
  targetVmId = result.targetVmId;
  assert.equal(result.ready, true);
  assert.equal(source.state(vm.id), 'stopped');
  assert.equal(source.get(vm.id).liveMigrationFence?.targetVmId, targetVmId);
  assert.equal(target.get(targetVmId).liveMigrationOrigin?.status, 'ready');
  const marker = await target.exec(targetVmId, 'cat /tmp/sakura-migration-marker', 15_000);
  assert.equal(marker.code, 0);
  assert.equal(marker.stdout.trim(), 'sakura-live-migration');
  console.log('A live Alpine guest retained its in-memory marker through paired TLS disk and RAM migration; target SSH became ready and source QEMU stopped behind a durable fence.');
} finally {
  if (source && sourceVmId) await source.stop(sourceVmId, true).catch(() => {});
  if (target && targetVmId) await target.stop(targetVmId, true).catch(() => {});
  await source?.close();
  await target?.close();
  await sourcePeers?.close();
  await targetPeers?.close();
  await engine?.runtime.close();
  const [resolved, temporary] = await Promise.all([realpath(root), realpath(tmpdir())]);
  if (dirname(resolved).toLowerCase() !== temporary.toLowerCase() ||
      !basename(resolved).startsWith('sakura-live-runner-smoke-'))
    throw new Error('Refusing unexpected smoke cleanup path');
  await rm(resolved, { recursive: true, force: true });
}
