import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = await mkdtemp(join(tmpdir(), 'sakura-live-distributed-'));
const sourceRoot = join(root, 'source'), targetRoot = join(root, 'target');
await Promise.all([mkdir(sourceRoot), mkdir(targetRoot)]);
const image = join(process.cwd(), '.data', 'images', 'alpine-3.23.qcow2');
process.env.SAKURA_DATA_DIR = sourceRoot;
process.env.SAKURA_IMAGE_PATH = image;
if (process.platform === 'linux' && !process.env.SAKURA_QEMU_DIR)
  process.env.SAKURA_QEMU_DIR = '/usr/bin';
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { HostPeers } = await import('../server/host-peers.ts');
const { LiveMigrationRunner } = await import('../server/live-migration-runner.ts');
const { createLiveMigrationCompletionPort } = await import('../server/live-migration-proof.ts');
const { vmDir } = await import('../server/model.ts');
const { qmp } = await import('../server/qmp.ts');

type Reply = { id?: number; type?: 'ready' | 'error'; ok?: boolean; error?: string;
  port?: number; fingerprint?: string; hostId?: string; code?: string;
  result?: { status: string; originStatus: string; marker: string;
    persistentMarker: string; sessionId: string;
    projectCommand: string; projectCount: number } };
let worker: ChildProcess | undefined;
let engine: Awaited<ReturnType<typeof createRuntime>> | undefined;
let machines: InstanceType<typeof Machines> | undefined;
let peers: InstanceType<typeof HostPeers> | undefined;
let vmId: string | undefined;
let workerOutput = '';
const pending = new Map<number, { resolve: (value: Reply) => void; reject: (error: Error) => void }>();
let sequence = 0;

function request(action: 'grant' | 'inspect' | 'restart', payload: Record<string, unknown>) {
  const id = ++sequence;
  return new Promise<Reply>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.send({ id, action, ...payload }, (error) => {
      if (error) { pending.delete(id); reject(error); }
    });
  });
}

try {
  worker = fork(join(process.cwd(), 'scripts', 'live-migration-target-worker.ts'), [], {
    cwd: process.cwd(), execArgv: ['--import', 'tsx'],
    env: { ...process.env, SAKURA_DATA_DIR: targetRoot, SAKURA_IMAGE_PATH: image },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  worker.stdout?.on('data', (chunk: Buffer) => {
    workerOutput = (workerOutput + chunk.toString()).slice(-6000);
  });
  worker.stderr?.on('data', (chunk: Buffer) => {
    workerOutput = (workerOutput + chunk.toString()).slice(-6000);
  });
  const ready = await new Promise<Reply>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Target worker timeout: ${workerOutput}`)),
      60_000);
    const onMessage = (message: Reply) => {
      if (message.type === 'ready') { clearTimeout(timer); resolve(message); }
      else if (message.type === 'error') {
        clearTimeout(timer); reject(new Error(message.error));
      } else if (message.id !== undefined) {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        message.ok ? waiter.resolve(message) : waiter.reject(new Error(message.error));
      }
    };
    worker!.on('message', onMessage);
    worker!.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Target worker exited ${code}: ${workerOutput}`));
      for (const waiter of pending.values()) waiter.reject(new Error('Target worker exited'));
      pending.clear();
    });
  });
  assert.ok(ready.port && ready.fingerprint && ready.hostId && ready.code);
  engine = await createRuntime();
  machines = new Machines(engine);
  await machines.init();
  const status = async () => ({ platform: process.platform, arch: process.arch,
    cpus: 4, memoryTotal: 8 * 1024 ** 3, memoryFree: 4 * 1024 ** 3,
    load: [0, 0, 0], vmCount: machines!.records.size,
    runningVms: machines!.live.size });
  peers = new HostPeers(status, join(sourceRoot, 'source-peer.json'), 'Source');
  await peers.init(false);
  await peers.configure({ operation: 'connect',
    url: `https://127.0.0.1:${ready.port}/`, fingerprint: ready.fingerprint,
    code: ready.code });
  await request('grant', { requesterId: peers.view().hostId });
  const outbound = peers.view().outbound[0];
  assert.equal(outbound.remoteId, ready.hostId);
  const vm = await machines.create({ name: 'distributed-source', accelerator: 'tcg',
    memoryMiB: 256, cpus: 1, diskGiB: 2 });
  vmId = vm.id;
  await machines.organize(vmId,
    { group: 'migration', tags: ['distributed'], favorite: true });
  await machines.start(vmId);
  const bootDeadline = Date.now() + 120_000;
  while (machines.state(vmId) !== 'running') {
    if (Date.now() >= bootDeadline) throw new Error('Source guest did not become ready');
    await delay(500);
  }
  assert.equal((await machines.exec(vmId,
    'printf distributed-guest > /tmp/sakura-migration-marker; printf persistent-guest > /workspace/sakura-migration-marker; sync', 15_000)).code, 0);
  await writeFile(join(vmDir(vmId), 'projects.json'), JSON.stringify({ active: 'default',
    projects: [{ id: 'default', name: '默认项目' }] }));
  await writeFile(join(vmDir(vmId), 'project.json'), JSON.stringify({
    directory: '/workspace', command: 'printf distributed-project',
  }));
  const runner = new LiveMigrationRunner(machines, peers, undefined, undefined,
    createLiveMigrationCompletionPort(machines, () => peers!));
  const prepare = peers.prepareLiveTarget.bind(peers), complete = peers.completeLiveTarget.bind(peers);
  let preparedTransfer: string | undefined, preparedSession: string | undefined;
  let losePrepare = true;
  peers.prepareLiveTarget = async (peerId, input) => {
    const transferId = (input as { transferId: string }).transferId;
    if (preparedTransfer) assert.equal(transferId, preparedTransfer);
    preparedTransfer = transferId;
    const receipt = await prepare(peerId, input);
    if (preparedSession) assert.equal(receipt.sessionId, preparedSession);
    preparedSession = receipt.sessionId;
    if (losePrepare) { losePrepare = false; throw new Error('injected prepare response loss'); }
    return receipt;
  };
  peers.completeLiveTarget = async (peerId, input) => {
    let receipt = await complete(peerId, input);
    const deadline = Date.now() + 120_000;
    while (receipt.status !== 'running' || receipt.originStatus !== 'ready') {
      if (Date.now() >= deadline) throw new Error('Target did not become ready before injected reply loss');
      await delay(500);
      receipt = await peers!.inspectLiveTarget(peerId, {
        targetVmId: receipt.targetVmId, transferId: preparedTransfer,
      });
    }
    throw new Error('injected cutover response loss');
  };
  const options = { targetHostId: outbound.remoteId, targetName: 'distributed-target' };
  await assert.rejects(runner.run(vmId, options), /injected prepare response loss/);
  assert.equal(machines.state(vmId), 'running');
  await assert.rejects(runner.run(vmId, { ...options, transferId: preparedTransfer },
    undefined, line => process.stdout.write(line)), /injected cutover response loss/);
  const originalFence = machines.get(vmId).liveMigrationFence!;
  const inspected = (await request('inspect', { targetVmId: originalFence.targetVmId })).result;
  assert.deepEqual(inspected, { status: 'running', originStatus: 'ready',
    marker: 'distributed-guest', persistentMarker: 'persistent-guest', sessionId: preparedSession,
    projectCommand: 'printf distributed-project',
    projectCount: 1 });
  await assert.rejects(machines.suspend(vmId), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
  await assert.rejects(machines.resume(vmId), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
  const sourceQmp = machines.live.get(vmId)!.qmpPort;
  const sourceState = await qmp(sourceQmp, 'query-status') as { running?: boolean };
  assert.equal(sourceState.running, false);
  await machines.stop(vmId);
  assert.equal(machines.live.has(vmId), false);
  assert.equal(machines.get(vmId).liveMigrationFence?.sourceStopped?.sourceProcessId,
    originalFence.sourceProcessId);
  await machines.close();
  await peers.close();
  await engine.runtime.close();
  await request('restart', {});
  engine = await createRuntime();
  machines = new Machines(engine);
  await machines.init();
  peers = new HostPeers(status, join(sourceRoot, 'source-peer.json'), 'Source');
  await peers.init(false);
  const restarted = new LiveMigrationRunner(machines, peers, undefined, undefined,
    createLiveMigrationCompletionPort(machines, () => peers!));
  const result = await restarted.run(vmId, { ...options, transferId: preparedTransfer },
    undefined, line => process.stdout.write(line));
  assert.equal(result.ready, true);
  const recovered = (await request('inspect', { targetVmId: result.targetVmId })).result!;
  assert.equal(recovered.status, 'running');
  assert.equal(recovered.originStatus, 'ready');
  assert.equal(recovered.persistentMarker, 'persistent-guest');
  assert.equal(recovered.sessionId, preparedSession);
  assert.equal(machines.state(vmId), 'stopped');
  const sourceRecords = JSON.parse(await readFile(join(sourceRoot, 'machines.json'), 'utf8'));
  const targetRecords = JSON.parse(await readFile(join(targetRoot, 'machines.json'), 'utf8'));
  assert.equal(sourceRecords.find((entry: { id: string }) => entry.id === vmId)
    ?.liveMigrationFence?.targetVmId, result.targetVmId);
  assert.equal(targetRecords.find((entry: { id: string }) => entry.id === result.targetVmId)
    ?.liveMigrationOrigin?.status, 'ready');
  assert.deepEqual(targetRecords.find((entry: { id: string }) => entry.id === result.targetVmId)
    ?.organization, { group: 'migration', tags: ['distributed'], favorite: true });
  console.log('Two isolated Sakura services recovered lost prepare and cutover replies with the original transfer/session after both services restarted; guest data and project configuration survived, and the source remained fenced.');
} finally {
  if (machines && vmId) await machines.stop(vmId, true).catch(() => {});
  await machines?.close();
  await peers?.close();
  await engine?.runtime.close();
  if (worker && worker.exitCode === null) {
    try {
      const id = ++sequence;
      worker.send({ id, action: 'shutdown' });
      await Promise.race([new Promise<void>((resolve) => worker!.once('exit', () => resolve())),
        delay(10_000).then(() => { throw new Error('Target worker shutdown timed out'); })]);
    } catch { worker.kill(); }
  }
  const [resolved, temporary] = await Promise.all([realpath(root), realpath(tmpdir())]);
  if (dirname(resolved).toLowerCase() !== temporary.toLowerCase() ||
      !basename(resolved).startsWith('sakura-live-distributed-'))
    throw new Error('Refusing unexpected smoke cleanup path');
  await rm(resolved, { recursive: true, force: true,
    maxRetries: 20, retryDelay: 250 });
}
