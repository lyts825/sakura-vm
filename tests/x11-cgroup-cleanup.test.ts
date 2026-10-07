/**
 * 模块职责：回归验证模块，围绕 `x11-cgroup-cleanup` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `x11-cgroup-cleanup`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: X11 controller waits for kernel cgroup cleanup and preserves ownership checks.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: X11 controller waits for kernel cgroup cleanup and preserves ownership checks
 * 协作入口 / Collaborators: `spawnSync`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr)`.
 */
test('X11 controller waits for kernel cgroup cleanup and preserves ownership checks', () => {
  const python = process.env.SAKURA_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(python, ['tests/x11_cgroup_cleanup_test.py'], {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
});
