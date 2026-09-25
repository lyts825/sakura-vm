import test from 'node:test';
import assert from 'node:assert/strict';
import { CodeIntelligence } from '../server/code-intelligence.ts';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';

test('code checks accept editor and CLI paths within the selected project', async () => {
  const commands: string[] = [];
  const machines = {
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stdout: '', stderr: '' };
    },
  } as unknown as Machines;
  const projects = { config: async () => ({ directory: '/workspace/app' }) } as unknown as Workspaces;
  const checks = new CodeIntelligence(machines, projects);
  for (const input of ['/workspace/app/src/a.js', 'src/a.js']) {
    const result = await checks.diagnose('vm', input);
    assert.equal(result.path, 'src/a.js');
    assert.equal(result.supported, true);
  }
  assert.deepEqual(commands, [
    "node --check '/workspace/app/src/a.js'",
    "node --check '/workspace/app/src/a.js'",
  ]);
  for (const path of [
    '/workspace/app-other/a.js',
    '/etc/a.js',
    '../a.js',
    '/workspace/app/../a.js',
    '/workspace/app',
  ])
    await assert.rejects(checks.diagnose('vm', path));
  assert.equal(commands.length, 2, 'Out-of-project inputs must not execute a guest command');
});
