import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('fixed SingleApp native guards exercise exact runs, application exec, readonly recovery and mapped FD authority', () => {
  const python = process.env.SAKURA_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(python, [resolve('tests/single-app-native-model.py'), '-v'], {
    encoding: 'utf8', timeout: 20_000, maxBuffer: 128 * 1024,
  });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 21 tests/); assert.match(result.stderr, /\bOK\b/);
});
