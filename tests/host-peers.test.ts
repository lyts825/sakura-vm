import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostPeers } from '../server/host-peers.ts';

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

const status = async () => ({
  platform: 'win32', arch: 'x64', cpus: 8, memoryTotal: 16 * 1024 ** 3,
  memoryFree: 8 * 1024 ** 3, load: [0.1, 0.2, 0.3], vmCount: 3, runningVms: 2,
});

test('short-code pairing pins TLS, persists a peer, polls live resources and revokes access', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-peers-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await freePort();
  const targetFile = join(root, 'target.json');
  let targetMetrics = { ...await status(), cpus: 2, memoryFree: 512 * 1024 ** 2 };
  const targetStatus = async () => targetMetrics;
  const first = new HostPeers(targetStatus, targetFile, 'Target');
  await first.init(false);
  await first.configure({ operation: 'listener', listener: {
    enabled: true, host: '127.0.0.1', port,
  } });
  await first.close();
  let target = new HostPeers(targetStatus, targetFile, 'Target');
  await target.init(true);
  assert.equal(target.view().listener.active, true);
  const issued = await target.configure({ operation: 'create-code' });
  assert.ok('pairing' in issued);
  const code = issued.pairing!.value;
  const address = `https://127.0.0.1:${port}/`;
  const initiatorFile = join(root, 'initiator.json');
  const initiator = new HostPeers(status, initiatorFile, 'Initiator');
  await initiator.init(false);
  try {
    await assert.rejects(initiator.configure({ operation: 'connect', url: address,
      fingerprint: initiator.view().fingerprint, code }), /本机证书/);
    const wrongPin = target.view().fingerprint.replace(/^../, '00');
    if (wrongPin !== target.view().fingerprint)
      await assert.rejects(initiator.configure({ operation: 'connect', url: address,
        fingerprint: wrongPin, code }), /指纹不匹配/);
    await initiator.configure({ operation: 'connect', url: address,
      fingerprint: target.view().fingerprint, code });
    assert.equal(initiator.view().outbound.length, 1);
    assert.equal(initiator.view().outbound[0].observation?.status?.runningVms, 2);
    assert.equal(target.view().incoming.length, 1);
    assert.equal(target.view().pairing, null);
    const constrained = await initiator.score({ cpus: 4, memoryMiB: 1024 });
    assert.equal(constrained.candidates[0].source, 'local');
    assert.equal(constrained.candidates[1].eligible, false);
    assert.match(constrained.candidates[1].reasons.join(' '), /处理器不足.*空闲内存不足/);
    targetMetrics = { ...targetMetrics, cpus: 16, memoryFree: 32 * 1024 ** 3,
      load: [0, 0, 0] };
    const recommended = await initiator.score({ cpus: 4, memoryMiB: 1024 });
    assert.equal(recommended.candidates[0].source, 'peer');
    assert.equal(recommended.candidates[0].eligible, true);
    const third = new HostPeers(status, join(root, 'third.json'), 'Third');
    await third.init(false);
    try {
      await assert.rejects(third.configure({ operation: 'connect', url: address,
        fingerprint: target.view().fingerprint, code }), /HTTP 403/);
    } finally { await third.close(); }
    await target.close();
    target = new HostPeers(targetStatus, targetFile, 'Target');
    await target.init(true);
    await initiator.refresh();
    assert.equal(initiator.view().outbound[0].observation?.status?.runningVms, 2);
    await target.configure({ operation: 'revoke-inbound', id: target.view().incoming[0].id });
    await initiator.refresh();
    assert.match(initiator.view().outbound[0].observation?.error || '', /HTTP 401/);
    const unavailable = await initiator.score({ cpus: 4, memoryMiB: 1024 });
    assert.equal(unavailable.candidates[0].source, 'local');
    assert.equal(unavailable.candidates[1].eligible, false);
    await initiator.close();
    const restored = new HostPeers(status, initiatorFile, 'Initiator');
    await restored.init(false);
    assert.equal(restored.view().outbound.length, 1);
    await restored.refresh();
    assert.match(restored.view().outbound[0].observation?.error || '', /HTTP 401/);
    await restored.configure({ operation: 'remove-outbound', id: restored.view().outbound[0].id });
    assert.equal(restored.view().outbound.length, 0);
    await restored.close();
  } finally {
    await target.close();
  }
});
