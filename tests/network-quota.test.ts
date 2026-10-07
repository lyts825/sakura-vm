/**
 * 模块职责：回归验证模块，围绕 `network-quota` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `network-quota`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: bandwidth quota rejects foreign qdisc rules without changing them; bandwidth quota validates command arguments before guest access.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Machines } from '../server/machines.ts';
import { networkQuota } from '../server/network-quota.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: bandwidth quota rejects foreign qdisc rules without changing them
 * 协作入口 / Collaborators: `assert.rejects`, `networkQuota`, `assert.ok`, `commands.some`.
 * 检查边界 / Checked boundaries: `assert.rejects( networkQuota(machines, 'guest', { mode: 'apply', egressKbps: 512 }, 'run'), /已有其他根队列规则/, )`; `assert.ok(commands.some((command) => command.includes('tc qdisc show')))`.
 */
test('bandwidth quota rejects foreign qdisc rules without changing them', async () => {
  const commands: string[] = [];
  const machines = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: bandwidth quota rejects foreign qdisc rules without changing them
     */
    state: () => 'running',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: bandwidth quota rejects foreign qdisc rules without changing them
     * 协作入口 / Collaborators: `commands.push`.
     */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: bandwidth quota validates command arguments before guest access
 * 协作入口 / Collaborators: `assert.rejects`, `networkQuota`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(networkQuota(machines, 'guest', { mode: 'apply', interface: 'eth0;id' }, 'run'))`; `assert.rejects(networkQuota(machines, 'guest', { mode: 'apply', egressKbps: -1 }, 'run'))`.
 */
test('bandwidth quota validates command arguments before guest access', async () => {
  let executed = false;
  const machines = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: bandwidth quota validates command arguments before guest access
     */
    state: () => 'running',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: bandwidth quota validates command arguments before guest access
     * 状态影响 / State effects: `executed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    exec: async () => {
      executed = true;
      return { code: 0, stdout: '', stderr: '' };
    },
  } as unknown as Machines;
  await assert.rejects(networkQuota(machines, 'guest', { mode: 'apply', interface: 'eth0;id' }, 'run'));
  await assert.rejects(networkQuota(machines, 'guest', { mode: 'apply', egressKbps: -1 }, 'run'));
  assert.equal(executed, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: connection quota rolls back both firewall chains before changing bandwidth if insertion fails
 * 协作入口 / Collaborators: `assert.rejects`, `networkQuota`, `assert.ok`, `commands.some`.
 * 检查边界 / Checked boundaries: `assert.rejects(networkQuota(machines, 'guest', { mode: 'apply', maxTcpConnections: 3, newTcpConnectionsPerSecond: 2 }, 'run'), /IP…`; `assert.ok(commands.some((command) => command.includes('iptables -w -X SK_NQ_')))`.
 */
test('connection quota rolls back both firewall chains before changing bandwidth if insertion fails', async () => {
  const commands: string[] = [];
  const machines = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: connection quota rolls back both firewall chains before changing bandwidth if insertion fails
     */
    state: () => 'running',
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _key: string; callback: () => Promise<unknown>。
     * 结果：返回分支计算值（`callback()`），以 Promise 交付。
     * Result: Return the branch-computed value (`callback()`) through a Promise.
     * 验证场景 / Scenario: connection quota rolls back both firewall chains before changing bandwidth if insertion fails
     * 协作入口 / Collaborators: `callback`.
     */
    locked: async (_key: string, callback: /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => callback(),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: connection quota rolls back both firewall chains before changing bandwidth if insertion fails
     * 协作入口 / Collaborators: `commands.push`, `command.includes`.
     */
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
