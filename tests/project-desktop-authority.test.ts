/**
 * 模块职责：回归验证模块，围绕 `project-desktop-authority` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-desktop-authority`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: both packaged clipboard controllers share exact fixed Desktop authority; source-level full-ticket models pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { desktopAuthoritySource } from '../server/desktop-project-authority.ts';
import { desktopAdapterSource } from '../server/desktop-project-control.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: both packaged clipboard controllers share exact fixed Desktop authority; source-level full-ticket models pass
 * 协作入口 / Collaborators: `readFile`, `assert.ok`, `source.includes`, `spawnSync`.
 * 检查边界 / Checked boundaries: `assert.ok(source.includes(desktopAuthoritySource))`; `assert.equal(result.status, 0, result.stderr)`.
 */
test('both packaged clipboard controllers share exact fixed Desktop authority; source-level full-ticket models pass', async () => {
  for (const path of ['../native/linux-clipboard/controller.py','../native/wayland-clipboard/controller.py']) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.ok(source.includes(desktopAuthoritySource));
  }
  const result = spawnSync('python', [fileURLToPath(new URL('./project-desktop-authority-model.py', import.meta.url)), '-v'],
    { encoding: 'utf8', input: desktopAdapterSource });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stderr, /Ran 17 tests/); assert.match(result.stderr, /\bOK\b/);
});
