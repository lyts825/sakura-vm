import test from 'node:test';
import assert from 'node:assert/strict';
import type { Machines } from '../server/machines.ts';
import { networkEmulation } from '../server/network-emulation.ts';

test('network emulation previews, applies and clears a verified guest netem rule', async () => {
  let current = 'qdisc fq_codel 0: root refcnt 2';
  const commands: string[] = [];
  const machines = {
    state: () => 'running',
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.includes('tc qdisc show')) return { stdout: current, stderr: '', code: 0 };
      if (command.includes('tc qdisc replace')) {
        current = 'qdisc netem 8001: root refcnt 2 limit 1000 delay 20ms loss 2%';
        return { stdout: '', stderr: '', code: 0 };
      }
      if (command.includes('tc qdisc del')) {
        current = 'qdisc fq_codel 0: root refcnt 2';
        return { stdout: '', stderr: '', code: 0 };
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  } as unknown as Machines;

  const options = { mode: 'apply', interface: 'eth0', delayMs: 20, jitterMs: 5, lossPercent: 2 };
  const preview = await networkEmulation(machines, 'guest', options, 'check');
  assert.equal(preview.ready, true);
  assert.equal(preview.executed, false);
  assert.equal(commands.length, 1);
  const applied = await networkEmulation(machines, 'guest', options, 'run');
  assert.equal(applied.executed, true);
  assert.equal(applied.netemActive, true);
  assert.ok(
    commands.some((command) => command === 'tc qdisc replace dev eth0 root netem delay 20ms 5ms loss 2%'),
  );
  const cleared = await networkEmulation(
    machines,
    'guest',
    {
      mode: 'clear',
      interface: 'eth0',
      delayMs: 0,
      jitterMs: 0,
      lossPercent: 0,
    },
    'run',
  );
  assert.equal(cleared.executed, true);
  assert.equal(cleared.netemActive, false);
  assert.ok(commands.includes('tc qdisc del dev eth0 root'));
});

test('network emulation rejects unsafe or inconsistent parameters before guest execution', async () => {
  const commands: string[] = [];
  const machines = {
    state: () => 'running',
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { stdout: '', stderr: '', code: 0 };
    },
  } as unknown as Machines;
  await assert.rejects(
    networkEmulation(
      machines,
      'guest',
      {
        mode: 'apply',
        interface: 'eth0;id',
        delayMs: 20,
      },
      'run',
    ),
  );
  await assert.rejects(
    networkEmulation(
      machines,
      'guest',
      {
        mode: 'apply',
        interface: 'eth0',
        delayMs: 10,
        jitterMs: 20,
      },
      'run',
    ),
  );
  await assert.rejects(
    networkEmulation(
      machines,
      'guest',
      {
        mode: 'apply',
        interface: 'eth0',
        delayMs: 0,
        lossPercent: 0,
      },
      'run',
    ),
  );
  assert.deepEqual(commands, []);
});

test('network emulation reports missing tc without claiming an applied rule', async () => {
  const machines = {
    state: () => 'running',
    exec: async () => ({ stdout: '', stderr: '', code: 127 }),
  } as unknown as Machines;
  await assert.rejects(networkEmulation(machines, 'guest', {}, 'check'), /缺少 tc/);
});
