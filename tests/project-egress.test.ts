/**
 * 模块职责：回归验证模块，围绕 `project-egress` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-egress`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: production project UID egress transactions preserve exact owners, boot restoration and retry after lost acknowledgements; private UID admission verifies protected OpenRC and systemd PAM SSH ancestry, including live authority changes.
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
 * 验证场景 / Scenario: production project UID egress transactions preserve exact owners, boot restoration and retry after lost acknowledgements
 * 协作入口 / Collaborators: `fileURLToPath`, `spawnSync`, `assert.equal`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.equal(result.error, undefined)`; `assert.equal(result.signal, null)`.
 */
test('production project UID egress transactions preserve exact owners, boot restoration and retry after lost acknowledgements', async () => {
  const controller = fileURLToPath(new URL('../native/project-identity/controller.py', import.meta.url));
  const model = fileURLToPath(new URL('./project-egress-model.py', import.meta.url));
  const result = spawnSync(process.env.SAKURA_TEST_PYTHON || 'python', ['-I', model, controller],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 65536, windowsHide: true });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.passed, true); assert.equal(proof.kind, 'portable-model-only');
  assert.equal(proof.sourceSha256, createHash('sha256').update(await readFile(controller)).digest('hex'));
  assert.deepEqual(proof.checks, ['private_and_host_rules', 'create_ack_and_record_loss', 'foreign_or_tampered_table',
    'modes_and_exact_delete', 'owner_and_namespace_refusals', 'reboot_restores_intents', 'boot_service_plans', 'rebind_commit_order',
    'boot_install_and_interrupted_upgrade', 'openrc_dependencies_and_operator_settings',
    'boot_symlink_sync_and_pending_recovery', 'bounded_kernel_json']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private UID admission verifies protected OpenRC and systemd PAM SSH ancestry, including live authority changes
 * 协作入口 / Collaborators: `fileURLToPath`, `spawnSync`, `assert.equal`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.equal(result.error, undefined)`; `assert.equal(result.signal, null)`.
 */
test('private UID admission verifies protected OpenRC and systemd PAM SSH ancestry, including live authority changes', async () => {
  const controller = fileURLToPath(new URL('../native/project-identity/controller.py', import.meta.url));
  const model = fileURLToPath(new URL('./project-egress-nnp-model.py', import.meta.url));
  const result = spawnSync(process.env.SAKURA_TEST_PYTHON || 'python', ['-I', model, controller],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 65536, windowsHide: true });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.passed, true); assert.equal(proof.kind, 'portable-model-only');
  assert.equal(proof.sourceSha256, createHash('sha256').update(await readFile(controller)).digest('hex'));
  assert.deepEqual(proof.checks, ['live_services_and_root_management', 'surviving_pre_auth_and_nonroot_sessions',
    'openrc_ssh_descendants_and_listener_identity', 'existing_account_flags_and_capabilities', 'pinned_process_identity', 'openrc_current_launchers',
    'configuration_is_separate_from_live_admission', 'readable_pinned_directories',
    'systemd_pam_sessions_and_bounded_authority', 'systemd_scope_and_listener_refusals',
    'systemd_authority_changes_and_fd_cleanup', 'systemd_pam_identity_changes_and_chain_bounds',
    'initial_snapshot_recovers_unrelated_churn', 'initial_snapshot_rejects_dangerous_new_pids',
    'initial_snapshot_retry_bounds_and_safe_reasons', 'root_ancestor_failures_and_used_nodes_are_not_retried',
    'incremental_census_includes_continuous_births', 'incremental_census_rejects_pid_reuse_and_unstable_reads',
    'pinned_process_birth_and_fd_cleanup']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: systemd admission verifies effective NNP, authoritative exec flags, SSH templates and future service drop-ins
 * 协作入口 / Collaborators: `fileURLToPath`, `spawnSync`, `assert.equal`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.equal(result.error, undefined)`; `assert.equal(result.signal, null)`.
 */
test('systemd admission verifies effective NNP, authoritative exec flags, SSH templates and future service drop-ins', async () => {
  const controller = fileURLToPath(new URL('../native/project-identity/controller.py', import.meta.url));
  const model = fileURLToPath(new URL('./project-egress-systemd-model.py', import.meta.url));
  const result = spawnSync(process.env.SAKURA_TEST_PYTHON || 'python', ['-I', model, controller],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 65536, windowsHide: true });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.passed, true); assert.equal(proof.kind, 'portable-model-only');
  assert.equal(proof.sourceSha256, createHash('sha256').update(await readFile(controller)).digest('hex'));
  assert.deepEqual(proof.checks, ['effective_values_and_template_instance', 'full_privilege_prefix_and_complete_flags',
    'absent_units_are_separate_from_live_protection', 'ssh_templates_and_installed_instances',
    'admission_and_restore_check_real_user_instances', 'ssh_listener_authority_strict_properties']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: production nft compatibility preserves actual table ownership, exact snapshots and three explicit commands in one fixed transaction
 * 协作入口 / Collaborators: `fileURLToPath`, `spawnSync`, `assert.equal`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.equal(result.error, undefined)`; `assert.equal(result.signal, null)`.
 */
test('production nft compatibility preserves actual table ownership, exact snapshots and three explicit commands in one fixed transaction', async () => {
  const controller = fileURLToPath(new URL('../native/project-identity/controller.py', import.meta.url));
  const model = fileURLToPath(new URL('./project-egress-compat-model.py', import.meta.url));
  const transactions = fileURLToPath(new URL('./project-egress-model.py', import.meta.url));
  const result = spawnSync(process.env.SAKURA_TEST_PYTHON || 'python', ['-I', model, controller],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 65536, windowsHide: true });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.passed, true); assert.equal(proof.kind, 'portable-production-model-only');
  assert.equal(proof.sourceSha256, createHash('sha256').update(await readFile(controller)).digest('hex'));
  assert.equal(proof.transactionModelSha256, createHash('sha256').update(await readFile(transactions)).digest('hex'));
  assert.equal(proof.checks.length, 24);
  for (const name of ['test_official_106_json_shape_requires_real_top_comment_and_unchanged_snapshot',
    'test_modern_strict_fast_path_has_no_text_or_second_query', 'test_legacy_text_exact_64k_boundary_and_one_byte_over',
    'test_modern_fast_path_rejects_boolean_float_and_coerced_numeric_fields',
    'test_production_lost_create_ack_recovery_still_requires_real_table_marker',
    'test_transaction_fixture_rejects_arbitrary_text_or_changed_fixed_create_syntax',
    'test_existing_exact_table_create_rejects_without_appending_chain_or_rule',
    'test_error_in_third_fixed_statement_leaves_no_partial_table_or_chain',
    'test_captured_debian_106_unmarked_pending_stays_refused',
    'test_captured_debian_106_marked_table_only_pending_stays_refused'])
    assert.ok(proof.checks.includes(name), name);
});
