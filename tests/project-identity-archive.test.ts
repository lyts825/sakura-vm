import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

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
