/**
 * 模块职责：回归验证模块，围绕 `project-identity-archive` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-identity-archive`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: production ticket archival preserves ownership, bounds, replay refusal and interrupted-write recovery.
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
 * 验证场景 / Scenario: production ticket archival preserves ownership, bounds, replay refusal and interrupted-write recovery
 * 协作入口 / Collaborators: `fileURLToPath`, `spawnSync`, `assert.equal`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.equal(result.error, undefined)`; `assert.equal(result.signal, null)`.
 */
test('production ticket archival preserves ownership, bounds, replay refusal and interrupted-write recovery', async () => {
  const controller = fileURLToPath(new URL('../native/project-identity/controller.py', import.meta.url));
  const model = fileURLToPath(new URL('./project-identity-archive-model.py', import.meta.url));
  const result = spawnSync(process.env.SAKURA_TEST_PYTHON || 'python', ['-I', model, controller],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 65536, windowsHide: true });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.passed, true);
  assert.equal(proof.kind, 'portable-model-only');
  assert.equal(proof.sourceSha256, createHash('sha256').update(await readFile(controller)).digest('hex'));
  assert.deepEqual(proof.checks, ['successful_archive', 'capacity_and_replay', 'automatic_admission_and_random_collision', 'busy_and_active_preserved',
    'source_replacement_preserved', 'conflicting_archive_preserved', 'lost_destination_sync_recovers',
    'publication_refusals_keep_source', 'raw_syscall_publication_and_abi_refusals', 'readonly_and_bad_archive', 'authority_refusals',
    'later_busy_and_changed_group', 'bounded_archive_and_old_boot', 'bounded_hot_records_and_unknown_files']);
});
