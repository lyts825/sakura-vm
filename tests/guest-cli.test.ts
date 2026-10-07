/**
 * 模块职责：回归验证模块，围绕 `guest-cli` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `guest-cli`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: CLI scopes commands and shells without interpreting guest arguments as controller options.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error CLI JavaScript modules intentionally have no declaration file.
import { guestArguments, guestExecution } from '../scripts/guest-cli.mjs';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: CLI scopes commands and shells without interpreting guest arguments as controller options
 * 协作入口 / Collaborators: `guestArguments`, `assert.deepEqual`, `guestExecution`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(guestExecution('vm', options), { path: '/vms/vm/exec?project=0123456789abcdef', body: { command: "'printf' '%s' '…`; `assert.deepEqual(guestExecution('vm', guestArguments('exec', ['--instance', '--', 'uname'])), { path: '/vms/vm/exec', body: { comm…`.
 */
test('CLI scopes commands and shells without interpreting guest arguments as controller options', () => {
  const options = guestArguments('exec', ['--project', '0123456789abcdef', '--timeout', '7', '--',
    'printf', '%s', "a'b $(host)\n--instance"]);
  assert.deepEqual(guestExecution('vm', options), {
    path: '/vms/vm/exec?project=0123456789abcdef',
    body: { command: "'printf' '%s' 'a'\\''b $(host)\n--instance'", timeoutSeconds: 7 },
  });
  assert.deepEqual(guestExecution('vm', guestArguments('exec', ['--instance', '--', 'uname'])), {
    path: '/vms/vm/exec', body: { command: "'uname'", scope: 'instance' },
  });
  assert.deepEqual(guestExecution('vm', guestArguments('exec', ['printf', '--project', 'literal'])), {
    path: '/vms/vm/exec', body: { command: "'printf' '--project' 'literal'" },
  });
  assert.equal(guestArguments('shell', ['--project', 'default']).project, 'default');
  for (const args of [['--instance', '--project', 'default', '--', 'true'], ['--project', '../guest', 'true'],
    ['--timeout', '0', 'true'], ['--timeout', '3601', 'true'], ['--timeout', '1.5', 'true'],
    ['--project', 'default', '--project', 'default', 'true'], ['--instance', '--instance', 'true'], []])
    assert.throws(() => guestArguments('exec', args));
  assert.throws(() => guestArguments('shell', ['--instance']));
  assert.throws(() => guestArguments('shell', ['--project', 'default', 'unexpected']));
});
