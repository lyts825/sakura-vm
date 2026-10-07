/**
 * 模块职责：回归验证模块，围绕 `feature-suite-dev-identity` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `feature-suite-dev-identity`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: all nine finite dev operations use captured UID commands and protected project environment; realistic non-enumerable named scope stays attached without changing the config fingerprint.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { projectSchema, projectVersion } from '../server/workspaces.ts';
import { AppError, setVmStorageRoot } from '../server/model.ts';
import { Jobs } from '../server/jobs.ts';
import { FeatureSuite } from '../server/feature-suite.ts';
import { projectIdentityPayload } from '../server/project-identity.ts';
import { scopeIdentityFixture } from './project-scope-identity-fixture.ts';
import { runFeatureDevTask, featureDevTaskCommand, type FeatureDevTaskOptions,
  type FeatureDevTaskInput } from '../server/feature-suite-dev-task.ts';

const id = '11111111-1111-4111-8111-111111111111', projectId = '0123456789abcdef';
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `run, save, options, machines, workspaces, live, config, payloads, results`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `run, save, options, machines, workspaces, live, config, payloads, results`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `projectSchema.parse`, `Object.defineProperty`.
 */
function fixture() {
  const context = new AsyncLocalStorage<string>();
  let override: string | undefined, leaseOpen = false, releases = 0;
  const live = { startedAt: '2026-10-02T00:00:00Z' };
  const config = projectSchema.parse({ directory: '/srv/projects/original', template: 'none',
    networkIsolation: 'private', environment: { MODE: 'original' }, secrets: { TOKEN: 'fixture-token' } });
  Object.defineProperty(config, '_workspace', { value: projectId, enumerable: false });
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`Object.defineProperty(structuredClone(config), '_workspace', { value: projectId,…`）。
   * Result: Return the branch-computed value (`Object.defineProperty(structuredClone(config), '_workspace', { value: projectId,…`).
   * 协作入口 / Collaborators: `Object.defineProperty`, `structuredClone`.
   */
  const clone = () => Object.defineProperty(structuredClone(config), '_workspace', { value: projectId, enumerable: false });
  const payloads: any[] = [], results: any[] = [], events: string[] = [], logs: string[] = [];
  const machines = { live: new Map([[id, live]]), /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'running'`）。
   * Result: Return the branch-computed value (`'running'`).
   */
  state: () => 'running', /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ distro: 'alpine' })`）。
   * Result: Return the branch-computed value (`({ distro: 'alpine' })`).
   */
  get: () => ({ distro: 'alpine' }),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    requireUnlocked: () => {}, /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('Root project execution forbidden')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    exec: async () => { throw new Error('Root project execution forbidden'); },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('Root project helper publication forbidden')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    writeGuestFile: async () => { throw new Error('Root project helper publication forbidden'); },
  } as unknown as Machines;
  const workspaces = { projects: {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`override || context.getStore() || projectId`）。
     * Result: Return the branch-computed value (`override || context.getStore() || projectId`).
     * 协作入口 / Collaborators: `context.getStore`.
     */
    current: () => override || context.getStore() || projectId,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`id + ':' + (override || context.getStore() || projectId)`）。
     * Result: Return the branch-computed value (`id + ':' + (override || context.getStore() || projectId)`).
     * 协作入口 / Collaborators: `context.getStore`.
     */
    key: () => id + ':' + (override || context.getStore() || projectId),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; scope: string; action: () => unknown。
     * 结果：返回分支计算值（`context.run(scope, action)`）。
     * Result: Return the branch-computed value (`context.run(scope, action)`).
     * 协作入口 / Collaborators: `context.run`.
     */
    inScope: (_id: string, scope: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => unknown) => context.run(scope, action),
  }, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`clone()`），以 Promise 交付。
   * Result: Return the branch-computed value (`clone()`) through a Promise.
   * 协作入口 / Collaborators: `clone`.
   */
  config: async () => clone(),
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 失败 / Failure: `new Error('Selected-project reread forbidden')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  resolvedConfig: async () => { throw new Error('Selected-project reread forbidden'); },
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: _id: string; captured: typeof config。
   * 结果：返回受控对象，公开字段包括 `_workspace, environment`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `_workspace, environment`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `assert.equal`, `projectVersion`.
   * 检查边界 / Checked boundaries: `assert.equal(projectVersion(captured), projectVersion(config))`.
   */
  resolveProject: async (_id: string, captured: typeof config) => {
    assert.equal(projectVersion(captured), projectVersion(config));
    return { ...captured, _workspace: (captured as typeof config & { _workspace?: string })._workspace,
      environment: { ...captured.environment, TOKEN: 'fixture-private-token' } };
  } } as unknown as Workspaces;
  const options: FeatureDevTaskOptions = { terminals: { /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: _id; scope; session; readOnly; signal; _terminalId; mode。
   * 结果：返回受控对象，公开字段包括 `command, projectId, networkIsolation, signal, terminalId, captured, release`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `command, projectId, networkIsolation, signal, terminalId, captured, release`; the actual branch determines its shape.
   * 状态影响 / State effects: `leaseOpen`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `assert.equal`, `assert.deepEqual`, `clone`, `projectVersion`.
   * 检查边界 / Checked boundaries: `assert.equal(scope, projectId)`; `assert.equal(session, null)`.
   */
  prepare: async (_id, scope, session, readOnly, signal, _terminalId, mode) => {
    assert.equal(scope, projectId); assert.equal(session, null); assert.equal(readOnly, false);
    assert.deepEqual(mode, { mode: 'task' }); leaseOpen = true;
    return { command: 'unused', projectId, networkIsolation: 'private', signal: signal!, terminalId: undefined,
      captured: { project: clone(), configVersion: projectVersion(config), live: live as any },
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 状态影响 / State effects: `leaseOpen`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `events.push`.
       */
      release: () => { leaseOpen = false; ++releases; events.push('release'); } };
  } }, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _machines; _id; captured; execution; signal; log; timeout; _agent; _cleanup; pins。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `assert.ok`, `assert.equal`, `projectIdentityPayload`, `payloads.push`.
   * 检查边界 / Checked boundaries: `assert.ok(leaseOpen)`; `assert.equal(captured._workspace, projectId)`.
   */
  runTask: async (_machines, _id, captured, execution, signal, log, timeout, _agent, _cleanup, pins) => {
    assert.ok(leaseOpen); assert.equal(captured._workspace, projectId);
    assert.equal(pins?.expectedLive, live); assert.equal(signal.aborted, false); assert.equal(timeout, 600000);
    projectIdentityPayload(execution); payloads.push({ captured, execution }); events.push('uid-task');
    log?.('fixture-private-token\n'); return { code: 0, stdout: 'result fixture-private-token', stderr: '' };
  } };
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: result: unknown。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `assert.ok`, `results.push`, `events.push`.
   * 检查边界 / Checked boundaries: `assert.ok(leaseOpen)`.
   */
  const save = async (result: unknown) => { assert.ok(leaseOpen); results.push(result); events.push('save'); };
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: input: FeatureDevTaskInput = { operation: 'test' }; signal = new AbortController().signal。
   * 结果：返回分支计算值（`runFeatureDevTask(machines, workspaces, id, input, signal, value => logs.push(va…`）。
   * Result: Return the branch-computed value (`runFeatureDevTask(machines, workspaces, id, input, signal, value => logs.push(va…`).
   * 协作入口 / Collaborators: `runFeatureDevTask`.
   */
  const run = (input: FeatureDevTaskInput = { operation: 'test' }, signal = new AbortController().signal) =>
    runFeatureDevTask(machines, workspaces, id, input, signal, value => logs.push(value), save, options);
  return { run, save, options, machines, workspaces, live, config, payloads, results, events, logs,
    clone, /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`leaseOpen`）。
     * Result: Return the branch-computed value (`leaseOpen`).
     */
    leaseOpen: () => leaseOpen, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`releases`）。
     * Result: Return the branch-computed value (`releases`).
     */
    releases: () => releases, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `override`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    switchScope: () => { override = 'fedcba9876543210'; } };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: all nine finite dev operations use captured UID commands and protected project environment
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.equal`, `f.releases`.
 * 检查边界 / Checked boundaries: `assert.equal(f.payloads.length, 1)`; `assert.equal(f.releases(), 1)`.
 */
test('all nine finite dev operations use captured UID commands and protected project environment', async () => {
  for (const operation of ['test', 'test-discover', 'dependencies', 'lock', 'lock-check',
    'install-locked', 'worktree-list', 'worktree-add', 'worktree-remove'] as const) {
    const f = fixture(); await f.run({ operation, branch: 'feature/test', path: '.worktrees/test' });
    assert.equal(f.payloads.length, 1); assert.equal(f.releases(), 1);
    const { captured, execution } = f.payloads[0];
    assert.equal(captured._workspace, projectId); assert.equal(execution.environment.TOKEN, 'fixture-private-token');
    assert.match(execution.command, /^set -eu\n/);
    assert.equal(execution.command.includes("cd '/srv/projects/original'"), false);
    assert.equal(execution.command.includes('export '), false); assert.equal(execution.command.includes('ip netns exec'), false);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: realistic non-enumerable named scope stays attached without changing the config fingerprint
 * 协作入口 / Collaborators: `fixture`, `assert.equal`, `Object.hasOwn`, `structuredClone`.
 * 检查边界 / Checked boundaries: `assert.equal(Object.hasOwn(structuredClone(f.config), '_workspace'), false)`; `assert.equal(captured._workspace, projectId)`.
 */
test('realistic non-enumerable named scope stays attached without changing the config fingerprint', async () => {
  const f = fixture(); assert.equal(Object.hasOwn(structuredClone(f.config), '_workspace'), false);
  await f.run(); const captured = f.payloads[0].captured;
  assert.equal(captured._workspace, projectId);
  assert.equal(Object.getOwnPropertyDescriptor(captured, '_workspace')?.enumerable, false);
  assert.equal(projectVersion(captured), projectVersion(f.config));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a wrong prepared named scope is rejected even when its serialized config fingerprint matches
 * 状态影响 / State effects: `f.options.terminals!.prepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (e: any) => e.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.payloads.length, 0)`.
 */
test('a wrong prepared named scope is rejected even when its serialized config fingerprint matches', async () => {
  const f = fixture(), prepare = f.options.terminals!.prepare;
  f.options.terminals!.prepare = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回受控对象，公开字段包括 `captured`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `captured`; the actual branch determines its shape.
   * 验证场景 / Scenario: a wrong prepared named scope is rejected even when its serialized config fingerprint matches
   * 协作入口 / Collaborators: `prepare`, `Object.defineProperty`, `structuredClone`, `assert.equal`.
   * 检查边界 / Checked boundaries: `assert.equal(projectVersion(wrong), projectVersion(f.config))`.
   */
  async (...args) => {
    const result = await prepare(...args), wrong = Object.defineProperty(structuredClone(f.config), '_workspace',
      { value: 'fedcba9876543210', enumerable: false });
    assert.equal(projectVersion(wrong), projectVersion(f.config));
    return { ...result, captured: { ...result.captured!, project: wrong } };
  };
  await assert.rejects(f.run(), (e: any) => e.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.payloads.length, 0); assert.equal(f.releases(), 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: caller mutation cannot change an already accepted worktree task
 * 状态影响 / State effects: `input.branch`, `input.path`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.match`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.match(f.payloads[0].execution.command, /trees\/original' 'original'/)`; `assert.equal(f.payloads[0].execution.command.includes('changed'), false)`.
 */
test('caller mutation cannot change an already accepted worktree task', async () => {
  const f = fixture(), input: FeatureDevTaskInput = { operation: 'worktree-add', branch: 'original', path: 'trees/original' };
  const running = f.run(input); input.branch = 'changed'; input.path = 'trees/changed'; await running;
  assert.match(f.payloads[0].execution.command, /trees\/original' 'original'/);
  assert.equal(f.payloads[0].execution.command.includes('changed'), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: original live replacement during prepare refuses execution and releases the lease
 * 状态影响 / State effects: `f.options.terminals!.prepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (e: any) => e.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.payloads.length, 0)`.
 */
test('original live replacement during prepare refuses execution and releases the lease', async () => {
  const f = fixture(), prepare = f.options.terminals!.prepare;
  f.options.terminals!.prepare = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`r`），以 Promise 交付。
   * Result: Return the branch-computed value (`r`) through a Promise.
   * 验证场景 / Scenario: original live replacement during prepare refuses execution and releases the lease
   * 协作入口 / Collaborators: `prepare`, `f.machines.live.set`.
   */
  async (...args) => { const r = await prepare(...args); f.machines.live.set(id, {} as any); return r; };
  await assert.rejects(f.run(), (e: any) => e.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.payloads.length, 0); assert.equal(f.releases(), 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: config changes after capture cannot authorize a newer preparation candidate
 * 状态影响 / State effects: `f.options.terminals!.prepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (e: any) => e.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.payloads.length, 0)`.
 */
test('config changes after capture cannot authorize a newer preparation candidate', async () => {
  const f = fixture(), prepare = f.options.terminals!.prepare;
  f.options.terminals!.prepare = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`prepare(...args)`），以 Promise 交付。
   * Result: Return the branch-computed value (`prepare(...args)`) through a Promise.
   * 验证场景 / Scenario: config changes after capture cannot authorize a newer preparation candidate
   * 状态影响 / State effects: `f.config.environment`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `prepare`.
   */
  async (...args) => { f.config.environment = { MODE: 'changed' }; return prepare(...args); };
  await assert.rejects(f.run(), (e: any) => e.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.payloads.length, 0); assert.equal(f.releases(), 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancellation while resolving the captured environment launches no code and releases its lease
 * 状态影响 / State effects: `f.workspaces.resolveProject`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run({ operation: 'test' }, abort.signal))`; `assert.equal(f.payloads.length, 0)`.
 */
test('cancellation while resolving the captured environment launches no code and releases its lease', async () => {
  const f = fixture(), abort = new AbortController(), resolve = f.workspaces.resolveProject;
  f.workspaces.resolveProject = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`r`），以 Promise 交付。
   * Result: Return the branch-computed value (`r`) through a Promise.
   * 验证场景 / Scenario: cancellation while resolving the captured environment launches no code and releases its lease
   * 协作入口 / Collaborators: `resolve`, `abort.abort`.
   */
  async (...args) => { const r = await resolve(...args); abort.abort(); return r; };
  await assert.rejects(f.run({ operation: 'test' }, abort.signal));
  assert.equal(f.payloads.length, 0); assert.equal(f.results.length, 0); assert.equal(f.releases(), 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: scope switch during execution prevents result publication into another project
 * 状态影响 / State effects: `f.options.runTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (e: any) => e.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.results.length, 0)`.
 */
test('scope switch during execution prevents result publication into another project', async () => {
  const f = fixture(), runTask = f.options.runTask!;
  f.options.runTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`r`），以 Promise 交付。
   * Result: Return the branch-computed value (`r`) through a Promise.
   * 验证场景 / Scenario: scope switch during execution prevents result publication into another project
   * 协作入口 / Collaborators: `runTask`, `f.switchScope`.
   */
  async (...args) => { const r = await runTask(...args); f.switchScope(); return r; };
  await assert.rejects(f.run(), (e: any) => e.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.results.length, 0); assert.equal(f.releases(), 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: actual nonzero exit remains observable while output and errors are redacted
 * 状态影响 / State effects: `f.options.runTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), /failure \[私密配置已隐藏\]/)`; `assert.deepEqual(f.results, [{ code: 7, stdout: '[私密配置已隐藏]', stderr: 'failure [私密配置已隐藏]' }])`.
 */
test('actual nonzero exit remains observable while output and errors are redacted', async () => {
  const f = fixture(), runTask = f.options.runTask!;
  f.options.runTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: actual nonzero exit remains observable while output and errors are redacted
   * 协作入口 / Collaborators: `runTask`.
   */
  async (...args) => { await runTask(...args); return { code: 7, stdout: 'fixture-private-token', stderr: 'failure fixture-private-token' }; };
  await assert.rejects(f.run(), /failure \[私密配置已隐藏\]/);
  assert.deepEqual(f.results, [{ code: 7, stdout: '[私密配置已隐藏]', stderr: 'failure [私密配置已隐藏]' }]);
  assert.equal(f.logs.join('').includes('fixture-private-token'), false);
  assert.deepEqual(f.events, ['uid-task', 'save', 'release']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: native cleanup 503 and exact code bypass result parsing and publication
 * 状态影响 / State effects: `f.options.runTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (e: any) => e === error && e.status === 503)`; `assert.equal(f.results.length, 0)`.
 */
test('native cleanup 503 and exact code bypass result parsing and publication', async () => {
  const f = fixture(), error = new AppError('native cleanup pending', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  f.options.runTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: native cleanup 503 and exact code bypass result parsing and publication
   * 失败 / Failure: `error`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw error; };
  await assert.rejects(f.run(), (e: any) => e === error && e.status === 503);
  assert.equal(f.results.length, 0); assert.equal(f.releases(), 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancelled public Jobs keep cleanup failures as errors with the original cleanup code
 * 状态影响 / State effects: `f.options.runTask`, `suite.jobs`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `suite.dev`, `suite.jobs.wait`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal(job.errorCode, 'PROJECT_IDENTITY_CLEANUP_FAILED')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('cancelled public Jobs keep cleanup failures as errors with the original cleanup code', async () => {
  const f = fixture(), abort = new AbortController();
  f.options.runTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: cancelled public Jobs keep cleanup failures as errors with the original cleanup code
   * 失败 / Failure: `new AppError('cleanup pending', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `abort.abort`.
   */
  async () => { abort.abort(); throw new AppError('cleanup pending', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'); };
  const suite = new FeatureSuite(f.machines, f.workspaces, {}, f.options); suite.jobs = new Jobs();
  try {
    const job = suite.dev(id, { operation: 'test' }, abort.signal); await suite.jobs.wait(job.key!);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    assert.equal(job.result, undefined); assert.equal(f.releases(), 1);
  } finally { await suite.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: result persistence retains the lease and persistence failure still releases it
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `runFeatureDevTask`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(runFeatureDevTask(f.machines, f.workspaces, id, { operation: 'test' }, new AbortController().signal, () => {}, asyn…`; `assert.equal(f.releases(), 1)`.
 */
test('result persistence retains the lease and persistence failure still releases it', async () => {
  const f = fixture();
  await assert.rejects(runFeatureDevTask(f.machines, f.workspaces, id, { operation: 'test' },
    new AbortController().signal, () => {}, async () => { assert.ok(f.leaseOpen()); throw new AppError('save failed', 507); }, f.options),
    (e: any) => e.status === 507);
  assert.equal(f.releases(), 1); assert.equal(f.payloads.length, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a secondary release error cannot replace the original native cleanup 503
 * 状态影响 / State effects: `f.options.runTask`, `f.options.terminals!.prepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (e: any) => e === original)`.
 */
test('a secondary release error cannot replace the original native cleanup 503', async () => {
  const f = fixture(), prepare = f.options.terminals!.prepare;
  const original = new AppError('native pending', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  f.options.runTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: a secondary release error cannot replace the original native cleanup 503
   * 失败 / Failure: `original`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw original; };
  f.options.terminals!.prepare = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`({ ...await prepare(...args), release: () => { throw new Error('secondary'); } }…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ...await prepare(...args), release: () => { throw new Error('secondary'); } }…`) through a Promise.
   * 验证场景 / Scenario: a secondary release error cannot replace the original native cleanup 503
   * 协作入口 / Collaborators: `prepare`.
   */
  async (...args) => ({ ...await prepare(...args), /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: a secondary release error cannot replace the original native cleanup 503
   * 失败 / Failure: `new Error('secondary')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  release: () => { throw new Error('secondary'); } });
  await assert.rejects(f.run(), (e: any) => e === original);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: native environment entry, reserved identity keys and total bytes are bounded before launch
 * 状态影响 / State effects: `f.workspaces.resolveProject`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Object.fromEntries`, `Array.from`, `'x'.repeat`, `fixture`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run())`; `assert.equal(f.payloads.length, 0)`.
 */
test('native environment entry, reserved identity keys and total bytes are bounded before launch', async () => {
  for (const environment of [{ HOME: '/untrusted' }, Object.fromEntries(Array.from({ length: 129 }, (_, i) => ['K' + i, 'x'])),
    { TOKEN: 'x'.repeat(8193) }, Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['K' + i, '中'.repeat(300)]))]) {
    const f = fixture(); f.workspaces.resolveProject = /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ ...f.config, _workspace: projectId, environment })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ ...f.config, _workspace: projectId, environment })`) through a Promise.
     * 验证场景 / Scenario: native environment entry, reserved identity keys and total bytes are bounded before launch
     */
    async () => ({ ...f.config, _workspace: projectId, environment });
    await assert.rejects(f.run()); assert.equal(f.payloads.length, 0); assert.equal(f.releases(), 1);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: finite commands reject unknown operations and worktree traversal before guest execution
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(input as FeatureDevTaskInput))`; `assert.equal(f.payloads.length, 0)`.
 */
test('finite commands reject unknown operations and worktree traversal before guest execution', async () => {
  const f = fixture();
  for (const input of [{ operation: 'unknown' }, { operation: 'worktree-add', branch: '-malicious', path: 'tree' },
    { operation: 'worktree-remove', path: '../other' }, { operation: 'worktree-add', branch: 'safe', path: '/absolute' }])
    await assert.rejects(f.run(input as FeatureDevTaskInput));
  assert.equal(f.payloads.length, 0);
  const command = featureDevTaskCommand({ ...f.config, directory: '/srv/$(printf exploit)' }, { operation: 'lock' });
  assert.match(command, /'project=\/srv\/\$\(printf exploit\)'/);
  assert.match(featureDevTaskCommand(f.config, { operation: 'test-discover' }), /\\\( -name \.git/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: real host journal and binary frames retain the named task identity through issuance and full cleanup
 * 状态影响 / State effects: `f.machines.live`, `f.machines.locked`, `f.machines.exec`, `f.machines.execInput`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `randomUUID`, `mkdtemp`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal(identity.inputs.length, 1)`; `assert.equal(identity.tickets.size, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('real host journal and binary frames retain the named task identity through issuance and full cleanup', async () => {
  const f = fixture(), vmId = randomUUID(), boot = randomUUID(), folder = await mkdtemp(join(tmpdir(), 'sakura-feature-dev-'));
  const commands: string[] = [];
  f.machines.live = new Map([[vmId, f.live as any]]);
  f.machines.locked = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: _key; action。
   * 结果：返回分支计算值（`action()`），以 Promise 交付。
   * Result: Return the branch-computed value (`action()`) through a Promise.
   * 验证场景 / Scenario: real host journal and binary frames retain the named task identity through issuance and full cleanup
   * 协作入口 / Collaborators: `action`.
   */
  async (_key, action) => action();
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: real host journal and binary frames retain the named task identity through issuance and full cleanup
   * 协作入口 / Collaborators: `commands.push`.
   */
  async (_id, command) => { commands.push(command); return { code: 0, stdout: '', stderr: '' }; };
  setVmStorageRoot(vmId, folder);
  const identity = scopeIdentityFixture(f.machines, f.config, () => boot, () => null);
  const native = f.machines.execInput;
  f.machines.execInput = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回受控对象，公开字段包括 `stdout`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `stdout`; the actual branch determines its shape.
   * 验证场景 / Scenario: real host journal and binary frames retain the named task identity through issuance and full cleanup
   * 协作入口 / Collaborators: `native`.
   */
  async (...args) => { const r = await native(...args); return { ...r, stdout: 'actual-result' }; };
  delete f.options.runTask;
  try {
    await runFeatureDevTask(f.machines, f.workspaces, vmId, { operation: 'test' }, new AbortController().signal,
      () => {}, f.save, f.options);
    assert.equal(identity.inputs.length, 1); assert.equal(identity.tickets.size, 1);
    const ticket = [...identity.tickets.values()][0]; assert.equal(ticket.projectId, projectId); assert.equal(ticket.phase, 'closed');
    assert.equal(ticket.cgroupName, 'sakura-task-' + ticket.runId);
    assert.equal(identity.inputs[0].readUInt16LE(10), 0);
    assert.ok(commands.every(command => !command.includes('fixture-private-token') && !command.includes('npm test')));
    const journal = JSON.parse(await readFile(join(folder, vmId, 'project-identities', projectId + '.json'), 'utf8'));
    assert.equal(journal.runs[0].identity.projectId, projectId); assert.equal(journal.runs[0].phase, 'closed');
  } finally { setVmStorageRoot(vmId); await rm(folder, { recursive: true, force: true }); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: public suite close cancels the UID task and waits for the preparation lease release
 * 状态影响 / State effects: `f.options.runTask`, `suite.jobs`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `suite.dev`, `suite.close`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'cancelled')`; `assert.equal(f.releases(), 1)`.
 */
test('public suite close cancels the UID task and waits for the preparation lease release', async () => {
  const f = fixture(); let began!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void; const started = new Promise<void>(resolve => { began = resolve; });
  f.options.runTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _m; _i; _p; _e; signal。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: public suite close cancels the UID task and waits for the preparation lease release
   * 失败 / Failure: `new Error('unreachable')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `began`, `signal.throwIfAborted`.
   */
  async (_m, _i, _p, _e, signal) => {
    began(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    signal.throwIfAborted(); throw new Error('unreachable');
  };
  const suite = new FeatureSuite(f.machines, f.workspaces, {}, f.options); suite.jobs = new Jobs();
  const job = suite.dev(id, { operation: 'test' }); await started; await suite.close();
  assert.equal(job.status, 'cancelled'); assert.equal(f.releases(), 1); assert.equal(f.leaseOpen(), false);
});
