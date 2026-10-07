/**
 * 模块职责：回归验证模块，围绕 `guest-task` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `guest-task`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: binary task input stays outside argv and survives the background launcher stdin redirection; oversized task input is refused before allocating or cleaning any task receipt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { guestTask, guestTaskControlPaths, guestTaskControlRoot } from '../server/guest-task.ts';
import type { Machines } from '../server/machines.ts';
import { randomUUID } from 'node:crypto';
import { OwnedForwardAgent, bindTaskAgent } from '../server/ssh-agent-scope.ts';
import { projectIdentitySchema } from '../server/project-identity.ts';

const result = { stdout: 'worker output', stderr: '', code: 7 };

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: binary task input stays outside argv and survives the background launcher stdin redirection
 * 协作入口 / Collaborators: `Buffer.from`, `guestTask`, `input.fill`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(await operation, result)`; `assert.equal(received[0].toString(), 'private task input\0中文')`.
 */
test('binary task input stays outside argv and survives the background launcher stdin redirection', async () => {
  const runId = '476c4053-3d3d-4ea4-8546-e7026ce90b46', input = Buffer.from('private task input\0中文');
  const commands: string[] = [], received: Buffer[] = [], live = {};
  const machines = {
    live: new Map([['owned', live]]),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string; _timeout: number; signal: AbortSignal。
     * 结果：返回受控对象，公开字段包括 `code`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code`; the actual branch determines its shape.
     * 验证场景 / Scenario: binary task input stays outside argv and survives the background launcher stdin redirection
     * 协作入口 / Collaborators: `assert.equal`, `commands.push`.
     * 检查边界 / Checked boundaries: `assert.equal(signal, undefined, 'cleanup uses its own uncancelled connections')`.
     */
    exec: async (_id: string, command: string, _timeout: number, signal?: AbortSignal) => {
      assert.equal(signal, undefined, 'cleanup uses its own uncancelled connections');
      commands.push(command); return { ...result, code: 0 };
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string; body: Buffer。
     * 结果：返回分支计算值（`result`），以 Promise 交付。
     * Result: Return the branch-computed value (`result`) through a Promise.
     * 验证场景 / Scenario: binary task input stays outside argv and survives the background launcher stdin redirection
     * 协作入口 / Collaborators: `commands.push`, `received.push`, `assert.ok`, `command.startsWith`.
     * 检查边界 / Checked boundaries: `assert.ok(command.startsWith('# SAKURA_GUEST_TASK_RUN\n') && command.includes('exec 7<&0'))`; `assert.ok(command.includes('<&7 &') && command.includes('exec 7<&-'))`.
     */
    execInput: async (_id: string, command: string, body: Buffer) => {
      commands.push(command); received.push(body);
      assert.ok(command.startsWith('# SAKURA_GUEST_TASK_RUN\n') && command.includes('exec 7<&0'));
      assert.ok(command.includes('<&7 &') && command.includes('exec 7<&-'));
      assert.ok(command.includes('sakura-task-' + runId));
      assert.ok(!command.includes('private task input') && !command.includes(input.toString('base64')));
      return result;
    },
  } as unknown as Machines;
  const operation = guestTask(machines, 'owned', '/fixed/payload-launcher', new AbortController().signal,
    undefined, 10000, undefined, undefined, { input, runId });
  input.fill(0);
  assert.deepEqual(await operation, result);
  assert.equal(received[0].toString(), 'private task input\0中文');
  assert.ok(commands.at(-1)?.startsWith('# SAKURA_GUEST_TASK_RETIRE\n'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: oversized task input is refused before allocating or cleaning any task receipt
 * 协作入口 / Collaborators: `assert.rejects`, `guestTask`, `Buffer.alloc`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(guestTask(machines, 'owned', '/fixed/launch', new AbortController().signal, undefined, 10000, undefined, undefined,…`; `assert.equal(calls, 0)`.
 */
test('oversized task input is refused before allocating or cleaning any task receipt', async () => {
  let calls = 0;
  const machines = { live: new Map(), /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 验证场景 / Scenario: oversized task input is refused before allocating or cleaning any task receipt
   */
  exec: async () => { calls++; return result; },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`result`），以 Promise 交付。
     * Result: Return the branch-computed value (`result`) through a Promise.
     * 验证场景 / Scenario: oversized task input is refused before allocating or cleaning any task receipt
     */
    execInput: async () => { calls++; return result; } } as unknown as Machines;
  await assert.rejects(guestTask(machines, 'owned', '/fixed/launch', new AbortController().signal,
    undefined, 10000, undefined, undefined, { input: Buffer.alloc(131073) }), { code: 'GUEST_INPUT_INVALID' });
  assert.equal(calls, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: only an exact minted Agent task preserves the authenticated channel socket; every cleanup stays env-i
 * 协作入口 / Collaborators: `randomUUID`, `'a'.repeat`, `projectIdentitySchema.parse`, `identityId.replaceAll('-', '').slice`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(await guestTask(machines, 'owned', '/fixed/agent-native-launcher', new AbortController().signal, undefined, 10000…`; `assert.ok(commands[0].includes('env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C SAKURA_SSH_AGENT_SOURCE="${SSH_AU…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('only an exact minted Agent task preserves the authenticated channel socket; every cleanup stays env-i', async () => {
  const runId = randomUUID(), identityId = randomUUID(), commands: string[] = [], live = {};
  const agent = new OwnedForwardAgent('unit-unused-agent', new AbortController().signal);
  const machines = { live: new Map([['owned', live]]),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string; _timeout: number; signal: AbortSignal; _log: unknown; source: unknown。
     * 结果：返回受控对象，公开字段包括 `code`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code`; the actual branch determines its shape.
     * 验证场景 / Scenario: only an exact minted Agent task preserves the authenticated channel socket; every cleanup stays env-i
     * 协作入口 / Collaborators: `commands.push`, `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(signal, undefined)`; `assert.equal(source, undefined)`.
     */
    exec: async (_id: string, command: string, _timeout: number, signal?: AbortSignal, _log?: unknown, source?: unknown) => {
      commands.push(command); assert.equal(signal, undefined); assert.equal(source, undefined);
      return { ...result, code: 0 };
    }, /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string; input: Buffer; _timeout: number; _signal: AbortSignal; _log: unknown; source: unknown。
     * 结果：返回分支计算值（`result`），以 Promise 交付。
     * Result: Return the branch-computed value (`result`) through a Promise.
     * 验证场景 / Scenario: only an exact minted Agent task preserves the authenticated channel socket; every cleanup stays env-i
     * 协作入口 / Collaborators: `commands.push`, `assert.equal`, `input.toString`.
     * 检查边界 / Checked boundaries: `assert.equal(source, agent)`; `assert.equal(input.toString(), 'protected frame')`.
     */
    execInput: async (_id: string, command: string, input: Buffer, _timeout: number,
      _signal: AbortSignal, _log: unknown, source: unknown) => {
      commands.push(command); assert.equal(source, agent); assert.equal(input.toString(), 'protected frame');
      return result;
    } } as unknown as Machines;
  const ctx = { resource: { version: 1 as const, kind: 'ssh-agent' as const, leaseId: randomUUID(), brokerSha256: 'a'.repeat(64), timeoutSeconds: 60 },
    identity: projectIdentitySchema.parse({ version: 1, phase: 'active', registryId: randomUUID(), projectId: 'default', identityId,
      revision: 1, uid: 20000, gid: 20000, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
      home: '/var/lib/sakura-project-homes/' + identityId, directory: '/workspace', directoryDevice: '1', directoryInode: '2',
      homeDevice: '1', homeInode: '3', networkIsolation: 'host' }),
    owner: { kind: 'task' as const, runId, bootId: randomUUID() }, sha256: 'b'.repeat(64) };
  const release = bindTaskAgent(machines, 'owned', ctx, agent, live as never);
  try {
    assert.deepEqual(await guestTask(machines, 'owned', '/fixed/agent-native-launcher', new AbortController().signal,
      undefined, 10000, agent, undefined, { input: Buffer.from('protected frame'), runId, forwardedAgent: true }), result);
    assert.ok(commands[0].includes('env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C SAKURA_SSH_AGENT_SOURCE="${SSH_AUTH_SOCK-}"'));
    assert.ok(commands.slice(1).every(command => command.includes('env -i PATH=') && !command.includes('SSH_AUTH_SOCK') && !command.includes('SAKURA_SSH_AGENT_SOURCE')));
    const count = commands.length;
    for (const options of [{ runId: randomUUID(), input: Buffer.from('frame') }, { runId, input: undefined }])
      await assert.rejects(guestTask(machines, 'owned', '/fixed/launch', new AbortController().signal,
        undefined, 10000, agent, undefined, { ...options, forwardedAgent: true }), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    machines.live.set('owned', {} as never);
    await assert.rejects(guestTask(machines, 'owned', '/fixed/launch', new AbortController().signal,
      undefined, 10000, agent, undefined, { runId, input: Buffer.from('frame'), forwardedAgent: true }),
      { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.equal(commands.length, count, 'rejected caller flags cannot allocate or clean an unrelated task');
  } finally { release(); await agent.close(); }
});
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: execute: (command: string, attempt: number) => Promise<typeof result>; worker = result。
 * 结果：返回受控对象，公开字段包括 `live, machines, commands, logs, log`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `live, machines, commands, logs, log`; the actual branch determines its shape.
 */
function fixture(execute?: /**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: command: string; attempt: number。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
(command: string, attempt: number) => Promise<typeof result>, worker = result) {
  const live = {},
    commands: string[] = [],
    logs: string[] = [];
  let controls = 0;
  const machines = {
    live: new Map([['owned', live]]),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string; _timeout: number; signal: AbortSignal。
     * 结果：返回受控对象，公开字段包括 `code`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code`; the actual branch determines its shape.
     * 失败 / Failure: `signal.reason`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `commands.push`, `command.startsWith`, `execute`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    exec: async (_id: string, command: string, _timeout: number, signal?: AbortSignal) => {
      commands.push(command);
      if (command.startsWith('# SAKURA_GUEST_TASK_RUN\n')) {
        if (signal?.aborted) throw signal.reason;
        return worker;
      }
      if (command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')) return { ...result, code: 0 };
      return execute ? execute(command, ++controls) : { ...result, code: 0 };
    },
  } as unknown as Machines;
  return { live, machines, commands, logs, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: value: string。
   * 结果：返回分支计算值（`logs.push(value)`）。
   * Result: Return the branch-computed value (`logs.push(value)`).
   * 协作入口 / Collaborators: `logs.push`.
   */
  log: (value: string) => logs.push(value) };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: identity receipt cleanup failures retain their error code and cannot retire the outer receipt
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `guestTask`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(guestTask(f.machines, 'owned', 'true', new AbortController().signal, undefined, 10000, undefined, async () => { thr…`; `assert.equal(f.commands.some(command => command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')), false)`.
 */
test('identity receipt cleanup failures retain their error code and cannot retire the outer receipt', async () => {
  const f = fixture();
  await assert.rejects(guestTask(f.machines, 'owned', 'true', new AbortController().signal,
    undefined, 10000, undefined, async () => {
      throw new (await import('../server/model.ts')).AppError('identity still unconfirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    }), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(f.commands.some(command => command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cleanup retries its independent connection before the stage callback and receipt retirement
 * 协作入口 / Collaborators: `fixture`, `assert.deepEqual`, `guestTask`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.deepEqual( await guestTask( f.machines, 'owned', 'exit 7', new AbortController().signal, f.log, 10000, undefined, async () …`; `assert.equal(callback, 1)`.
 */
test('cleanup retries its independent connection before the stage callback and receipt retirement', async () => {
  const f = fixture(async (_command, attempt) => {
    if (attempt === 1) throw new Error('first cleanup connection failed');
    return { ...result, code: 0 };
  });
  let callback = 0;
  assert.deepEqual(
    await guestTask(
      f.machines,
      'owned',
      'exit 7',
      new AbortController().signal,
      f.log,
      10000,
      undefined,
      async () => {
        ++callback;
        assert.equal(f.commands.filter((command) => command.includes('sakura_owned_anchor')).length, 2);
        assert.equal(
          f.commands.some((command) => command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')),
          false,
        );
      },
    ),
    result,
  );
  assert.equal(callback, 1);
  assert.ok(f.logs.some((value) => value.includes('第 1 次未确认')));
  assert.equal(f.commands.at(-1)?.startsWith('# SAKURA_GUEST_TASK_RETIRE\n'), true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unconfirmed task scope cleanup keeps the receipt and never runs stage cleanup
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `guestTask`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects( guestTask( f.machines, 'owned', 'exit 7', new AbortController().signal, f.log, 10000, undefined, async () => { ++c…`; `assert.equal(callback, 0)`.
 */
test('unconfirmed task scope cleanup keeps the receipt and never runs stage cleanup', async () => {
  const f = fixture(async () => ({ ...result, stderr: 'owned group still alive', code: 1 }));
  let callback = 0;
  await assert.rejects(
    guestTask(
      f.machines,
      'owned',
      'exit 7',
      new AbortController().signal,
      f.log,
      10000,
      undefined,
      async () => {
        ++callback;
      },
    ),
    (error: any) =>
      error.code === 'GUEST_TASK_CLEANUP_FAILED' && /owned group still alive/.test(error.message),
  );
  assert.equal(callback, 0);
  assert.equal(f.commands.filter((command) => command.includes('sakura_owned_anchor')).length, 3);
  assert.equal(
    f.commands.some((command) => command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')),
    false,
  );
  assert.ok(f.logs.some((value) => value.includes('/run/sakura-guest-tasks/')));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: stage cleanup retries only after the scope is confirmed and preserves worker status
 * 协作入口 / Collaborators: `fixture`, `assert.deepEqual`, `guestTask`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.deepEqual( await guestTask( f.machines, 'owned', 'exit 7', new AbortController().signal, f.log, 10000, undefined, async () …`; `assert.equal(attempts, 3)`.
 */
test('stage cleanup retries only after the scope is confirmed and preserves worker status', async () => {
  const f = fixture();
  let attempts = 0;
  assert.deepEqual(
    await guestTask(
      f.machines,
      'owned',
      'exit 7',
      new AbortController().signal,
      f.log,
      10000,
      undefined,
      async () => {
        assert.equal(f.commands.filter((command) => command.includes('sakura_owned_anchor')).length, 1);
        if (++attempts < 3) throw new Error('stage connection failed');
      },
    ),
    result,
  );
  assert.equal(attempts, 3);
  assert.equal(f.commands.at(-1)?.startsWith('# SAKURA_GUEST_TASK_RETIRE\n'), true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a guest without the required task scope reports refusal instead of a successful command
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `guestTask`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects( guestTask( f.machines, 'owned', 'project command', new AbortController().signal, f.log, 10000, undefined, async ()…`; `assert.equal(callback, true)`.
 */
test('a guest without the required task scope reports refusal instead of a successful command', async () => {
  const refused = {
    stdout: '',
    stderr: 'SAKURA_TASK_SCOPE_UNAVAILABLE: 客户机需要可写 cgroup v2；项目代码未执行',
    code: 126,
  };
  const f = fixture(undefined, refused);
  let callback = false;
  await assert.rejects(
    guestTask(
      f.machines,
      'owned',
      'project command',
      new AbortController().signal,
      f.log,
      10000,
      undefined,
      async () => {
        callback = true;
      },
    ),
    (error: any) => error.code === 'GUEST_TASK_SCOPE_UNAVAILABLE' && /项目代码未执行/.test(error.message),
  );
  assert.equal(callback, true);
  assert.equal(f.commands.at(-1)?.startsWith('# SAKURA_GUEST_TASK_RETIRE\n'), true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lost retirement acknowledgements retry the same receipt after a single authorized stage cleanup
 * 协作入口 / Collaborators: `assert.deepEqual`, `guestTask`, `assert.equal`, `commands.at`.
 * 检查边界 / Checked boundaries: `assert.deepEqual( await guestTask( machines, 'owned', 'exit 7', new AbortController().signal, (value) => logs.push(value), 10000, …`; `assert.equal(callbacks, 1)`.
 */
test('lost retirement acknowledgements retry the same receipt after a single authorized stage cleanup', async () => {
  const commands: string[] = [],
    logs: string[] = [];
  const live = {};
  let retirements = 0,
    callbacks = 0;
  const machines = {
    live: new Map([['owned', live]]),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code`; the actual branch determines its shape.
     * 验证场景 / Scenario: lost retirement acknowledgements retry the same receipt after a single authorized stage cleanup
     * 失败 / Failure: `new Error('retirement reply lost')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `commands.push`, `command.startsWith`.
     */
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.startsWith('# SAKURA_GUEST_TASK_RUN\n')) return result;
      if (command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n') && ++retirements === 1) throw new Error('retirement reply lost');
      return { ...result, code: 0 };
    },
  } as unknown as Machines;
  assert.deepEqual(
    await guestTask(
      machines,
      'owned',
      'exit 7',
      new AbortController().signal,
      (value) => logs.push(value),
      10000,
      undefined,
      async () => {
        ++callbacks;
      },
    ),
    result,
  );
  assert.equal(callbacks, 1);
  assert.equal(retirements, 2);
  assert.equal(commands.at(-1), commands.at(-2));
  assert.ok(logs.some((value) => value.includes('归属核销第 1 次未确认')));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: stage callbacks are refused when the guest boot or stopped scope cannot be reconfirmed
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `guestTask`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects( guestTask( f.machines, 'owned', 'exit 7', new AbortController().signal, f.log, 10000, undefined, async () => { ++c…`; `assert.equal(callbacks, 0)`.
 */
test('stage callbacks are refused when the guest boot or stopped scope cannot be reconfirmed', async () => {
  const f = fixture(async (command) => ({
    ...result,
    code: command.includes('任务停止归属记录已丢失') ? 1 : 0,
    stderr: command.includes('任务停止归属记录已丢失') ? 'guest boot changed before stage cleanup' : '',
  }));
  let callbacks = 0;
  await assert.rejects(
    guestTask(
      f.machines,
      'owned',
      'exit 7',
      new AbortController().signal,
      f.log,
      10000,
      undefined,
      async () => {
        ++callbacks;
      },
    ),
    /guest boot changed/,
  );
  assert.equal(callbacks, 0);
  assert.equal(f.commands.filter((command) => command.includes('任务停止归属记录已丢失')).length, 3);
  assert.equal(
    f.commands.some((command) => command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')),
    false,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: stage cleanup failure and live instance replacement cannot retire uncertain ownership
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `guestTask`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects( guestTask( f.machines, 'owned', 'exit 7', new AbortController().signal, f.log, 10000, undefined, async () => { ++a…`; `assert.equal(attempts, 3)`.
 */
test('stage cleanup failure and live instance replacement cannot retire uncertain ownership', async () => {
  const f = fixture();
  let attempts = 0;
  await assert.rejects(
    guestTask(
      f.machines,
      'owned',
      'exit 7',
      new AbortController().signal,
      f.log,
      10000,
      undefined,
      async () => {
        ++attempts;
        throw new Error('stage connection failed');
      },
    ),
    /后续清理未确认/,
  );
  assert.equal(attempts, 3);
  assert.equal(
    f.commands.some((command) => command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')),
    false,
  );
  const changed = fixture(async () => {
    changed.machines.live.set('owned', {} as any);
    return { ...result, code: 0 };
  });
  let callback = false;
  await assert.rejects(
    guestTask(
      changed.machines,
      'owned',
      'true',
      new AbortController().signal,
      changed.log,
      10000,
      undefined,
      async () => {
        callback = true;
      },
    ),
    /实例已改变/,
  );
  assert.equal(callback, false);
  assert.equal(changed.commands.filter((command) => command.includes('sakura_owned_anchor')).length, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancellation still performs cleanup without passing an already aborted signal to control calls
 * 协作入口 / Collaborators: `fixture`, `controller.abort`, `assert.rejects`, `guestTask`.
 * 检查边界 / Checked boundaries: `assert.rejects( guestTask(f.machines, 'owned', 'true', controller.signal, f.log, 10000, undefined, async () => { callback = true; …`; `assert.equal(callback, true)`.
 */
test('cancellation still performs cleanup without passing an already aborted signal to control calls', async () => {
  const f = fixture(),
    controller = new AbortController();
  const original = new Error('owned cancellation');
  controller.abort(original);
  let callback = false;
  await assert.rejects(
    guestTask(f.machines, 'owned', 'true', controller.signal, f.log, 10000, undefined, async () => {
      callback = true;
    }),
    (error) => error === original,
  );
  assert.equal(callback, true);
  assert.equal(f.commands.at(-1)?.startsWith('# SAKURA_GUEST_TASK_RETIRE\n'), true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private control path and every root phase validate protected parents and the same call nonce
 * 状态影响 / State effects: `nonce`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.deepEqual`, `guestTaskControlPaths`, `guestTask`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(guestTaskControlPaths(runId), { directory: guestTaskControlRoot + '/' + runId, receipt: guestTaskControlRoot + '/…`; `assert.equal(f.commands.length, phases.length)`.
 */
test('private control path and every root phase validate protected parents and the same call nonce', async () => {
  const runId = 'd0ae3dc9-206b-498d-b172-6c9cb2c6e2f1', f = fixture();
  assert.deepEqual(guestTaskControlPaths(runId), {
    directory: guestTaskControlRoot + '/' + runId,
    receipt: guestTaskControlRoot + '/' + runId + '/.sakura-job-' + runId + '.pid',
  });
  await guestTask(f.machines, 'owned', 'true', new AbortController().signal, undefined,
    10000, undefined, async () => {}, { runId });
  const phases = ['RUN', 'CLEANUP', 'CONFIRM_STOPPED', 'RETIRE'];
  assert.equal(f.commands.length, phases.length);
  let nonce: string | undefined;
  for (let index = 0; index < phases.length; ++index) {
    const command = f.commands[index];
    assert.ok(command.startsWith('# SAKURA_GUEST_TASK_' + phases[index] + '\n'));
    assert.ok(command.includes('/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/sh -c'));
    assert.match(command, /sakura_control_directory \/ parent/);
    assert.match(command, /sakura_control_directory \/run parent/);
    assert.ok(command.includes('0 0 600 1'));
    assert.ok(command.includes('run UUID') || command.includes('sakura_control_task'));
    assert.doesNotMatch(command, /chmod|\/tmp\/\.sakura-job-/);
    const tokens = [...new Set(command.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g))]
      .filter(value => value !== runId);
    assert.equal(tokens.length, 1);
    if (nonce) assert.equal(tokens[0], nonce);
    else nonce = tokens[0];
  }
  const again = fixture();
  await guestTask(again.machines, 'owned', 'true', new AbortController().signal, undefined,
    10000, undefined, undefined, { runId });
  assert.ok(!again.commands[0].includes(nonce!));
  assert.ok(f.commands.at(-1)?.includes('任务域未停止，拒绝核销控制记录'));
  assert.ok(f.commands.at(-1)?.includes('授权记录缺失且控制目录非空'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a refused private control directory cannot invoke cleanup callbacks or report worker success
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `guestTask`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(guestTask(f.machines, 'owned', 'true', new AbortController().signal, f.log, 10000, undefined, async () => { callbac…`; `assert.equal(callback, 0)`.
 */
test('a refused private control directory cannot invoke cleanup callbacks or report worker success', async () => {
  const f = fixture(async () => ({ ...result, code: 125, stderr: 'SAKURA_TASK_CONTROL_REFUSED: 控制目录必须为 root0700' }));
  let callback = 0;
  await assert.rejects(guestTask(f.machines, 'owned', 'true', new AbortController().signal,
    f.log, 10000, undefined, async () => { callback++; }), (error: any) =>
      error.code === 'GUEST_TASK_CLEANUP_FAILED' && error.message.includes('root0700'));
  assert.equal(callback, 0);
  assert.equal(f.commands.some(value => value.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')), false);
  assert.ok(f.commands.slice(1).every(value => value.includes('sakura_control_task')));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private receipt retirement failures cannot downgrade unconfirmed control ownership to success
 * 协作入口 / Collaborators: `assert.rejects`, `guestTask`, `assert.equal`, `commands.filter`.
 * 检查边界 / Checked boundaries: `assert.rejects(guestTask(machines, 'owned', 'exit 7', new AbortController().signal), { code: 'GUEST_TASK_CLEANUP_FAILED', })`; `assert.equal(commands.filter(value => value.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')).length, 3)`.
 */
test('private receipt retirement failures cannot downgrade unconfirmed control ownership to success', async () => {
  const commands: string[] = [], live = {};
  const machines = { live: new Map([['owned', live]]), /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; command: string。
   * 结果：返回分支计算值（`command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n') ? { code: 125, stdout: '', st…`），以 Promise 交付。
   * Result: Return the branch-computed value (`command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n') ? { code: 125, stdout: '', st…`) through a Promise.
   * 验证场景 / Scenario: private receipt retirement failures cannot downgrade unconfirmed control ownership to success
   * 协作入口 / Collaborators: `commands.push`, `command.startsWith`.
   */
  exec: async (_id: string, command: string) => {
    commands.push(command);
    return command.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')
      ? { code: 125, stdout: '', stderr: 'SAKURA_TASK_CONTROL_REFUSED: 任务控制授权或启动身份不符' }
      : { ...result, code: command.startsWith('# SAKURA_GUEST_TASK_RUN\n') ? 7 : 0 };
  } } as unknown as Machines;
  await assert.rejects(guestTask(machines, 'owned', 'exit 7', new AbortController().signal), {
    code: 'GUEST_TASK_CLEANUP_FAILED',
  });
  assert.equal(commands.filter(value => value.startsWith('# SAKURA_GUEST_TASK_RETIRE\n')).length, 3);
});
