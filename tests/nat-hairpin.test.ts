/**
 * 模块职责：回归验证模块，围绕 `nat-hairpin` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `nat-hairpin`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: hairpin verification only uses a current VM forward and checks the guest route; hairpin reports a failed guest connection without claiming readiness.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Machines } from '../server/machines.ts';
import { natHairpin } from '../server/nat-hairpin.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: hairpin verification only uses a current VM forward and checks the guest route
 * 协作入口 / Collaborators: `assert.rejects`, `natHairpin`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.rejects(natHairpin(machines, 'guest', { mode: 'verify', hostPort: 18081 }, 'run'), /不属于此实例/)`; `assert.equal(commands.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('hairpin verification only uses a current VM forward and checks the guest route', async () => {
  const commands: string[] = [];
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ forwards: [{ name: 'web', host: 18080, guest: 8080 }] })`）。
     * Result: Return the branch-computed value (`({ forwards: [{ name: 'web', host: 18080, guest: 8080 }] })`).
     * 验证场景 / Scenario: hairpin verification only uses a current VM forward and checks the guest route
     */
    get: () => ({ forwards: [{ name: 'web', host: 18080, guest: 8080 }] }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: hairpin verification only uses a current VM forward and checks the guest route
     */
    state: () => 'running',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: hairpin verification only uses a current VM forward and checks the guest route
     * 协作入口 / Collaborators: `commands.push`.
     */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: hairpin reports a failed guest connection without claiming readiness
 * 协作入口 / Collaborators: `natHairpin`, `assert.equal`, `assert.match`, `String`.
 * 检查边界 / Checked boundaries: `assert.equal(result.ready, false)`; `assert.match(String(result.reason), /connection refused/)`.
 */
test('hairpin reports a failed guest connection without claiming readiness', async () => {
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ forwards: [{ host: 18080, guest: 8080 }] })`）。
     * Result: Return the branch-computed value (`({ forwards: [{ host: 18080, guest: 8080 }] })`).
     * 验证场景 / Scenario: hairpin reports a failed guest connection without claiming readiness
     */
    get: () => ({ forwards: [{ host: 18080, guest: 8080 }] }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: hairpin reports a failed guest connection without claiming readiness
     */
    state: () => 'running',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ code: 1, stdout: '', stderr: 'connection refused' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ code: 1, stdout: '', stderr: 'connection refused' })`) through a Promise.
     * 验证场景 / Scenario: hairpin reports a failed guest connection without claiming readiness
     */
    exec: async () => ({ code: 1, stdout: '', stderr: 'connection refused' }),
  } as unknown as Machines;
  const result = await natHairpin(machines, 'guest', { mode: 'verify' }, 'run');
  assert.equal(result.ready, false);
  assert.match(String(result.reason), /connection refused/);
});
