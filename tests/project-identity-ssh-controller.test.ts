/**
 * 模块职责：回归验证模块，围绕 `project-identity-ssh-controller` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-identity-ssh-controller`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: portable SSH controller model preserves descriptor, daemon, snapshot and cleanup authority.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: portable SSH controller model preserves descriptor, daemon, snapshot and cleanup authority
 * 协作入口 / Collaborators: `fileURLToPath`, `spawnSync`, `assert.equal`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.equal(result.error, undefined)`; `assert.equal(result.signal, null)`.
 */
test('portable SSH controller model preserves descriptor, daemon, snapshot and cleanup authority', async () => {
  const controller = fileURLToPath(new URL('../native/project-identity/controller.py', import.meta.url));
  const model = fileURLToPath(new URL('./project-identity-ssh-controller-model.py', import.meta.url));
  const result = spawnSync(process.env.SAKURA_TEST_PYTHON || 'python', ['-I', model, controller], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 65536,
    windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.passed, true);
  assert.equal(proof.kind, 'portable-model-only');
  assert.equal(
    proof.sourceSha256,
    createHash('sha256')
      .update(await readFile(controller))
      .digest('hex'),
  );
  assert.deepEqual(proof.checks, [
    'snapshot_and_environment_bounds',
    'command_frame_and_identity_environment',
    'service_cgroups_and_daemon_arguments',
    'daemon_process_and_protected_atomic_paths',
    'receipts_and_interrupted_prepare',
    'snapshot_stdin_deadline_and_eof',
    'session_descriptor_order_and_stdout',
    'session_network_descriptors_are_rejected',
    'readonly_probe_and_stop_authority',
    'partial_receipt_cleanup_recovery',
  ]);
});
