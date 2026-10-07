/**
 * 模块职责：回归验证模块，围绕 `live-migration-target` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `live-migration-target`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: a QEMU launch failure removes the unpublished incoming target; incoming target atomically adopts source identity and persists a non-bootable prepared record.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Engine } from '../server/runtime.ts';
import type { HostPeers } from '../server/host-peers.ts';
import { createSshKey, seedIso } from '../server/seed.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-live-target-'));
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_PATH = join(root, 'base.qcow2');
const { Machines } = await import('../server/machines.ts');
const { LiveMigrationReceiver } = await import('../server/live-migration-receiver.ts');
const { vmDir } = await import('../server/model.ts');
after(async () => {
  const [resolved, temporary] = await Promise.all([realpath(root), realpath(tmpdir())]);
  if (dirname(resolved).toLowerCase() !== temporary.toLowerCase() ||
      !basename(resolved).startsWith('sakura-live-target-'))
    throw new Error('Refusing unexpected test cleanup path');
  await rm(resolved, { recursive: true, force: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a QEMU launch failure removes the unpublished incoming target
 * 协作入口 / Collaborators: `writeFile`, `machines.init`, `assert.rejects`, `receiver.prepare`.
 * 检查边界 / Checked boundaries: `assert.rejects(receiver.prepare({ requesterId: randomUUID(), sourceVmId: randomUUID(), transferId: randomUUID(), config: { name: '…`; `assert.equal(registered, false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a QEMU launch failure removes the unpublished incoming target', async () => {
  await writeFile(process.env.SAKURA_IMAGE_PATH!, 'synthetic base');
  const engine = { qemuIoAvailable: false, runtime: { /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: a QEMU launch failure removes the unpublished incoming target
   */
  close: async () => {} },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: tool: string; args: string[]。
     * 结果：返回分支计算值（`writeFile(args.at(-2)!, 'synthetic overlay')`），以 Promise 交付。
     * Result: Return the branch-computed value (`writeFile(args.at(-2)!, 'synthetic overlay')`) through a Promise.
     * 验证场景 / Scenario: a QEMU launch failure removes the unpublished incoming target
     * 失败 / Failure: `new Error('injected QEMU launch failure')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `writeFile`, `args.at`.
     */
    run: async (tool: string, args: string[]) => {
      if (tool === 'sakura-img') return writeFile(args.at(-2)!, 'synthetic overlay');
      throw new Error('injected QEMU launch failure');
    },
  } as unknown as Engine;
  const machines = new Machines(engine, fakeVmNetwork);
  await machines.init();
  let registered = false;
  const peers = { /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`randomUUID()`）。
   * Result: Return the branch-computed value (`randomUUID()`).
   * 验证场景 / Scenario: a QEMU launch failure removes the unpublished incoming target
   * 状态影响 / State effects: `registered`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `randomUUID`.
   */
  registerMigrationSession: () => { registered = true; return randomUUID(); },
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a QEMU launch failure removes the unpublished incoming target
     */
    closeMigrationSession: () => {} } as unknown as HostPeers;
  try {
    const receiver = new LiveMigrationReceiver(machines, peers);
    await assert.rejects(receiver.prepare({ requesterId: randomUUID(),
      sourceVmId: randomUUID(), transferId: randomUUID(),
      config: { name: 'failing-target', memoryMiB: 512, cpus: 2, diskGiB: 8,
        accelerator: 'tcg', forwards: [] },
      key: createSshKey().privateText,
      seed: seedIso({ 'meta-data': 'source', 'user-data': 'setup' }),
    }), /目标 QEMU 未启动|目标 QEMU 已退出|目标 QMP 启动超时/);
    assert.equal(registered, false);
    assert.equal([...machines.records.values()].some((vm) => vm.name === 'failing-target'), false);
  } finally { await machines.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: incoming target atomically adopts source identity and persists a non-bootable prepared record
 * 协作入口 / Collaborators: `writeFile`, `machines.init`, `randomUUID`, `createSshKey`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.createIncomingTarget({ name: 'invalid' }, { key: 'not a private key', seed: identity.seed, }, source), /身份…`; `assert.equal((await machines.createIncomingTarget({ name: 'target' }, identity, source)).id, target.id)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('incoming target atomically adopts source identity and persists a non-bootable prepared record', async () => {
  await writeFile(process.env.SAKURA_IMAGE_PATH!, 'synthetic base');
  const engine = { qemuIoAvailable: false, runtime: { /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: incoming target atomically adopts source identity and persists a non-bootable prepared record
   */
  close: async () => {} },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: tool: string; args: string[]。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: incoming target atomically adopts source identity and persists a non-bootable prepared record
     * 失败 / Failure: `new Error(`Unexpected ${tool}`)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `writeFile`, `args.at`.
     */
    run: async (tool: string, args: string[]) => {
      if (tool !== 'sakura-img') throw new Error(`Unexpected ${tool}`);
      await writeFile(args.at(-2)!, 'synthetic overlay');
    },
  } as unknown as Engine;
  const machines = new Machines(engine, fakeVmNetwork);
  await machines.init();
  const source = { sourceHostId: randomUUID(), sourceVmId: randomUUID(),
    transferId: randomUUID() };
  const identity = { key: createSshKey().privateText,
    seed: seedIso({ 'meta-data': 'source identity', 'user-data': 'source setup' }) };
  try {
    await assert.rejects(machines.createIncomingTarget({ name: 'invalid' }, {
      key: 'not a private key', seed: identity.seed,
    }, source), /身份数据无效|控制密钥无效/);
    const target = await machines.createIncomingTarget({ name: 'target' }, identity, source);
    assert.equal((await machines.createIncomingTarget({ name: 'target' }, identity, source)).id, target.id);
    assert.equal(target.liveMigrationOrigin?.status, 'prepared');
    assert.equal(target.liveMigrationOrigin?.sourceVmId, source.sourceVmId);
    assert.equal(await readFile(join(vmDir(target.id), 'id_rsa'), 'utf8'), identity.key);
    assert.deepEqual(await readFile(join(vmDir(target.id), 'seed.iso')), identity.seed);
    await assert.rejects(machines.start(target.id), /尚未接收客户机状态/);
    await assert.rejects(machines.createIncomingTarget({ name: 'other' }, identity, source),
      /已创建目标实例/);
    const restored = new Machines(engine, fakeVmNetwork);
    await restored.init();
    try {
      assert.equal(restored.get(target.id).liveMigrationOrigin?.status, 'prepared');
      await assert.rejects(restored.start(target.id), /尚未接收客户机状态/);
    } finally { await restored.close(); }
  } finally { await machines.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: target preparation replays its original receipt and reconstructs the same transfer after host restart
 * 状态影响 / State effects: `restored`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `writeFile`, `machines.init`, `randomUUID`, `createSshKey`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(await receiver.prepare(input), receipt)`; `assert.equal(registered, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('target preparation replays its original receipt and reconstructs the same transfer after host restart', async () => {
  await writeFile(process.env.SAKURA_IMAGE_PATH!, 'synthetic base');
  const engine = { qemuIoAvailable: false, whpxAvailable: false, runtime: { /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: target preparation replays its original receipt and reconstructs the same transfer after host restart
   */
  close: async () => {} },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: tool: string; args: string[]; options: { signal: AbortSignal }。
     * 结果：返回分支计算值（`writeFile(args.at(-2)!, 'synthetic overlay')`），以 Promise 交付。
     * Result: Return the branch-computed value (`writeFile(args.at(-2)!, 'synthetic overlay')`) through a Promise.
     * 验证场景 / Scenario: target preparation replays its original receipt and reconstructs the same transfer after host restart
     * 协作入口 / Collaborators: `writeFile`, `args.at`.
     */
    run: async (tool: string, args: string[], options?: { signal: AbortSignal }) => {
      if (tool === 'sakura-img') return writeFile(args.at(-2)!, 'synthetic overlay');
      await new Promise<void>(resolve => options!.signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  } as unknown as Engine;
  const machines = new Machines(engine, fakeVmNetwork);
  await machines.init();
  const sessions = new Set<string>();
  let registered = 0;
  const peers = {
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: _requester: string; ports: { sessionId?: string }。
     * 结果：返回分支计算值（`id`）。
     * Result: Return the branch-computed value (`id`).
     * 验证场景 / Scenario: target preparation replays its original receipt and reconstructs the same transfer after host restart
     * 协作入口 / Collaborators: `randomUUID`, `sessions.add`.
     */
    registerMigrationSession: (_requester: string, ports: { sessionId?: string }) => {
      registered++; const id = ports.sessionId || randomUUID(); sessions.add(id); return id;
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`sessions.has(id)`）。
     * Result: Return the branch-computed value (`sessions.has(id)`).
     * 验证场景 / Scenario: target preparation replays its original receipt and reconstructs the same transfer after host restart
     * 协作入口 / Collaborators: `sessions.has`.
     */
    matchesMigrationSession: (id: string) => sessions.has(id),
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`sessions.delete(id)`）。
     * Result: Return the branch-computed value (`sessions.delete(id)`).
     * 验证场景 / Scenario: target preparation replays its original receipt and reconstructs the same transfer after host restart
     * 协作入口 / Collaborators: `sessions.delete`.
     */
    closeMigrationSession: (id: string) => sessions.delete(id),
  } as unknown as HostPeers;
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: _port: number; command: string。
   * 结果：返回分支计算值（`command === 'query-status' ? { running: false, status: 'inmigrate' } : [{ device…`），以 Promise 交付。
   * Result: Return the branch-computed value (`command === 'query-status' ? { running: false, status: 'inmigrate' } : [{ device…`) through a Promise.
   * 验证场景 / Scenario: target preparation replays its original receipt and reconstructs the same transfer after host restart
   */
  const query = async (_port: number, command: string) => command === 'query-status'
    ? { running: false, status: 'inmigrate' }
    : [{ device: 'sakura-disk', inserted: { ro: false, 'node-name': '#target', image: { 'virtual-size': 8 * 1024 ** 3 } } }];
  const input = { requesterId: randomUUID(), sourceVmId: randomUUID(), transferId: randomUUID(), completionProtocol: 1 as const,
    config: { name: 'replay-target', memoryMiB: 512, cpus: 2, diskGiB: 8, accelerator: 'tcg' as const, forwards: [] },
    key: createSshKey().privateText, seed: seedIso({ 'meta-data': 'original', 'user-data': 'original' }) };
  let restored: InstanceType<typeof Machines> | undefined;
  try {
    const receiver = new LiveMigrationReceiver(machines, peers, undefined, query);
    const receipt = await receiver.prepare(input);
    assert.deepEqual(await receiver.prepare(input), receipt);
    assert.equal(registered, 1);
    await assert.rejects(receiver.prepare({ ...input, sourceVmId: randomUUID() }), /身份不匹配/);
    await machines.close();
    sessions.clear();
    restored = new Machines(engine, fakeVmNetwork);
    await restored.init();
    const restarted = new LiveMigrationReceiver(restored, peers, undefined, query);
    const replayed = await restarted.prepare(input);
    assert.equal(replayed.targetVmId, receipt.targetVmId);
    assert.equal(replayed.sessionId, receipt.sessionId);
    assert.equal(restored.get(replayed.targetVmId).liveMigrationOrigin?.transferId, input.transferId);
    assert.equal(restored.get(replayed.targetVmId).liveMigrationOrigin?.sessionId, replayed.sessionId);
    await assert.rejects(restarted.abort({ requesterId: input.requesterId, transferId: input.transferId,
      targetVmId: replayed.targetVmId, sessionId: randomUUID(), sourceRunning: true }), /会话与目标实例不匹配/);
    await restarted.abort({ requesterId: input.requesterId, transferId: input.transferId,
      targetVmId: replayed.targetVmId, sessionId: replayed.sessionId, sourceRunning: true });
    assert.equal(restored.records.has(receipt.targetVmId), false);
  } finally { await restored?.close(); await machines.close(); }
});
