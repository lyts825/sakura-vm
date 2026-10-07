/**
 * 模块职责：回归验证模块，围绕 `wayland-mapped-executable` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `wayland-mapped-executable`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: mapped Wayland ELF bootstrap keeps the selected image and closes original Root authority before execution.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: mapped Wayland ELF bootstrap keeps the selected image and closes original Root authority before execution
 * 协作入口 / Collaborators: `spawnSync`, `fileURLToPath`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 0, result.stderr || result.error?.message)`; `assert.match(result.stderr, /Ran 9 tests/)`.
 */
test('mapped Wayland ELF bootstrap keeps the selected image and closes original Root authority before execution', () => {
  const result = spawnSync('python', [fileURLToPath(new URL('./wayland-mapped-executable-model.py', import.meta.url)), '-v'],
    { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stderr, /Ran 9 tests/); assert.match(result.stderr, /\bOK\b/);
});
