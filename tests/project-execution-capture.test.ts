/**
 * 模块职责：回归验证模块，围绕 `project-execution-capture` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-execution-capture`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: project exec resolves the captured non-enumerable config once and pins its original Live for native admission; malformed captured lease scope/hash/Live is refused before environment resolution or execution.
 */
import type { ProjectPreparationV1 } from '../server/service-contracts/v1.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectExecution } from '../server/project-execution.ts';

import { AppError } from '../server/model.ts';
import { projectIdentityPayload } from '../server/project-identity.ts';
import {
  syscallIdentityFixture as fixture,
  syscallVmId as id,
  syscallProjectId as projectId,
  copySyscallProject,
} from './helpers/syscall-identity.ts';

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `service, run`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `service, run`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `fixture`.
 */
function setup() {
  const f = fixture();
  const terminals = { workspaces: f.workspaces, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: [vm, project, signal, options]: Parameters<ProjectPreparationV1['prepareTask']>。
   * 结果：返回分支计算值（`f.manager.prepare(vm, project, null, false, signal, undefined, { ...options, mod…`）。
   * Result: Return the branch-computed value (`f.manager.prepare(vm, project, null, false, signal, undefined, { ...options, mod…`).
   * 协作入口 / Collaborators: `f.manager.prepare`.
   */
  prepareTask: (...[vm, project, signal, options]: Parameters<ProjectPreparationV1['prepareTask']>) =>
    f.manager.prepare(vm, project, null, false, signal, undefined, { ...options, mode: 'task' }) };
  const service = new ProjectExecution(f.machines, terminals, (...args) => f.options.runProjectTask!(...args));
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: command = 'UID_TEST_MARKER'; requested = projectId; signal = f.abort.signal。
   * 结果：返回分支计算值（`service.run(id, { command, timeoutSeconds: 30 }, requested, signal)`）。
   * Result: Return the branch-computed value (`service.run(id, { command, timeoutSeconds: 30 }, requested, signal)`).
   * 协作入口 / Collaborators: `service.run`.
   */
  const run = (command = 'UID_TEST_MARKER', requested = projectId, signal = f.abort.signal) =>
    service.run(id, { command, timeoutSeconds: 30 }, requested, signal);
  return { ...f, service, run };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: project exec resolves the captured non-enumerable config once and pins its original Live for native admission
 * 协作入口 / Collaborators: `setup`, `f.run`, `assert.equal`, `f.resolves`.
 * 检查边界 / Checked boundaries: `assert.equal(result.scope, 'project')`; `assert.equal(result.code, 7)`.
 */
test('project exec resolves the captured non-enumerable config once and pins its original Live for native admission', async () => {
  const f = setup(), result = await f.run();
  assert.equal(result.scope, 'project'); assert.equal(result.code, 7);
  assert.equal(result.stdout, '[私密配置已隐藏] output'); assert.equal(f.resolves(), 1);
  const [, , project, execution, , , timeout, , , pins] = f.launches[0];
  assert.equal(project._workspace, projectId); assert.equal(Object.getOwnPropertyDescriptor(project, '_workspace')?.enumerable, false);
  assert.equal(pins?.expectedLive, f.live); assert.equal(execution.environment?.TOKEN, 'seccomp-private-value');
  assert.equal(execution.command, 'UID_TEST_MARKER'); assert.equal(timeout, 30000);
  assert.ok(projectIdentityPayload(execution).input.includes(Buffer.from('UID_TEST_MARKER')));
  assert.deepEqual(f.rootCommands, []);
  assert.deepEqual(f.events, ['prepare', 'uid-start', 'domain-stopped', 'native-closed', 'release']);
  await f.service.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: malformed captured lease scope/hash/Live is refused before environment resolution or execution
 * 状态影响 / State effects: `f.manager.prepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `setup`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.launches.length, 0)`.
 */
test('malformed captured lease scope/hash/Live is refused before environment resolution or execution', async () => {
  for (const corrupt of [
    (lease: any) => { lease.captured = undefined; },
    (lease: any) => { lease.captured.live = {}; },
    (lease: any) => { lease.captured.configVersion = '0'.repeat(64); },
    (lease: any) => { lease.captured.project = copySyscallProject(lease.captured.project, 'fedcba9876543210'); },
  ]) {
    const f = setup(), prepare = f.manager.prepare;
    f.manager.prepare = /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`lease`），以 Promise 交付。
     * Result: Return the branch-computed value (`lease`) through a Promise.
     * 验证场景 / Scenario: malformed captured lease scope/hash/Live is refused before environment resolution or execution
     * 协作入口 / Collaborators: `prepare`, `corrupt`.
     */
    async (...args) => { const lease = await prepare(...args); corrupt(lease); return lease; };
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.launches.length, 0); assert.equal(f.resolves(), 0); assert.equal(f.releases(), 1);
    await f.service.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: changing Live during preparation cannot redirect a request to the replacement guest
 * 状态影响 / State effects: `f.manager.prepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `setup`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.launches.length, 0)`.
 */
test('changing Live during preparation cannot redirect a request to the replacement guest', async () => {
  const f = setup(), prepare = f.manager.prepare;
  f.manager.prepare = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`lease`），以 Promise 交付。
   * Result: Return the branch-computed value (`lease`) through a Promise.
   * 验证场景 / Scenario: changing Live during preparation cannot redirect a request to the replacement guest
   * 协作入口 / Collaborators: `prepare`, `f.machines.live.set`.
   */
  async (...args) => { const lease = await prepare(...args); f.machines.live.set(id, {} as any); return lease; };
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); await f.service.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: environment resolution cannot change the captured config, scope or original live
 * 状态影响 / State effects: `f.workspaces.resolveProject`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `setup`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.launches.length, 0)`.
 */
test('environment resolution cannot change the captured config, scope or original live', async () => {
  for (const change of ['config', 'scope', 'live']) {
    const f = setup(), resolve = f.workspaces.resolveProject;
    f.workspaces.resolveProject = /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`value`），以 Promise 交付。
     * Result: Return the branch-computed value (`value`) through a Promise.
     * 验证场景 / Scenario: environment resolution cannot change the captured config, scope or original live
     * 状态影响 / State effects: `f.project.environment`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `resolve`, `f.forceScope`, `f.machines.live.set`.
     */
    async (...args) => {
      const value = await resolve(...args);
      if (change === 'config') f.project.environment = { MODE: 'changed' };
      if (change === 'scope') f.forceScope();
      if (change === 'live') f.machines.live.set(id, {} as any);
      return value;
    };
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); await f.service.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a configuration returned from another original scope is refused even with the same JSON version
 * 状态影响 / State effects: `f.workspaces.config`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `setup`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.launches.length, 0)`.
 */
test('a configuration returned from another original scope is refused even with the same JSON version', async () => {
  const f = setup(); f.workspaces.config = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`copySyscallProject(f.project, 'fedcba9876543210')`），以 Promise 交付。
   * Result: Return the branch-computed value (`copySyscallProject(f.project, 'fedcba9876543210')`) through a Promise.
   * 验证场景 / Scenario: a configuration returned from another original scope is refused even with the same JSON version
   * 协作入口 / Collaborators: `copySyscallProject`.
   */
  async () => copySyscallProject(f.project, 'fedcba9876543210');
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.launches.length, 0); await f.service.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: changed original Live at task completion cannot publish stale stdout or successful results
 * 状态影响 / State effects: `f.options.runProjectTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `setup`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.releases(), 1)`.
 */
test('changed original Live at task completion cannot publish stale stdout or successful results', async () => {
  const f = setup(), run = f.options.runProjectTask!;
  f.options.runProjectTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 验证场景 / Scenario: changed original Live at task completion cannot publish stale stdout or successful results
   * 协作入口 / Collaborators: `run`, `f.machines.live.set`.
   */
  async (...args) => { const result = await run(...args); f.machines.live.set(id, {} as any); return result; };
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.releases(), 1); await f.service.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: body plus captured environment beyond the native boundary returns 413 without issuing a command
 * 协作入口 / Collaborators: `setup`, `assert.rejects`, `f.run`, `'x'.repeat`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run('x'.repeat(65536)), (error: any) => error.status === 413 && error.code === 'PROJECT_IDENTITY_PAYLOAD_INVALID'…`; `assert.equal(f.launches.length, 0)`.
 */
test('body plus captured environment beyond the native boundary returns 413 without issuing a command', async () => {
  const f = setup();
  await assert.rejects(f.run('x'.repeat(65536)), (error: any) => error.status === 413 && error.code === 'PROJECT_IDENTITY_PAYLOAD_INVALID');
  assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); await f.service.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a preparation cancellation is applied before project command launch
 * 状态影响 / State effects: `f.manager.prepare`, `f.workspaces.resolveProject`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `setup`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), error => error === abort.signal.reason)`; `assert.equal(f.launches.length, 0)`.
 */
test('a preparation cancellation is applied before project command launch', async () => {
  const f = setup(), prepare = f.manager.prepare, abort = new AbortController();
  f.manager.prepare = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回受控对象，公开字段包括 `signal`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `signal`; the actual branch determines its shape.
   * 验证场景 / Scenario: a preparation cancellation is applied before project command launch
   * 协作入口 / Collaborators: `prepare`.
   */
  async (...args) => { const lease = await prepare(...args); return { ...lease, signal: abort.signal }; };
  const resolve = f.workspaces.resolveProject;
  f.workspaces.resolveProject = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 验证场景 / Scenario: a preparation cancellation is applied before project command launch
   * 协作入口 / Collaborators: `resolve`, `abort.abort`.
   */
  async (...args) => { const result = await resolve(...args); abort.abort(); return result; };
  await assert.rejects(f.run(), error => error === abort.signal.reason);
  assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); await f.service.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the response waits for an asynchronous lease release after complete task closure
 * 状态影响 / State effects: `f.manager.prepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `setup`, `f.run().then`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(returned, false)`; `assert.equal(f.releases(), 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('the response waits for an asynchronous lease release after complete task closure', async () => {
  const f = setup(), prepare = f.manager.prepare; let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, finish!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, returned = false;
  const releasing = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { finish = resolve; });
  f.manager.prepare = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`lease`），以 Promise 交付。
   * Result: Return the branch-computed value (`lease`) through a Promise.
   * 验证场景 / Scenario: the response waits for an asynchronous lease release after complete task closure
   * 状态影响 / State effects: `lease.release`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `prepare`.
   */
  async (...args) => {
    const lease = await prepare(...args), release = lease.release;
    lease.release = /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: the response waits for an asynchronous lease release after complete task closure
     * 协作入口 / Collaborators: `entered`, `release`.
     */
    async () => { entered(); await gate; await release(); }; return lease;
  };
  const operation = f.run().then(result => { returned = true; return result; }); await releasing;
  assert.equal(returned, false); assert.equal(f.releases(), 0); assert.ok(f.events.includes('native-closed'));
  finish(); await operation; assert.equal(returned, true); assert.equal(f.releases(), 1); await f.service.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an unconfirmed lease release prevents a successful command response
 * 状态影响 / State effects: `f.manager.prepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `setup`, `assert.rejects`, `f.run`, `f.service.close`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), error => error === failure)`.
 */
test('an unconfirmed lease release prevents a successful command response', async () => {
  const f = setup(), prepare = f.manager.prepare, failure = new AppError('lease cleanup unknown', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  f.manager.prepare = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`lease`），以 Promise 交付。
   * Result: Return the branch-computed value (`lease`) through a Promise.
   * 验证场景 / Scenario: an unconfirmed lease release prevents a successful command response
   * 状态影响 / State effects: `lease.release`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `prepare`.
   */
  async (...args) => {
    const lease = await prepare(...args), release = lease.release;
    lease.release = /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: an unconfirmed lease release prevents a successful command response
     * 失败 / Failure: `failure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `release`.
     */
    async () => { await release(); throw failure; }; return lease;
  };
  await assert.rejects(f.run(), error => error === failure); await f.service.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: native and preparation cleanup failures retain the original 503 code and all causes
 * 状态影响 / State effects: `f.options.runProjectTask`, `f.manager.prepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `setup`, `assert.rejects`, `f.run`, `f.service.close`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => { assert.ok(error instanceof AppError); assert.equal(error.status, 503); assert.equal(erro…`.
 */
test('native and preparation cleanup failures retain the original 503 code and all causes', async () => {
  const f = setup(), prepare = f.manager.prepare, native = new AppError('original domain populated', 503, 'GUEST_TASK_CLEANUP_FAILED');
  const failure = new Error('release failed');
  f.options.runProjectTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: native and preparation cleanup failures retain the original 503 code and all causes
   * 失败 / Failure: `native`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw native; };
  f.manager.prepare = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`lease`），以 Promise 交付。
   * Result: Return the branch-computed value (`lease`) through a Promise.
   * 验证场景 / Scenario: native and preparation cleanup failures retain the original 503 code and all causes
   * 状态影响 / State effects: `lease.release`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `prepare`.
   */
  async (...args) => {
    const lease = await prepare(...args), release = lease.release;
    lease.release = /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: native and preparation cleanup failures retain the original 503 code and all causes
     * 失败 / Failure: `failure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `release`.
     */
    async () => { await release(); throw failure; }; return lease;
  };
  await assert.rejects(f.run(), (error: any) => {
    assert.ok(error instanceof AppError); assert.equal(error.status, 503); assert.equal(error.code, native.code);
    assert.equal(error.cause, native); assert.deepEqual((error as any).errors, [native, failure]); return true;
  });
  await f.service.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: service close waits for pending full-domain cleanup and surfaces its original 503
 * 状态影响 / State effects: `f.options.runProjectTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `setup`, `f.run`, `assert.rejects`, `f.service.close`.
 * 检查边界 / Checked boundaries: `assert.rejects(operation, error => error === native)`; `assert.equal(f.service.close(), closing)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('service close waits for pending full-domain cleanup and surfaces its original 503', async () => {
  const f = setup(), native = new AppError('original domain unknown', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, finish!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { finish = resolve; });
  f.options.runProjectTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: service close waits for pending full-domain cleanup and surfaces its original 503
   * 失败 / Failure: `native`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `entered`.
   */
  async (...args) => {
    entered(); await new Promise<void>(resolve => args[4].addEventListener('abort', () => resolve(), { once: true }));
    await gate; throw native;
  };
  const operation = f.run(), rejected = assert.rejects(operation, error => error === native); await ready;
  const closing = f.service.close(); assert.equal(f.service.close(), closing);
  const closeRejected = assert.rejects(closing, error => error === native);
  assert.equal(f.releases(), 0); finish(); await rejected; await closeRejected; assert.equal(f.releases(), 1);
});
