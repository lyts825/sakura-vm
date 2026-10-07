/**
 * 模块职责：回归验证模块，围绕 `ha-witness-enrollment` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ha-witness-enrollment`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: a durable witness enrollment blocks ordinary starts even without the HA plugin.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-ha-enrollment-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema } = await import('../server/model.ts');
const engine = { runtime: { /**
 * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
 * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 */
close: async () => {} } } as Engine;

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a durable witness enrollment blocks ordinary starts even without the HA plugin
 * 失败 / Failure: `new Error('unsafe enrollment cleanup')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `randomUUID`, `machines.init`, `machines.records.set`, `createSchema.parse`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.start(id), { code: 'HA_WITNESS_UNAVAILABLE' })`; `assert.rejects(machines.delete(id), { code: 'HA_WITNESS_ENROLLED' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a durable witness enrollment blocks ordinary starts even without the HA plugin', async () => {
  const machines = new Machines(engine, fakeVmNetwork);
  const id = randomUUID(), targetHostId = randomUUID();
  try {
    await machines.init();
    machines.records.set(id, { ...createSchema.parse({ name: 'witness-source' }),
      id, createdAt: new Date().toISOString(), snapshots: [] });
    await machines.enrollHaWitness(id, targetHostId, 3);
    await assert.rejects(machines.start(id), { code: 'HA_WITNESS_UNAVAILABLE' });
    await assert.rejects(machines.delete(id), { code: 'HA_WITNESS_ENROLLED' });
    const reopened = new Machines(engine, fakeVmNetwork);
    await reopened.init();
    try {
      assert.equal(reopened.get(id).haWitnessEnrollment?.targetHostId, targetHostId);
      await assert.rejects(reopened.start(id), { code: 'HA_WITNESS_UNAVAILABLE' });
      let checked = false;
      reopened.beforeHaStart(async () => {
        checked = true;
        throw new Error('witness rejects a promoted source');
      });
      await assert.rejects(reopened.start(id), /witness rejects/);
      assert.equal(checked, true);
      await reopened.releaseHaWitness(id, targetHostId);
      assert.equal(reopened.get(id).haWitnessEnrollment, undefined);
    } finally { await reopened.close(); }
  } finally {
    await machines.close();
    const path = await realpath(root);
    if (!basename(path).startsWith('sakura-ha-enrollment-') ||
        resolve(path) === resolve(tmpdir())) throw new Error('unsafe enrollment cleanup');
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
