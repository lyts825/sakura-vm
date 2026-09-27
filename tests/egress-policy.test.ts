import test from 'node:test';
import assert from 'node:assert/strict';
import type { Machines } from '../server/machines.ts';
import { egressPolicy } from '../server/egress-policy.ts';

test('egress policy rejects invalid targets before accessing the guest', async () => {
  let accessed = false;
  const machines = {
    state: () => 'running',
    exec: async () => {
      accessed = true;
      return { code: 0, stdout: '', stderr: '' };
    },
  } as unknown as Machines;
  for (const allowedDestinations of [['999.2.3.4'], ['10.0.0.0/33'], []])
    await assert.rejects(egressPolicy(machines, 'guest',
      { mode: 'apply', allowedDestinations }, 'run'));
  assert.equal(accessed, false);
});

test('egress policy refuses to remove a similarly named foreign firewall chain', async () => {
  const commands: string[] = [];
  const machines = {
    state: () => 'running',
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stderr: '', stdout: command.includes('-S OUTPUT')
        ? '-P OUTPUT ACCEPT\n-A OUTPUT -o eth0 -j SK_EG_DEADBEEF\n'
        : '-N SK_EG_DEADBEEF\n-A SK_EG_DEADBEEF -j DROP\n' };
    },
  } as unknown as Machines;
  await assert.rejects(egressPolicy(machines, 'guest', { mode: 'clear' }, 'run'),
    /同名非 Sakura/);
  assert.ok(commands.every((command) => command.includes('-S')));
});

test('egress policy rolls back both chains if attaching the second family fails', async () => {
  const commands: string[] = [];
  const machines = {
    state: () => 'running',
    locked: async (_key: string, callback: () => Promise<unknown>) => callback(),
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.includes('-I OUTPUT'))
        return { code: 1, stderr: 'IPv6 insert failed', stdout: '' };
      return { code: 0, stderr: '', stdout: command.includes('-S OUTPUT') ? '-P OUTPUT ACCEPT' : '' };
    },
  } as unknown as Machines;
  await assert.rejects(egressPolicy(machines, 'guest',
    { mode: 'apply', allowedDestinations: ['10.0.2.2/32'] }, 'run'), /IPv6 insert failed/);
  assert.ok(commands.some((command) => command.includes('iptables -w -X SK_EG_')));
  assert.ok(commands.some((command) => command.includes('ip6tables -w -X SK_EG_')));
});
