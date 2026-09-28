import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSecureErase, runSecureErase, secureEraseInput } from '../server/secure-erase.ts';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';

test('logical erase requires a current project file, a separate preview and explicit confirmation', async () => {
  let commands = 0;
  const machines = {
    state: () => 'running', requireUnlocked: () => {},
    exec: async () => { commands++; return { code: 0, stdout: '', stderr: '' }; },
  } as unknown as Machines;
  const unsafe = { config: async () => ({ directory: '/etc' }) } as unknown as Workspaces;
  assert.equal(secureEraseInput.safeParse({ mode: 'preview', path: '../secret' }).success, false);
  assert.equal(secureEraseInput.safeParse({ mode: 'preview', path: 'folder\\secret' }).success, false);
  assert.equal(secureEraseInput.safeParse({ mode: 'erase', path: 'file',
    previewToken: 'a'.repeat(64), confirmed: false }).success, false);
  assert.equal((await checkSecureErase(machines, unsafe, 'vm')).ready, false);
  await assert.rejects(runSecureErase(machines, unsafe, 'vm',
    { mode: 'preview', path: 'passwd' }), /\/workspace/);
  assert.equal(commands, 0);
});

test('guest output cannot claim a successful erase without a matching verified record', async () => {
  const workspaces = { config: async () => ({ directory: '/workspace' }) } as unknown as Workspaces;
  const machines = {
    state: () => 'running', requireUnlocked: () => {},
    exec: async () => ({ code: 0, stdout: JSON.stringify({ path: '/workspace/other',
      bytes: 1, sha256Before: 'a'.repeat(64), sha256After: 'b'.repeat(64),
      passes: 3, removed: true, recordedAt: new Date().toISOString() }), stderr: '' }),
  } as unknown as Machines;
  await assert.rejects(runSecureErase(machines, workspaces, 'vm',
    { mode: 'erase', path: 'target', previewToken: 'a'.repeat(64), confirmed: true }),
  /记录无效/);
});
