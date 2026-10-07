/**
 * 模块职责：回归验证模块，围绕 `snapshot-replications-network` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `snapshot-replications-network`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: pinned TLS replicates selected historical snapshot with verified receipt and idempotent retry; a mismatched remote checksum remains under review across retries.
 */
const peerHandlers = new WeakMap<InstanceType<typeof HostPeers>, import('../server/host-peers.ts').HostPeerDependencies>();
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-snapshot-network-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Bundles } = await import('../server/bundles.ts');
const { HostPeers } = await import('../server/host-peers.ts');
const { SnapshotReplications } = await import('../server/snapshot-replications.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
const { createSshKey, seedIso } = await import('../server/seed.ts');
after(() => rm(root, { recursive: true, force: true }));

/**
 * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
 * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`address.port`），以 Promise 交付。
 * Result: Return the branch-computed value (`address.port`) through a Promise.
 * 失败 / Failure: `new Error('no port')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `createServer`, `server.address`.
 */
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pinned TLS replicates selected historical snapshot with verified receipt and idempotent retry
 * 状态影响 / State effects: `historical[103]`, `current[103]`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Buffer.alloc`, `disk.writeUInt32BE`, `disk.writeBigUInt64BE`, `Buffer.from`.
 * 检查边界 / Checked boundaries: `assert.ok('pairing' in issue && issue.pairing)`; `assert.equal(copied.sha256, expectedSha)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('pinned TLS replicates selected historical snapshot with verified receipt and idempotent retry', async () => {
  const disk = Buffer.alloc(104);
  disk.writeUInt32BE(0x514649fb);
  disk.writeUInt32BE(3, 4);
  disk.writeBigUInt64BE(8n * 1024n ** 3n, 24);
  const historical = Buffer.from(disk);
  historical[103] = 0x42;
  const current = Buffer.from(disk);
  current[103] = 0x7a;
  const engine = { runtime: { /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: pinned TLS replicates selected historical snapshot with verified receipt and idempotent retry
   */
  close: async () => {} },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _tool: string; args: string[]。
     * 结果：返回分支计算值（`JSON.stringify({ required: disk.length }) / '{}'`），以 Promise 交付。
     * Result: Return the branch-computed value (`JSON.stringify({ required: disk.length }) / '{}'`) through a Promise.
     * 验证场景 / Scenario: pinned TLS replicates selected historical snapshot with verified receipt and idempotent retry
     * 协作入口 / Collaborators: `JSON.stringify`, `writeFile`, `args.at`, `args.includes`.
     */
    run: async (_tool: string, args: string[]) => {
      if (args[0] === 'measure') return JSON.stringify({ required: disk.length });
      if (args[0] === 'convert')
        await writeFile(args.at(-1)!, args.includes('-l') ? historical : current);
      return '{}';
    } } as Engine;
  const source = new Machines(engine, fakeVmNetwork);
  const destination = new Machines(engine, fakeVmNetwork);
  await source.init();
  await destination.init();
  const id = randomUUID();
  const identity = createSshKey();
  const seed = seedIso({ 'user-data': 'historical' });
  source.records.set(id, { ...createSchema.parse({ name: 'source' }), id,
    createdAt: new Date().toISOString(), snapshots: [] });
  await mkdir(vmDir(id), { recursive: true });
  await writeFile(join(vmDir(id), 'disk.qcow2'), historical);
  await writeFile(join(vmDir(id), 'id_rsa'), identity.privateText);
  await writeFile(join(vmDir(id), 'seed.iso'), seed);
  const snapshot = await source.snapshot(id, 'before-change');
  await writeFile(join(vmDir(id), 'disk.qcow2'), current);
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ platform: 'win32', arch: 'x64', cpus: 8, memoryTotal: 16 * 1024 ** 3, memoryF…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ platform: 'win32', arch: 'x64', cpus: 8, memoryTotal: 16 * 1024 ** 3, memoryF…`) through a Promise.
   * 验证场景 / Scenario: pinned TLS replicates selected historical snapshot with verified receipt and idempotent retry
   */
  const status = async () => ({ platform: 'win32', arch: 'x64', cpus: 8,
    memoryTotal: 16 * 1024 ** 3, memoryFree: 8 * 1024 ** 3,
    load: [0, 0, 0], vmCount: 1, runningVms: 0 });
  const port = await freePort();
  const targetFile = join(root, 'target-peers.json');
  const setup = new HostPeers(status, targetFile, 'Target', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
  await setup.init(false);
  await setup.configure({ operation: 'listener', listener: {
    enabled: true, host: '127.0.0.1', port } });
  await setup.close();
  const target = new HostPeers(status, targetFile, 'Target', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
  await target.init(true);
  const local = new HostPeers(status, join(root, 'local-peers.json'), 'Local', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
  await local.init(false);
  const targetBundles = new Bundles(destination);
  peerHandlers.set(target, { ...peerHandlers.get(target), importReceiver: {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: { requesterId, transferId }。
     * 结果：返回分支计算值（`found ? { id: found.id, name: found.migrationOrigin!.targetName, sha256: found.m…`），以 Promise 交付。
     * Result: Return the branch-computed value (`found ? { id: found.id, name: found.migrationOrigin!.targetName, sha256: found.m…`) through a Promise.
     * 验证场景 / Scenario: pinned TLS replicates selected historical snapshot with verified receipt and idempotent retry
     * 协作入口 / Collaborators: `[...destination.records.values()].find`, `destination.records.values`.
     */
    status: async ({ requesterId, transferId }) => {
      const found = [...destination.records.values()].find((vm) =>
        vm.migrationOrigin?.sourceHostId === requesterId &&
        vm.migrationOrigin.transferId === transferId);
      return found ? { id: found.id, name: found.migrationOrigin!.targetName,
        sha256: found.migrationOrigin!.diskSha256,
        sourceVmId: found.migrationOrigin!.sourceVmId,
        snapshotId: found.migrationOrigin!.snapshotId } : null;
    },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: { requesterId, transferId, name, so…。
     * 结果：返回受控对象，公开字段包括 `id, name, sha256, sourceVmId, snapshotId`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `id, name, sha256, sourceVmId, snapshotId`; the actual branch determines its shape.
     * 验证场景 / Scenario: pinned TLS replicates selected historical snapshot with verified receipt and idempotent retry
     * 协作入口 / Collaborators: `targetBundles.import`.
     */
    receive: async ({ requesterId, transferId, name, sourceVmId, snapshotId,
      source: body, signal }) => {
      const imported = await targetBundles.import(name, body, signal, undefined,
        { sourceHostId: requesterId, transferId, targetName: name,
          sourceVmId, snapshotId });
      return { id: imported.id, name, sha256: imported.migrationOrigin?.diskSha256,
        sourceVmId, snapshotId };
    },
  } });
  try {
    const issue = await target.configure({ operation: 'create-code' });
    assert.ok('pairing' in issue && issue.pairing);
    await local.configure({ operation: 'connect', url: `https://127.0.0.1:${port}/`,
      fingerprint: target.view().fingerprint, code: issue.pairing.value });
    await target.configure({ operation: 'allow-import',
      id: target.view().incoming[0].id, enabled: true });
    const queueFile = join(root, 'snapshot-replications.json');
    const replication = new SnapshotReplications(source, new Bundles(source), local, queueFile);
    await replication.init();
    const options = { peerId: local.view().outbound[0].id,
      snapshotId: snapshot.id, targetName: 'historical-copy' };
    const copied = await replication.run(id, options, new AbortController().signal);
    const expectedSha = createHash('sha256').update(historical).digest('hex');
    assert.equal(copied.sha256, expectedSha);
    assert.equal(destination.records.size, 1);
    const imported = destination.get(copied.remoteVmId);
    assert.deepEqual(await readFile(join(vmDir(imported.id), 'disk.qcow2')), historical);
    assert.deepEqual(await readFile(join(vmDir(id), 'disk.qcow2')), current);
    assert.equal(imported.migrationOrigin?.sourceVmId, id);
    assert.equal(imported.migrationOrigin?.snapshotId, snapshot.id);
    assert.equal(imported.migrationOrigin?.diskSha256, expectedSha);
    const restarted = new SnapshotReplications(source, new Bundles(source), local, queueFile);
    await restarted.init();
    const retry = await restarted.run(id, options, new AbortController().signal);
    assert.equal(retry.remoteVmId, imported.id);
    assert.equal(retry.sha256, expectedSha);
    assert.equal(destination.records.size, 1);
    assert.equal(restarted.view().entries[0].status, 'replicated');
  } finally {
    await local.close();
    await target.close();
    await source.close();
    await destination.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a mismatched remote checksum remains under review across retries
 * 协作入口 / Collaborators: `randomUUID`, `new Date().toISOString`, `createSchema.parse`, `join`.
 * 检查边界 / Checked boundaries: `assert.rejects(first.run(id, options, new AbortController().signal), /校验值/)`; `assert.equal(first.view().entries[0].status, 'review')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a mismatched remote checksum remains under review across retries', async () => {
  const id = randomUUID();
  const snapshotId = randomUUID();
  const peerId = randomUUID();
  const remoteId = randomUUID();
  const remoteVmId = randomUUID();
  const snapshot = { id: snapshotId, name: 'old', createdAt: new Date().toISOString(),
    diskGiB: 8, pendingResize: false };
  const vm = { ...createSchema.parse({ name: 'source' }), id,
    createdAt: new Date().toISOString(), snapshots: [snapshot] };
  const machines = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; work: () => Promise<unknown>。
     * 结果：返回分支计算值（`work()`），以 Promise 交付。
     * Result: Return the branch-computed value (`work()`) through a Promise.
     * 验证场景 / Scenario: a mismatched remote checksum remains under review across retries
     * 协作入口 / Collaborators: `work`.
     */
    locked: async (_id: string, work: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => work(),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a mismatched remote checksum remains under review across retries
     */
    requireStopped: () => {},
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`vm`）。
     * Result: Return the branch-computed value (`vm`).
     * 验证场景 / Scenario: a mismatched remote checksum remains under review across retries
     */
    get: () => vm,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ key: 'identity', seed: Buffer.from('seed') })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ key: 'identity', seed: Buffer.from('seed') })`) through a Promise.
     * 验证场景 / Scenario: a mismatched remote checksum remains under review across retries
     * 协作入口 / Collaborators: `Buffer.from`.
     */
    snapshotIdentity: async () => ({ key: 'identity', seed: Buffer.from('seed') }),
  } as unknown as InstanceType<typeof Machines>;
  let receipt: { id: string; name: string; sha256: string;
    sourceVmId: string; snapshotId: string } | null = null;
  const peers = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ outbound: [{ id: peerId, remoteId, name: 'Remote' }] })`）。
     * Result: Return the branch-computed value (`({ outbound: [{ id: peerId, remoteId, name: 'Remote' }] })`).
     * 验证场景 / Scenario: a mismatched remote checksum remains under review across retries
     */
    view: () => ({ outbound: [{ id: peerId, remoteId, name: 'Remote' }] }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ candidates: [{ id: remoteId, source: 'peer', eligible: true, reasons: [], sta…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ candidates: [{ id: remoteId, source: 'peer', eligible: true, reasons: [], sta…`) through a Promise.
     * 验证场景 / Scenario: a mismatched remote checksum remains under review across retries
     */
    score: async () => ({ candidates: [{ id: remoteId, source: 'peer', eligible: true,
      reasons: [], status: { platform: 'win32', arch: 'x64' } }] }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ platform: 'win32', arch: 'x64' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ platform: 'win32', arch: 'x64' })`) through a Promise.
     * 验证场景 / Scenario: a mismatched remote checksum remains under review across retries
     */
    status: async () => ({ platform: 'win32', arch: 'x64' }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`receipt`），以 Promise 交付。
     * Result: Return the branch-computed value (`receipt`) through a Promise.
     * 验证场景 / Scenario: a mismatched remote checksum remains under review across retries
     */
    importStatus: async () => receipt,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _peer: string; _transfer: string; name: string; produce: (target: Writable, signal: AbortSignal) => Promise<unknown>; signal: AbortSignal。
     * 结果：返回分支计算值（`receipt`），以 Promise 交付。
     * Result: Return the branch-computed value (`receipt`) through a Promise.
     * 验证场景 / Scenario: a mismatched remote checksum remains under review across retries
     * 状态影响 / State effects: `receipt`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `produce`, `'b'.repeat`.
     */
    upload: async (_peer: string, _transfer: string, name: string,
      produce: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: target: Writable; signal: AbortSignal。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      (target: Writable, signal: AbortSignal) => Promise<unknown>,
      signal: AbortSignal) => {
      await produce(new Writable({ /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: _chunk; _encoding; done。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: a mismatched remote checksum remains under review across retries
       * 协作入口 / Collaborators: `done`.
       */
      write(_chunk, _encoding, done) { done(); } }), signal);
      receipt = { id: remoteVmId, name, sha256: 'b'.repeat(64),
        sourceVmId: id, snapshotId };
      return receipt;
    },
  } as unknown as InstanceType<typeof HostPeers>;
  const bundles = { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'a'.repeat(64)`），以 Promise 交付。
   * Result: Return the branch-computed value (`'a'.repeat(64)`) through a Promise.
   * 验证场景 / Scenario: a mismatched remote checksum remains under review across retries
   * 协作入口 / Collaborators: `'a'.repeat`.
   */
  export: async () => 'a'.repeat(64) } as unknown as InstanceType<typeof Bundles>;
  const file = join(root, `mismatch-${randomUUID()}.json`);
  const first = new SnapshotReplications(machines, bundles, peers, file);
  await first.init();
  const options = { peerId, snapshotId, targetName: 'old-copy' };
  await assert.rejects(first.run(id, options, new AbortController().signal), /校验值/);
  assert.equal(first.view().entries[0].status, 'review');
  assert.equal(first.view().entries[0].sourceSha256, 'a'.repeat(64));
  const restarted = new SnapshotReplications(machines, bundles, peers, file);
  await restarted.init();
  await assert.rejects(restarted.run(id, options, new AbortController().signal), /校验值/);
  assert.equal(restarted.view().entries[0].status, 'review');
});
