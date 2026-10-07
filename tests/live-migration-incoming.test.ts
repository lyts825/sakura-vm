/**
 * 模块职责：回归验证模块，围绕 `live-migration-incoming` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `live-migration-incoming`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: incoming QEMU stays paused until transfer completes and cannot be resumed manually.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-live-incoming-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
after(async () => {
  const [resolved, temporary] = await Promise.all([realpath(root), realpath(tmpdir())]);
  if (dirname(resolved).toLowerCase() !== temporary.toLowerCase() ||
      !basename(resolved).startsWith('sakura-live-incoming-'))
    throw new Error('Refusing unexpected test cleanup path');
  await rm(resolved, { recursive: true, force: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: incoming QEMU stays paused until transfer completes and cannot be resumed manually
 * 协作入口 / Collaborators: `machines.init`, `randomUUID`, `mkdir`, `vmDir`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.start(id), /尚未接收客户机状态/)`; `assert.equal(incoming.status, 'paused')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('incoming QEMU stays paused until transfer completes and cannot be resumed manually', async () => {
  const launches: string[][] = [];
  const engine = { whpxAvailable: false, runtime: { /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: incoming QEMU stays paused until transfer completes and cannot be resumed manually
   */
  close: async () => {} },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _tool: string; args: string[]; options: { signal: AbortSignal }。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: incoming QEMU stays paused until transfer completes and cannot be resumed manually
     * 协作入口 / Collaborators: `launches.push`.
     */
    run: async (_tool: string, args: string[], options: { signal: AbortSignal }) => {
      launches.push(args);
      await new Promise<void>((resolve) => options.signal.addEventListener('abort',
        () => resolve(), { once: true }));
    },
  } as unknown as Engine;
  const machines = new Machines(engine, fakeVmNetwork);
  await machines.init();
  const id = randomUUID();
  await mkdir(vmDir(id));
  await writeFile(join(vmDir(id), 'disk.qcow2'), 'synthetic disk');
  const now = new Date().toISOString();
  machines.records.set(id, { ...createSchema.parse({ name: 'target' }),
    id, createdAt: now, snapshots: [], liveMigrationOrigin: {
      sourceHostId: randomUUID(), sourceVmId: randomUUID(), transferId: randomUUID(),
      status: 'prepared', createdAt: now, updatedAt: now,
    } });
  try {
    await assert.rejects(machines.start(id), /尚未接收客户机状态/);
    const incoming = await machines.startIncoming(id);
    assert.equal(incoming.status, 'paused');
    assert.deepEqual(launches[0].slice(-2), ['-incoming', 'defer']);
    assert.equal(launches[0][launches[0].indexOf('-cpu') + 1], 'Nehalem-v1');
    assert.equal(machines.live.get(id)?.incoming, true);
    assert.equal(machines.live.get(id)?.bootDone, undefined);
    await assert.rejects(machines.startIncoming(id), /必须处于停止状态/);
    await assert.rejects(machines.resume(id), /迁移接收中/);
    await assert.rejects(machines.completeIncoming(id, async () =>
      ({ status: 'inmigrate', running: false })), /尚未完成迁移/);
    assert.equal(machines.state(id), 'paused');
    await machines.completeIncoming(id, async () => ({ status: 'running', running: true }));
    assert.equal(machines.state(id), 'starting');
    assert.equal(machines.live.get(id)?.incoming, false);
    assert.equal(machines.get(id).liveMigrationOrigin?.status, 'received');
    assert.ok(machines.live.get(id)?.bootDone);
    await machines.stop(id, true);
    assert.equal(machines.live.has(id), false);
  } finally {
    if (machines.live.has(id)) await machines.stop(id, true);
    await machines.close();
  }
});
