import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('Wayland wire and content rules use real pinned protocol definitions', () => {
  const python = process.env.SAKURA_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(python, [resolve('tests/wayland-proxy.test.py')], {
    encoding: 'utf8', timeout: 20_000, maxBuffer: 128 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 13 tests/);
  assert.match(result.stderr, /OK/);
});
