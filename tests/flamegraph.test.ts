import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFlamegraph, renderFlamegraph, runFlamegraph } from '../server/flamegraph.ts';
import type { Machines } from '../server/machines.ts';

const trace = `web<svc> 123 [001] 1.000: cycles:
  abc work+0x1 (/usr/bin/web)
  def main+0x2 (/usr/bin/web)

web<svc> 123 [001] 1.020: cycles:
  abc work+0x1 (/usr/bin/web)
  def main+0x2 (/usr/bin/web)

`;

test('perf stacks become a bounded, escaped SVG with proportional frame counts', () => {
  const result = renderFlamegraph(trace);
  assert.equal(result.samples, 2);
  assert.equal(result.topFrames.find((frame) => frame.name === 'work')?.count, 2);
  assert.equal(result.topFrames.find((frame) => frame.name === 'main')?.count, 2);
  assert.match(result.svg, /web&lt;svc&gt;/);
  assert.doesNotMatch(result.svg, /web<svc>/);
  assert.match(result.svg, /100\.0%/);
  assert.throws(() => renderFlamegraph('no stacks'), /没有返回调用栈/);
});

test('guest profiler checks perf and samples with bounded validated options', async () => {
  const commands: string[] = [];
  const machines = {
    state: () => 'running',
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return command.includes('perf record')
        ? { stdout: trace, stderr: '', code: 0 }
        : { stdout: 'perf version 6.0\n', stderr: '', code: 0 };
    },
  } as unknown as Machines;
  const signal = new AbortController().signal;
  const checked = await checkFlamegraph(machines, 'vm', signal);
  assert.equal(checked.ready, true);
  const result = await runFlamegraph(machines, 'vm', { durationSeconds: 2, frequencyHz: 50 }, signal);
  assert.equal(result.executed, true);
  assert.equal(result.download.mime, 'image/svg+xml');
  assert.equal(result.samples, 2);
  assert.match(commands[1], /perf record -q -F 50 -g -a/);
  assert.match(commands[1], /sleep 2/);
  await assert.rejects(runFlamegraph(machines, 'vm', { durationSeconds: 100, frequencyHz: 50 }, signal));
  assert.equal(commands.length, 2);
});
