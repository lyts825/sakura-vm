/**
 * 模块职责：回归验证模块，围绕 `live-migration-fence` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `live-migration-fence`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: migration fence is written only at QEMU switchover and blocks source restart after recovery.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-live-fence-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
after(async () => {
  const [resolved, temporary] = await Promise.all([realpath(root), realpath(tmpdir())]);
  if (dirname(resolved).toLowerCase() !== temporary.toLowerCase() ||
      !basename(resolved).startsWith('sakura-live-fence-'))
    throw new Error('Refusing unexpected test cleanup path');
  await rm(resolved, { recursive: true, force: true });
});

for (const stopMode of ['ordinary', 'completion', 'incident'] as const)
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 状态影响 / State effects: `machines.exec`, `live.incoming`, `live.status`, `restored.get(id).liveMigrationFence`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `machines.init`, `randomUUID`, `new Date().toISOString`, `mkdir`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.suspend(id), { code: 'LIVE_MIGRATION_SOURCE_FENCED' })`; `assert.rejects(machines.memorySnapshot(id, 'fenced'), { code: 'LIVE_MIGRATION_SOURCE_FENCED' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test(`manual run transitions honor a fence and ${stopMode} stop persists native exit for host restart`, async () => {
  const engine = { whpxAvailable: false, runtime: { /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   */
  close: async () => {} },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _tool: string; _args: string[]; options: { signal: AbortSignal }。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    run: async (_tool: string, _args: string[], options: { signal: AbortSignal }) => {
      await new Promise<void>(resolve => options.signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  } as unknown as Engine;
  const machines = new Machines(engine, fakeVmNetwork);
  await machines.init();
  const id = randomUUID(), now = new Date().toISOString();
  await mkdir(vmDir(id));
  await writeFile(join(vmDir(id), 'disk.qcow2'), 'synthetic disk');
  machines.records.set(id, { ...createSchema.parse({ name: `source-${id.slice(0, 8)}` }),
    id, createdAt: now, snapshots: [], liveMigrationOrigin: {
      sourceHostId: randomUUID(), sourceVmId: randomUUID(), transferId: randomUUID(),
      status: 'prepared', createdAt: now, updatedAt: now,
    } });
  let gracefulExecutions = 0;
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 失败 / Failure: `new Error('fenced source must not execute')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { gracefulExecutions++; throw new Error('fenced source must not execute'); };
  try {
    await machines.startIncoming(id);
    const live = machines.live.get(id)!;
    live.incoming = false;
    live.status = 'running';
    delete machines.get(id).liveMigrationOrigin;
    const fence = await machines.fenceForLiveMigration(id, {
      targetHostId: randomUUID(), targetVmId: randomUUID(), transferId: randomUUID(),
      peerId: randomUUID(), sourceHostId: randomUUID(), sessionId: randomUUID(), projectsDigest: 'a'.repeat(64),
    }, async (_port, command) => command === 'query-status' ? { running: false } : { status: 'pre-switchover' });
    await assert.rejects(machines.suspend(id), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
    await assert.rejects(machines.memorySnapshot(id, 'fenced'), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
    await assert.rejects(machines.restoreMemory(id, randomUUID()), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
    live.status = 'paused';
    await assert.rejects(machines.resume(id), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
    if (stopMode === 'ordinary') await machines.stop(id);
    else if (stopMode === 'completion') await machines.stopLiveMigrationSource(id, fence);
    else {
      await machines.setIncidentLockdown(id, true);
      await machines.setIncidentLockdown(id, false);
      await assert.rejects(machines.start(id), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
    }
    assert.equal(gracefulExecutions, 0);
    assert.equal(machines.live.has(id), false);
    assert.equal(machines.get(id).liveMigrationFence?.sourceStopped?.sourceProcessId, fence.sourceProcessId);
    const restored = new Machines(engine, fakeVmNetwork);
    await restored.init();
    try {
      const durable = restored.get(id).liveMigrationFence!;
      assert.equal(restored.canConfirmLiveMigrationCompletion(id, durable), true);
      await assert.rejects(restored.start(id), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
      const noExit = { ...durable, sourceStopped: undefined };
      restored.get(id).liveMigrationFence = noExit;
      assert.equal(restored.canConfirmLiveMigrationCompletion(id, noExit), false);
      await assert.rejects(restored.stopLiveMigrationSource(id, noExit), { code: 'LIVE_MIGRATION_SOURCE_UNCONFIRMED' });
    } finally { await restored.close(); }
  } finally { await machines.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: migration fence is written only at QEMU switchover and blocks source restart after recovery
 * 状态影响 / State effects: `state`, `migration`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `machines.init`, `randomUUID`, `new Date().toISOString`, `machines.records.set`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.fenceForLiveMigration(id, identity, query), /尚未在迁移切换点暂停/)`; `assert.equal(machines.get(id).liveMigrationFence, undefined)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('migration fence is written only at QEMU switchover and blocks source restart after recovery', async () => {
  const engine = { runtime: { /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: migration fence is written only at QEMU switchover and blocks source restart after recovery
   */
  close: async () => {} } } as Engine;
  const machines = new Machines(engine, fakeVmNetwork);
  await machines.init();
  const id = randomUUID();
  const now = new Date().toISOString();
  machines.records.set(id, { ...createSchema.parse({ name: 'source' }),
    id, createdAt: now, snapshots: [] });
  machines.live.set(id, { status: 'running', qmpPort: 7339 } as never);
  const identity = { targetHostId: randomUUID(), targetVmId: randomUUID(),
    transferId: randomUUID() };
  let state = { running: true }, migration = { status: 'active' };
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: _port: number; command: string。
   * 结果：返回分支计算值（`command === 'query-status' ? state : migration`），以 Promise 交付。
   * Result: Return the branch-computed value (`command === 'query-status' ? state : migration`) through a Promise.
   * 验证场景 / Scenario: migration fence is written only at QEMU switchover and blocks source restart after recovery
   */
  const query = async (_port: number, command: string) =>
    command === 'query-status' ? state : migration;
  try {
    await assert.rejects(machines.fenceForLiveMigration(id, identity, query), /尚未在迁移切换点暂停/);
    assert.equal(machines.get(id).liveMigrationFence, undefined);
    state = { running: false };
    migration = { status: 'pre-switchover' };
    const fence = await machines.fenceForLiveMigration(id, identity, query);
    assert.equal(fence.transferId, identity.transferId);
    const saved = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
    assert.equal(saved.find((vm: { id: string }) => vm.id === id).liveMigrationFence.transferId,
      identity.transferId);
    assert.deepEqual(await machines.fenceForLiveMigration(id, identity, query), fence);
    await assert.rejects(machines.fenceForLiveMigration(id, {
      ...identity, transferId: randomUUID(),
    }, query), /其他在线迁移栅栏/);
    await assert.rejects(machines.start(id), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
    machines.live.delete(id);
    await assert.rejects(machines.delete(id), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
    const restored = new Machines(engine, fakeVmNetwork);
    await restored.init();
    try {
      assert.equal(restored.get(id).liveMigrationFence?.transferId, identity.transferId);
      await assert.rejects(restored.start(id), { code: 'LIVE_MIGRATION_SOURCE_FENCED' });
    } finally { await restored.close(); }
  } finally {
    machines.live.delete(id);
    await machines.close();
  }
});
