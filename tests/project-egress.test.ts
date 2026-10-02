import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

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
    'boot_install_and_interrupted_upgrade', 'openrc_dependencies_and_operator_settings', 'bounded_kernel_json']);
});
