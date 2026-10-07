/**
 * 模块职责：回归验证模块，围绕 `flamegraph` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `flamegraph`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: perf stacks become a bounded, escaped SVG with proportional frame counts; guest profiler checks perf and samples with bounded validated options.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: perf stacks become a bounded, escaped SVG with proportional frame counts
 * 协作入口 / Collaborators: `renderFlamegraph`, `assert.equal`, `result.topFrames.find`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(result.samples, 2)`; `assert.equal(result.topFrames.find((frame) => frame.name === 'work')?.count, 2)`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: guest profiler checks perf and samples with bounded validated options
 * 协作入口 / Collaborators: `checkFlamegraph`, `assert.equal`, `runFlamegraph`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(checked.ready, true)`; `assert.equal(result.executed, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('guest profiler checks perf and samples with bounded validated options', async () => {
  const commands: string[] = [];
  const machines = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: guest profiler checks perf and samples with bounded validated options
     */
    state: () => 'running',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回分支计算值（`command.includes('perf record') ? { stdout: trace, stderr: '', code: 0 } : { std…`），以 Promise 交付。
     * Result: Return the branch-computed value (`command.includes('perf record') ? { stdout: trace, stderr: '', code: 0 } : { std…`) through a Promise.
     * 验证场景 / Scenario: guest profiler checks perf and samples with bounded validated options
     * 协作入口 / Collaborators: `commands.push`, `command.includes`.
     */
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
