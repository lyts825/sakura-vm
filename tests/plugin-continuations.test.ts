/**
 * 模块职责：回归验证模块，围绕 `plugin-continuations` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `plugin-continuations`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: native completion callbacks preserve their admitted identity without acquiring cleanup or fresh business authority.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { PluginDirectory } from '../server/plugin-directory.ts';
import { pluginAuthority, pluginCleanup, withPluginCleanup } from '../server/plugin-authority.ts';
import { captureOperationCheck } from '../server/operation-context.ts';
import { resourceContext, withResourceContext } from '../server/host-runtime/context.ts';
import { vmAccess } from '../server/vm-access.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: native completion callbacks preserve their admitted identity without acquiring cleanup or fresh business authority
 * 协作入口 / Collaborators: `directory.begin`, `'a'.repeat`, `'b'.repeat`, `directory.publish`.
 * 检查边界 / Checked boundaries: `assert.equal(completed, true)`; `assert.equal(commands, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('native completion callbacks preserve their admitted identity without acquiring cleanup or fresh business authority', async () => {
  const directory = new PluginDirectory();
  const instance = directory.begin('official', 'continuation', '1', 'a'.repeat(64));
  const other = directory.begin('system', 'unrelated-cleanup', '1', 'b'.repeat(64));
  directory.publish(instance);
  directory.publish(other);
  const vmId = '00000000-0000-4000-8000-000000000001';
  const native = new EventEmitter();
  let commands = 0;
  const machine = {
    records: new Map(),
    live: new Map([[vmId, {}]]),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`native`），以 Promise 交付。
     * Result: Return the branch-computed value (`native`) through a Promise.
     * 验证场景 / Scenario: native completion callbacks preserve their admitted identity without acquiring cleanup or fresh business authority
     */
    connect: async () => native,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: native completion callbacks preserve their admitted identity without acquiring cleanup or fresh business authority
     */
    exec: async () => {
      commands++;
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  const vm = vmAccess(machine as never, instance.scope, instance);
  const client = await withResourceContext(
    { actorId: 'original-account', projectId: 'original-project' },
    () => vm.connect(vmId),
  );
  let checked!: Promise<void>,
    completed = false;
  client.once('close', function (this: unknown) {
    completed = true;
    assert.equal(this, client);
    assert.equal(pluginAuthority(), instance);
    assert.equal(pluginCleanup(), undefined);
    assert.equal(resourceContext()?.actorId, 'original-account');
    assert.equal(resourceContext()?.projectId, 'original-project');
    assert.equal(resourceContext()?.vmId, vmId);
    assert.equal(resourceContext()?.pluginGeneration, instance.generation);
    assert.throws(() => vm.exec(vmId, 'new-operation'), { name: 'AbortError' });
    checked = assert.rejects(captureOperationCheck()(), { code: 'PLUGIN_REVOKED' });
  });
  instance.revoke();
  withPluginCleanup(other, () => native.emit('close'));
  assert.equal(completed, true);
  await checked;
  assert.equal(commands, 0);
  await instance.scope.dispose();
  await other.scope.dispose();
});
