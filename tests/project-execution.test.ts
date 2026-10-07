/**
 * 模块职责：回归验证模块，围绕 `project-execution` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-execution`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: default execution passes saved active project command and environment to the identity runner and redacts secrets; abort and service shutdown clean the guest process group and release execution locks.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Machines as MachineType } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';
import type { Secrets } from '../server/secrets.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-project-execution-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { ProjectTerminals } = await import('../server/project-terminals.ts');
const { ProjectExecution, withProjectCommand } = await import('../server/project-execution.ts');
const { vmDir } = await import('../server/model.ts');
const { guestTask } = await import('../server/guest-task.ts');
after(() => rm(root, { recursive: true, force: true }));

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `id, machines, live, commands, payloads, workspaces, terminals, service, executing`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, machines, live, commands, payloads, workspaces, terminals, service, executing`; the actual branch determines its shape.
 * 状态影响 / State effects: `locks.live`, `locks.records`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `Object.assign`, `locks.locked.bind`, `mkdir`.
 */
async function fixture() {
  const id = randomUUID(), locks = new Machines({} as Engine, fakeVmNetwork), commands: string[] = [];
  const live = { status: 'running' };
  let wait = false;
  let started!: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const executing = new Promise<void>((done) => { started = done; });
  const machines = Object.assign(new EventEmitter(), {
    records: new Map([[id, { template: 'none' }]]), live: new Map([[id, live]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ template: 'none', distro: 'alpine' })`）。
     * Result: Return the branch-computed value (`({ template: 'none', distro: 'alpine' })`).
     */
    get: () => ({ template: 'none', distro: 'alpine' }), /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`live.status`）。
     * Result: Return the branch-computed value (`live.status`).
     */
    state: () => live.status,
    locked: locks.locked.bind(locks),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string; _timeout: number; signal: AbortSignal。
     * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `commands.push`, `command.includes`, `started`.
     */
    exec: async (_id: string, command: string, _timeout: number, signal?: AbortSignal) => {
      commands.push(command);
      if (command.includes('project-directory-migrations'))
        return { stdout: 'null\n', stderr: '', code: 0 };
      if (command.includes('SAKURA_PROJECT_MAIN_LEGACY_STATUS'))
        return { stdout: 'absent\n', stderr: '', code: 0 };
      if (!command.includes('setsid sh -c')) return { stdout: '', stderr: '', code: 0 };
      started();
      if (wait) await new Promise<void>((_done, fail) => {
        if (signal?.aborted) fail(signal.reason);
        else signal?.addEventListener('abort', () => fail(signal.reason), { once: true });
      });
      return { stdout: 'private-value\noutput', stderr: 'private-value', code: 7 };
    },
  }) as unknown as MachineType;
  // The lock facade shares the same live process inventory as the transport fixture.
  locks.live = machines.live;
  locks.records = machines.records;
  await mkdir(vmDir(id), { recursive: true });
  const workspaces = new Workspaces(machines, { secrets: {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ TOKEN: 'private-value' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ TOKEN: 'private-value' })`) through a Promise.
     */
    resolve: async () => ({ TOKEN: 'private-value' }),
  } as unknown as Secrets });
  const payloads: { directory: string; networkIsolation?: string; execution: { command: string; environment?: Record<string, string> } }[] = [];
  const terminals = new ProjectTerminals(machines, workspaces), service = new ProjectExecution(machines, terminals,
    async (transport, vmId, project, execution, signal, log, timeout, agentPath, afterCleanup) => {
      payloads.push({ directory: project.directory, networkIsolation: project.networkIsolation, execution });
      return guestTask(transport, vmId, '/fixed/protected-project-launcher', signal, log, timeout, agentPath, afterCleanup);
    });
  return { id, machines, live, commands, payloads, workspaces, terminals, service, executing,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `wait`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    wait: () => { wait = true; },
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `service.close`, `terminals.close`, `workspaces.close`.
     * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
     * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
     */
    close: async () => { await service.close(); await terminals.close(); await workspaces.close(); } };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: default execution passes saved active project command and environment to the identity runner and redacts secrets
 * 协作入口 / Collaborators: `fixture`, `f.workspaces.projects.create`, `f.service.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.scope, 'project')`; `assert.equal('projectId' in result && result.projectId, index.active)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('default execution passes saved active project command and environment to the identity runner and redacts secrets', async () => {
  const f = await fixture();
  try {
    const index = await f.workspaces.projects.create(f.id, 'Private', async () => {
      await f.workspaces.save(f.id, { directory: '/workspace/private', networkIsolation: 'private',
        environment: { MESSAGE: 'hello' }, secrets: { TOKEN: 'secret-token' } });
    });
    const result = await f.service.run(f.id, { command: 'echo "$TOKEN"' });
    assert.equal(result.scope, 'project');
    assert.equal('projectId' in result && result.projectId, index.active);
    assert.equal(result.code, 7);
    assert.equal(result.stdout, '[私密配置已隐藏]\noutput');
    assert.equal(result.stderr, '[私密配置已隐藏]');
    assert.equal(f.payloads.length, 1);
    assert.equal(f.payloads[0].directory, '/workspace/private');
    assert.equal(f.payloads[0].networkIsolation, 'private');
    assert.equal(f.payloads[0].execution.command, 'echo "$TOKEN"');
    assert.equal(f.payloads[0].execution.environment?.TOKEN, 'private-value');
    assert.ok(!f.commands.some((value) => value.includes('private-value')));
    const management = await f.service.run(f.id, { command: 'echo admin', scope: 'instance' });
    assert.equal(management.scope, 'instance');
    assert.equal(management.stdout, 'private-value\noutput', 'instance commands do not load project secret values');
    assert.equal(f.payloads.length, 1, 'explicit instance administration does not use a project identity');
    await assert.rejects(f.service.run(f.id, { command: 'true', scope: 'instance' }, index.active), /不能同时指定项目/);
    await assert.rejects(f.service.run(f.id, { command: 'true' }, '1111111111111111'), /项目不存在/);
    assert.throws(() => f.service.run(f.id, { command: 'true' }, ''));
    for (const timeoutSeconds of [0, 3601, 1.5])
      assert.throws(() => f.service.run(f.id, { command: 'true', timeoutSeconds }));
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: abort and service shutdown clean the guest process group and release execution locks
 * 协作入口 / Collaborators: `fixture`, `f.wait`, `f.service.run`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/other' }), /另一项操作|请先结束此项目/)`; `assert.rejects(operation)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('abort and service shutdown clean the guest process group and release execution locks', async () => {
  const f = await fixture(); f.wait();
  try {
    const abort = new AbortController();
    const operation = f.service.run(f.id, { command: 'sleep 600' }, null, abort.signal);
    await f.executing;
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/other' }), /另一项操作|请先结束此项目/);
    const cancelled = assert.rejects(operation);
    abort.abort(); await cancelled;
    assert.ok(f.commands.some((value) => value.includes('sakura_owned_anchor') && value.includes('.pid.stop')));
    await f.workspaces.save(f.id, { directory: '/workspace/other' });
    const second = f.service.run(f.id, { command: 'sleep 600', scope: 'instance' });
    const stopped = assert.rejects(second);
    // Admission is asynchronous; wait for this command to enter before testing shutdown cleanup.
    await new Promise<void>(resolve => setImmediate(resolve));
    await f.service.close(); await stopped;
    assert.ok(f.commands.filter((value) => value.includes('sakura_owned_anchor') && value.includes('.pid.stop')).length >= 2);
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: agent command setup resolves the persisted active project and preserves an explicit default scope
 * 协作入口 / Collaborators: `fixture`, `f.workspaces.projects.create`, `assert.deepEqual`, `withProjectCommand`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(await withProjectCommand(f.machines, f.id, undefined, undefined, inspect), { projectId: index.active, directory: …`; `assert.deepEqual(await f.workspaces.projects.with(f.id, 'default', () => withProjectCommand(f.machines, f.id, undefined, f.workspa…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('agent command setup resolves the persisted active project and preserves an explicit default scope', async () => {
  const f = await fixture();
  try {
    const index = await f.workspaces.projects.create(f.id, 'Private', async () => {
      await f.workspaces.save(f.id, { directory: '/workspace/agent', networkIsolation: 'private' });
    });
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: project: { _workspace?: string; directory: string; networkIsolation?: stri…。
     * 结果：返回分支计算值（`Promise.resolve({ projectId: project._workspace || 'default', directory: project…`）。
     * Result: Return the branch-computed value (`Promise.resolve({ projectId: project._workspace || 'default', directory: project…`).
     * 验证场景 / Scenario: agent command setup resolves the persisted active project and preserves an explicit default scope
     * 协作入口 / Collaborators: `Promise.resolve`.
     */
    const inspect = (project: { _workspace?: string; directory: string; networkIsolation?: string }) =>
      Promise.resolve({ projectId: project._workspace || 'default', directory: project.directory,
        networkIsolation: project.networkIsolation || 'host' });
    assert.deepEqual(await withProjectCommand(f.machines, f.id, undefined, undefined, inspect),
      { projectId: index.active, directory: '/workspace/agent', networkIsolation: 'private' });
    assert.deepEqual(await f.workspaces.projects.with(f.id, 'default', () =>
      withProjectCommand(f.machines, f.id, undefined, f.workspaces, inspect)),
      { projectId: 'default', directory: '/workspace', networkIsolation: 'host' });
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: independent projects execute concurrently while VM configuration writes remain excluded
 * 协作入口 / Collaborators: `fixture`, `f.wait`, `f.workspaces.projects.create`, `f.service.run`.
 * 检查边界 / Checked boundaries: `assert.equal(f.payloads.length, 2)`; `assert.rejects(f.workspaces.save(f.id, { directory: '/workspace' }), { code: 'VM_EXECUTION_ACTIVE' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('independent projects execute concurrently while VM configuration writes remain excluded', async () => {
  const f = await fixture(); f.wait();
  const abort = new AbortController();
  try {
    const index = await f.workspaces.projects.create(f.id, 'Parallel', async () => {
      await f.workspaces.save(f.id, { directory: '/workspace/parallel' });
    });
    const first = f.service.run(f.id, { command: 'sleep 600' }, 'default', abort.signal);
    await f.executing;
    const second = f.service.run(f.id, { command: 'sleep 600' }, index.active, abort.signal);
    const settled = Promise.allSettled([first, second]);
    const deadline = Date.now() + 5000;
    while (f.payloads.length < 2 && Date.now() < deadline)
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    assert.equal(f.payloads.length, 2);
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace' }), { code: 'VM_EXECUTION_ACTIVE' });
    abort.abort();
    assert.ok((await settled).every(result => result.status === 'rejected'));
  } finally { abort.abort(); await f.close(); }
});
