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
  assert.ok(commands.some((command) => command.includes('tc qdisc show')));
  assert.ok(commands.every((command) => command.includes('tc qdisc show') || command.includes('-S OUTPUT')));
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

test('connection quota rolls back both firewall chains before changing bandwidth if insertion fails', async () => {
  const commands: string[] = [];
  const machines = {
    state: () => 'running',
    locked: async (_key: string, callback: () => Promise<unknown>) => callback(),
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.includes('-I OUTPUT'))
        return { code: 1, stdout: '', stderr: 'IPv6 insert failed' };
      if (command.includes('tc qdisc show'))
        return { code: 0, stdout: 'qdisc fq_codel 0: root refcnt 2', stderr: '' };
      return { code: 0, stdout: command.includes('-S OUTPUT') ? '-P OUTPUT ACCEPT' : '', stderr: '' };
    },
  } as unknown as Machines;
  await assert.rejects(networkQuota(machines, 'guest',
    { mode: 'apply', maxTcpConnections: 3, newTcpConnectionsPerSecond: 2 }, 'run'),
    /IPv6 insert failed/);
  assert.ok(commands.some((command) => command.includes('iptables -w -X SK_NQ_')));
  assert.ok(commands.some((command) => command.includes('ip6tables -w -X SK_NQ_')));
  assert.ok(!commands.some((command) => command.includes('tc qdisc replace')));
});
