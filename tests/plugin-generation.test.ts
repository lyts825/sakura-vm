/**
 * 模块职责：回归验证模块，围绕 `plugin-generation` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `plugin-generation`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: front-end authority changes cancel plugin requests while core requests remain independent; an old operation admission cannot call a newly activated provider.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PluginGeneration } from '../src/plugin-generation.ts';
import { PluginDirectory } from '../server/plugin-directory.ts';
import { OperationGateway } from '../server/operation-gateway.ts';
import type { IncomingMessage } from 'node:http';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: front-end authority changes cancel plugin requests while core requests remain independent
 * 协作入口 / Collaborators: `directory.begin`, `directory.publish`, `generations.update`, `directory.view`.
 * 检查边界 / Checked boundaries: `assert.ok(signal)`; `assert.equal(generations.capture('/system'), undefined)`.
 */
test('front-end authority changes cancel plugin requests while core requests remain independent', async () => {
  const directory = new PluginDirectory(), a = directory.begin('official', 'metrics', '1', 'artifact');
  directory.publish(a); const generations = new PluginGeneration(); generations.update(directory.view());
  const signal = generations.capture('/vms/example/metrics')!; assert.ok(signal);
  assert.equal(generations.capture('/system'), undefined);
  a.setPermissions(['vm']); assert.equal(generations.update(directory.view()), true); assert.equal(signal.aborted, true);
  const next = generations.capture('/vms/example/metrics')!; assert.equal(next.aborted, false);
  assert.equal(generations.update(directory.view()), false); a.revoke(); await a.scope.dispose();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an old operation admission cannot call a newly activated provider
 * 状态影响 / State effects: `a.phase`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `directory.begin`, `directory.publish`, `gateway.prepare`, `a.revoke`.
 * 检查边界 / Checked boundaries: `assert.throws(() => admission.run(() => calls++), { code: 'PLUGIN_REVOKED' })`; `assert.rejects(admission.check(), { code: 'PLUGIN_REVOKED' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('an old operation admission cannot call a newly activated provider', async () => {
  const directory = new PluginDirectory(), a = directory.begin('official', 'metrics', '1', 'artifact');
  directory.publish(a);
  const gateway = new OperationGateway({ /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回列表形式的受控数据，供调用者遍历或比较。
   * Result: Return controlled data as a list for iteration or comparison.
   * 验证场景 / Scenario: an old operation admission cannot call a newly activated provider
   */
  enabled: () => ['metrics'], /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`directory.get('official', 'metrics')`）。
   * Result: Return the branch-computed value (`directory.get('official', 'metrics')`).
   * 验证场景 / Scenario: an old operation admission cannot call a newly activated provider
   * 协作入口 / Collaborators: `directory.get`.
   */
  instance: () => directory.get('official', 'metrics'),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ check: async () => 'owner' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ check: async () => 'owner' })`) through a Promise.
     * 验证场景 / Scenario: an old operation admission cannot call a newly activated provider
     */
    bind: async () => ({ /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'owner'`），以 Promise 交付。
     * Result: Return the branch-computed value (`'owner'`) through a Promise.
     * 验证场景 / Scenario: an old operation admission cannot call a newly activated provider
     */
    check: async () => 'owner' }) });
  const admission = await gateway.prepare({ method: 'GET' } as IncomingMessage, new URL('http://localhost/api/vms/vm/metrics'));
  a.revoke(); await a.scope.dispose(); a.phase = 'inactive';
  const b = directory.begin('official', 'metrics', '2', 'replacement'); directory.publish(b);
  let calls = 0; assert.throws(() => admission.run(() => calls++), { code: 'PLUGIN_REVOKED' });
  await assert.rejects(admission.check(), { code: 'PLUGIN_REVOKED' }); assert.equal(calls, 0);
  b.revoke(); await b.scope.dispose();
});
