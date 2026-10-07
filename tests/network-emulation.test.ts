/**
 * 模块职责：回归验证模块，围绕 `network-emulation` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `network-emulation`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: network emulation previews, applies and clears a verified guest netem rule; network emulation rejects unsafe or inconsistent parameters before guest execution.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Machines } from '../server/machines.ts';
import { networkEmulation } from '../server/network-emulation.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: network emulation previews, applies and clears a verified guest netem rule
 * 协作入口 / Collaborators: `networkEmulation`, `assert.equal`, `assert.ok`, `commands.some`.
 * 检查边界 / Checked boundaries: `assert.equal(preview.ready, true)`; `assert.equal(preview.executed, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('network emulation previews, applies and clears a verified guest netem rule', async () => {
  let current = 'qdisc fq_codel 0: root refcnt 2';
  const commands: string[] = [];
  const machines = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: network emulation previews, applies and clears a verified guest netem rule
     */
    state: () => 'running',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
     * 验证场景 / Scenario: network emulation previews, applies and clears a verified guest netem rule
     * 状态影响 / State effects: `current`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new Error(`Unexpected command: ${command}`)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `commands.push`, `command.includes`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: network emulation rejects unsafe or inconsistent parameters before guest execution
 * 协作入口 / Collaborators: `assert.rejects`, `networkEmulation`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects( networkEmulation( machines, 'guest', { mode: 'apply', interface: 'eth0;id', delayMs: 20, }, 'run', ), )`; `assert.rejects( networkEmulation( machines, 'guest', { mode: 'apply', interface: 'eth0', delayMs: 10, jitterMs: 20, }, 'run', ), )`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('network emulation rejects unsafe or inconsistent parameters before guest execution', async () => {
  const commands: string[] = [];
  const machines = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: network emulation rejects unsafe or inconsistent parameters before guest execution
     */
    state: () => 'running',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
     * 验证场景 / Scenario: network emulation rejects unsafe or inconsistent parameters before guest execution
     * 协作入口 / Collaborators: `commands.push`.
     */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: network emulation reports missing tc without claiming an applied rule
 * 协作入口 / Collaborators: `assert.rejects`, `networkEmulation`.
 * 检查边界 / Checked boundaries: `assert.rejects(networkEmulation(machines, 'guest', {}, 'check'), /缺少 tc/)`.
 */
test('network emulation reports missing tc without claiming an applied rule', async () => {
  const machines = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: network emulation reports missing tc without claiming an applied rule
     */
    state: () => 'running',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ stdout: '', stderr: '', code: 127 })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ stdout: '', stderr: '', code: 127 })`) through a Promise.
     * 验证场景 / Scenario: network emulation reports missing tc without claiming an applied rule
     */
    exec: async () => ({ stdout: '', stderr: '', code: 127 }),
  } as unknown as Machines;
  await assert.rejects(networkEmulation(machines, 'guest', {}, 'check'), /缺少 tc/);
});
