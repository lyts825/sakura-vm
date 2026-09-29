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
  assert.equal(commands.length, 2);
  for (const command of commands) {
    assert.match(command, /^sh -lc /);
    assert.match(command, /node --check/);
    assert.match(command, /\/workspace\/app\/src\/a\.js/);
  }
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

test('private project code checks run in the isolated namespace', async () => {
  let launched = '';
  const machines = { exec: async (_id: string, command: string) => {
    launched = command;
    return { code: 0, stdout: '', stderr: '' };
  } } as unknown as Machines;
  const projects = { config: async () => ({ directory: '/workspace/app', networkIsolation: 'private' }) } as unknown as Workspaces;
  await new CodeIntelligence(machines, projects).diagnose('vm', 'src/a.js');
  assert.match(launched, /ip netns exec sk-default sh -lc/);
  assert.match(launched, /sakura_ipv4=.*ip -n sk-default/);
});
