import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { desktopAuthoritySource } from '../server/desktop-project-authority.ts';
import { desktopAdapterSource } from '../server/desktop-project-control.ts';

test('both packaged clipboard controllers share exact fixed Desktop authority; source-level full-ticket models pass', async () => {
  for (const path of ['../native/linux-clipboard/controller.py','../native/wayland-clipboard/controller.py']) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.ok(source.includes(desktopAuthoritySource));
  }
  const result = spawnSync('python', [fileURLToPath(new URL('./project-desktop-authority-model.py', import.meta.url)), '-v'],
    { encoding: 'utf8', input: desktopAdapterSource });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stderr, /Ran 16 tests/); assert.match(result.stderr, /\bOK\b/);
});
