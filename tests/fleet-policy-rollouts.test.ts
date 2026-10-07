/**
 * 模块职责：回归验证模块，围绕 `fleet-policy-rollouts` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `fleet-policy-rollouts`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: fleet rollout requires per-peer permission, reviews versions, publishes and survives restart.
 */
const peerHandlers = new WeakMap<InstanceType<typeof HostPeers>, import('../server/host-peers.ts').HostPeerDependencies>();
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostPeers } from '../server/host-peers.ts';
import { FeatureRollouts } from '../server/feature-rollouts.ts';
import { FleetPolicyRollouts } from '../server/fleet-policy-rollouts.ts';

/**
 * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
 * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`address.port`），以 Promise 交付。
 * Result: Return the branch-computed value (`address.port`) through a Promise.
 * 失败 / Failure: `new Error('No test port')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `createServer`, `server.address`.
 */
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`({ platform: 'win32', arch: 'x64', cpus: 4, memoryTotal: 8 * 1024 ** 3, memoryFr…`），以 Promise 交付。
 * Result: Return the branch-computed value (`({ platform: 'win32', arch: 'x64', cpus: 4, memoryTotal: 8 * 1024 ** 3, memoryFr…`) through a Promise.
 */
const status = async () => ({ platform: 'win32', arch: 'x64', cpus: 4,
  memoryTotal: 8 * 1024 ** 3, memoryFree: 4 * 1024 ** 3,
  load: [0, 0, 0], vmCount: 0, runningVms: 0 });

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: fleet rollout requires per-peer permission, reviews versions, publishes and survives restart
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.ok('pairing' in issued)`; `assert.rejects(fleet.configure({ operation: 'create', policy, peers: [peerId] }), /HTTP 403/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('fleet rollout requires per-peer permission, reviews versions, publishes and survives restart', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-fleet-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await freePort();
  const targetFile = join(root, 'target-peers.json');
  const setup = new HostPeers(status, targetFile, 'Target', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
  await setup.init(false);
  await setup.configure({ operation: 'listener', listener: { enabled: true,
    host: '127.0.0.1', port } });
  await setup.close();
  const target = new HostPeers(status, targetFile, 'Target', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
  await target.init(true);
  const rollout = new FeatureRollouts(join(root, 'rollout.json'));
  await rollout.init();
  peerHandlers.set(target, { ...peerHandlers.get(target), rolloutReceiver: { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ hostId: target.view().hostId, policies: rollout.view().policies })`）。
   * Result: Return the branch-computed value (`({ hostId: target.view().hostId, policies: rollout.view().policies })`).
   * 验证场景 / Scenario: fleet rollout requires per-peer permission, reviews versions, publishes and survives restart
   * 协作入口 / Collaborators: `target.view`, `rollout.view`.
   */
  view: () => ({ hostId: target.view().hostId,
    policies: rollout.view().policies }), /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: input。
     * 结果：返回分支计算值（`rollout.configure(input)`）。
     * Result: Return the branch-computed value (`rollout.configure(input)`).
     * 验证场景 / Scenario: fleet rollout requires per-peer permission, reviews versions, publishes and survives restart
     * 协作入口 / Collaborators: `rollout.configure`.
     */
    save: (input) => rollout.configure(input) } });
  const source = new HostPeers(status, join(root, 'source-peers.json'), 'Source', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
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
