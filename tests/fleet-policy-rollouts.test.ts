import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostPeers } from '../server/host-peers.ts';
import { FeatureRollouts } from '../server/feature-rollouts.ts';
import { FleetPolicyRollouts } from '../server/fleet-policy-rollouts.ts';

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
const status = async () => ({ platform: 'win32', arch: 'x64', cpus: 4,
  memoryTotal: 8 * 1024 ** 3, memoryFree: 4 * 1024 ** 3,
  load: [0, 0, 0], vmCount: 0, runningVms: 0 });

test('fleet rollout requires per-peer permission, reviews versions, publishes and survives restart', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-fleet-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await freePort();
  const targetFile = join(root, 'target-peers.json');
  const setup = new HostPeers(status, targetFile, 'Target');
  await setup.init(false);
  await setup.configure({ operation: 'listener', listener: { enabled: true,
    host: '127.0.0.1', port } });
  await setup.close();
  const target = new HostPeers(status, targetFile, 'Target');
  await target.init(true);
  const rollout = new FeatureRollouts(join(root, 'rollout.json'));
  await rollout.init();
  target.setRolloutReceiver({ view: () => ({ hostId: target.view().hostId,
    policies: rollout.view().policies }), save: (input) => rollout.configure(input) });
  const source = new HostPeers(status, join(root, 'source-peers.json'), 'Source');
  await source.init(false);
  const fleetFile = join(root, 'fleet.json');
  const fleet = new FleetPolicyRollouts(source, fleetFile);
  await fleet.init();
  try {
    const issued = await target.configure({ operation: 'create-code' });
    assert.ok('pairing' in issued);
    await source.configure({ operation: 'connect',
      url: `https://127.0.0.1:${port}/`, fingerprint: target.view().fingerprint,
      code: issued.pairing!.value });
    const peerId = source.view().outbound[0].id;
    const policy = { pluginId: 'metrics', enabled: false, percentage: 100, cohortVersion: 'fleet-v1' };
    await assert.rejects(fleet.configure({ operation: 'create', policy, peers: [peerId] }), /HTTP 403/);
    const inboundId = target.view().incoming[0].id;
    await target.configure({ operation: 'allow-policy', id: inboundId, enabled: true });
    const batch = await fleet.configure({ operation: 'create', policy, peers: [peerId] });
    assert.equal(batch.targets[0].beforeRevision, 0);
    assert.equal(batch.targets[0].state, 'pending');
    assert.equal(rollout.view().policies.length, 0);
    await assert.rejects(fleet.configure({ operation: 'publish', id: batch.id, revision: 2 }), /已变化/);
    const published = await fleet.configure({ operation: 'publish', id: batch.id, revision: 1 });
    assert.equal(published.targets[0].state, 'applied');
    assert.equal(rollout.view().policies[0].revision, 1);
    assert.equal(rollout.decision('metrics').allowed, false);
    await fleet.close();
    const resumed = new FleetPolicyRollouts(source, fleetFile);
    await resumed.init();
    try {
      assert.equal(resumed.view().batches[0].targets[0].state, 'applied');
      await assert.rejects(resumed.configure({ operation: 'create', policy,
        peers: [peerId, peerId] }), /重复/);
      const newer = await resumed.configure({ operation: 'create',
        policy: { ...policy, enabled: true, cohortVersion: 'fleet-v2' }, peers: [peerId] });
      assert.equal(newer.targets[0].beforeRevision, 1);
      await rollout.configure({ operation: 'save', revision: 1,
        policy: { ...policy, enabled: true, cohortVersion: 'manual-change' } });
      const stale = await resumed.configure({ operation: 'publish', id: newer.id, revision: 1 });
      assert.equal(stale.targets[0].state, 'failed');
      assert.match(stale.targets[0].error || '', /已被其他操作修改/);
      assert.equal(rollout.view().policies[0].cohortVersion, 'manual-change');
      await target.configure({ operation: 'allow-policy', id: inboundId, enabled: false });
      await assert.rejects(source.rolloutStatus(peerId), /HTTP 403/);
    } finally { await resumed.close(); }
  } finally {
    await Promise.allSettled([fleet.close(), source.close(), target.close(), rollout.close()]);
  }
});
