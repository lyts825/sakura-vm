import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Machines } from '../server/machines.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-memory-reclaim-test-'));
process.env.SAKURA_DATA_DIR = root;
const { MemoryReclaim, parseGuestMemory, reclaimDecision } =
  await import('../server/memory-reclaim.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-memory-reclaim-test-'));
  await rm(root, { recursive: true, force: true });
});

test('memory pressure parser rejects incomplete data and decision has hysteresis', () => {
  assert.deepEqual(parseGuestMemory('MemTotal: 1048576 kB\nMemAvailable: 819200 kB\n'),
    { totalMiB: 1024, availableMiB: 800 });
  assert.throws(() => parseGuestMemory('MemTotal: 1048576 kB\n'), /无效/);
  assert.equal(reclaimDecision(1024, 1024, 512,
    { totalMiB: 1024, availableMiB: 800 }, 2).decision, 'hold');
  assert.deepEqual(reclaimDecision(1024, 1024, 512,
    { totalMiB: 1024, availableMiB: 800 }, 3),
    { targetMiB: 960, decision: 'shrink', reason: '客户机连续三次可用内存超过 55%，回收至多 64 MiB' });
  assert.equal(reclaimDecision(896, 1024, 512,
    { totalMiB: 896, availableMiB: 100 }, 0).targetMiB, 1024);
  assert.equal(reclaimDecision(384, 1024, 512,
    { totalMiB: 384, availableMiB: 250 }, 3).targetMiB, 512);
});

test('persisted policy shrinks only after three samples and restores on guest pressure', async () => {
  const id = randomUUID();
  let current = 1024, time = 100_000;
  const calls: number[] = [];
  let memory = { totalMiB: 1024, availableMiB: 800 };
  const vm = { id, distro: 'alpine', memoryMiB: 1024, hardware: undefined };
  const machines = {
    records: new Map([[id, vm]]),
    get: () => vm,
    view: async () => ({ ...vm, memoryTargetMiB: current }),
    state: () => 'running',
    requireUnlocked: () => {},
    live: new Map([[id, { memoryTargetMiB: current }]]),
    setMemoryTarget: async (_id: string, value: number) => {
      current = value;
      (machines.live.get(id) as { memoryTargetMiB: number }).memoryTargetMiB = value;
      calls.push(value);
      return { ...vm, memoryTargetMiB: value };
    },
  } as unknown as Machines;
  const first = new MemoryReclaim(machines, async () => memory, () => false, () => {}, () => time);
  await first.init();
  await first.action(id, { operation: 'configure', policy: { enabled: true, minMiB: 512 } });
  await first.sample(id);
  await first.sample(id);
  assert.deepEqual(calls, []);
  await first.sample(id);
  assert.deepEqual(calls, [960]);
  await first.close();

  const second = new MemoryReclaim(machines, async () => memory, () => false, () => {}, () => time);
  await second.init();
  assert.equal((await second.view(id)).policy.enabled, true);
  memory = { totalMiB: 960, availableMiB: 100 };
  time += 61_000;
  await second.sample(id);
  assert.deepEqual(calls, [960, 1024]);
  await second.close();
});
