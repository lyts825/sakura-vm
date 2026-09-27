import test from 'node:test';
import assert from 'node:assert/strict';
import type { Machines } from '../server/machines.ts';
import { natHairpin } from '../server/nat-hairpin.ts';

test('hairpin verification only uses a current VM forward and checks the guest route', async () => {
  const commands: string[] = [];
  const machines = {
    get: () => ({ forwards: [{ name: 'web', host: 18080, guest: 8080 }] }),
    state: () => 'running',
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stdout: 'sakura-hairpin-connected\n', stderr: '' };
    },
  } as unknown as Machines;
  await assert.rejects(natHairpin(machines, 'guest',
    { mode: 'verify', hostPort: 18081 }, 'run'), /不属于此实例/);
  assert.equal(commands.length, 0);
  const checked = await natHairpin(machines, 'guest', {}, 'check');
  assert.equal(checked.ready, true);
  assert.equal(commands.length, 1);
  const verified = await natHairpin(machines, 'guest', { mode: 'verify' }, 'run');
  assert.equal(verified.ready, true);
  assert.match(commands[1], /10\.0\.2\.2.*18080/);
});

test('hairpin reports a failed guest connection without claiming readiness', async () => {
  const machines = {
    get: () => ({ forwards: [{ host: 18080, guest: 8080 }] }),
    state: () => 'running',
    exec: async () => ({ code: 1, stdout: '', stderr: 'connection refused' }),
  } as unknown as Machines;
  const result = await natHairpin(machines, 'guest', { mode: 'verify' }, 'run');
  assert.equal(result.ready, false);
  assert.match(String(result.reason), /connection refused/);
});
