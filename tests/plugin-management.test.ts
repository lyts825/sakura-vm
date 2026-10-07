/**
 * 模块职责：回归验证模块，围绕 `plugin-management` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `plugin-management`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: namespaces and generations retain ownership until cleanup is confirmed; manager reads live unload and cleanup state without an activation snapshot.
 */
import { services as metricsContract } from '../plugins/metrics/services.ts';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PluginDirectory } from '../server/plugin-directory.ts';
import { PluginManager } from '../server/plugin-manager.ts';
import type { Machines } from '../server/machines.ts';
import { loaders } from '../server/plugins/registry.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: namespaces and generations retain ownership until cleanup is confirmed
 * 状态影响 / State effects: `first.phase`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `directory.setDesired`, `directory.begin`, `'a'.repeat`, `'b'.repeat`.
 * 检查边界 / Checked boundaries: `assert.notEqual(first.identity, community.identity)`; `assert.throws(() => directory.begin('official', 'metrics', '2.0.0', 'c'.repeat(64)), { code: 'PLUGIN_CLEANUP_PENDING', })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('namespaces and generations retain ownership until cleanup is confirmed', async () => {
  const directory = new PluginDirectory();
  directory.setDesired('official', ['metrics']);
  const first = directory.begin('official', 'metrics', '1.0.0', 'a'.repeat(64));
  const community = directory.begin('community', 'metrics', '1.0.0', 'b'.repeat(64), ['compute']);
  directory.publish(first);
  directory.publish(community);
  assert.notEqual(first.identity, community.identity);
  first.revoke();
  first.phase = 'cleanup-pending';
  assert.throws(() => directory.begin('official', 'metrics', '2.0.0', 'c'.repeat(64)), {
    code: 'PLUGIN_CLEANUP_PENDING',
  });
  assert.throws(() => first.check(), { code: 'PLUGIN_REVOKED' });
  community.check('compute');
  assert.throws(() => community.check('vm'), { code: 'PLUGIN_PERMISSION_DENIED' });
  await first.scope.dispose();
  first.phase = 'inactive';
  const second = directory.begin('official', 'metrics', '2.0.0', 'c'.repeat(64));
  directory.publish(second);
  assert.notEqual(first.generation, second.generation);
  assert.throws(() => first.check(), { code: 'PLUGIN_REVOKED' });
  assert.equal(directory.view().instances.find((item) => item.identity === first.identity)?.desired, true);
  await second.scope.dispose();
  await community.scope.dispose();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: manager reads live unload and cleanup state without an activation snapshot
 * 状态影响 / State effects: `loaders.metrics`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `writeFile`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(manager.view().active, ['metrics'])`; `assert.rejects(manager.unload('metrics'), AggregateError)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('manager reads live unload and cleanup state without an activation snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-plugin-manager-'));
  const file = join(root, 'plugins.json'),
    original = loaders.metrics;
  let attempt = 0;
  loaders.metrics = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ...(await original()), activate: async (host) => { host.provide(metricsContra…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ...(await original()), activate: async (host) => { host.provide(metricsContra…`) through a Promise.
   * 验证场景 / Scenario: manager reads live unload and cleanup state without an activation snapshot
   * 协作入口 / Collaborators: `original`.
   */
  async () => ({
    ...(await original()),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: host。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: manager reads live unload and cleanup state without an activation snapshot
     * 协作入口 / Collaborators: `host.provide`.
     */
    activate: async (host) => {
      host.provide(metricsContract.metrics, {
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`({})`），以 Promise 交付。
         * Result: Return the branch-computed value (`({})`) through a Promise.
         * 验证场景 / Scenario: manager reads live unload and cleanup state without an activation snapshot
         */
        sample: async () => ({}), /**
         * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
         * English: Read or resolve observable fixture state for business calls or subsequent assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 验证场景 / Scenario: manager reads live unload and cleanup state without an activation snapshot
         */
        forget: () => {},
        /**
         * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
         * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 验证场景 / Scenario: manager reads live unload and cleanup state without an activation snapshot
         * 失败 / Failure: `new Error('cleanup receipt')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         */
        close: async () => {
          if (++attempt === 1) throw new Error('cleanup receipt');
        },
      } as any);
    },
  });
  const manager = new PluginManager(file);
  try {
    await writeFile(file, JSON.stringify({ schemaVersion: 3, plugins: ['metrics'], packs: [] }));
    await manager.init();
    await manager.start(Object.assign(new EventEmitter(), { records: new Map() }) as Machines);
    assert.deepEqual(manager.view().active, ['metrics']);
    await assert.rejects(manager.unload('metrics'), AggregateError);
    assert.deepEqual(manager.view().active, []);
    assert.equal(
      manager.view().runtime?.instances.find((item) => item.identity === 'official:metrics')?.phase,
      'cleanup-pending',
    );
    await manager.unload('metrics');
    assert.equal(
      manager.view().runtime?.instances.find((item) => item.identity === 'official:metrics')?.phase,
      'inactive',
    );
  } finally {
    await manager.close();
    loaders.metrics = original;
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: activation publishes once while live contribution and permission changes advance the directory
 * 协作入口 / Collaborators: `directory.begin`, `'a'.repeat`, `directory.view`, `instance.contribute`.
 * 检查边界 / Checked boundaries: `assert.equal(directory.view().version, activating)`; `assert.equal(directory.view().version, published + 1)`.
 */
test('activation publishes once while live contribution and permission changes advance the directory', async () => {
  const directory = new PluginDirectory();
  const instance = directory.begin('official', 'metrics', '1.0.0', 'a'.repeat(64));
  const activating = directory.view().version;
  instance.contribute('operation', 'sample');
  instance.contribute('event', 'vm:change');
  assert.equal(directory.view().version, activating);
  directory.publish(instance);
  const published = directory.view().version;
  const unregister = instance.contribute('event', 'vm:started');
  assert.equal(directory.view().version, published + 1);
  unregister();
  assert.equal(directory.view().version, published + 2);
  unregister();
  assert.equal(directory.view().version, published + 2);
  instance.setPermissions(['vm']);
  assert.equal(directory.view().version, published + 3);
  await instance.scope.dispose();
});
