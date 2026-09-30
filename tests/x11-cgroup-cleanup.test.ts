import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('X11 controller waits for kernel cgroup cleanup and preserves ownership checks', () => {
  const python = process.env.SAKURA_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(python, ['tests/x11_cgroup_cleanup_test.py'], {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
});
