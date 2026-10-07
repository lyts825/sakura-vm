/**
 * 模块职责：回归验证模块，围绕 `cold-migration-network` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `cold-migration-network`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: pinned peer TLS streams a real validated bundle into a distinct machine manager.
 */
const peerHandlers = new WeakMap<InstanceType<typeof HostPeers>, import('../server/host-peers.ts').HostPeerDependencies>();
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-cold-network-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Bundles } = await import('../server/bundles.ts');
const { HostPeers } = await import('../server/host-peers.ts');
const { ColdMigrations } = await import('../server/cold-migration.ts');
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
 * 验证场景 / Scenario: pinned peer TLS streams a real validated bundle into a distinct machine manager
 * 协作入口 / Collaborators: `source.init`, `destination.init`, `randomUUID`, `createSshKey`.
 * 检查边界 / Checked boundaries: `assert.ok('pairing' in issue && issue.pairing)`; `assert.equal(copied.phase, 'copied')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('pinned peer TLS streams a real validated bundle into a distinct machine manager', async () => {
  const engine = { runtime: { /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: pinned peer TLS streams a real validated bundle into a distinct machine manager
   */
  close: async () => {} },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _tool: string; args: string[]。
     * 结果：返回分支计算值（`JSON.stringify({ required: disk.length }) / '{}'`），以 Promise 交付。
     * Result: Return the branch-computed value (`JSON.stringify({ required: disk.length }) / '{}'`) through a Promise.
     * 验证场景 / Scenario: pinned peer TLS streams a real validated bundle into a distinct machine manager
     * 协作入口 / Collaborators: `JSON.stringify`, `copyFile`, `args.at`.
     */
    run: async (_tool: string, args: string[]) => {
      if (args[0] === 'measure') return JSON.stringify({ required: disk.length });
      if (args[0] === 'convert') await copyFile(args.at(-2)!, args.at(-1)!);
      return '{}';
    } } as Engine;
  const source = new Machines(engine, fakeVmNetwork);
  const destination = new Machines(engine, fakeVmNetwork);
  await source.init();
  await destination.init();
  const id = randomUUID();
  const key = createSshKey();
  const seed = seedIso({ 'user-data': 'test' });
  const disk = Buffer.alloc(104);
  disk.writeUInt32BE(0x514649fb);
  disk.writeUInt32BE(3, 4);
  disk.writeBigUInt64BE(8n * 1024n ** 3n, 24);
  source.records.set(id, { ...createSchema.parse({ name: 'source' }), id,
    createdAt: new Date().toISOString(), snapshots: [] });
  await mkdir(vmDir(id), { recursive: true });
  await writeFile(join(vmDir(id), 'disk.qcow2'), disk);
  await writeFile(join(vmDir(id), 'id_rsa'), key.privateText);
  await writeFile(join(vmDir(id), 'seed.iso'), seed);
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ platform: 'win32', arch: 'x64', cpus: 8, memoryTotal: 16 * 1024 ** 3, memoryF…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ platform: 'win32', arch: 'x64', cpus: 8, memoryTotal: 16 * 1024 ** 3, memoryF…`) through a Promise.
   * 验证场景 / Scenario: pinned peer TLS streams a real validated bundle into a distinct machine manager
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
  let activated = false;
  peerHandlers.set(target, { ...peerHandlers.get(target), importReceiver: {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: { requesterId, transferId }。
     * 结果：返回分支计算值（`found ? { id: found.id, name: found.migrationOrigin!.targetName, sha256: found.m…`），以 Promise 交付。
     * Result: Return the branch-computed value (`found ? { id: found.id, name: found.migrationOrigin!.targetName, sha256: found.m…`) through a Promise.
     * 验证场景 / Scenario: pinned peer TLS streams a real validated bundle into a distinct machine manager
     * 协作入口 / Collaborators: `[...destination.records.values()].find`, `destination.records.values`.
     */
    status: async ({ requesterId, transferId }) => {
      const found = [...destination.records.values()].find((vm) =>
        vm.migrationOrigin?.sourceHostId === requesterId &&
        vm.migrationOrigin.transferId === transferId);
      return found ? { id: found.id, name: found.migrationOrigin!.targetName,
        sha256: found.migrationOrigin!.diskSha256 } : null;
    },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: { requesterId, transferId, name, so…。
     * 结果：返回受控对象，公开字段包括 `id, name, sha256`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `id, name, sha256`; the actual branch determines its shape.
     * 验证场景 / Scenario: pinned peer TLS streams a real validated bundle into a distinct machine manager
     * 协作入口 / Collaborators: `targetBundles.import`.
     */
    receive: async ({ requesterId, transferId, name, source: body, signal }) => {
      const imported = await targetBundles.import(name, body, signal, undefined,
        { sourceHostId: requesterId, transferId, targetName: name });
      return { id: imported.id, name, sha256: imported.migrationOrigin!.diskSha256 };
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: { remoteVmId }。
     * 结果：返回分支计算值（`({ id: remoteVmId, status: 'stopped' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ id: remoteVmId, status: 'stopped' })`) through a Promise.
     * 验证场景 / Scenario: pinned peer TLS streams a real validated bundle into a distinct machine manager
     */
    inspectActivation: async ({ remoteVmId }) => ({ id: remoteVmId, status: 'stopped' }),
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: { requesterId, transferId, remoteVm…。
     * 结果：返回受控对象，公开字段包括 `id, status`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `id, status`; the actual branch determines its shape.
     * 验证场景 / Scenario: pinned peer TLS streams a real validated bundle into a distinct machine manager
     * 状态影响 / State effects: `activated`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `assert.equal`, `source.records.has`, `destination.get`.
     * 检查边界 / Checked boundaries: `assert.equal(source.records.has(id), false)`; `assert.equal(imported.migrationOrigin?.sourceHostId, requesterId)`.
     */
    activate: async ({ requesterId, transferId, remoteVmId, sha256 }) => {
      assert.equal(source.records.has(id), false);
      const imported = destination.get(remoteVmId);
      assert.equal(imported.migrationOrigin?.sourceHostId, requesterId);
      assert.equal(imported.migrationOrigin?.transferId, transferId);
      assert.equal(imported.migrationOrigin?.diskSha256, sha256);
      activated = true;
      return { id: remoteVmId, status: 'starting' };
    },
  } });
  try {
    const issue = await target.configure({ operation: 'create-code' });
    assert.ok('pairing' in issue && issue.pairing);
    await local.configure({ operation: 'connect', url: `https://127.0.0.1:${port}/`,
      fingerprint: target.view().fingerprint, code: issue.pairing.value });
    await target.configure({ operation: 'allow-import',
      id: target.view().incoming[0].id, enabled: true });
    const migration = new ColdMigrations(source, new Bundles(source), local,
      join(root, 'cold-migrations.json'));
    await migration.init();
    const options = { peerId: local.view().outbound[0].id,
      targetName: 'migrated', confirmSourceRemoval: false };
    const copied = await migration.run(id, options, new AbortController().signal);
    assert.equal(copied.phase, 'copied');
    assert.equal(copied.sourceRemoved, false);
    assert.equal(destination.records.size, 1);
    const imported = destination.get(copied.remoteVmId);
    assert.deepEqual(await readFile(join(vmDir(imported.id), 'disk.qcow2')), disk);
    assert.equal(imported.migrationOrigin?.transferId, copied.transferId);
    const retry = await migration.run(id, options, new AbortController().signal);
    assert.equal(retry.remoteVmId, imported.id);
    assert.equal(destination.records.size, 1);
    await assert.rejects(migration.run(id, { ...options, startTarget: true },
      new AbortController().signal), /明确确认移除源实例/);
    await assert.rejects(migration.run(id, { ...options,
      confirmSourceRemoval: true, startTarget: true }, new AbortController().signal), /HTTP 403/);
    assert.equal(source.records.has(id), true);
    assert.equal(activated, false);
    await target.configure({ operation: 'allow-activate',
      id: target.view().incoming[0].id, enabled: true });
    const moved = await migration.run(id, { ...options,
      confirmSourceRemoval: true, startTarget: true }, new AbortController().signal);
    assert.equal(moved.phase, 'moved');
    assert.equal(moved.sourceRemoved, true);
    assert.ok('targetStart' in moved && moved.targetStart);
    assert.equal(moved.targetStart.status, 'starting');
    assert.equal(activated, true);
    assert.equal(source.records.has(id), false);
  } finally {
    await local.close();
    await target.close();
    await source.close();
    await destination.close();
  }
});
