/**
 * 模块职责：回归验证模块，围绕 `ebpf-profiler` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ebpf-profiler`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: bpftrace stack counts become a ranked kernel profile; eBPF profiler probes the guest and runs a bounded profile program.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: bpftrace stack counts become a ranked kernel profile
 * 协作入口 / Collaborators: `parseKernelProfile`, `assert.equal`, `assert.deepEqual`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.equal(parsed.samples, 40)`; `assert.equal(parsed.stackCount, 2)`.
 */
test('bpftrace stack counts become a ranked kernel profile', () => {
  const parsed = parseKernelProfile(profile);
  assert.equal(parsed.samples, 40);
  assert.equal(parsed.stackCount, 2);
  assert.deepEqual(parsed.stacks[0].frames, ['cpuidle_enter_state', 'do_idle']);
  assert.deepEqual(parsed.topSymbols[0], { name: 'cpuidle_enter_state', count: 28, percent: 70 });
  assert.throws(() => parseKernelProfile('@[]: 0'), /没有返回内核调用栈/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: eBPF profiler probes the guest and runs a bounded profile program
 * 协作入口 / Collaborators: `checkEbpfProfiler`, `assert.equal`, `runEbpfProfiler`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(checked.ready, true)`; `assert.equal(result.samples, 40)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('eBPF profiler probes the guest and runs a bounded profile program', async () => {
  const commands: string[] = [];
  const machines = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: eBPF profiler probes the guest and runs a bounded profile program
     */
    state: () => 'running',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回分支计算值（`command.includes('bpftrace -q') ? { stdout: profile, stderr: '', code: 0 } : { s…`），以 Promise 交付。
     * Result: Return the branch-computed value (`command.includes('bpftrace -q') ? { stdout: profile, stderr: '', code: 0 } : { s…`) through a Promise.
     * 验证场景 / Scenario: eBPF profiler probes the guest and runs a bounded profile program
     * 协作入口 / Collaborators: `commands.push`, `command.includes`.
     */
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
