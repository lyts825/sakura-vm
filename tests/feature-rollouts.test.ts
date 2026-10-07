/**
 * 模块职责：回归验证模块，围绕 `feature-rollouts` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `feature-rollouts`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: versioned host rollout survives restart and gates selected plugin activation; rollout percentage uses a stable versioned cohort and cannot bypass a disabled flag.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FeatureRollouts } from '../server/feature-rollouts.ts';
import { Features } from '../server/features.ts';
import { PluginManager } from '../server/plugin-manager.ts';
import type { Machines } from '../server/machines.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: versioned host rollout survives restart and gates selected plugin activation
 * 状态影响 / State effects: `blocked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.equal(rollouts.decision('metrics').allowed, true)`; `assert.equal(rollouts.decision('metrics').allowed, false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('versioned host rollout survives restart and gates selected plugin activation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-rollout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'rollouts.json');
  let blocked = false;
  const rollouts = new FeatureRollouts(file, () => blocked);
  await rollouts.init();
  const hostId = rollouts.view().hostId;
  assert.equal(rollouts.decision('metrics').allowed, true);
  const disabled = { pluginId: 'metrics', enabled: false, percentage: 100, cohortVersion: 'v1' };
  await rollouts.configure({ operation: 'save', policy: disabled });
  assert.equal(rollouts.decision('metrics').allowed, false);
  assert.equal(rollouts.decision('metrics', { ...disabled, enabled: true }).allowed, true);
  await assert.rejects(rollouts.configure({ operation: 'save', policy: disabled }), /已变化/);
  blocked = true;
  await assert.rejects(rollouts.configure({ operation: 'remove', pluginId: 'metrics',
    revision: 1 }), /维护中/);
  blocked = false;
  await rollouts.close();

  const restarted = new FeatureRollouts(file);
  await restarted.init();
  assert.equal(restarted.view().hostId, hostId);
  assert.equal(restarted.decision('metrics').allowed, false);
  const managerFile = join(root, 'plugins.json');
  const manager = new PluginManager(managerFile);
  await manager.init();
  await manager.change({ kind: 'plugin', id: 'metrics', enabled: true });
  const installed = new PluginManager(managerFile);
  const selected = await installed.init();
  const machines = Object.assign(new EventEmitter(), {
    records: new Map(), /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({})`）。
     * Result: Return the branch-computed value (`({})`).
     * 验证场景 / Scenario: versioned host rollout survives restart and gates selected plugin activation
     */
    get: () => ({}),
  }) as unknown as Machines;
  const skipped = await installed.start(machines,
    (id) => restarted.decision(id).allowed);
  try {
    assert.equal(skipped.enabled.has('metrics'), false);
    assert.equal(skipped.lifecycle.metrics.phase, 'skipped');
    assert.match(skipped.errors.metrics, /灰度/);
    assert.equal(installed.view().restartRequired, false);
  } finally {
    await skipped.close();
  }
  await restarted.configure({ operation: 'save', revision: 1,
    policy: { ...disabled, enabled: true, percentage: 100 } });
  const active = await Features.create(machines, selected,
    (id) => restarted.decision(id).allowed);
  try {
    assert.equal(active.enabled.has('metrics'), true);
  } finally {
    await active.close();
  }
  await restarted.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: rollout percentage uses a stable versioned cohort and cannot bypass a disabled flag
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.ok('bucket' in preview)`; `assert.equal(service.decision('metrics').bucket, preview.bucket)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('rollout percentage uses a stable versioned cohort and cannot bypass a disabled flag', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-rollout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'rollouts.json');
  const service = new FeatureRollouts(file);
  await service.init();
  const base = { pluginId: 'metrics', enabled: true, percentage: 25, cohortVersion: 'canary-1' };
  const preview = await service.configure({ operation: 'preview', policy: base });
  assert.ok('bucket' in preview);
  await service.configure({ operation: 'save', policy: base });
  assert.equal(service.decision('metrics').bucket, preview.bucket);
  assert.equal(service.decision('metrics').allowed, preview.allowed);
  await service.close();
  const resumed = new FeatureRollouts(file);
  await resumed.init();
  assert.deepEqual(resumed.decision('metrics'), service.decision('metrics'));
  assert.equal(resumed.decision('metrics', { ...base, percentage: 0 }).allowed, false);
  assert.equal(resumed.decision('metrics', { ...base, percentage: 100 }).allowed, true);
  assert.equal(resumed.decision('metrics', { ...base, enabled: false }).allowed, false);
  await resumed.configure({ operation: 'remove', pluginId: 'metrics', revision: 1 });
  assert.equal(resumed.decision('metrics').allowed, true);
  await resumed.close();
});
