/**
 * 模块职责：回归验证模块，围绕 `single-app-native` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `single-app-native`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: fixed SingleApp native guards exercise exact runs, application exec, readonly recovery and mapped FD authority.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: fixed SingleApp native guards exercise exact runs, application exec, readonly recovery and mapped FD authority
 * 协作入口 / Collaborators: `spawnSync`, `resolve`, `assert.ifError`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.ifError(result.error)`; `assert.equal(result.status, 0, result.stdout + result.stderr)`.
 */
test('fixed SingleApp native guards exercise exact runs, application exec, readonly recovery and mapped FD authority', () => {
  const python = process.env.SAKURA_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(python, [resolve('tests/single-app-native-model.py'), '-v'], {
    encoding: 'utf8', timeout: 20_000, maxBuffer: 128 * 1024,
  });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 21 tests/); assert.match(result.stderr, /\bOK\b/);
});
