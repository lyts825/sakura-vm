/**
 * 模块职责：回归验证模块，围绕 `service-mesh-identity` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `service-mesh-identity`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: ordinary status neither executes project code nor resolves project secrets or issues a task; explicit version check caches only the original project/config/boot and closes the complete finite task.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Project } from '../server/workspaces.ts';
const parent = process.env.SAKURA_DATA_DIR || tmpdir();
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'sakura-mesh-identity-tests-')); process.env.SAKURA_DATA_DIR = root;
const { meshIdentityFixture } = await import('./service-mesh-identity-fixture.ts');
const { ServiceMesh, meshRunSchema, envoySidecarConfig } = await import('../server/service-mesh.ts');
const { ProjectMeshScope, projectMeshScopePaths, projectServiceScopePaths, projectNotebookScopePaths,
  projectReverseTunnelScopePaths, projectMeshRecordSchema } = await import('../server/project-service-scope.ts');
const { meshControlCommand, meshInspectInput, meshConfigInput, meshProcessInput, meshEnvoyExecution,
  meshConfigPlan, meshConfigSchema } = await import('../server/service-mesh-identity.ts');
const policy = { name: 'api', listenPort: 15300, upstreamPort: 8080 };
after(async () => { assert.equal(dirname(resolve(root)), resolve(parent)); assert.match(basename(root), /^sakura-mesh-identity-tests-/);
  await rm(root, { recursive: true, force: true }); });
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: { after: (action: () => Promise<unknown>) => void }。
 * 结果：返回分支计算值（`f`），以 Promise 交付。
 * Result: Return the branch-computed value (`f`) through a Promise.
 * 协作入口 / Collaborators: `meshIdentityFixture`, `t.after`.
 */
async function fixture(t: { after: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: action: () => Promise<unknown>。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
(action: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => Promise<unknown>) => void }) {
  const f = await meshIdentityFixture(); t.after(() => f.close()); return f;
}
/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: t: { after: (action: () => Promise<unknown>) => void }。
 * 结果：返回分支计算值（`f`），以 Promise 交付。
 * Result: Return the branch-computed value (`f`) through a Promise.
 * 协作入口 / Collaborators: `fixture`, `f.mesh.action`.
 */
async function ready(t: { after: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: action: () => Promise<unknown>。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
(action: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => Promise<unknown>) => void }) {
  const f = await fixture(t); await f.mesh.action(f.id, { mode: 'save', policy }, 'run'); return f;
}
/**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: t: { after: (action: () => Promise<unknown>) => void }。
 * 结果：返回分支计算值（`f`），以 Promise 交付。
 * Result: Return the branch-computed value (`f`) through a Promise.
 * 协作入口 / Collaborators: `ready`, `f.mesh.action`.
 */
async function running(t: { after: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: action: () => Promise<unknown>。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
(action: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => Promise<unknown>) => void }) {
  const f = await ready(t); await f.mesh.action(f.id, { mode: 'start' }, 'run'); return f;
}
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: error: any。
 * 结果：返回分支计算值（`error?.status === 503`）。
 * Result: Return the branch-computed value (`error?.status === 503`).
 */
const is503 = (error: any) => error?.status === 503;
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: project: Project; id: string。
 * 结果：返回分支计算值（`Object.defineProperty(structuredClone(project), '_workspace', { value: id === 'd…`）。
 * Result: Return the branch-computed value (`Object.defineProperty(structuredClone(project), '_workspace', { value: id === 'd…`).
 * 协作入口 / Collaborators: `Object.defineProperty`, `structuredClone`.
 */
function originalScope(project: Project, id: string) {
  return Object.defineProperty(structuredClone(project), '_workspace', { value: id === 'default' ? undefined : id, enumerable: false });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: ordinary status neither executes project code nor resolves project secrets or issues a task
 * 状态影响 / State effects: `f.state.resolutionHook`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ready`, `f.mesh.status`, `assert.equal`, `f.read`.
 * 检查边界 / Checked boundaries: `assert.equal(view.envoyUsable, null)`; `assert.equal(view.version, null)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('ordinary status neither executes project code nor resolves project secrets or issues a task', async t => {
  const f = await ready(t), count = f.state.taskCalls, preparations = f.state.preparations;
  f.state.resolutionHook = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: ordinary status neither executes project code nor resolves project secrets or issues a task
   * 失败 / Failure: `new Error('status must not resolve a project environment')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw new Error('status must not resolve a project environment'); };
  const view = await f.mesh.status(f.id);
  assert.equal(view.envoyUsable, null); assert.equal(view.version, null); assert.equal(view.executed, false);
  assert.equal(f.state.taskCalls, count); assert.equal(f.state.preparations, preparations);
  assert.equal(f.state.resolutions, 0); assert.equal((await f.read()).tasks.length, 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: explicit version check caches only the original project/config/boot and closes the complete finite task
 * 状态影响 / State effects: `f.state.resolutionHook`, `f.state.bootId`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ready`, `f.mesh.action`, `assert.equal`, `f.held.get`.
 * 检查边界 / Checked boundaries: `assert.equal(view.envoyUsable, true)`; `assert.equal(view.version, 'envoy version: fixture')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('explicit version check caches only the original project/config/boot and closes the complete finite task', async t => {
  const f = await ready(t), view = await f.mesh.action(f.id, { mode: 'status' }, 'check');
  assert.equal(view.envoyUsable, true); assert.equal(view.version, 'envoy version: fixture');
  assert.equal(view.executed, false); assert.equal(f.state.taskCalls, 1); assert.equal(f.held.get('default'), 0);
  const taskEnd = f.events.indexOf('default:task-full-domain-absent'), retired = f.events.indexOf('default:task-native-ticket-retired'),
    release = f.events.indexOf('default:release');
  assert.ok(taskEnd >= 0 && taskEnd < retired && retired < release);
  f.state.resolutionHook = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: explicit version check caches only the original project/config/boot and closes the complete finite task
   * 失败 / Failure: `new Error('cached status must remain a read')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw new Error('cached status must remain a read'); };
  const status = await f.mesh.status(f.id); assert.equal(status.version, view.version); assert.equal(f.state.taskCalls, 1);
  f.state.bootId = randomUUID(); assert.equal((await f.mesh.status(f.id)).version, null); assert.equal(f.state.taskCalls, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: first private start observes the namespace created by its own preparation before executing Envoy
 * 状态影响 / State effects: `f.state.namespacePresent`, `f.state.prepareHook`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.workspaces.save`, `f.mesh.action`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(view.bindingValid, true)`; `assert.equal(f.state.starts, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('first private start observes the namespace created by its own preparation before executing Envoy', async t => {
  const f = await fixture(t);
  await f.workspaces.save(f.id, { networkIsolation: 'private' });
  await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
  f.state.namespacePresent = false;
  f.state.prepareHook = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: first private start observes the namespace created by its own preparation before executing Envoy
   * 状态影响 / State effects: `f.state.namespacePresent`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  () => { f.state.namespacePresent = true; };
  const view = await f.mesh.action(f.id, { mode: 'start' }, 'run');
  assert.equal(view.bindingValid, true); assert.equal(f.state.starts, 1);
  assert.equal(f.state.preparations, 1); assert.equal(f.state.taskCalls, 2);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: only an explicit private check prepares a missing namespace and publishes a UID compatibility sample
 * 状态影响 / State effects: `f.state.namespacePresent`, `f.state.prepareHook`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.workspaces.save`, `f.mesh.action`, `f.mesh.status`.
 * 检查边界 / Checked boundaries: `assert.equal(before.namespacePresent, false)`; `assert.equal(before.ready, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('only an explicit private check prepares a missing namespace and publishes a UID compatibility sample', async t => {
  const f = await fixture(t);
  await f.workspaces.save(f.id, { networkIsolation: 'private' });
  await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
  f.state.namespacePresent = false;
  f.state.prepareHook = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: only an explicit private check prepares a missing namespace and publishes a UID compatibility sample
   * 状态影响 / State effects: `f.state.namespacePresent`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  () => { f.state.namespacePresent = true; };
  const before = await f.mesh.status(f.id);
  assert.equal(before.namespacePresent, false); assert.equal(before.ready, false);
  assert.equal(f.state.preparations, 0); assert.equal(f.state.namespacePresent, false);
  const checked = await f.mesh.action(f.id, { mode: 'status' }, 'check');
  assert.equal(checked.namespacePresent, true); assert.equal(checked.ready, true);
  assert.equal(f.state.taskCalls, 1); assert.equal(f.state.starts, 0);
  assert.equal(f.held.get('default'), 0);
});

for (const mode of ['start', 'check'] as const) for (const field of ['boot', 'binary'] as const)
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: t。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `f.state.prepareHook`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `ready`, `assert.rejects`, `f.mesh.action`, `assert.equal`.
   * 检查边界 / Checked boundaries: `assert.rejects(f.mesh.action(f.id, { mode: mode === 'check' ? 'status' : 'start' }, mode === 'check' ? 'check' : 'run'), (error: a…`; `assert.equal(f.state.taskCalls, 0)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  test(mode + ' rejects a changed original ' + field + ' after preparation before any UID execution', async t => {
    const f = await ready(t);
    f.state.prepareHook = /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `f.state.bootId`, `f.binary.inode`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `randomUUID`.
     */
    () => {
      if (field === 'boot') f.state.bootId = randomUUID();
      else f.binary.inode = '99001';
    };
    await assert.rejects(f.mesh.action(f.id, { mode: mode === 'check' ? 'status' : 'start' }, mode === 'check' ? 'check' : 'run'),
      (error: any) => error.code === 'SERVICE_SCOPE_CHANGED');
    assert.equal(f.state.taskCalls, 0); assert.equal(f.state.starts, 0);
    assert.equal((await f.read()).tasks.length, 0); assert.equal((await f.read()).runs.length, 0);
    assert.equal(f.held.get('default'), 0);
  });
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cached Envoy compatibility becomes unknown after a system binary is replaced
 * 状态影响 / State effects: `f.binary.mtimeNs`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ready`, `f.mesh.action`, `f.mesh.status`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(view.envoyUsable, null)`; `assert.equal(view.version, null)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cached Envoy compatibility becomes unknown after a system binary is replaced', async t => {
  const f = await ready(t); await f.mesh.action(f.id, { mode: 'status' }, 'check');
  f.binary.mtimeNs = '124000'; const view = await f.mesh.status(f.id);
  assert.equal(view.envoyUsable, null); assert.equal(view.version, null); assert.equal(f.state.taskCalls, 1);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: named projects preserve a non-enumerable scope and use distinct persistent accounts and homes
 * 协作入口 / Collaborators: `fixture`, `f.workspaces.projects.create`, `ids.push`, `f.workspaces.projects.inScope`.
 * 检查边界 / Checked boundaries: `assert.notEqual(alpha.uid, beta.uid)`; `assert.notEqual(alpha.home, beta.home)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('named projects preserve a non-enumerable scope and use distinct persistent accounts and homes', async t => {
  const f = await fixture(t);
  const ids: string[] = [];
  for (const name of ['alpha', 'beta']) {
    const id = (await f.workspaces.projects.create(f.id, name, async () => {
      await f.workspaces.save(f.id, { directory: '/workspace/' + name, networkIsolation: 'private', environment: { PROJECT_VALUE: name } });
    })).active; ids.push(id);
    await f.workspaces.projects.inScope(f.id, id, async () => {
      await f.mesh.action(f.id, { mode: 'save', policy }, 'run'); await f.mesh.action(f.id, { mode: 'start' }, 'run');
    });
  }
  const [alpha, beta] = ids.map(id => f.identities.get(id)!);
  assert.notEqual(alpha.uid, beta.uid); assert.notEqual(alpha.home, beta.home);
  assert.equal(alpha.uid, alpha.gid); assert.equal(beta.uid, beta.gid);
  for (const execution of f.executions) {
    const descriptor = Object.getOwnPropertyDescriptor(execution.project, '_workspace')!;
    assert.equal(descriptor.enumerable, false); assert.ok(ids.includes(descriptor.value));
    assert.equal(execution.project.directory, '/workspace/' + execution.environment?.PROJECT_VALUE);
  }
  assert.equal(f.state.resolutions, 2, 'one resolution per start, reused by version, validation and the long-running process');
  assert.equal(f.rootLaunches.length, 2);
  assert.ok(f.rootLaunches.every(command => !command.includes('PROJECT_VALUE') && !command.includes('/workspace/')));
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: selecting a different UI project while resolving does not redirect the original scoped operation
 * 协作入口 / Collaborators: `fixture`, `f.workspaces.projects.create`, `f.workspaces.projects.inScope`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(f.running.has(alpha), true)`; `assert.equal(f.running.has(beta), false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('selecting a different UI project while resolving does not redirect the original scoped operation', async t => {
  const f = await fixture(t);
  const alpha = (await f.workspaces.projects.create(f.id, 'alpha', async () => {
    await f.workspaces.save(f.id, { directory: '/workspace/alpha', networkIsolation: 'private' });
  })).active;
  const beta = (await f.workspaces.projects.create(f.id, 'beta', async () => {
    await f.workspaces.save(f.id, { directory: '/workspace/beta', networkIsolation: 'private' });
  })).active;
  await f.workspaces.projects.inScope(f.id, alpha, async () => {
    await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
    f.state.resolutionHook = /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: selecting a different UI project while resolving does not redirect the original scoped operation
     * 协作入口 / Collaborators: `f.workspaces.projects.update`.
     */
    async () => { await f.workspaces.projects.update(f.id, beta); };
    const view = await f.mesh.action(f.id, { mode: 'start' }, 'run');
    assert.equal(view.projectId, alpha); assert.equal(view.directory, '/workspace/alpha');
  });
  assert.equal(f.running.has(alpha), true); assert.equal(f.running.has(beta), false);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: live replacement before execution rejects the original operation without following the replacement
 * 状态影响 / State effects: `f.state.resolutionHook`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ready`, `assert.rejects`, `f.mesh.action`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'))`; `assert.equal(f.state.taskCalls, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('live replacement before execution rejects the original operation without following the replacement', async t => {
  const f = await ready(t);
  f.state.resolutionHook = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: live replacement before execution rejects the original operation without following the replacement
   * 协作入口 / Collaborators: `f.machines.live.set`.
   */
  async () => { f.machines.live.set(f.id, {} as any); };
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'));
  assert.equal(f.state.taskCalls, 0); assert.equal(f.state.starts, 0); assert.equal(f.held.get('default'), 0);
  assert.equal((await f.read()).runs.length, 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a config change during resolution cannot execute a newly resolved project command
 * 状态影响 / State effects: `f.state.resolutionHook`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ready`, `assert.rejects`, `f.mesh.action`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'))`; `assert.equal(f.state.taskCalls, 0)`.
 */
test('a config change during resolution cannot execute a newly resolved project command', async t => {
  const f = await ready(t);
  f.state.resolutionHook = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: a config change during resolution cannot execute a newly resolved project command
   * 协作入口 / Collaborators: `f.workspaces.save`.
   */
  async () => { await f.workspaces.save(f.id, { environment: { CHANGED: 'new' } }); };
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'));
  assert.equal(f.state.taskCalls, 0); assert.equal(f.state.starts, 0); assert.equal(f.held.get('default'), 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a reboot retaining the same Live is rejected by the finite task original boot pin before UID execution
 * 状态影响 / State effects: `f.state.resolutionHook`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ready`, `assert.rejects`, `f.mesh.action`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'))`; `assert.equal(f.state.taskCalls, 0)`.
 */
test('a reboot retaining the same Live is rejected by the finite task original boot pin before UID execution', async t => {
  const f = await ready(t);
  f.state.resolutionHook = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: a reboot retaining the same Live is rejected by the finite task original boot pin before UID execution
   * 状态影响 / State effects: `f.state.bootId`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `randomUUID`.
   */
  async () => { f.state.bootId = randomUUID(); };
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'));
  assert.equal(f.state.taskCalls, 0); assert.equal(f.state.starts, 0); assert.equal(f.held.get('default'), 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: explicit directory migration is required and never replaced by a Root mkdir or chown fallback
 * 状态影响 / State effects: `f.state.migrationRequired`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ready`, `assert.rejects`, `f.mesh.action`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), (error: any) => error.code === 'PROJECT_DIRECTORY_MIGRATION_REQUIRED…`; `assert.equal(f.state.taskCalls, 0)`.
 */
test('explicit directory migration is required and never replaced by a Root mkdir or chown fallback', async t => {
  const f = await ready(t); f.state.migrationRequired = true;
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), (error: any) => error.code === 'PROJECT_DIRECTORY_MIGRATION_REQUIRED');
  assert.equal(f.state.taskCalls, 0); assert.equal(f.state.starts, 0); assert.equal(f.rootLaunches.length, 0);
  assert.ok(!f.commands.some(command => /mkdir|chown|--version|--mode validate/.test(command)));
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the protected payload bound is checked before any native version task or service launch
 * 协作入口 / Collaborators: `ready`, `f.workspaces.save`, `Object.fromEntries`, `Array.from`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), (error: any) => error.status === 413)`; `assert.equal(f.state.taskCalls, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('the protected payload bound is checked before any native version task or service launch', async t => {
  const f = await ready(t);
  await f.workspaces.save(f.id, { environment: Object.fromEntries(Array.from({ length: 20 }, (_, n) => ['VALUE_' + n, 'x'.repeat(4096)])) });
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), (error: any) => error.status === 413);
  assert.equal(f.state.taskCalls, 0); assert.equal(f.rootLaunches.length, 0); assert.equal(f.held.get('default'), 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: finite task output is bounded before caching a version or issuing a sidecar
 * 状态影响 / State effects: `f.state.taskOutput`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ready`, `'x'.repeat`, `assert.rejects`, `f.mesh.action`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), (error: any) => error.code === 'PROJECT_IDENTITY_RESULT_INVALID')`; `assert.equal(f.state.starts, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('finite task output is bounded before caching a version or issuing a sidecar', async t => {
  const f = await ready(t); f.state.taskOutput = 'x'.repeat(1024 * 1024 + 1);
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), (error: any) => error.code === 'PROJECT_IDENTITY_RESULT_INVALID');
  assert.equal(f.state.starts, 0); assert.equal((await f.read()).probes.length, 0);
  assert.equal((await f.read()).tasks.length, 0); assert.equal(f.held.get('default'), 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private version output and unusable-binary errors are redacted before persistence and API return
 * 状态影响 / State effects: `f.workspaces.resolveProject`, `f.state.taskOutput`, `f.state.usable`, `f.state.taskStderr`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ready`, `f.workspaces.save`, `f.mesh.action`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(!JSON.stringify(view).includes(secret))`; `assert.ok(!(await readFile(f.file, 'utf8')).includes(secret))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('private version output and unusable-binary errors are redacted before persistence and API return', async t => {
  const f = await ready(t), secret = 'mesh-secret-value-123';
  await f.workspaces.save(f.id, { secrets: { TOKEN: 'mesh-token' } });
  f.workspaces.resolveProject = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: _id; project。
   * 结果：返回分支计算值（`originalScope({ ...project, environment: { TOKEN: secret } }, project._workspace…`），以 Promise 交付。
   * Result: Return the branch-computed value (`originalScope({ ...project, environment: { TOKEN: secret } }, project._workspace…`) through a Promise.
   * 验证场景 / Scenario: private version output and unusable-binary errors are redacted before persistence and API return
   * 协作入口 / Collaborators: `originalScope`.
   */
  async (_id, project) => originalScope({ ...project, environment: { TOKEN: secret } }, project._workspace || 'default');
  f.state.taskOutput = 'envoy version ' + secret;
  const view = await f.mesh.action(f.id, { mode: 'status' }, 'check');
  assert.ok(!JSON.stringify(view).includes(secret)); assert.ok(!(await readFile(f.file, 'utf8')).includes(secret));
  f.state.usable = false; f.state.taskStderr = 'incompatible ' + secret;
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), (error: any) => !String(error).includes(secret));
  assert.ok(!(await readFile(f.file, 'utf8')).includes(secret));
});

for (const field of ['listenerChanged', 'configChanged', 'nativeChanged'] as const)
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: t。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `f.state[field]`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `running`, `readFile`, `f.mesh.status`, `assert.equal`.
   * 检查边界 / Checked boundaries: `assert.equal(view.sidecarRunning, true)`; `assert.equal(view.bindingValid, false)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  test('readonly status rejects a changed ' + field + ' without adopting it or rewriting the original run', async t => {
    const f = await running(t), before = await readFile(f.file, 'utf8'), tasks = f.state.taskCalls;
    f.state[field] = true; const view = await f.mesh.status(f.id);
    assert.equal(view.sidecarRunning, true); assert.equal(view.bindingValid, false); assert.equal(view.ready, false);
    assert.equal(f.state.taskCalls, tasks); assert.equal(await readFile(f.file, 'utf8'), before);
  });
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an Envoy orphan is retained until the original complete domain, including detached descendants, is stopped
 * 状态影响 / State effects: `f.running.get('default')!.orphan`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `running`, `f.running.get`, `assert.equal`, `f.mesh.status`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.mesh.status(f.id)).bindingValid, false)`; `assert.deepEqual([...f.members.get(runId)!], [1234, 5555, 5556])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('an Envoy orphan is retained until the original complete domain, including detached descendants, is stopped', async t => {
  const f = await running(t); f.running.get('default')!.orphan = true;
  assert.equal((await f.mesh.status(f.id)).bindingValid, false);
  const row = (await f.read()).runs[0], runId = row.execution.record.runId;
  assert.deepEqual([...f.members.get(runId)!], [1234, 5555, 5556]);
  await f.mesh.action(f.id, { mode: 'stop' }, 'run');
  assert.equal(f.members.has(runId), false); assert.equal(f.tickets.get(runId)!.phase, 'closed');
  assert.equal((await f.read()).runs.length, 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: host reload reads full original tickets and keeps persistent sidecars without new tasks or launches
 * 协作入口 / Collaborators: `running`, `readFile`, `f.restart`, `f.mesh.status`.
 * 检查边界 / Checked boundaries: `assert.equal(view.bindingValid, true)`; `assert.equal(f.state.taskCalls, tasks)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('host reload reads full original tickets and keeps persistent sidecars without new tasks or launches', async t => {
  const f = await running(t), before = await readFile(f.file, 'utf8'), tasks = f.state.taskCalls, launches = f.state.starts;
  await f.restart(); const view = await f.mesh.status(f.id);
  assert.equal(view.bindingValid, true); assert.equal(f.state.taskCalls, tasks); assert.equal(f.state.starts, launches);
  assert.equal(await readFile(f.file, 'utf8'), before);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a new boot cannot reuse the old sidecar label or silently retire the original run
 * 状态影响 / State effects: `f.state.bootId`, `f.state.coldBootBlocked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `running`, `f.read`, `randomUUID`, `f.mesh.status`.
 * 检查边界 / Checked boundaries: `assert.equal(view.sidecarRunning, true)`; `assert.equal(view.bindingValid, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a new boot cannot reuse the old sidecar label or silently retire the original run', async t => {
  const f = await running(t), row = (await f.read()).runs[0];
  f.state.bootId = randomUUID(); f.state.coldBootBlocked = true;
  const view = await f.mesh.status(f.id); assert.equal(view.sidecarRunning, true); assert.equal(view.bindingValid, false);
  assert.equal((await f.read()).runs[0].execution.record.bootId, row.execution.record.bootId);
  await assert.rejects(f.mesh.action(f.id, { mode: 'stop' }, 'run'), is503);
  assert.equal(f.running.has('default'), true); assert.equal(f.tickets.get(row.execution.record.runId)!.phase, 'active');
  f.state.coldBootBlocked = false; await f.mesh.action(f.id, { mode: 'stop' }, 'run');
  assert.equal((await f.read()).runs.length, 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed full-domain stop retains the record and fixed configuration and returns 503 until a confirmed retry
 * 状态影响 / State effects: `f.state.cleanupFailures`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `running`, `f.read`, `assert.rejects`, `f.mesh.action`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.mesh.action(f.id, { mode: 'stop' }, 'run'), is503)`; `assert.equal((await f.read()).runs[0].phase, 'stopping')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('failed full-domain stop retains the record and fixed configuration and returns 503 until a confirmed retry', async t => {
  const f = await running(t), original = (await f.read()).runs[0]; f.state.cleanupFailures = 1;
  await assert.rejects(f.mesh.action(f.id, { mode: 'stop' }, 'run'), is503);
  assert.equal((await f.read()).runs[0].phase, 'stopping'); assert.equal(f.members.has(original.execution.record.runId), true);
  assert.equal(f.configs.has(original.execution.record.runId), true); assert.equal(f.tickets.get(original.execution.record.runId)!.phase, 'active');
  await f.mesh.action(f.id, { mode: 'stop' }, 'run'); assert.equal((await f.read()).runs.length, 0);
  assert.ok(f.events.indexOf('default:full-domain-absent') < f.events.indexOf('default:config-retired'));
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: launch ACK loss and failed rollback retain the pending preparation even before ready listener publication
 * 状态影响 / State effects: `f.state.launchAckFailures`, `f.state.cleanupFailures`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ready`, `assert.rejects`, `f.mesh.action`, `f.read`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), is503)`; `assert.equal(row.phase, 'stopping')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('launch ACK loss and failed rollback retain the pending preparation even before ready listener publication', async t => {
  const f = await ready(t); f.state.launchAckFailures = 1; f.state.cleanupFailures = 1;
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), is503);
  const row = (await f.read()).runs[0];
  assert.equal(row.phase, 'stopping'); assert.equal(row.listener, null); assert.equal(row.execution.record.phase, 'intent');
  assert.equal(f.held.get('default'), 1); assert.equal(f.configs.has(row.execution.record.runId), true);
  assert.equal(f.running.has('default'), true);
  await f.mesh.action(f.id, { mode: 'stop' }, 'run');
  assert.equal(f.held.get('default'), 0); assert.equal((await f.read()).runs.length, 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a lost fixed configuration publication ACK keeps its original receipt until cleanup succeeds
 * 状态影响 / State effects: `f.state.configFailures`, `f.state.configCleanupFailures`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ready`, `assert.rejects`, `f.mesh.action`, `f.read`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), is503)`; `assert.equal(row.config, null)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a lost fixed configuration publication ACK keeps its original receipt until cleanup succeeds', async t => {
  const f = await ready(t); f.state.configFailures = 1; f.state.configCleanupFailures = 1;
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), is503);
  const row = (await f.read()).runs[0]; assert.equal(row.config, null); assert.equal(f.configs.has(row.execution.record.runId), true);
  assert.equal(f.state.starts, 0); assert.equal(f.held.get('default'), 1);
  await f.mesh.action(f.id, { mode: 'stop' }, 'run'); assert.equal(f.configs.size, 0); assert.equal(f.held.get('default'), 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: finite validator cleanup failure preserves config and the separate original task ticket, not merely the service intent
 * 状态影响 / State effects: `f.state.taskFailOnCall`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ready`, `assert.rejects`, `f.mesh.action`, `f.read`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), is503)`; `assert.equal(task.owner.kind, 'task')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('finite validator cleanup failure preserves config and the separate original task ticket, not merely the service intent', async t => {
  const f = await ready(t); f.state.taskFailOnCall = 2;
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), is503);
  const saved = await f.read(), row = saved.runs[0], task = saved.tasks[0];
  assert.equal(task.owner.kind, 'task'); assert.equal(task.identity.identityId, row.execution.identity.identityId);
  assert.notEqual(task.owner.runId, row.execution.record.runId); assert.equal(f.finiteMembers.has(task.owner.runId), true);
  assert.equal(f.configs.has(row.execution.record.runId), true); assert.equal(f.state.starts, 0); assert.equal(f.held.get('default'), 1);
  await assert.rejects(f.mesh.action(f.id, { mode: 'stop' }, 'run'), is503); assert.equal(f.configs.size, 1);
  f.finiteMembers.clear(); await f.mesh.action(f.id, { mode: 'stop' }, 'run');
  assert.equal((await f.read()).tasks.length, 0); assert.equal((await f.read()).runs.length, 0);
  assert.equal(f.configs.size, 0); assert.equal(f.held.get('default'), 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a failed version task retains its preparation and durable task ticket before any long-running service intent exists
 * 状态影响 / State effects: `f.state.taskCleanupFailures`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ready`, `assert.rejects`, `f.mesh.action`, `f.read`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.mesh.action(f.id, { mode: 'status' }, 'check'), is503)`; `assert.equal(saved.runs.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a failed version task retains its preparation and durable task ticket before any long-running service intent exists', async t => {
  const f = await ready(t); f.state.taskCleanupFailures = 1;
  await assert.rejects(f.mesh.action(f.id, { mode: 'status' }, 'check'), is503);
  const saved = await f.read(); assert.equal(saved.runs.length, 0); assert.equal(saved.tasks.length, 1);
  assert.equal(f.held.get('default'), 1); assert.equal((await f.mesh.status(f.id)).ready, false);
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), /先停止/);
  f.finiteMembers.clear(); await f.mesh.action(f.id, { mode: 'stop' }, 'run');
  assert.equal((await f.read()).tasks.length, 0); assert.equal(f.held.get('default'), 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a changed finite-task host receipt cannot authorize retirement or configuration deletion
 * 状态影响 / State effects: `f.state.taskFailOnCall`, `ticket.sha256`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ready`, `assert.rejects`, `f.mesh.action`, `f.read`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), is503)`; `assert.rejects(f.mesh.action(f.id, { mode: 'stop' }, 'run'), is503)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a changed finite-task host receipt cannot authorize retirement or configuration deletion', async t => {
  const f = await ready(t); f.state.taskFailOnCall = 2;
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), is503);
  const task = (await f.read()).tasks[0], ticket = f.finiteTickets.get(task.owner.runId)!;
  f.finiteMembers.clear(); const sha256 = ticket.sha256; ticket.sha256 = 'e'.repeat(64);
  await assert.rejects(f.mesh.action(f.id, { mode: 'stop' }, 'run'), is503); assert.equal(f.configs.size, 1);
  assert.equal((await f.read()).tasks.length, 1); ticket.sha256 = sha256;
  await f.mesh.action(f.id, { mode: 'stop' }, 'run'); assert.equal(f.held.get('default'), 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: preparation release failures remain 503 and retain a retryable original run after confirmed process cleanup
 * 状态影响 / State effects: `f.state.releaseFailures`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ready`, `assert.rejects`, `f.mesh.action`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), is503)`; `assert.equal(f.running.size, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('preparation release failures remain 503 and retain a retryable original run after confirmed process cleanup', async t => {
  const f = await ready(t); f.state.releaseFailures = 2;
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), is503);
  assert.equal(f.running.size, 0); assert.equal(f.members.size, 0); assert.equal((await f.read()).runs[0].phase, 'stopping');
  assert.equal(f.held.get('default'), 1);
  await f.mesh.action(f.id, { mode: 'stop' }, 'run'); assert.equal(f.held.get('default'), 0); assert.equal((await f.read()).runs.length, 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: abort preserves the cancellation result after the original finite task fully cleans up, with no Root fallback
 * 状态影响 / State effects: `f.state.taskHook`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ready`, `assert.rejects`, `f.mesh.action`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run', controller.signal), (error: any) => error.name === 'AbortError')`; `assert.equal(f.state.starts, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('abort preserves the cancellation result after the original finite task fully cleans up, with no Root fallback', async t => {
  const f = await ready(t), controller = new AbortController(); f.state.taskHook = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`controller.abort()`），以 Promise 交付。
   * Result: Return the branch-computed value (`controller.abort()`) through a Promise.
   * 验证场景 / Scenario: abort preserves the cancellation result after the original finite task fully cleans up, with no Root fallback
   * 协作入口 / Collaborators: `controller.abort`.
   */
  async () => controller.abort();
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run', controller.signal), (error: any) => error.name === 'AbortError');
  assert.equal(f.state.starts, 0); assert.equal(f.held.get('default'), 0); assert.equal(f.finiteMembers.size, 0);
  assert.equal((await f.read()).tasks.length, 0); assert.equal(f.rootLaunches.length, 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy root or unknown scoped processes are reported for administrator review and never stopped or adopted
 * 状态影响 / State effects: `f.state.unknownScope`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ready`, `f.state.legacyRunning.add`, `f.mesh.status`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(current.sidecarRunning, true)`; `assert.equal(current.ready, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('legacy root or unknown scoped processes are reported for administrator review and never stopped or adopted', async t => {
  const f = await ready(t); f.state.legacyRunning.add('default');
  const current = await f.mesh.status(f.id); assert.equal(current.sidecarRunning, true); assert.equal(current.ready, false);
  assert.match(current.reason!, /root|未知/); await assert.rejects(f.mesh.action(f.id, { mode: 'stop' }, 'run'), /管理员/);
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), /管理员/);
  assert.equal(f.state.legacyRunning.has('default'), true); assert.equal(f.state.taskCalls, 0);
  f.state.legacyRunning.clear(); f.state.unknownScope = true;
  await assert.rejects(f.mesh.action(f.id, { mode: 'stop' }, 'run'), /管理员/); assert.equal(f.state.starts, 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: environment changes mark the old process unready but explicit stop uses only its original protected config and ticket
 * 状态影响 / State effects: `f.state.resolutionHook`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `running`, `f.read`, `f.workspaces.save`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.mesh.status(f.id)).bindingValid, false)`; `assert.equal(f.state.resolutions, resolutions)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('environment changes mark the old process unready but explicit stop uses only its original protected config and ticket', async t => {
  const f = await running(t), row = (await f.read()).runs[0];
  await f.workspaces.save(f.id, { environment: { CHANGED_ENV: 'new' } });
  assert.equal((await f.mesh.status(f.id)).bindingValid, false);
  f.state.resolutionHook = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: environment changes mark the old process unready but explicit stop uses only its original protected config and ticket
   * 失败 / Failure: `new Error('stop cannot resolve replacement config/environment')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw new Error('stop cannot resolve replacement config/environment'); };
  const resolutions = f.state.resolutions; await f.mesh.action(f.id, { mode: 'stop' }, 'run');
  assert.equal(f.state.resolutions, resolutions); assert.equal(f.tickets.get(row.execution.record.runId)!.phase, 'closed');
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: externally changed host metadata is not overwritten from a stale in-memory facade
 * 状态影响 / State effects: `saved.probes[0].version`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `running`, `f.read`, `JSON.stringify`, `writeFile`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.mesh.status(f.id))`; `assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('externally changed host metadata is not overwritten from a stale in-memory facade', async t => {
  const f = await running(t), saved = await f.read();
  saved.probes[0].version = 'external administrator sample'; const external = JSON.stringify(saved);
  await writeFile(f.file, external); await assert.rejects(f.mesh.status(f.id));
  await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run')); assert.equal(await readFile(f.file, 'utf8'), external);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Mesh owns a distinct namespace and receipt while reusing only the existing service domain policy
 * 协作入口 / Collaborators: `ready`, `f.workspaces.config`, `projectMeshScopePaths`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(paths.guest, '/run/sakura-project-mesh/default')`; `assert.equal(paths.session, 'sakura-mesh-uid-default')`.
 */
test('Mesh owns a distinct namespace and receipt while reusing only the existing service domain policy', async t => {
  const f = await ready(t), project = await f.workspaces.config(f.id), scope = new ProjectMeshScope(f.machines, f.id, project);
  const paths = projectMeshScopePaths(project);
  assert.equal(paths.guest, '/run/sakura-project-mesh/default'); assert.equal(paths.session, 'sakura-mesh-uid-default');
  assert.notEqual(paths.guest, projectServiceScopePaths(project, 'mesh').guest);
  assert.notEqual(paths.guest, projectNotebookScopePaths(project).guest);
  assert.notEqual(paths.guest, projectReverseTunnelScopePaths(project).guest);
  assert.match(scope.receipt().replaceAll('\\', '/'), /project-mesh\/default\/runtime.json$/);
  const intent = scope.newIntent('a'.repeat(64), f.state.bootId); assert.equal(intent.scopeName, 'sakura-service-' + intent.runId);
  assert.equal(projectMeshRecordSchema.safeParse({ ...intent, session: 'sakura-service-mesh' }).success, false);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a full Mesh ticket refuses a substituted account, original config digest or listener port
 * 协作入口 / Collaborators: `running`, `f.read`, `assert.equal`, `meshRunSchema.safeParse`.
 * 检查边界 / Checked boundaries: `assert.equal(meshRunSchema.safeParse(row).success, true)`; `assert.equal(meshRunSchema.safeParse({ ...row, plan: { ...row.plan, uid: row.plan.uid + 1 } }).success, false)`.
 */
test('a full Mesh ticket refuses a substituted account, original config digest or listener port', async t => {
  const f = await running(t), row = (await f.read()).runs[0]; assert.equal(meshRunSchema.safeParse(row).success, true);
  assert.equal(meshRunSchema.safeParse({ ...row, plan: { ...row.plan, uid: row.plan.uid + 1 } }).success, false);
  assert.equal(meshRunSchema.safeParse({ ...row, config: { ...row.config, sha256: 'c'.repeat(64) } }).success, false);
  assert.equal(meshRunSchema.safeParse({ ...row, listener: { ...row.listener, port: 9999 } }).success, false);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Root config metadata uses bounded stdin frames and a fixed command while all project execution remains in UID frames
 * 协作入口 / Collaborators: `running`, `f.read`, `f.workspaces.config`, `JSON.stringify`.
 * 检查边界 / Checked boundaries: `assert.equal('name' in plan, false)`; `assert.equal('updatedAt' in plan, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('Root config metadata uses bounded stdin frames and a fixed command while all project execution remains in UID frames', async t => {
  const f = await running(t), row = (await f.read()).runs[0], project = await f.workspaces.config(f.id);
  const source = JSON.stringify(envoySidecarConfig(policy));
  const plan = meshConfigPlan(row.execution.identity, row.execution.record, source, { ...policy, updatedAt: 'ignored' } as any);
  assert.equal('name' in plan, false); assert.equal('updatedAt' in plan, false);
  assert.equal(plan.sha256, createHash('sha256').update(source).digest('hex'));
  const inspect = meshInspectInput(project), publish = meshConfigInput('publish', plan, null, source),
    probe = meshProcessInput(plan, row.config, row.binary, row.execution.identity, row.execution.run, row.listener);
  for (const frame of [inspect, publish, probe]) {
    assert.equal(frame.subarray(0, 8).toString(), 'SKMESH01'); assert.ok(frame.readUInt32LE(8) <= 8192);
  }
  assert.ok(!meshControlCommand.includes(project.directory)); assert.ok(!meshControlCommand.includes(row.execution.identity.identityId));
  assert.ok(!meshControlCommand.includes('os.execv')); assert.match(meshControlCommand, /HOME=\/ /);
  assert.match(meshEnvoyExecution(row.binary, row.config), /os.execv/);
  const config = meshConfigSchema.parse(row.config); assert.equal(config.gid, row.execution.identity.gid);
  assert.equal(f.frames[0].readUInt32LE(12), 0); assert.equal(f.frames[0].subarray(0, 8).toString(), 'SKIDP001');
});
