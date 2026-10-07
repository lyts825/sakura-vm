/**
 * 模块职责：回归验证模块，围绕 `input-method-project` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `input-method-project`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: queued IME work keeps its original project after the user selects another project; a replacement live is refused before a queued IME operation can start.
 */
import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PluginContext } from '../server/plugin-api.ts';
import type { JobView } from '../server/jobs.ts';

const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, 'sakura-ime-project-'));
process.env.SAKURA_DATA_DIR = root;
const { Jobs } = await import('../server/jobs.ts');
const { AppError } = await import('../server/model.ts');
const { activate, installIme } = await import('../plugins/desktop/server.ts');
const { pluginCapabilities } = await import('../server/plugin-capabilities.ts');
const { PluginScope } = await import('../server/plugin-scope.ts');
after(async () => {
  const owned = await realpath(root);
  assert.equal(dirname(owned), parent); assert.match(basename(owned), /^sakura-ime-project-/);
  await rm(owned, { recursive: true, force: true });
});

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
/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: this: object; reference: { pluginId: string; key: string }。
 * 结果：返回分支计算值（`Reflect.get(this, reference.key)`）。
 * Result: Return the branch-computed value (`Reflect.get(this, reference.key)`).
 * 协作入口 / Collaborators: `assert.equal`, `Reflect.get`.
 * 检查边界 / Checked boundaries: `assert.equal(reference.pluginId, owners[reference.key])`.
 */
function resolveService(this: object, reference: { pluginId: string; key: string }) {
  const owners: Record<string, string> = { workspaces: 'projects', desktops: 'desktop', jobs: 'desktop',
    x11Clipboard: 'desktop', waylandClipboard: 'desktop' };
  assert.equal(reference.pluginId, owners[reference.key]);
  return Reflect.get(this, reference.key);
}
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: TestContext。
 * 结果：返回受控对象，公开字段包括 `id, host, desktops, jobs, workspaces, live, calls, select`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, host, desktops, jobs, workspaces, live, calls, select`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `Object.assign`, `t.after`.
 */
function fixture(t: TestContext) {
  const id = randomUUID(), context = new AsyncLocalStorage<string>();
  let selected = 'alpha';
  const live = new Map([[id, { status: 'running', startedAt: 'original-boot' }]]), calls: string[] = [];
  const jobs = new Jobs();
  const workspaces = { projects: {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`context.getStore() || selected`）。
     * Result: Return the branch-computed value (`context.getStore() || selected`).
     * 协作入口 / Collaborators: `context.getStore`.
     */
    current: () => context.getStore() || selected,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; project: string; action: () => Promise<T>。
     * 结果：返回分支计算值（`context.run(project, action)`）。
     * Result: Return the branch-computed value (`context.run(project, action)`).
     * 协作入口 / Collaborators: `context.run`.
     */
    inScope: <T>(_id: string, project: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<T>) => context.run(project, action),
  } };
  const machines = Object.assign(new EventEmitter(), { live,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`live.get(id)?.status || 'stopped'`）。
     * Result: Return the branch-computed value (`live.get(id)?.status || 'stopped'`).
     * 协作入口 / Collaborators: `live.get`.
     */
    state: () => live.get(id)?.status || 'stopped',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('The IME route must use the Desktop lifecycle')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    exec: () => { throw new Error('The IME route must use the Desktop lifecycle'); },
  });
  const desktops = { /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: _id: string; signal: AbortSignal; log: (text: string) => void。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `signal.throwIfAborted`, `calls.push`, `workspaces.projects.current`, `log`.
   */
  installIme: async (_id: string, signal: AbortSignal,
    log: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: text: string。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (text: string) => void) => {
      signal.throwIfAborted(); calls.push(workspaces.projects.current()); log('安装完成\n');
      return { code: 0, stdout: '', stderr: '' };
    } };
  const host = { vm: machines, workspaces, jobs, desktops, use: resolveService, optional: resolveService } as unknown as PluginContext;
  t.after(() => jobs.close());
  return { id, host, desktops, jobs, workspaces, live, calls, /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: project: string。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `selected`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  select: (project: string) => { selected = project; } };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: queued IME work keeps its original project after the user selects another project
 * 状态影响 / State effects: `f.jobs.flush`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `gate`, `f.jobs.flush.bind`, `installIme.call`.
 * 检查边界 / Checked boundaries: `assert.equal(view.projectId, 'alpha')`; `assert.equal(view.status, 'done')`.
 */
test('queued IME work keeps its original project after the user selects another project', async t => {
  const f = fixture(t), queued = gate();
  const flush = f.jobs.flush.bind(f.jobs); let first = true;
  f.jobs.flush = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: queued IME work keeps its original project after the user selects another project
   * 状态影响 / State effects: `first`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `flush`.
   */
  async () => { if (first) { first = false; await queued.promise; } await flush(); };
  const view = installIme.call(f.host, f.id);
  f.select('beta'); queued.resolve(); await f.jobs.wait(f.id);
  assert.equal(view.projectId, 'alpha'); assert.equal(view.status, 'done');
  assert.deepEqual(f.calls, ['alpha']); assert.equal(f.workspaces.projects.current(), 'beta');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a replacement live is refused before a queued IME operation can start
 * 协作入口 / Collaborators: `fixture`, `installIme.call`, `f.live.set`, `f.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(f.calls, [])`; `assert.equal(view.status, 'error')`.
 */
test('a replacement live is refused before a queued IME operation can start', async t => {
  const f = fixture(t), view = installIme.call(f.host, f.id);
  f.live.set(f.id, { status: 'running', startedAt: 'replacement-boot' });
  await f.jobs.wait(f.id);
  assert.deepEqual(f.calls, []); assert.equal(view.status, 'error');
  assert.equal(view.errorCode, 'DESKTOP_SCOPE_CHANGED');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a replacement live during IME installation cannot report success for the new guest
 * 状态影响 / State effects: `f.desktops.installIme`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `gate`, `installIme.call`, `f.live.set`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(f.calls, ['alpha'])`; `assert.equal(view.status, 'error')`.
 */
test('a replacement live during IME installation cannot report success for the new guest', async t => {
  const f = fixture(t), entered = gate(), finished = gate();
  f.desktops.installIme = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: a replacement live during IME installation cannot report success for the new guest
   * 协作入口 / Collaborators: `f.calls.push`, `f.workspaces.projects.current`, `entered.resolve`.
   */
  async () => {
    f.calls.push(f.workspaces.projects.current()); entered.resolve(); await finished.promise;
    return { code: 0, stdout: '', stderr: '' };
  };
  const view = installIme.call(f.host, f.id); await entered.promise;
  f.live.set(f.id, { status: 'running', startedAt: 'replacement-boot' }); finished.resolve();
  await f.jobs.wait(f.id);
  assert.deepEqual(f.calls, ['alpha']); assert.equal(view.status, 'error');
  assert.equal(view.errorCode, 'DESKTOP_SCOPE_CHANGED');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancelled IME cleanup failure remains visible as an error in the public job
 * 状态影响 / State effects: `f.desktops.installIme`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `gate`, `installIme.call`, `f.jobs.cancel`.
 * 检查边界 / Checked boundaries: `assert.equal(view.status, 'error')`; `assert.equal(view.errorCode, 'DESKTOP_CLEANUP_FAILED')`.
 */
test('cancelled IME cleanup failure remains visible as an error in the public job', async t => {
  const f = fixture(t), entered = gate();
  f.desktops.installIme = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: _id; signal。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: cancelled IME cleanup failure remains visible as an error in the public job
   * 失败 / Failure: `new AppError('原桌面清理未确认', 503, 'DESKTOP_CLEANUP_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `entered.resolve`.
   */
  async (_id, signal) => {
    const aborted = new Promise<void>(done => signal.addEventListener('abort', () => done(), { once: true }));
    entered.resolve(); await aborted;
    throw new AppError('原桌面清理未确认', 503, 'DESKTOP_CLEANUP_FAILED');
  };
  const view = installIme.call(f.host, f.id); await entered.promise;
  f.jobs.cancel(f.id); await f.jobs.wait(f.id);
  assert.equal(view.status, 'error'); assert.equal(view.errorCode, 'DESKTOP_CLEANUP_FAILED');
  assert.equal(view.error, '原桌面清理未确认');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: registered IME retry restores the saved project before capturing its new task
 * 协作入口 / Collaborators: `fixture`, `Object.assign`, `pluginCapabilities`, `activate`.
 * 检查边界 / Checked boundaries: `assert.equal(retried.projectId, 'alpha')`; `assert.equal(retried.status, 'done')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('registered IME retry restores the saved project before capturing its new task', async t => {
  const f = fixture(t), callbacks = new Map<string, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: job: JobView。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (job: JobView) => unknown>();
  const activationMachines = Object.assign(new EventEmitter(), { live: new Map() });
  const scope = new PluginScope();
  const activation = {
    vm: activationMachines,
    use: resolveService,
    optional: resolveService,
    capabilities: pluginCapabilities('desktop', activationMachines as never, scope),
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: ref: string | { key: string }; service: unknown。
     * 结果：返回分支计算值（`service`）。
     * Result: Return the branch-computed value (`service`).
     * 验证场景 / Scenario: registered IME retry restores the saved project before capturing its new task
     * 协作入口 / Collaborators: `Reflect.set`.
     */
    provide: (ref: string | { key: string }, service: unknown) => {
      Reflect.set(activation, typeof ref === 'string' ? ref : ref.key, service);
      return service;
    },
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: jobs: InstanceType<typeof Jobs>; retry: (job: JobView) => unknown。
     * 结果：返回分支计算值（`callbacks.set(jobs === activation.jobs ? 'ime' : randomUUID(), retry)`）。
     * Result: Return the branch-computed value (`callbacks.set(jobs === activation.jobs ? 'ime' : randomUUID(), retry)`).
     * 验证场景 / Scenario: registered IME retry restores the saved project before capturing its new task
     * 协作入口 / Collaborators: `callbacks.set`, `randomUUID`.
     */
    registerJobs: (jobs: InstanceType<typeof Jobs>, retry: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: job: JobView。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (job: JobView) => unknown) =>
      callbacks.set(jobs === activation.jobs ? 'ime' : randomUUID(), retry),
  } as unknown as PluginContext;
  await activate(activation);
  const installed = activation.desktops as import('../server/desktop.ts').Desktops, jobStore = activation.jobs;
  t.after(async () => { await installed.close(); await jobStore.close(); await scope.dispose(); });
  Object.assign(activation, { vm: f.host.vm, workspaces: f.host.workspaces,
    desktops: f.host.desktops, jobs: f.jobs });
  f.select('beta');
  const retried = await callbacks.get('ime')!({ key: f.id, vmId: f.id, projectId: 'alpha',
    status: 'error', log: '', startedAt: new Date().toISOString() }) as JobView;
  await f.jobs.wait(f.id);
  assert.equal(retried.projectId, 'alpha'); assert.equal(retried.status, 'done');
  assert.deepEqual(f.calls, ['alpha']); assert.equal(f.workspaces.projects.current(), 'beta');
});
