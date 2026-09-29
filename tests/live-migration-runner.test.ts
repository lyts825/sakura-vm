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

const root = await mkdtemp(join(tmpdir(), 'sakura-live-runner-'));
process.env.SAKURA_DATA_DIR = root;
const { LiveMigrationRunner } = await import('../server/live-migration-runner.ts');
const { vmDir } = await import('../server/model.ts');
after(async () => {
  const [resolved, temporary] = await Promise.all([realpath(root), realpath(tmpdir())]);
  if (dirname(resolved).toLowerCase() !== temporary.toLowerCase() ||
      !basename(resolved).startsWith('sakura-live-runner-'))
    throw new Error('Refusing unexpected test cleanup path');
  await rm(resolved, { recursive: true, force: true });
});

async function fixture(mode: 'success' | 'before-fence' | 'after-fence') {
  const vmId = randomUUID(), hostId = randomUUID(), targetVmId = randomUUID();
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
    liveMigrationFence: undefined as { targetHostId: string; targetVmId: string;
      transferId: string } | undefined };
  let stopped = 0, aborted = 0, closed = 0, prepared = 0, completed = 0;
  const live = { status: 'running', accelerator: 'tcg', qmpPort: 1234 };
  const machines = {
    get: (id: string) => { assert.equal(id, vmId); return vm; },
    live: new Map([[vmId, live]]),
    fenceForLiveMigration: async (_id: string, fence: typeof vm.liveMigrationFence) => {
      vm.liveMigrationFence = fence;
    },
    stop: async () => { stopped++; },
  } as unknown as Machines;
  const peers = {
    view: () => ({ outbound: [{ id: randomUUID(), remoteId: hostId, name: 'Target' }] }),
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
        diskPort: 2345, statePort: 2346 };
    },
    openMigrationForward: async () => ({ port: 3456,
      close: async () => { closed++; } }),
    targetMigrationQmp: async () => ({}),
    completeLiveTarget: async () => { completed++; return {
      targetVmId, status: 'running', originStatus: 'ready' }; },
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
  const runner = new LiveMigrationRunner(machines, peers, query, transport);
  return { runner, vmId, hostId, vm,
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

test('migration refuses project secrets that cannot follow the guest to another host', async () => {
  const { runner, vmId, hostId, counts } = await fixture('success');
  await writeFile(join(vmDir(vmId), 'project.json'), JSON.stringify({
    directory: '/workspace', secrets: { TOKEN: 'HostOnlySecret' },
  }));
  await assert.rejects(runner.run(vmId, { targetHostId: hostId,
    targetName: 'destination' }), /宿主私密配置/);
  assert.equal(counts().prepared, 0);
});
