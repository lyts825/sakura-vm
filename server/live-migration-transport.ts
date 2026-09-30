import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export type MigrationQmp = (command: string, args?: Record<string, unknown>,
  timeoutMs?: number) => Promise<unknown>;

type Address = Record<string, unknown>;
function requireLocalInet(address: Address, name: string) {
  const data = address.type === 'inet' && address.data &&
    typeof address.data === 'object' ? address.data as Address : address;
  if (address.type !== 'inet' || data.host !== '127.0.0.1' ||
      !/^[0-9]{1,5}$/.test(String(data.port)) ||
      Number(data.port) < 1 || Number(data.port) > 65535)
    throw new Error(`${name} must use a loopback TCP port`);
}

function requireLocalMigrationUri(uri: string, name: string) {
  const match = /^tcp:127\.0\.0\.1:([0-9]{1,5})$/.exec(uri);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535)
    throw new Error(`${name} must use a loopback TCP port`);
}

export type MirroredMigrationOptions = {
  source: MigrationQmp;
  target: MigrationQmp;
  sourceDiskNode: string;
  targetDiskNode: string;
  nbdListen: Address;
  nbdConnect: Address;
  nbdServerOptions?: Record<string, unknown>;
  nbdClientOptions?: Record<string, unknown>;
  incomingUri: string;
  outgoingUri: string;
  /** Must durably prevent a source restart before it returns. */
  fenceSource: () => Promise<void>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

type Status = { status?: string; running?: boolean; errorDesc?: string };
const readStatus = (value: unknown): Status => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('QEMU returned an invalid status');
  return value as Status;
};

function writableDiskSize(value: unknown, node: string) {
  if (!Array.isArray(value)) throw new Error('QEMU returned invalid block devices');
  const writable = value.filter((item) => item && typeof item === 'object' &&
    item.inserted && item.inserted.ro === false);
  if (writable.length !== 1 || writable[0].inserted['node-name'] !== node)
    throw new Error('Migration requires exactly one matching writable disk');
  const size = writable[0].inserted.image?.['virtual-size'];
  if (!Number.isSafeInteger(size) || size <= 0)
    throw new Error('QEMU did not report the disk virtual size');
  return size as number;
}

function cpuLayout(value: unknown) {
  if (!Array.isArray(value) || !value.length)
    throw new Error('QEMU returned invalid CPU slots');
  return JSON.stringify(value.map((slot) => {
    if (!slot || typeof slot !== 'object' || typeof slot.type !== 'string' || !slot.type ||
        !Number.isSafeInteger(slot['vcpus-count']) || slot['vcpus-count'] <= 0 ||
        !slot.props || typeof slot.props !== 'object' || Array.isArray(slot.props) ||
        !Object.values(slot.props).every((item) => Number.isSafeInteger(item)))
      throw new Error('QEMU returned invalid CPU slots');
    return [slot.type, slot['vcpus-count'],
      Object.entries(slot.props).sort(([a], [b]) => a.localeCompare(b))];
  }).map((slot) => JSON.stringify(slot)).sort());
}

async function waitFor(source: MigrationQmp, command: 'query-block-jobs' | 'query-migrate',
  ready: (value: unknown) => boolean, timeoutMs: number, signal?: AbortSignal) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const value = await source(command, undefined, 5000);
    if (ready(value)) return value;
    await delay(200, undefined, { signal });
  }
  throw new Error(`${command} timed out`);
}

/** QEMU pre-copy plus NBD disk mirroring over local ports; caller owns secure tunneling and a durable fence. */
export async function migrateQemuWithMirroredDisk(input: MirroredMigrationOptions) {
  const { source, target, signal } = input;
  if (!input.sourceDiskNode || !input.targetDiskNode || !input.incomingUri ||
      !input.outgoingUri || !input.nbdListen || !input.nbdConnect)
    throw new Error('Migration endpoints are incomplete');
  requireLocalInet(input.nbdListen, 'NBD listener');
  requireLocalInet(input.nbdConnect, 'NBD client');
  requireLocalMigrationUri(input.incomingUri, 'Migration receiver');
  requireLocalMigrationUri(input.outgoingUri, 'Migration sender');
  signal?.throwIfAborted();
  const [sourceState, targetState] = await Promise.all([
    source('query-status'), target('query-status'),
  ]);
  if (readStatus(sourceState).running !== true || readStatus(targetState).running !== false)
    throw new Error('Migration requires a running source and paused receiver');
  const [sourceVersion, targetVersion] = await Promise.all([
    source('query-version'), target('query-version'),
  ]);
  const version = (value: unknown) => {
    const qemu = (value as { qemu?: { major?: number; minor?: number; micro?: number } })?.qemu;
    if (!qemu || ![qemu.major, qemu.minor, qemu.micro].every(Number.isInteger))
      throw new Error('QEMU returned an invalid version');
    return `${qemu.major}.${qemu.minor}.${qemu.micro}`;
  };
  if (version(sourceVersion) !== version(targetVersion))
    throw new Error('Source and target QEMU versions differ');
  const [sourceCpus, targetCpus] = await Promise.all([
    source('query-hotpluggable-cpus'), target('query-hotpluggable-cpus'),
  ]);
  if (cpuLayout(sourceCpus) !== cpuLayout(targetCpus))
    throw new Error('Source and target CPU models or topology differ');
  const [sourceBlocks, targetBlocks] = await Promise.all([
    source('query-block'), target('query-block'),
  ]);
  if (writableDiskSize(sourceBlocks, input.sourceDiskNode) !==
      writableDiskSize(targetBlocks, input.targetDiskNode))
    throw new Error('Source and target disk virtual sizes differ');

  // QEMU block node names are limited; keep every generated name below 32 bytes.
  const id = randomUUID().replaceAll('-', '').slice(0, 12);
  const exportId = `sakura-export-${id}`;
  const targetNode = `sakura-target-${id}`;
  const mirrorJob = `sakura-mirror-${id}`;
  let nbdStarted = false, exported = false, remoteAdded = false;
  let mirrorStarted = false, migrationStarted = false, fenceStarted = false;
  const timeout = input.timeoutMs || 5 * 60_000;
  const mirrorReady = (value: unknown) => {
    if (!Array.isArray(value)) throw new Error('QEMU returned invalid block jobs');
    const job = value.find((item) => item && typeof item === 'object' &&
      item.device === mirrorJob) as { ready?: boolean; 'io-status'?: string } | undefined;
    if (!job) throw new Error('Disk mirror job disappeared before synchronization');
    if (job['io-status'] && job['io-status'] !== 'ok')
      throw new Error(`Disk mirror I/O failed: ${job['io-status']}`);
    return job.ready === true;
  };
  const cleanupTransport = async () => {
    if (remoteAdded) {
      await source('blockdev-del', { 'node-name': targetNode });
      remoteAdded = false;
    }
    if (exported) {
      await target('block-export-del', { id: exportId });
      exported = false;
    }
    if (nbdStarted) {
      await target('nbd-server-stop');
      nbdStarted = false;
    }
  };
  try {
    await target('migrate-incoming', { uri: input.incomingUri,
      'exit-on-error': false }, 10_000);
    await target('nbd-server-start', {
      ...input.nbdServerOptions, addr: input.nbdListen,
    });
    nbdStarted = true;
    await target('block-export-add', { type: 'nbd', id: exportId,
      'node-name': input.targetDiskNode, name: exportId, writable: true });
    exported = true;
    await source('blockdev-add', { ...input.nbdClientOptions, driver: 'nbd',
      'node-name': targetNode, server: input.nbdConnect, export: exportId });
    remoteAdded = true;
    await source('blockdev-mirror', { 'job-id': mirrorJob,
      device: input.sourceDiskNode, target: targetNode, sync: 'full' });
    mirrorStarted = true;
    await waitFor(source, 'query-block-jobs', mirrorReady, timeout, signal);
    await source('migrate-set-capabilities', { capabilities: [
      { capability: 'pause-before-switchover', state: true },
    ] });
    await source('migrate', { uri: input.outgoingUri }, 10_000);
    migrationStarted = true;
    await waitFor(source, 'query-migrate', (value) => {
      const state = readStatus(value);
      if (state.status === 'failed' || state.status === 'cancelled' ||
          state.status === 'completed')
        throw new Error(`Migration ended before switchover: ${state.status} ${state.errorDesc || ''}`);
      return state.status === 'pre-switchover';
    }, timeout, signal);
    if (readStatus(await source('query-status')).running !== false)
      throw new Error('Source QEMU is still running at pre-switchover');
    signal?.throwIfAborted();
    // The guest may have dirtied the disk during RAM pre-copy. Wait until the
    // final writes reach the target after the source vCPUs have stopped.
    await waitFor(source, 'query-block-jobs', mirrorReady, timeout, signal);
    await source('block-job-cancel', { device: mirrorJob });
    await waitFor(source, 'query-block-jobs', (value) => {
      if (!Array.isArray(value)) throw new Error('QEMU returned invalid block jobs');
      return !value.some((job) => job && typeof job === 'object' &&
        job.device === mirrorJob);
    }, timeout, signal);
    mirrorStarted = false;
    await cleanupTransport();
    signal?.throwIfAborted();
    fenceStarted = true;
    await input.fenceSource();
    await source('migrate-continue', { state: 'pre-switchover' });
    await waitFor(source, 'query-migrate', (value) => {
      const state = readStatus(value);
      if (state.status === 'failed' || state.status === 'cancelled')
        throw new Error(`Migration failed after fencing: ${state.errorDesc || state.status}`);
      return state.status === 'completed';
    }, timeout);
    if (readStatus(await target('query-status')).running !== true ||
        readStatus(await source('query-status')).running !== false)
      throw new Error('QEMU source/target state is inconsistent after migration');
    return { sourceStopped: true, targetRunning: true, fenced: true } as const;
  } catch (error) {
    // Once fencing begins, a rollback could let both copies write. Leave both
    // processes for the control plane to reconcile instead of resuming source.
    if (!fenceStarted) {
      let migrationCancelled = !migrationStarted;
      if (migrationStarted) {
        await source('migrate_cancel').catch(() => {});
        try {
          const terminal = await waitFor(source, 'query-migrate', (value) =>
            ['cancelled', 'failed', 'completed'].includes(readStatus(value).status || ''),
          15_000);
          migrationCancelled = ['cancelled', 'failed'].includes(readStatus(terminal).status || '');
        } catch { migrationCancelled = false; }
      }
      if (mirrorStarted) await source('block-job-cancel', { device: mirrorJob }).catch(() => {});
      if (mirrorStarted) await waitFor(source, 'query-block-jobs', (value) =>
        Array.isArray(value) && !value.some((job) => job && typeof job === 'object' &&
          job.device === mirrorJob), 15_000).catch(() => {});
      await cleanupTransport().catch(() => {});
      const current = readStatus(await source('query-status').catch(() => ({})));
      const receiver = readStatus(await target('query-status').catch(() => ({})));
      if (migrationCancelled && receiver.running === false && current.running === false)
        await source('cont').catch(() => {});
    }
    throw error;
  }
}
