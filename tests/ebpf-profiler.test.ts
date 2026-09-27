import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEbpfProfiler, parseKernelProfile, runEbpfProfiler } from '../server/ebpf-profiler.ts';
import type { Machines } from '../server/machines.ts';

const profile = `@[
    filemap_map_pages+181
    __handle_mm_fault+2905
    handle_mm_fault+250
]: 12
@[
    cpuidle_enter_state+164
    do_idle+390
]: 28
`;

test('bpftrace stack counts become a ranked kernel profile', () => {
  const parsed = parseKernelProfile(profile);
  assert.equal(parsed.samples, 40);
  assert.equal(parsed.stackCount, 2);
  assert.deepEqual(parsed.stacks[0].frames, ['cpuidle_enter_state', 'do_idle']);
  assert.deepEqual(parsed.topSymbols[0], { name: 'cpuidle_enter_state', count: 28, percent: 70 });
  assert.throws(() => parseKernelProfile('@[]: 0'), /没有返回内核调用栈/);
});

test('eBPF profiler probes the guest and runs a bounded profile program', async () => {
  const commands: string[] = [];
  const machines = {
    state: () => 'running',
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return command.includes('bpftrace -q')
        ? { stdout: profile, stderr: '', code: 0 }
        : { stdout: 'bpftrace v0.21\n', stderr: '', code: 0 };
    },
  } as unknown as Machines;
  const signal = new AbortController().signal;
  const checked = await checkEbpfProfiler(machines, 'vm', signal);
  assert.equal(checked.ready, true);
  const result = await runEbpfProfiler(machines, 'vm',
    { durationSeconds: 3, frequencyHz: 49 }, signal);
  assert.equal(result.samples, 40);
  assert.match(result.download.content, /cpuidle_enter_state/);
  assert.match(commands[1], /profile:hz:49/);
  assert.match(commands[1], /interval:s:3/);
  await assert.rejects(runEbpfProfiler(machines, 'vm', { durationSeconds: 11 }, signal));
  assert.equal(commands.length, 2);
});
