import test from 'node:test';
import assert from 'node:assert/strict';
import type { Machines } from '../server/machines.ts';
import { networkQuota } from '../server/network-quota.ts';

test('bandwidth quota rejects foreign qdisc rules without changing them', async () => {
  const commands: string[] = [];
  const machines = {
    state: () => 'running',
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stdout: 'qdisc netem 8001: root refcnt 2 delay 10ms', stderr: '' };
    },
  } as unknown as Machines;
  await assert.rejects(
    networkQuota(machines, 'guest', { mode: 'apply', egressKbps: 512 }, 'run'),
    /已有其他根队列规则/,
  );
  assert.equal(commands.length, 1);
  assert.ok(commands[0].includes('tc qdisc show'));
});

test('bandwidth quota validates command arguments before guest access', async () => {
  let executed = false;
  const machines = {
    state: () => 'running',
    exec: async () => {
      executed = true;
      return { code: 0, stdout: '', stderr: '' };
    },
  } as unknown as Machines;
  await assert.rejects(networkQuota(machines, 'guest', { mode: 'apply', interface: 'eth0;id' }, 'run'));
  await assert.rejects(networkQuota(machines, 'guest', { mode: 'apply', egressKbps: -1 }, 'run'));
  assert.equal(executed, false);
});
