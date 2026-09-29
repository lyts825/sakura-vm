import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { HostPeers } from '../server/host-peers.ts';
import { createSshKey, seedIso } from '../server/seed.ts';

const status = async () => ({ platform: process.platform, arch: process.arch,
  cpus: 4, memoryTotal: 8 * 1024 ** 3, memoryFree: 4 * 1024 ** 3,
  load: [0, 0, 0], vmCount: 0, runningVms: 0 });

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  return address.port;
}

test('migration streams use pinned peer TLS, session authority and revocable local forwards', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-peer-stream-'));
  const echo = createServer((socket) => socket.pipe(socket));
  const targetFile = join(root, 'target.json');
  const sourceFile = join(root, 'source.json');
  let target = new HostPeers(status, targetFile, 'Target');
  const source = new HostPeers(status, sourceFile, 'Source');
  let forward: Awaited<ReturnType<HostPeers['openMigrationForward']>> | undefined;
  let client: Socket | undefined;
  try {
    const reserved = createServer();
    const peerPort = await listen(reserved);
    // Release the temporary reservation before starting the HTTPS listener.
    await new Promise<void>((resolve) => reserved.close(() => resolve()));
    await target.init(false);
    await target.configure({ operation: 'listener', listener: {
      enabled: true, host: '127.0.0.1', port: peerPort,
    } });
    await target.close();
    target = new HostPeers(status, targetFile, 'Target');
    await target.init(true);
    await source.init(false);
    const issued = await target.configure({ operation: 'create-code' });
    if (!('pairing' in issued) || !issued.pairing) throw new Error('No pairing code');
    await source.configure({ operation: 'connect', url: `https://127.0.0.1:${peerPort}/`,
      fingerprint: target.view().fingerprint, code: issued.pairing.value });
    const inbound = target.view().incoming[0];
    const outbound = source.view().outbound[0];
    const echoPort = await listen(echo);
    const identity = { key: createSshKey().privateText,
      seedBase64: seedIso({ 'meta-data': 'source', 'user-data': 'setup' }).toString('base64') };
    const prepare = { transferId: randomUUID(), sourceVmId: randomUUID(),
      config: { name: 'migrated' }, ...identity };
    await assert.rejects(source.prepareLiveTarget(outbound.id, prepare), /HTTP 403/);
    assert.throws(() => target.registerMigrationSession(inbound.requesterId,
      { disk: echoPort, state: echoPort }), /权限/);
    await target.configure({ operation: 'allow-import', id: inbound.id, enabled: true });
    await target.configure({ operation: 'allow-activate', id: inbound.id, enabled: true });
    const prepared = { targetVmId: randomUUID(), sessionId: randomUUID(),
      targetDiskNode: '#block23', diskPort: echoPort, statePort: echoPort };
    target.setLiveMigrationReceiver({ prepare: async (input) => {
      assert.equal(input.requesterId, inbound.requesterId);
      assert.equal(input.transferId, prepare.transferId);
      assert.equal(input.key, identity.key);
      assert.deepEqual(input.seed, Buffer.from(identity.seedBase64, 'base64'));
      return prepared;
    }, complete: async (input) => {
      assert.equal(input.requesterId, inbound.requesterId);
      assert.equal(input.sessionId, prepared.sessionId);
      return { targetVmId: prepared.targetVmId,
        status: 'starting' as const, originStatus: 'received' as const };
    }, abort: async (input) => {
      assert.equal(input.requesterId, inbound.requesterId);
      assert.equal(input.sessionId, prepared.sessionId);
      assert.equal(input.sourceRunning, true);
      return { targetVmId: prepared.targetVmId, aborted: true as const };
    }, status: async (input) => {
      assert.equal(input.requesterId, inbound.requesterId);
      return { targetVmId: prepared.targetVmId,
        status: 'paused' as const, originStatus: 'prepared' as const };
    } });
    assert.deepEqual(await source.prepareLiveTarget(outbound.id, prepare), prepared);
    assert.equal((await source.inspectLiveTarget(outbound.id, {
      targetVmId: prepared.targetVmId, transferId: prepare.transferId,
    })).originStatus, 'prepared');
    assert.equal((await source.completeLiveTarget(outbound.id, {
      targetVmId: prepared.targetVmId, transferId: prepare.transferId,
      sessionId: prepared.sessionId,
    })).originStatus, 'received');
    assert.deepEqual(await source.abortLiveTarget(outbound.id, {
      targetVmId: prepared.targetVmId, transferId: prepare.transferId,
      sessionId: prepared.sessionId, sourceRunning: true,
    }), { targetVmId: prepared.targetVmId, aborted: true });
    assert.throws(() => target.registerMigrationSession(inbound.requesterId,
      { disk: 80, state: echoPort }), /端口无效/);
    const session = target.registerMigrationSession(inbound.requesterId,
      { disk: echoPort, state: echoPort, qmp: echoPort,
        targetDiskNode: 'sakura-disk' });
    await assert.rejects(source.targetMigrationQmp(outbound.id, session,
      'system_reset'), /Invalid option|invalid_value|Invalid input/i);
    await assert.rejects(source.targetMigrationQmp(outbound.id, session,
      'migrate-incoming', { uri: `tcp:0.0.0.0:${echoPort}`, 'exit-on-error': false }),
    /HTTP 400/);
    forward = await source.openMigrationForward(outbound.id, session, 'disk');
    client = createConnection({ host: '127.0.0.1', port: forward.port });
    client.on('error', () => {});
    await once(client, 'connect', { signal: AbortSignal.timeout(10_000) });
    const received = once(client, 'data', { signal: AbortSignal.timeout(10_000) });
    client.write('verified migration bytes');
    assert.equal((await received)[0].toString(), 'verified migration bytes');
    const closed = once(client, 'close', { signal: AbortSignal.timeout(10_000) });
    await target.configure({ operation: 'allow-activate', id: inbound.id, enabled: false });
    await closed;
    assert.throws(() => target.registerMigrationSession(inbound.requesterId,
      { disk: echoPort, state: echoPort }), /权限/);
  } finally {
    client?.destroy();
    await forward?.close();
    await source.close();
    await target.close();
    if (echo.listening) await new Promise<void>((resolve) => echo.close(() => resolve()));
    const [resolved, temporary] = await Promise.all([realpath(root), realpath(tmpdir())]);
    if (dirname(resolved).toLowerCase() !== temporary.toLowerCase() ||
        !basename(resolved).startsWith('sakura-peer-stream-'))
      throw new Error('Refusing unexpected test cleanup path');
    await rm(resolved, { recursive: true, force: true });
  }
});
