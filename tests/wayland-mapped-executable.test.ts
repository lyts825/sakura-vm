import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('mapped Wayland ELF bootstrap keeps the selected image and closes original Root authority before execution', () => {
  const result = spawnSync('python', [fileURLToPath(new URL('./wayland-mapped-executable-model.py', import.meta.url)), '-v'],
    { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stderr, /Ran 9 tests/); assert.match(result.stderr, /\bOK\b/);
});
