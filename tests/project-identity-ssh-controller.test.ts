import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

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
