/**
 * 模块职责：回归验证模块，围绕 `host-peers` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `host-peers`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: short-code pairing pins TLS, persists a peer, polls live resources and revokes access.
 */
const peerHandlers = new WeakMap<InstanceType<typeof HostPeers>, import('../server/host-peers.ts').HostPeerDependencies>();
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HostPeers } from '../server/host-peers.ts';

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
 * 结果：返回分支计算值（`({ platform: 'win32', arch: 'x64', cpus: 8, memoryTotal: 16 * 1024 ** 3, memoryF…`），以 Promise 交付。
 * Result: Return the branch-computed value (`({ platform: 'win32', arch: 'x64', cpus: 8, memoryTotal: 16 * 1024 ** 3, memoryF…`) through a Promise.
 */
const status = async () => ({
  platform: 'win32', arch: 'x64', cpus: 8, memoryTotal: 16 * 1024 ** 3,
  memoryFree: 8 * 1024 ** 3, load: [0.1, 0.2, 0.3], vmCount: 3, runningVms: 2,
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
 * 状态影响 / State effects: `snapshotImport`, `targetMetrics`, `target`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.equal(target.view().listener.active, true)`; `assert.ok('pairing' in issued)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('short-code pairing pins TLS, persists a peer, polls live resources and revokes access', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-peers-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await freePort();
  const targetFile = join(root, 'target.json');
  let targetMetrics = { ...await status(), cpus: 2, memoryFree: 512 * 1024 ** 2 };
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`targetMetrics`），以 Promise 交付。
   * Result: Return the branch-computed value (`targetMetrics`) through a Promise.
   * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
   */
  const targetStatus = async () => targetMetrics;
  const first = new HostPeers(targetStatus, targetFile, 'Target', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
  await first.init(false);
  await first.configure({ operation: 'listener', listener: {
    enabled: true, host: '127.0.0.1', port,
  } });
  await first.close();
  let target = new HostPeers(targetStatus, targetFile, 'Target', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
  await target.init(true);
  assert.equal(target.view().listener.active, true);
  const issued = await target.configure({ operation: 'create-code' });
  assert.ok('pairing' in issued);
  const code = issued.pairing!.value;
  const address = `https://127.0.0.1:${port}/`;
  const initiatorFile = join(root, 'initiator.json');
  const initiator = new HostPeers(status, initiatorFile, 'Initiator', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
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
    const transferId = randomUUID();
    const importedId = randomUUID();
    let imported = '';
    let receipt: { id: string; name: string } | null = null;
    peerHandlers.set(target, { ...peerHandlers.get(target), importReceiver: {
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`receipt`），以 Promise 交付。
       * Result: Return the branch-computed value (`receipt`) through a Promise.
       * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
       */
      status: async () => receipt,
      /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: { source, name }。
       * 结果：返回分支计算值（`(receipt = { id: importedId, name })`），以 Promise 交付。
       * Result: Return the branch-computed value (`(receipt = { id: importedId, name })`) through a Promise.
       * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
       * 状态影响 / State effects: `imported`, `receipt`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `chunk.toString`.
       */
      receive: async ({ source, name }) => {
        for await (const chunk of source) imported += chunk.toString();
        return (receipt = { id: importedId, name });
      },
    } });
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: stream: NodeJS.WritableStream。
     * 结果：返回分支计算值（`pipeline(Readable.from(['verified ', 'bundle']), stream)`），以 Promise 交付。
     * Result: Return the branch-computed value (`pipeline(Readable.from(['verified ', 'bundle']), stream)`) through a Promise.
     * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
     * 协作入口 / Collaborators: `pipeline`, `Readable.from`.
     */
    const produce = async (stream: NodeJS.WritableStream) =>
      pipeline(Readable.from(['verified ', 'bundle']), stream);
    const outboundId = initiator.view().outbound[0].id;
    await assert.rejects(initiator.upload(outboundId, transferId, 'migrated', produce,
      new AbortController().signal));
    assert.equal(imported, '');
    const inboundId = target.view().incoming[0].id;
    await target.configure({ operation: 'allow-import', id: inboundId, enabled: true });
    const importedView = await initiator.upload(outboundId, transferId, 'migrated', produce,
      new AbortController().signal);
    assert.deepEqual(importedView, { id: importedId, name: 'migrated' });
    assert.equal(imported, 'verified bundle');
    assert.deepEqual(await initiator.importStatus(outboundId, transferId), importedView);
    await initiator.upload(outboundId, transferId, 'migrated', async () => {
      throw new Error('重试不得再次上传');
    }, new AbortController().signal);
    assert.equal(imported, 'verified bundle');
    const digest = 'a'.repeat(64);
    let activated = 0;
    let snapshotImport = false;
    peerHandlers.set(target, { ...peerHandlers.get(target), importReceiver: {
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`({ id: importedId, name: 'migrated', sha256: digest, ...(snapshotImport ? { sour…`），以 Promise 交付。
       * Result: Return the branch-computed value (`({ id: importedId, name: 'migrated', sha256: digest, ...(snapshotImport ? { sour…`) through a Promise.
       * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
       * 协作入口 / Collaborators: `randomUUID`.
       */
      status: async () => ({ id: importedId, name: 'migrated', sha256: digest,
        ...(snapshotImport ? { sourceVmId: randomUUID(), snapshotId: randomUUID() } : {}) }),
      /**
       * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
       * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
       * 失败 / Failure: `new Error('启动检查不得重新导入')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       */
      receive: async () => { throw new Error('启动检查不得重新导入'); },
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: { remoteVmId }。
       * 结果：返回分支计算值（`({ id: remoteVmId, status: 'stopped' })`），以 Promise 交付。
       * Result: Return the branch-computed value (`({ id: remoteVmId, status: 'stopped' })`) through a Promise.
       * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
       */
      inspectActivation: async ({ remoteVmId }) => ({ id: remoteVmId, status: 'stopped' }),
      /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: { remoteVmId }。
       * 结果：返回受控对象，公开字段包括 `id, status`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `id, status`; the actual branch determines its shape.
       * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
       */
      activate: async ({ remoteVmId }) => {
        activated++;
        return { id: remoteVmId, status: 'starting' };
      },
    } });
    const activation = { transferId, remoteVmId: importedId, sha256: digest };
    await assert.rejects(initiator.checkImportActivation(outboundId, activation), /HTTP 403/);
    await assert.rejects(initiator.activateImport(outboundId, activation), /HTTP 403/);
    await target.configure({ operation: 'allow-activate', id: inboundId, enabled: true });
    snapshotImport = true;
    await assert.rejects(initiator.checkImportActivation(outboundId, activation), /HTTP 409/);
    await assert.rejects(initiator.activateImport(outboundId, activation), /HTTP 409/);
    snapshotImport = false;
    assert.equal(activated, 0);
    assert.deepEqual(await initiator.checkImportActivation(outboundId, activation),
      { ready: true, id: importedId, status: 'stopped' });
    await assert.rejects(initiator.activateImport(outboundId,
      { ...activation, sha256: 'b'.repeat(64) }), /HTTP 409/);
    assert.equal(activated, 0);
    assert.deepEqual(await initiator.activateImport(outboundId, activation),
      { id: importedId, status: 'starting' });
    assert.equal(activated, 1);
    await target.configure({ operation: 'allow-activate', id: inboundId, enabled: false });
    await assert.rejects(initiator.activateImport(outboundId, activation), /HTTP 403/);
    const sourceVmId = randomUUID(), snapshotId = randomUUID();
    const replica = { ...activation, sourceVmId, snapshotId };
    let replicaStarts = 0, replicaRetires = 0;
    peerHandlers.set(target, { ...peerHandlers.get(target), importReceiver: {
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`({ id: importedId, name: 'standby', sha256: digest, sourceVmId, snapshotId })`），以 Promise 交付。
       * Result: Return the branch-computed value (`({ id: importedId, name: 'standby', sha256: digest, sourceVmId, snapshotId })`) through a Promise.
       * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
       */
      status: async () => ({ id: importedId, name: 'standby', sha256: digest,
        sourceVmId, snapshotId }),
      /**
       * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
       * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
       * 失败 / Failure: `new Error('副本接管不得重新导入')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       */
      receive: async () => { throw new Error('副本接管不得重新导入'); },
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`({ id: importedId, status: 'stopped' })`），以 Promise 交付。
       * Result: Return the branch-computed value (`({ id: importedId, status: 'stopped' })`) through a Promise.
       * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
       */
      inspectReplicaActivation: async () => ({ id: importedId, status: 'stopped' }),
      /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回受控对象，公开字段包括 `id, status`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `id, status`; the actual branch determines its shape.
       * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
       */
      activateReplica: async () => {
        replicaStarts++;
        return { id: importedId, status: 'starting' };
      },
      /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回受控对象，公开字段包括 `id, retired`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `id, retired`; the actual branch determines its shape.
       * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
       */
      retireReplica: async () => {
        replicaRetires++;
        return { id: importedId, retired: true };
      },
    } });
    await assert.rejects(initiator.checkReplicaActivation(outboundId, replica), /HTTP 403/);
    await target.configure({ operation: 'allow-failover', id: inboundId, enabled: true });
    assert.deepEqual(await initiator.checkReplicaActivation(outboundId, replica),
      { ready: true, id: importedId, status: 'stopped' });
    await assert.rejects(initiator.activateReplica(outboundId,
      { ...replica, snapshotId: randomUUID() }), /HTTP 409/);
    assert.equal(replicaStarts, 0);
    assert.deepEqual(await initiator.activateReplica(outboundId, replica),
      { id: importedId, status: 'starting' });
    assert.equal(replicaStarts, 1);
    assert.deepEqual(await initiator.retireReplica(outboundId, replica),
      { id: importedId, retired: true });
    assert.equal(replicaRetires, 1);
    await target.configure({ operation: 'allow-failover', id: inboundId, enabled: false });
    await assert.rejects(initiator.retireReplica(outboundId, replica), /HTTP 403/);
    let checks = 0;
    peerHandlers.set(target, { ...peerHandlers.get(target), importReceiver: {
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`++checks === 1 ? null : { id: importedId, name: 'migrated' }`），以 Promise 交付。
       * Result: Return the branch-computed value (`++checks === 1 ? null : { id: importedId, name: 'migrated' }`) through a Promise.
       * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
       */
      status: async () => ++checks === 1 ? null : { id: importedId, name: 'migrated' },
      /**
       * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
       * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
       * 失败 / Failure: `new Error('重复传输不得再次导入')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       */
      receive: async () => { throw new Error('重复传输不得再次导入'); },
    } });
    assert.deepEqual(await initiator.upload(outboundId, randomUUID(), 'migrated', produce,
      new AbortController().signal), { id: importedId, name: 'migrated' });
    await target.configure({ operation: 'allow-import', id: inboundId, enabled: false });
    await assert.rejects(initiator.upload(outboundId, randomUUID(), 'migrated', produce,
      new AbortController().signal));
    assert.equal(imported, 'verified bundle');
    let started!: /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void;
    const receiving = new Promise<void>((resolve) => { started = resolve; });
    let aborted = false;
    peerHandlers.set(target, { ...peerHandlers.get(target), importReceiver: {
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`null`），以 Promise 交付。
       * Result: Return the branch-computed value (`null`) through a Promise.
       * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
       */
      status: async () => null,
      /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: { source, signal }。
       * 结果：返回分支计算值（`await new Promise<never>((_resolve, reject) => signal.addEventListener('abort', …`），以 Promise 交付。
       * Result: Return the branch-computed value (`await new Promise<never>((_resolve, reject) => signal.addEventListener('abort', …`) through a Promise.
       * 验证场景 / Scenario: short-code pairing pins TLS, persists a peer, polls live resources and revokes access
       * 协作入口 / Collaborators: `started`.
       */
      receive: async ({ source, signal }) => {
        for await (const _chunk of source) { /* consume the bounded test stream */ }
        started();
        return await new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('transfer revoked'));
        }, { once: true }));
      },
    } });
    await target.configure({ operation: 'allow-import', id: inboundId, enabled: true });
    const inFlight = initiator.upload(outboundId, randomUUID(), 'migrated', produce,
      new AbortController().signal);
    await receiving;
    await target.configure({ operation: 'allow-import', id: inboundId, enabled: false });
    await assert.rejects(inFlight);
    assert.equal(aborted, true);
    const constrained = await initiator.score({ cpus: 4, memoryMiB: 1024 });
    assert.equal(constrained.candidates[0].source, 'local');
    assert.equal(constrained.candidates[1].eligible, false);
    assert.match(constrained.candidates[1].reasons.join(' '), /处理器不足.*空闲内存不足/);
    targetMetrics = { ...targetMetrics, cpus: 16, memoryFree: 32 * 1024 ** 3,
      load: [0, 0, 0] };
    const recommended = await initiator.score({ cpus: 4, memoryMiB: 1024 });
    assert.equal(recommended.candidates[0].source, 'peer');
    assert.equal(recommended.candidates[0].eligible, true);
    const third = new HostPeers(status, join(root, 'third.json'), 'Third', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
    await third.init(false);
    try {
      await assert.rejects(third.configure({ operation: 'connect', url: address,
        fingerprint: target.view().fingerprint, code }), /HTTP 403/);
    } finally { await third.close(); }
    await target.close();
    target = new HostPeers(targetStatus, targetFile, 'Target', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
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
    const restored = new HostPeers(status, initiatorFile, 'Initiator', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
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
