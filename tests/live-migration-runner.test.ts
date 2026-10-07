/**
 * 回归范围（完整情景见下方用例与断言）：
 * - source coordinator fences before confirming target and stops source only after readiness
 * - pre-fence failure aborts a paused target only after source is confirmed running
 * - post-fence failure keeps target and source fence for manual reconciliation
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { HostPeers } from '../server/host-peers.ts';
import type { qmp } from '../server/qmp.ts';
import type { migrateQemuWithMirroredDisk } from '../server/live-migration-transport.ts';
import type { LiveMigrationFence } from '../shared/contracts/vm.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-live-runner-'));
process.env.SAKURA_DATA_DIR = root;
const { LiveMigrationRunner } = await import('../server/live-migration-runner.ts');
const { createLiveMigrationCompletionPort } = await import('../server/live-migration-proof.ts');
const { migrateQemuWithMirroredDisk: transportQemu } = await import('../server/live-migration-transport.ts');
const { vmDir } = await import('../server/model.ts');
after(async () => {
  const [resolved, temporary] = await Promise.all([realpath(root), realpath(tmpdir())]);
  if (dirname(resolved).toLowerCase() !== temporary.toLowerCase() ||
      !basename(resolved).startsWith('sakura-live-runner-'))
    throw new Error('Refusing unexpected test cleanup path');
  await rm(resolved, { recursive: true, force: true });
});

async function fixture(mode: 'success' | 'before-fence' | 'after-fence') {
  const vmId = randomUUID(), hostId = randomUUID(), targetVmId = randomUUID(), peerId = randomUUID(), sourceHostId = randomUUID();
  const dir = vmDir(vmId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'id_rsa'), 'private key');
  await writeFile(join(dir, 'seed.iso'), 'seed content');
  await writeFile(join(dir, 'projects.json'), JSON.stringify({ active: 'default',
    projects: [{ id: 'default', name: 'Default' }] }));
  await writeFile(join(dir, 'project.json'), JSON.stringify({
    directory: '/workspace', command: 'printf migrated',
  }));
  const vm = { id: vmId, name: 'source', memoryMiB: 512, cpus: 2,
    diskGiB: 8, accelerator: 'tcg', forwards: [], snapshots: [],
    organization: { group: 'engineering', tags: ['important'], favorite: true },
    liveMigrationFence: undefined as LiveMigrationFence | undefined };
  let stopped = 0, aborted = 0, closed = 0, prepared = 0, completed = 0;
  const live = { status: 'running', accelerator: 'tcg', qmpPort: 1234 };
  const machines = {
    get: (id: string) => { assert.equal(id, vmId); return vm; },
    live: new Map([[vmId, live]]),
    locked: async <T>(_id: string, work: () => Promise<T>) => work(),
    fenceForLiveMigration: async (_id: string, fence: typeof vm.liveMigrationFence) => {
      vm.liveMigrationFence = { ...fence!, fencedAt: new Date().toISOString(), sourceProcessId: randomUUID() };
      return vm.liveMigrationFence;
    },
    stop: async () => { stopped++; },
    canConfirmLiveMigrationCompletion: () => true,
    isLiveMigrationCompletionDurable: () => true,
    stopLiveMigrationSource: async (_id: string, fence: LiveMigrationFence) => {
      stopped++;
      return vm.liveMigrationFence = { ...fence, sourceStopped: { sourceProcessId: fence.sourceProcessId!, stoppedAt: new Date().toISOString() } };
    },
    confirmLiveMigrationCompletion: async (_id: string, fence: LiveMigrationFence, inspect: () => Promise<unknown>) => {
      assert.ok(await inspect());
      assert.equal(fence.sourceStopped?.sourceProcessId, fence.sourceProcessId);
      return fence;
    },
  } as unknown as Machines;
  const peers = {
    view: () => ({ hostId: sourceHostId, outbound: [{ id: peerId, remoteId: hostId, name: 'Target' }] }),
    score: async () => ({ candidates: [
      { source: 'local', status: { platform: 'win32', arch: 'x64' } },
      { source: 'peer', id: hostId, eligible: true, reasons: [],
        status: { platform: 'win32', arch: 'x64' } },
    ] }),
    prepareLiveTarget: async (_peer: string, input: { sourceVmId: string;
      config: { name: string }; key: string; seedBase64: string;
      projects?: { configs: { default?: { command: string } } };
      organization?: { group: string; tags: string[]; favorite: boolean } }) => {
      prepared++;
      assert.equal(input.sourceVmId, vmId);
      assert.equal(input.config.name, 'destination');
      assert.equal(input.key, 'private key');
      assert.equal(Buffer.from(input.seedBase64, 'base64').toString(), 'seed content');
      assert.equal(input.projects?.configs.default?.command, 'printf migrated');
      assert.deepEqual(input.organization, vm.organization);
      return { targetVmId, sessionId: randomUUID(), targetDiskNode: '#target',
        diskPort: 2345, statePort: 2346, completionProtocol: 1 as const };
    },
    openMigrationForward: async () => ({ port: 3456,
      close: async () => { closed++; } }),
    targetMigrationQmp: async () => ({}),
    completeLiveTarget: async () => { completed++; return {
      targetVmId, status: 'running', originStatus: 'ready', sourceVmId: vmId, sourceHostId,
      sessionId: vm.liveMigrationFence!.sessionId, transferId: vm.liveMigrationFence!.transferId,
      projectsDigest: vm.liveMigrationFence!.projectsDigest, targetVerifiedAt: new Date().toISOString() }; },
    inspectLiveTarget: async () => ({ targetVmId, status: 'running', originStatus: 'ready', sourceVmId: vmId, sourceHostId,
      sessionId: vm.liveMigrationFence!.sessionId, transferId: vm.liveMigrationFence!.transferId,
      projectsDigest: vm.liveMigrationFence!.projectsDigest, targetVerifiedAt: new Date().toISOString() }),
    abortLiveTarget: async (_peer: string, request: { sourceRunning: boolean }) => {
      assert.equal(request.sourceRunning, true); aborted++;
      return { targetVmId, aborted: true };
    },
  } as unknown as HostPeers;
  const query = (async (_port: number, command: string) => {
    if (command === 'query-status') return { running: true, status: 'running' };
    if (command === 'query-migrate') return { status: 'none' };
    if (command === 'query-block') return [{ device: 'sakura-disk',
      inserted: { ro: false, 'node-name': '#source' } }];
    throw new Error(`Unexpected ${command}`);
  }) as typeof qmp;
  const transport = (async (input: Parameters<typeof migrateQemuWithMirroredDisk>[0]) => {
    assert.equal(input.sourceDiskNode, '#source');
    assert.equal(input.targetDiskNode, '#target');
    assert.equal(input.incomingUri, 'tcp:127.0.0.1:2346');
    if (mode === 'before-fence') throw new Error('injected transport failure');
    await input.fenceSource();
    if (mode === 'after-fence') throw new Error('injected cutover failure');
    return { sourceStopped: true, targetRunning: true, fenced: true } as const;
  }) as typeof migrateQemuWithMirroredDisk;
  const runner = new LiveMigrationRunner(machines, peers, query, transport,
    createLiveMigrationCompletionPort(machines, () => peers));
  return { runner, vmId, hostId, vm, machines, peers, query, transport,
    counts: () => ({ prepared, completed, stopped, aborted, closed }) };
}

test('source coordinator fences before confirming target and stops source only after readiness', async () => {
  const { runner, vmId, hostId, vm, counts } = await fixture('success');
  const result = await runner.run(vmId, { targetHostId: hostId, targetName: 'destination' });
  assert.equal(result.executed, true);
  assert.equal(result.targetHostId, hostId);
  assert.equal(vm.liveMigrationFence?.targetVmId, result.targetVmId);
  assert.deepEqual(counts(), { prepared: 1, completed: 1,
    stopped: 1, aborted: 0, closed: 2 });
});

test('pre-fence failure aborts a paused target only after source is confirmed running', async () => {
  const { runner, vmId, hostId, vm, counts } = await fixture('before-fence');
  await assert.rejects(runner.run(vmId, { targetHostId: hostId,
    targetName: 'destination' }), /injected transport failure/);
  assert.equal(vm.liveMigrationFence, undefined);
  assert.deepEqual(counts(), { prepared: 1, completed: 0,
    stopped: 0, aborted: 1, closed: 2 });
});

test('post-fence failure keeps target and source fence for manual reconciliation', async () => {
  const { runner, vmId, hostId, vm, counts } = await fixture('after-fence');
  await assert.rejects(runner.run(vmId, { targetHostId: hostId,
    targetName: 'destination' }), /injected cutover failure/);
  assert.ok(vm.liveMigrationFence);
  assert.deepEqual(counts(), { prepared: 1, completed: 0,
    stopped: 0, aborted: 0, closed: 2 });
});

test('pre-fence transport rollback cannot resume a source fenced by another request', async () => {
  const { vmId, hostId, vm, machines, peers, counts } = await fixture('before-fence');
  const failure = new Error('injected receiver failure with concurrent source fence');
  const concurrentFence: LiveMigrationFence = { targetHostId: hostId, targetVmId: randomUUID(),
    transferId: randomUUID(), fencedAt: new Date().toISOString() };
  const slots = [{ type: 'qemu64-x86_64-cpu', props: { 'socket-id': 0 }, 'vcpus-count': 1 }];
  const blocks = (node: string) => [{ device: 'sakura-disk', inserted: { ro: false,
    'node-name': node, image: { 'virtual-size': 8 * 1024 ** 3 } } }];
  let paused = false, resumed = 0, resumeLocks = 0;
  const originalLock = machines.locked.bind(machines);
  machines.locked = async (id, work, ...args) => {
    resumeLocks++;
    return originalLock(id, work, ...args);
  };
  const query = (async (_port: number, command: string) => {
    if (command === 'query-status') return { running: !paused, status: paused ? 'paused' : 'running' };
    if (command === 'query-migrate') return { status: 'none' };
    if (command === 'query-block') return blocks('#source');
    if (command === 'query-version') return { qemu: { major: 10, minor: 0, micro: 0 } };
    if (command === 'query-hotpluggable-cpus') return slots;
    if (command === 'cont') { resumed++; return {}; }
    throw new Error(`Unexpected source command ${command}`);
  }) as typeof qmp;
  peers.targetMigrationQmp = async (_peer, _session, command) => {
    if (command === 'query-status') return { running: false, status: 'prelaunch' };
    if (command === 'query-version') return { qemu: { major: 10, minor: 0, micro: 0 } };
    if (command === 'query-hotpluggable-cpus') return slots;
    if (command === 'query-block') return blocks('#target');
    if (command === 'migrate-incoming') {
      paused = true;
      vm.liveMigrationFence = concurrentFence;
      throw failure;
    }
    throw new Error(`Unexpected target command ${command}`);
  };
  const runner = new LiveMigrationRunner(machines, peers, query, transportQemu,
    createLiveMigrationCompletionPort(machines, () => peers));
  await assert.rejects(runner.run(vmId, { targetHostId: hostId, targetName: 'destination' }),
    error => error === failure);
  assert.equal(resumeLocks, 1);
  assert.equal(resumed, 0);
  assert.equal(vm.liveMigrationFence, concurrentFence);
  assert.deepEqual(counts(), { prepared: 1, completed: 0, stopped: 0, aborted: 0, closed: 2 });
});

test('migration refuses project secrets that cannot follow the guest to another host', async () => {
  const { runner, vmId, hostId, counts } = await fixture('success');
  await writeFile(join(vmDir(vmId), 'project.json'), JSON.stringify({
    directory: '/workspace', secrets: { TOKEN: 'HostOnlySecret' },
  }));
  await assert.rejects(runner.run(vmId, { targetHostId: hostId,
    targetName: 'destination' }), /宿主私密配置/);
  assert.equal(counts().prepared, 0);
});

test('lost prepare response reuses its durable transfer through a new coordinator', async () => {
  const { runner, vmId, hostId, vm, machines, peers, query, transport, counts } = await fixture('success');
  const original = peers.prepareLiveTarget.bind(peers);
  const transfers: string[] = [];
  peers.prepareLiveTarget = async (peerId, raw) => {
    transfers.push((raw as { transferId: string }).transferId);
    const receipt = await original(peerId, raw);
    if (transfers.length === 1) throw new Error('injected lost prepare response');
    return receipt;
  };
  await assert.rejects(runner.run(vmId, { targetHostId: hostId, targetName: 'destination' }), /lost prepare response/);
  assert.equal(vm.liveMigrationFence, undefined);
  const score = peers.score.bind(peers);
  peers.score = async input => {
    const result = await score(input);
    return { ...result, candidates: result.candidates.map(candidate => candidate.source === 'peer'
      ? { ...candidate, eligible: false, reasons: ['prepared target already holds the available resources'] }
      : candidate) };
  };
  const restarted = new LiveMigrationRunner(machines, peers, query, transport,
    createLiveMigrationCompletionPort(machines, () => peers));
  await assert.rejects(restarted.run(vmId, { targetHostId: hostId, targetName: 'destination',
    transferId: randomUUID() }), { code: 'LIVE_MIGRATION_ATTEMPT_CHANGED' });
  await restarted.run(vmId, { targetHostId: hostId, targetName: 'destination', transferId: transfers[0] });
  assert.deepEqual(transfers, [transfers[0], transfers[0]]);
  assert.equal(counts().prepared, 2);
  assert.equal(machines.get(vmId).liveMigrationFence?.transferId, transfers[0]);
});

test('lost cutover response is recoverable by the original transfer without preparing or transporting again', async () => {
  const { runner, vmId, hostId, vm, machines, peers, query, transport, counts } = await fixture('success');
  const original = peers.completeLiveTarget.bind(peers);
  peers.completeLiveTarget = async (peerId, raw) => {
    await original(peerId, raw);
    throw new Error('injected lost cutover response');
  };
  await assert.rejects(runner.run(vmId, { targetHostId: hostId, targetName: 'destination' }), /lost cutover response/);
  const fence = vm.liveMigrationFence!;
  const restarted = new LiveMigrationRunner(machines, peers, query, transport,
    createLiveMigrationCompletionPort(machines, () => peers));
  await assert.rejects(restarted.run(vmId, { targetHostId: hostId, transferId: randomUUID() }), /不属于原在线迁移/);
  const result = await restarted.run(vmId, { targetHostId: hostId, transferId: fence.transferId });
  assert.equal(result.transferId, fence.transferId);
  assert.deepEqual(counts(), { prepared: 1, completed: 1, stopped: 1, aborted: 0, closed: 2 });
  assert.equal(vm.liveMigrationFence?.transferId, fence.transferId);
});
