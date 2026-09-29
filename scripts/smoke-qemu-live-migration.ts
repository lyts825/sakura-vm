import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { migrateQemuWithMirroredDisk } from '../server/live-migration-transport.ts';
import { HostPeers } from '../server/host-peers.ts';
import { freePort, qmp } from '../server/qmp.ts';

if (!['linux', 'win32'].includes(process.platform)) {
  console.log('QEMU migration smoke requires Linux or Windows; skipped.');
  process.exit(0);
}

const qemuDir = process.env.SAKURA_QEMU_DIR ||
  (process.platform === 'win32' ? join(process.cwd(), '.tools', 'qemu') : '/usr/bin');
const suffix = process.platform === 'win32' ? '.exe' : '';
const qemu = join(qemuDir, `qemu-system-x86_64${suffix}`);
const qemuImg = join(qemuDir, `qemu-img${suffix}`);
const qemuIo = join(qemuDir, `qemu-io${suffix}`);
const run = promisify(execFile);
const processes: ChildProcess[] = [];
const status = (value: unknown) => value as { status?: string; running?: boolean };
const interruptPrecopy = process.argv.includes('--interrupt-precopy');
const failFence = process.argv.includes('--fail-fence');
const differentSize = process.argv.includes('--different-size');
const remoteEndpoint = process.argv.includes('--remote-endpoint');
const peerTunnel = process.argv.includes('--peer-tunnel');
const legacyDrive = process.argv.includes('--legacy-drive');
const root = await mkdtemp(join(tmpdir(), 'sakura-qemu-migration-'));
const sourceDisk = join(root, 'source.qcow2');
const targetDisk = join(root, 'target.qcow2');
let sourcePeers: HostPeers | undefined, targetPeers: HostPeers | undefined;
let peerId: string | undefined, peerSession: string | undefined;
const forwards: Array<Awaited<ReturnType<HostPeers['openMigrationForward']>>> = [];
const peerStatus = async () => ({ platform: process.platform, arch: process.arch,
  cpus: 4, memoryTotal: 8 * 1024 ** 3, memoryFree: 4 * 1024 ** 3,
  load: [0, 0, 0], vmCount: 1, runningVms: 1 });

async function launch(port: number, disk: string, incoming: boolean) {
  const child = spawn(qemu, [
    '-name', 'sakura-migration-smoke', '-machine', 'q35', '-accel', 'tcg',
    '-cpu', 'qemu64', '-m', '128', '-smp', '1', '-nodefaults',
    '-display', 'none', '-monitor', 'none', '-serial', 'none',
    ...(legacyDrive
      ? ['-drive', `file=${disk},if=virtio,id=sakura-disk,format=qcow2`]
      : ['-blockdev', JSON.stringify({ driver: 'file', 'node-name': 'sakura-file', filename: disk }),
          '-blockdev', JSON.stringify({ driver: 'qcow2', 'node-name': 'sakura-disk', file: 'sakura-file' }),
          '-device', 'virtio-blk-pci,drive=sakura-disk,id=sakura-device']),
    '-qmp', `tcp:127.0.0.1:${port},server=on,wait=off`,
    ...(incoming ? ['-incoming', 'defer'] : ['-S']),
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  processes.push(child);
  let failure = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    failure = (failure + chunk.toString('utf8')).slice(-8192);
  });
  child.on('error', (error) => { failure = error.message; });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`QEMU exited before QMP was ready: ${failure}`);
    try { await qmp(port, 'query-status', undefined, 1000); return; }
    catch { await delay(100); }
  }
  throw new Error(`QEMU did not open QMP: ${failure}`);
}

try {
  await run(qemuImg, ['create', '-f', 'qcow2', sourceDisk, '64M']);
  await run(qemuImg, ['create', '-f', 'qcow2', targetDisk,
    differentSize ? '32M' : '64M']);
  await run(qemuIo, ['-f', 'qcow2', '-c', 'write -P 0x5a 0 4096', sourceDisk]);
  const [sourcePort, targetPort, transferPort, nbdPort] = await Promise.all([
    freePort(), freePort(), freePort(), freePort(),
  ]);
  await launch(sourcePort, sourceDisk, false);
  await launch(targetPort, targetDisk, true);
  await qmp(sourcePort, 'cont');
  assert.equal(status(await qmp(sourcePort, 'query-status')).running, true);
  const node = async (port: number) => {
    const blocks = await qmp(port, 'query-block') as Array<{
      device: string; inserted?: { 'node-name'?: string; ro?: boolean } }>;
    const disk = blocks.find((block) => block.device === 'sakura-disk' &&
      block.inserted?.ro === false);
    if (!disk?.inserted?.['node-name']) throw new Error('QEMU writable disk node is unavailable');
    return disk.inserted['node-name'];
  };
  const [sourceDiskNode, targetDiskNode] = await Promise.all([
    node(sourcePort), node(targetPort),
  ]);
  let sourceNbdPort = nbdPort, sourceTransferPort = transferPort;
  if (peerTunnel) {
    const peerPort = await freePort();
    const targetFile = join(root, 'target-peer.json');
    targetPeers = new HostPeers(peerStatus, targetFile, 'Target');
    await targetPeers.init(false);
    await targetPeers.configure({ operation: 'listener', listener: {
      enabled: true, host: '127.0.0.1', port: peerPort,
    } });
    await targetPeers.close();
    targetPeers = new HostPeers(peerStatus, targetFile, 'Target');
    await targetPeers.init(true);
    sourcePeers = new HostPeers(peerStatus, join(root, 'source-peer.json'), 'Source');
    await sourcePeers.init(false);
    const code = await targetPeers.configure({ operation: 'create-code' });
    if (!('pairing' in code) || !code.pairing) throw new Error('Missing peer code');
    await sourcePeers.configure({ operation: 'connect',
      url: `https://127.0.0.1:${peerPort}/`,
      fingerprint: targetPeers.view().fingerprint, code: code.pairing.value });
    const incoming = targetPeers.view().incoming[0];
    const outgoing = sourcePeers.view().outbound[0];
    await targetPeers.configure({ operation: 'allow-import', id: incoming.id, enabled: true });
    await targetPeers.configure({ operation: 'allow-activate', id: incoming.id, enabled: true });
    const session = targetPeers.registerMigrationSession(incoming.requesterId,
      { disk: nbdPort, state: transferPort, qmp: targetPort,
        targetDiskNode });
    peerId = outgoing.id;
    peerSession = session;
    const disk = await sourcePeers.openMigrationForward(outgoing.id, session, 'disk');
    forwards.push(disk);
    const state = await sourcePeers.openMigrationForward(outgoing.id, session, 'state');
    forwards.push(state);
    sourceNbdPort = disk.port;
    sourceTransferPort = state.port;
  }
  let fenced = false, interrupted = false;
  const migration = migrateQemuWithMirroredDisk({
    source: (command, args, timeoutMs) => {
      if (interruptPrecopy && command === 'query-migrate' && !interrupted) {
        interrupted = true;
        throw new Error('injected pre-copy control failure');
      }
      return qmp(sourcePort, command, args, timeoutMs);
    },
    target: (command, args, timeoutMs) => peerTunnel
      ? sourcePeers!.targetMigrationQmp(peerId!, peerSession!, command, args, timeoutMs)
      : qmp(targetPort, command, args, timeoutMs),
    sourceDiskNode, targetDiskNode,
    nbdListen: { type: 'inet', data: { host: remoteEndpoint ? '0.0.0.0' : '127.0.0.1',
      port: String(nbdPort) } },
    nbdConnect: { type: 'inet', host: '127.0.0.1', port: String(sourceNbdPort) },
    incomingUri: `tcp:127.0.0.1:${transferPort}`,
    outgoingUri: `tcp:127.0.0.1:${sourceTransferPort}`,
    fenceSource: async () => {
      fenced = true;
      if (failFence) throw new Error('injected durable fence failure');
    },
    timeoutMs: 45_000,
  });
  if (remoteEndpoint) {
    await assert.rejects(migration, /loopback TCP port/);
    assert.equal(fenced, false);
    assert.equal(status(await qmp(sourcePort, 'query-status')).running, true);
    assert.equal(status(await qmp(targetPort, 'query-status')).running, false);
  } else if (differentSize) {
    await assert.rejects(migration, /virtual sizes differ/);
    assert.equal(fenced, false);
    assert.equal(status(await qmp(sourcePort, 'query-status')).running, true);
    assert.equal(status(await qmp(targetPort, 'query-status')).running, false);
  } else if (interruptPrecopy) {
    await assert.rejects(migration, /injected pre-copy control failure/);
    assert.equal(fenced, false, 'a failed pre-copy cannot fence the source');
    assert.equal(status(await qmp(targetPort, 'query-status')).running, false);
    assert.equal(status(await qmp(sourcePort, 'query-status')).running, true,
      'pre-copy failure must resume the source after cancelling migration');
  } else if (failFence) {
    await assert.rejects(migration, /injected durable fence failure/);
    assert.equal(fenced, true);
    assert.equal(status(await qmp(targetPort, 'query-status')).running, false);
    assert.equal(status(await qmp(sourcePort, 'query-status')).running, false,
      'an uncertain fence must leave the source stopped');
  } else {
    const result = await migration;
    assert.equal(fenced, true);
    assert.equal(result.targetRunning, true);
    assert.equal(status(await qmp(targetPort, 'query-status')).running, true,
      'the incoming QEMU must resume after receiving state');
    assert.equal(status(await qmp(sourcePort, 'query-status')).running, false,
      'the source QEMU must stop after handing off state');
  }
  await qmp(sourcePort, 'quit').catch(() => {});
  await qmp(targetPort, 'quit').catch(() => {});
  await Promise.all(processes.map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      delay(3000).then(() => { if (child.exitCode === null) child.kill('SIGKILL'); }),
    ]);
  }));
  if (remoteEndpoint) {
    console.log('An unauthenticated non-loopback NBD endpoint was rejected before QEMU changed state.');
  } else if (differentSize) {
    console.log('A mismatched target disk was rejected before either QEMU changed state.');
  } else if (interruptPrecopy) {
    console.log('Interrupted pre-copy left only the source running and never accepted a fence.');
  } else if (failFence) {
    console.log('Failed durable fencing left both QEMU instances stopped for reconciliation.');
  } else {
    await run(qemuImg, ['compare', '-f', 'qcow2', '-F', 'qcow2', sourceDisk, targetDisk]);
    console.log(`QEMU mirrored a live disk through NBD${peerTunnel ? ' and pinned peer TLS with restricted target QMP' : ''}, paused before switchover, transferred RAM, resumed only the target, and verified identical disk contents.`);
  }
} finally {
  await Promise.all(processes.map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      delay(3000).then(() => { if (child.exitCode === null) child.kill('SIGKILL'); }),
    ]);
  }));
  await Promise.all(forwards.map((forward) => forward.close()));
  await sourcePeers?.close();
  await targetPeers?.close();
  const [resolvedRoot, resolvedTemp] = await Promise.all([realpath(root), realpath(tmpdir())]);
  if (dirname(resolvedRoot).toLowerCase() !== resolvedTemp.toLowerCase() ||
      !basename(resolvedRoot).startsWith('sakura-qemu-migration-'))
    throw new Error('Migration smoke temporary path changed unexpectedly; refusing cleanup');
  await rm(resolvedRoot, { recursive: true, force: true });
}
