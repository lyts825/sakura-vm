/**
 * 模块职责：回归验证模块，围绕 `project-command-tasks` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-command-tasks`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: saved commands use the captured project, protected payload, declared parameters and exact live instance; command cancellation holds its preparation lease until cleanup finishes and preserves a 503 failure.
 */
import { projectMetadataFile } from '../server/project-catalog.ts';
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Files } from '../server/files.ts';
import type { projectIdentityTask } from '../server/project-run-scope.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-project-command-tasks-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { CommandPresets } = await import('../server/command-presets.ts');
const { Pipelines } = await import('../server/pipelines.ts');
const { AppError, vmDir } = await import('../server/model.ts');
after(() => rm(root, { recursive: true, force: true }));

/**
 * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
 * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `promise, resolve`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `promise, resolve`; the actual branch determines its shape.
 */
function gate() {
  let resolve!: /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
type Call = { project: any; execution: any; signal: AbortSignal;
  log?: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: text: string。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (text: string) => void; timeout?: number; expectedLive: unknown };

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `id, key, live, machines, workspaces, commands, calls, scope, fileCalls`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, key, live, machines, workspaces, commands, calls, scope, fileCalls`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `Object.assign`, `locks.locked.bind`, `mkdir`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture() {
  const id = randomUUID(), locks = new Machines({} as any, fakeVmNetwork), live = { status: 'running' };
  const commands: string[] = [], calls: Call[] = [];
  let status = 'running', migrations = 'null\n', resolveCount = 0;
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   */
  let resolveHook = async () => {};
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _call: Call。
   * 结果：返回分支计算值（`({ code: 0, stdout: '', stderr: '' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ code: 0, stdout: '', stderr: '' })`) through a Promise.
   */
  let execute = async (_call: Call) => ({ code: 0, stdout: '', stderr: '' });
  const machines = Object.assign(new EventEmitter(), {
    records: new Map([[id, { id, distro: 'alpine', template: 'none' }]]),
    live: new Map([[id, live]]), /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id, distro: 'alpine', template: 'none' })`）。
     * Result: Return the branch-computed value (`({ id, distro: 'alpine', template: 'none' })`).
     */
    get: () => ({ id, distro: 'alpine', template: 'none' }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`status`）。
     * Result: Return the branch-computed value (`status`).
     */
    state: () => status, locked: locks.locked.bind(locks),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `commands.push`, `command.includes`.
     */
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.includes('project-directory-migrations')) return { code: 0, stdout: migrations, stderr: '' };
      if (command.includes('SAKURA_PROJECT_MAIN_LEGACY_STATUS')) return { code: 0, stdout: 'absent\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
  }) as any;
  await mkdir(vmDir(id), { recursive: true });
  const workspaces = new Workspaces(machines, { secrets: { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `TOKEN`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `TOKEN`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `resolveHook`.
   */
  resolve: async () => {
    ++resolveCount; await resolveHook(); return { TOKEN: 'private-project-token' };
  } } as any });
  const first = await workspaces.projects.create(id, 'Alpha', () => workspaces.save(id,
    { directory: '/workspace/alpha', networkIsolation: 'private',
      environment: { MESSAGE: 'captured' }, secrets: { TOKEN: 'project-token' } }).then(() => {}));
  const second = await workspaces.projects.create(id, 'Beta', () => workspaces.save(id,
    { directory: '/workspace/beta', environment: { MESSAGE: 'other' } }).then(() => {}));
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: action: () => T。
   * 结果：返回分支计算值（`workspaces.projects.inScope(id, first.active, action)`）。
   * Result: Return the branch-computed value (`workspaces.projects.inScope(id, first.active, action)`).
   * 协作入口 / Collaborators: `workspaces.projects.inScope`.
   */
  const scope = <T>(action: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => T) => workspaces.projects.inScope(id, first.active, action);
  const key = scope(() => workspaces.projects.key(id));
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _transport; vmId; project; execution; signal; log; timeout; _agent; _afterCleanup; options。
   * 结果：返回分支计算值（`execute(call)`），以 Promise 交付。
   * Result: Return the branch-computed value (`execute(call)`) through a Promise.
   * 失败 / Failure: `new AppError('prepared live changed before admission', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `assert.ok`, `machines.live.get`, `calls.push`, `execute`.
   * 检查边界 / Checked boundaries: `assert.ok(options?.expectedLive, 'task runner requires the exact prepared live instance')`.
   */
  const runTask: typeof projectIdentityTask = async (_transport, vmId, project, execution, signal, log,
    timeout, _agent, _afterCleanup, options) => {
    assert.ok(options?.expectedLive, 'task runner requires the exact prepared live instance');
    if (options?.expectedLive !== machines.live.get(vmId))
      throw new AppError('prepared live changed before admission', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    const call = { project, execution, signal, log, timeout, expectedLive: options.expectedLive };
    calls.push(call); return execute(call);
  };
  const commandsService = new CommandPresets(machines, workspaces, { runTask });
  const fileCalls: string[] = [];
  const files = { /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: _vmId: string; path: string。
   * 结果：返回受控对象，公开字段包括 `size`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `size`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `fileCalls.push`.
   */
  info: async (_vmId: string, path: string) => { fileCalls.push(path); return { size: 0 }; },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    download: async () => {} } as unknown as Files;
  const pipelines = new Pipelines(machines, workspaces, files, { runTask });
  const preset = (await scope(() => commandsService.save(id,
    { name: 'Build', command: 'printf "%s" "$TARGET"', parameters: [{ name: 'TARGET', value: 'default' }] })))[0];
  const pipeline = await scope(() => pipelines.save(id, { name: 'Release', steps: [
    { name: 'Compile', command: 'first-step', timeout: 7 },
    { name: 'Verify', command: 'second-step', timeout: 11 },
  ] }));
  return { id, key, live, machines, workspaces, commands, calls, scope, fileCalls, files,
    projectId: first.active, otherProjectId: second.active, preset, pipeline,
    commandsService, pipelines, /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`resolveCount`）。
     * Result: Return the branch-computed value (`resolveCount`).
     */
    resolveCount: () => resolveCount,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: action: typeof execute。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `execute`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    execute: (action: typeof execute) => { execute = action; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: action: typeof resolveHook。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `resolveHook`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    resolving: (action: typeof resolveHook) => { resolveHook = action; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    pause: () => { status = 'paused'; }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `migrations`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    migration: (value: string) => { migrations = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`scope(() => workspaces.save(id, { directory: '/workspace/moved', networkIsolatio…`）。
     * Result: Return the branch-computed value (`scope(() => workspaces.save(id, { directory: '/workspace/moved', networkIsolatio…`).
     * 协作入口 / Collaborators: `scope`.
     */
    bindingChange: () => scope(() => workspaces.save(id, { directory: '/workspace/moved', networkIsolation: 'private' })),
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `commandsService.close`, `pipelines.close`, `workspaces.close`.
     * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
     * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
     */
    close: async () => { await commandsService.close(); await pipelines.close(); await workspaces.close(); } };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: saved commands use the captured project, protected payload, declared parameters and exact live instance
 * 协作入口 / Collaborators: `fixture`, `f.resolving`, `f.execute`, `f.scope`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'done')`; `assert.equal(job.projectId, f.projectId)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('saved commands use the captured project, protected payload, declared parameters and exact live instance', async () => {
  const f = await fixture();
  try {
    f.resolving(async () => { await f.workspaces.projects.update(f.id, f.otherProjectId); });
    f.execute(async call => { call.log?.('private-project-'); call.log?.('token\n'); return { code: 0, stdout: '', stderr: '' }; });
    const job = await f.scope(() => f.commandsService.run(f.id, f.preset.id, { TARGET: "x'; touch /tmp/unused; '" }));
    await f.commandsService.jobs.wait(f.key);
    assert.equal(job.status, 'done'); assert.equal(job.projectId, f.projectId);
    assert.equal(f.calls.length, 1); assert.equal(f.resolveCount(), 1);
    assert.equal(f.calls[0].project._workspace, f.projectId);
    assert.equal(f.calls[0].project.directory, '/workspace/alpha');
    assert.equal(f.calls[0].project.networkIsolation, 'private');
    assert.equal(f.calls[0].execution.environment.TOKEN, 'private-project-token');
    assert.match(f.calls[0].execution.command, /export TARGET='x'\\'';/);
    assert.equal(f.calls[0].expectedLive, f.live);
    assert.match(job.log, /私密配置已隐藏/); assert.ok(!job.log.includes('private-project-token'));
    assert.ok(!f.commands.some(command => /private-project-token|touch \/tmp\/unused/.test(command)));
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: command cancellation holds its preparation lease until cleanup finishes and preserves a 503 failure
 * 协作入口 / Collaborators: `fixture`, `gate`, `f.execute`, `f.scope`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.bindingChange(), /请先结束此项目的终端或命令/)`; `assert.equal(job.status, 'error')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('command cancellation holds its preparation lease until cleanup finishes and preserves a 503 failure', async () => {
  const f = await fixture(), started = gate(), cleanup = gate();
  try {
    f.execute(async call => {
      started.resolve(); await new Promise<void>(done => call.signal.addEventListener('abort', () => done(), { once: true }));
      await cleanup.promise;
      throw new AppError('private-project-token cleanup uncertain', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    });
    const job = await f.scope(() => f.commandsService.run(f.id, f.preset.id, {}));
    await started.promise; f.commandsService.jobs.cancel(f.key);
    await assert.rejects(f.bindingChange(), /请先结束此项目的终端或命令/);
    cleanup.resolve(); await f.commandsService.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    assert.ok(!job.error?.includes('private-project-token'));
    await f.bindingChange();
  } finally { cleanup.resolve(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: ordinary command failures redact their message without changing the exit classification
 * 协作入口 / Collaborators: `fixture`, `f.execute`, `f.scope`, `f.commandsService.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.match(job.error!, /私密配置已隐藏/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('ordinary command failures redact their message without changing the exit classification', async () => {
  const f = await fixture();
  try {
    f.execute(async () => ({ code: 9, stdout: '', stderr: 'private-project-token failed' }));
    const job = await f.scope(() => f.commandsService.run(f.id, f.preset.id, {}));
    await f.commandsService.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.match(job.error!, /私密配置已隐藏/);
    assert.equal(job.errorCode, undefined);
    await assert.rejects(f.scope(() => f.commandsService.run(f.id, f.preset.id, { UNKNOWN: 'value' })), /未声明/);
    assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a paused instance and unresolved directory migration cannot execute a saved command
 * 协作入口 / Collaborators: `fixture`, `f.migration`, `f.scope`, `f.commandsService.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal(f.calls.length, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a paused instance and unresolved directory migration cannot execute a saved command', async () => {
  const f = await fixture();
  try {
    f.migration('{"phase":"unknown"}\n');
    const job = await f.scope(() => f.commandsService.run(f.id, f.preset.id, {}));
    await f.commandsService.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.equal(f.calls.length, 0);
    f.pause();
    await assert.rejects(f.scope(() => f.commandsService.run(f.id, f.preset.id, {})), /请先启动/);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: instance replacement during secret resolution refuses command admission with its original identity error
 * 协作入口 / Collaborators: `fixture`, `f.resolving`, `f.scope`, `f.commandsService.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal(job.errorCode, 'PROJECT_IDENTITY_HOST_CHANGED')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('instance replacement during secret resolution refuses command admission with its original identity error', async () => {
  const f = await fixture();
  try {
    f.resolving(async () => { f.machines.live.set(f.id, {}); });
    const job = await f.scope(() => f.commandsService.run(f.id, f.preset.id, {}));
    await f.commandsService.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pipeline steps share one captured configuration and protected environment but retain separate task calls and timeouts
 * 协作入口 / Collaborators: `fixture`, `f.execute`, `f.scope`, `f.pipelines.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'done', job.error)`; `assert.equal(f.calls.length, 2)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('pipeline steps share one captured configuration and protected environment but retain separate task calls and timeouts', async () => {
  const f = await fixture();
  try {
    f.execute(async call => {
      if (f.calls.length === 1) await f.scope(() => f.workspaces.save(f.id,
        { directory: call.project.directory, networkIsolation: call.project.networkIsolation,
          environment: { MESSAGE: 'changed later' }, secrets: { TOKEN: 'different-reference' } }));
      call.log?.('private-project-token\n'); return { code: 0, stdout: '', stderr: '' };
    });
    const job = await f.scope(() => f.pipelines.run(f.id, f.pipeline.id));
    await f.pipelines.jobs.wait(f.key);
    assert.equal(job.status, 'done', job.error); assert.equal(f.calls.length, 2); assert.equal(f.resolveCount(), 1);
    assert.deepEqual(f.calls.map(call => call.timeout), [7000, 11000]);
    assert.deepEqual(f.calls.map(call => call.execution.command), ['first-step', 'second-step']);
    for (const call of f.calls) {
      assert.equal(call.project._workspace, f.projectId); assert.equal(call.execution.environment.MESSAGE, 'captured');
      assert.equal(call.execution.environment.TOKEN, 'private-project-token'); assert.equal(call.expectedLive, f.live);
    }
    const [run] = await f.scope(() => f.pipelines.runs(f.id));
    assert.equal(run.status, 'done'); assert.equal(run.projectId, f.projectId);
    assert.deepEqual(run.steps.map(step => step.status), ['done', 'done']);
    assert.ok(!run.steps.some(step => step.log.includes('private-project-token')));
    assert.ok(!f.commands.some(command => /first-step|second-step|private-project-token/.test(command)));
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a pipeline holds its binding across steps and artifact collection and releases it only after final persistence
 * 状态影响 / State effects: `f.files.info`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `gate`, `f.execute`, `f.scope`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.bindingChange(), /请先结束此项目的终端或命令/)`; `assert.equal(job.status, 'error')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a pipeline holds its binding across steps and artifact collection and releases it only after final persistence', async () => {
  const f = await fixture(), collecting = gate(), finish = gate();
  try {
    f.execute(async () => {
      await assert.rejects(f.bindingChange(), /请先结束此项目的终端或命令/);
      return { code: 0, stdout: '', stderr: '' };
    });
    f.files.info = /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: _id: string; path: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a pipeline holds its binding across steps and artifact collection and releases it only after final persistence
     * 失败 / Failure: `new AppError('artifact missing', 404)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `f.fileCalls.push`, `collecting.resolve`.
     */
    async (_id: string, path: string) => {
      f.fileCalls.push(path); collecting.resolve(); await finish.promise;
      throw new AppError('artifact missing', 404);
    };
    await f.scope(() => f.pipelines.save(f.id, { ...f.pipeline, artifacts: ['output.txt'] }));
    const job = await f.scope(() => f.pipelines.run(f.id, f.pipeline.id));
    await collecting.promise;
    await assert.rejects(f.bindingChange(), /请先结束此项目的终端或命令/);
    finish.resolve(); await f.pipelines.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.deepEqual(f.fileCalls, ['/workspace/alpha/output.txt']);
    await f.bindingChange();
  } finally { finish.resolve(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pipeline cancellation with unconfirmed cleanup remains an error in both durable run and job after reload
 * 协作入口 / Collaborators: `fixture`, `gate`, `f.execute`, `f.scope`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.bindingChange(), /请先结束此项目的终端或命令/)`; `assert.equal(job.status, 'error')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('pipeline cancellation with unconfirmed cleanup remains an error in both durable run and job after reload', async () => {
  const f = await fixture(), started = gate(), cleanup = gate();
  try {
    f.execute(async call => {
      started.resolve(); await new Promise<void>(done => call.signal.addEventListener('abort', () => done(), { once: true }));
      await cleanup.promise; throw new AppError('private-project-token cleanup uncertain', 503, 'GUEST_TASK_CLEANUP_FAILED');
    });
    const job = await f.scope(() => f.pipelines.run(f.id, f.pipeline.id));
    await started.promise; f.pipelines.jobs.cancel(f.key);
    await assert.rejects(f.bindingChange(), /请先结束此项目的终端或命令/);
    cleanup.resolve(); await f.pipelines.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'GUEST_TASK_CLEANUP_FAILED');
    const reloaded = new Pipelines(f.machines, f.workspaces, f.files);
    try {
      const [run] = await f.scope(() => reloaded.runs(f.id));
      assert.equal(run.status, 'error'); assert.equal(run.errorCode, 'GUEST_TASK_CLEANUP_FAILED');
      assert.equal(run.steps[0].status, 'error'); assert.equal(run.steps[0].errorCode, 'GUEST_TASK_CLEANUP_FAILED');
      assert.equal(run.steps[1].status, 'pending'); assert.ok(!JSON.stringify(run).includes('private-project-token'));
    } finally { await reloaded.close(); }
    assert.equal(f.calls.length, 1);
  } finally { cleanup.resolve(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: closing the command service cancels its execution and drains exact cleanup before dropping the configuration guard
 * 协作入口 / Collaborators: `fixture`, `gate`, `f.execute`, `f.scope`.
 * 检查边界 / Checked boundaries: `assert.equal(closed, false)`; `assert.rejects(f.bindingChange(), /请先结束此项目的终端或命令/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('closing the command service cancels its execution and drains exact cleanup before dropping the configuration guard', async () => {
  const f = await fixture(), started = gate(), cleaning = gate(), finish = gate();
  try {
    f.execute(async call => {
      started.resolve(); await new Promise<void>(done => call.signal.addEventListener('abort', () => done(), { once: true }));
      cleaning.resolve(); await finish.promise; throw call.signal.reason;
    });
    const job = await f.scope(() => f.commandsService.run(f.id, f.preset.id, {}));
    await started.promise; let closed = false;
    const closing = f.commandsService.close().then(() => { closed = true; });
    await cleaning.promise; assert.equal(closed, false);
    await assert.rejects(f.bindingChange(), /请先结束此项目的终端或命令/);
    finish.resolve(); await closing;
    assert.equal(job.status, 'cancelled'); await f.bindingChange();
  } finally { finish.resolve(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pipeline records stay in the original project when the saved active selection changes
 * 协作入口 / Collaborators: `fixture`, `f.resolving`, `f.scope`, `f.pipelines.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'done')`; `assert.equal(job.projectId, f.projectId)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('pipeline records stay in the original project when the saved active selection changes', async () => {
  const f = await fixture();
  try {
    f.resolving(async () => { await f.workspaces.projects.update(f.id, f.otherProjectId); });
    const job = await f.scope(() => f.pipelines.run(f.id, f.pipeline.id));
    await f.pipelines.jobs.wait(f.key);
    assert.equal(job.status, 'done'); assert.equal(job.projectId, f.projectId);
    assert.equal((await f.scope(() => f.pipelines.runs(f.id)))[0].projectId, f.projectId);
    assert.equal((await f.workspaces.projects.inScope(f.id, f.otherProjectId, () => f.pipelines.runs(f.id))).length, 0);
    const persisted = await readFile(f.scope(() => projectMetadataFile(f.id, f.workspaces.projects.current(f.id), 'pipeline-runs')), 'utf8');
    assert.equal(JSON.parse(persisted)[0].status, 'done');
  } finally { await f.close(); }
});
