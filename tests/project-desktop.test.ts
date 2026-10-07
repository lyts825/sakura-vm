/**
 * 模块职责：回归验证模块，围绕 `project-desktop` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-desktop`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: KDE public start captures its named project, exports secrets in UID frame and protects display identity; public running KDE requires exact stop before rebinding or directory/network edits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, vmDir, AppError, assertProjectTerminalsStopped } from './desktop-identity-fixture.ts';
import { Desktops } from '../server/desktop.ts';

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: Parameters<typeof fixture>[0]; mode = ''。
 * 结果：返回受控对象，公开字段包括 `desktops, scope, settled, publicStart`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `desktops, scope, settled, publicStart`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `fixture`, `t.after`, `delay`.
 */
async function publicFixture(t: Parameters<typeof fixture>[0], mode = '') {
  const f = await fixture(t, mode), desktops = new Desktops(f.machines, f.workspaces, f.options);
  t.after(() => desktops.close());
  // Let the constructor's readonly recovery observe the empty original intent.
  await delay(5);
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: project: string; action: () => Promise<T>。
   * 结果：返回分支计算值（`f.workspaces.projects.with(f.id, project, action)`）。
   * Result: Return the branch-computed value (`f.workspaces.projects.with(f.id, project, action)`).
   * 协作入口 / Collaborators: `f.workspaces.projects.with`.
   */
  const scope = <T>(project: string, action: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => Promise<T>) => f.workspaces.projects.with(f.id, project, action);
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: project: string。
   * 结果：返回分支计算值（`view`），以 Promise 交付。
   * Result: Return the branch-computed value (`view`) through a Promise.
   * 失败 / Failure: `Error('Desktop public operation did not settle')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `scope`, `['installing', 'starting'].includes`, `delay`, `Error`.
   */
  const settled = async (project: string) => {
    for (let i = 0; i < 500; ++i) {
      const view = await scope(project, () => desktops.view(f.id));
      if (!['installing', 'starting'].includes(view.status)) return view;
      await delay(5);
    }
    throw Error('Desktop public operation did not settle');
  };
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: project: string。
   * 结果：返回分支计算值（`settled(project)`），以 Promise 交付。
   * Result: Return the branch-computed value (`settled(project)`) through a Promise.
   * 协作入口 / Collaborators: `scope`, `settled`.
   */
  const start = async (project: string) => {
    await scope(project, async () => { desktops.start(f.id, 'start'); });
    return settled(project);
  };
  return { ...f, desktops, scope, settled, publicStart: start };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: KDE public start captures its named project, exports secrets in UID frame and protects display identity
 * 协作入口 / Collaborators: `publicFixture`, `f.publicStart`, `assert.equal`, `f.bindings.read`.
 * 检查边界 / Checked boundaries: `assert.equal(view.status, 'ready')`; `assert.equal(view.projectId, f.alpha)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('KDE public start captures its named project, exports secrets in UID frame and protects display identity', async t => {
  const f = await publicFixture(t), view = await f.publicStart(f.alpha);
  assert.equal(view.status, 'ready'); assert.equal(view.projectId, f.alpha); assert.equal(view.networkIsolation, 'private');
  const binding = await f.bindings.read(f.id); assert.equal(binding?.version, 2);
  if (binding?.version !== 2) assert.fail();
  assert.equal(binding.enabled, true); assert.equal(binding.execution.identity.uid, 20001);
  const frame = f.identity.inputs[0]; assert.match(frame.toString(), /desktop-secret-雪/);
  assert.doesNotMatch(frame.subarray(32, 32 + frame.readUInt32LE(24)).toString(), /cd |setpriv|killall|\/home\/sakura-desktop/);
  assert.ok(f.state.commands.every(command => !command.includes('desktop-secret') && !command.includes('desktop-hook')));
  assert.doesNotMatch(JSON.stringify(view), /desktop-secret/);
  assert.doesNotMatch(await readFile(join(vmDir(f.id), 'desktop-binding.json'), 'utf8'), /TOKEN|desktop-secret/);
  assert.equal((await f.scope(f.beta, () => f.desktops.view(f.id))).bindingMismatch, true);
  assert.equal((await f.desktops.view(f.id, true)).bindingMismatch, undefined);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: public running KDE requires exact stop before rebinding or directory/network edits
 * 协作入口 / Collaborators: `publicFixture`, `f.publicStart`, `assert.equal`, `f.scope`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.publicStart(f.beta)).status, 'error')`; `assert.equal(f.identity.inputs.length, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('public running KDE requires exact stop before rebinding or directory/network edits', async t => {
  const f = await publicFixture(t); await f.publicStart(f.alpha);
  assert.equal((await f.publicStart(f.beta)).status, 'error'); assert.equal(f.identity.inputs.length, 1);
  await f.scope(f.alpha, async () => {
    const config = await f.workspaces.config(f.id);
    await assert.rejects(f.workspaces.save(f.id, { ...config, directory: '/workspace/new' }), /停止/);
    await assert.rejects(f.workspaces.save(f.id, { ...config, networkIsolation: 'host' }), /停止/);
  });
  await f.desktops.stop(f.id); assert.equal((await f.bindings.read(f.id))!.enabled, false);
  assert.equal((await f.scope(f.beta, () => f.desktops.view(f.id))).bindingMismatch, undefined);
  assert.equal((await f.publicStart(f.beta)).status, 'ready');
  assert.equal((await f.bindings.read(f.id))!.projectId, f.beta);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lost preparation ACK and endpoint/network drift cannot authorize discovery or recovery
 * 状态影响 / State effects: `g.state.endpointDrift`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `publicFixture`, `assert.equal`, `f.publicStart`, `f.bindings.read`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.publicStart(f.alpha)).status, 'error')`; `assert.equal(f.identity.inputs.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('lost preparation ACK and endpoint/network drift cannot authorize discovery or recovery', async t => {
  const f = await publicFixture(t, 'prepare-ack-lost');
  assert.equal((await f.publicStart(f.alpha)).status, 'error'); assert.equal(f.identity.inputs.length, 0);
  assert.equal((await f.bindings.read(f.id))!.enabled, false);
  const g = await publicFixture(t); assert.equal((await g.publicStart(g.alpha)).status, 'ready');
  g.state.endpointDrift = true;
  await assert.rejects(g.scope(g.alpha, () => g.desktops.view(g.id)), { code: 'DESKTOP_SCOPE_CHANGED' });
  await assert.rejects(g.desktops.view(g.id, true), { code: 'DESKTOP_SCOPE_CHANGED' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: UID readiness failures redact resolved private values and persist disabled full recovery proof
 * 状态影响 / State effects: `f.state.onProbe`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `publicFixture`, `f.publicStart`, `assert.equal`, `assert.doesNotMatch`.
 * 检查边界 / Checked boundaries: `assert.equal(view.status, 'error')`; `assert.doesNotMatch(JSON.stringify(view), /desktop-secret/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('UID readiness failures redact resolved private values and persist disabled full recovery proof', async t => {
  const f = await publicFixture(t);
  f.state.onProbe = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: UID readiness failures redact resolved private values and persist disabled full recovery proof
   * 失败 / Failure: `new AppError('desktop-secret-雪', 409, 'MODEL_UID_START_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw new AppError('desktop-secret-雪', 409, 'MODEL_UID_START_FAILED'); };
  const view = await f.publicStart(f.alpha); assert.equal(view.status, 'error');
  assert.doesNotMatch(JSON.stringify(view), /desktop-secret/);
  const binding = await f.bindings.read(f.id); assert.equal(binding?.enabled, false);
  assert.equal(binding?.version === 2 && binding.state, 'stopped');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: public stop aborts fixed administrative preparation before waiting for the VM lock
 * 状态影响 / State effects: `f.state.installed`, `f.state.beforePrepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `publicFixture`, `f.scope`, `delay`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(f.state.preparations, 1)`; `assert.equal(f.identity.inputs.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('public stop aborts fixed administrative preparation before waiting for the VM lock', async t => {
  const f = await publicFixture(t); f.state.installed = false;
  f.state.beforePrepare = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: signal。
   * 结果：返回分支计算值（`delay(60000, undefined, { signal })`）。
   * Result: Return the branch-computed value (`delay(60000, undefined, { signal })`).
   * 验证场景 / Scenario: public stop aborts fixed administrative preparation before waiting for the VM lock
   * 协作入口 / Collaborators: `delay`.
   */
  signal => delay(60000, undefined, { signal });
  await f.scope(f.alpha, async () => { f.desktops.start(f.id, 'install'); });
  for (let i = 0; i < 500 && !f.state.preparations; ++i) await delay(5);
  assert.equal(f.state.preparations, 1); assert.equal(f.identity.inputs.length, 0);
  await f.desktops.stop(f.id);
  assert.equal(await f.bindings.read(f.id), null);
  assert.ok(f.state.commands.some(command => command.includes('SAKURA_GUEST_TASK_CLEANUP')));
  assert.equal((await f.scope(f.alpha, () => f.desktops.view(f.id))).status, 'not-installed');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: public controller reload preserves original running GUI and true boot retires old proof before recovery
 * 状态影响 / State effects: `f.live.status`, `f.state.boot`, `f.owner.record`, `f.owner.inode`, `f.state.detached`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `publicFixture`, `f.publicStart`, `f.desktops.close`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.equal(f.identity.inputs.length, 1)`; `assert.equal(f.identity.inputs.length, 2)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('public controller reload preserves original running GUI and true boot retires old proof before recovery', async t => {
  const f = await publicFixture(t); await f.publicStart(f.alpha); await f.desktops.close();
  const resumed = new Desktops(f.machines, f.workspaces, f.options); t.after(() => resumed.close());
  await delay(30); assert.equal(f.identity.inputs.length, 1);
  f.live.status = 'stopped'; f.machines.emit('change');
  f.state.boot = randomUUID(); f.owner.record = null; f.owner.inode = null; f.state.detached = false;
  f.identity.tickets.clear(); f.live.status = 'running'; f.live.startedAt = 'desktop-model-boot-2'; f.machines.emit('change');
  for (let i = 0; i < 500 && f.identity.inputs.length === 1; ++i) await delay(5);
  for (let i = 0; i < 500; ++i) {
    if ((await f.scope(f.alpha, () => resumed.view(f.id))).status === 'ready') break;
    await delay(5);
  }
  assert.equal(f.identity.inputs.length, 2);
  assert.equal((await f.scope(f.alpha, () => resumed.view(f.id))).projectId, f.alpha);
  assert.equal(f.state.neighbor, true); assert.equal(f.state.killed, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: stopped-instance edits retain the exact old proof; corrupt bindings cannot be cleared by Root fallback
 * 状态影响 / State effects: `f.live.status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `publicFixture`, `f.publicStart`, `f.machines.emit`, `f.scope`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.bindings.read(f.id))!.enabled, true)`; `assert.rejects(f.bindings.read(f.id))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('stopped-instance edits retain the exact old proof; corrupt bindings cannot be cleared by Root fallback', async t => {
  const f = await publicFixture(t); await f.publicStart(f.alpha);
  f.live.status = 'stopped'; f.machines.emit('change');
  await f.scope(f.alpha, async () => {
    const config = await f.workspaces.config(f.id);
    await assert.rejects(f.workspaces.save(f.id, { ...config, networkIsolation: 'host' }), /停止/);
  });
  assert.equal((await f.bindings.read(f.id))!.enabled, true);
  const file = join(vmDir(f.id), 'desktop-binding.json'), before = await readFile(file);
  await writeFile(file, 'null'); await assert.rejects(f.bindings.read(f.id));
  f.live.status = 'running';
  await assert.rejects(f.scope(f.alpha, () => f.desktops.view(f.id)));
  await assert.rejects(f.desktops.stop(f.id)); assert.equal(await readFile(file, 'utf8'), 'null');
  await writeFile(file, before); await f.desktops.stop(f.id);
  assert.equal((await f.publicStart(f.alpha)).status, 'ready');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: public IME captures the named original project and restarts its full UID desktop without legacy Root start
 * 协作入口 / Collaborators: `publicFixture`, `f.publicStart`, `f.scope`, `f.workspaces.projects.update`.
 * 检查边界 / Checked boundaries: `assert.equal((await running).code, 0)`; `assert.equal(binding?.projectId, f.alpha)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('public IME captures the named original project and restarts its full UID desktop without legacy Root start', async t => {
  const f = await publicFixture(t); await f.publicStart(f.alpha);
  const controller = new AbortController(), output: string[] = [];
  const running = f.scope(f.alpha, () => f.desktops.installIme(f.id, controller.signal, line => output.push(line)));
  await f.workspaces.projects.update(f.id, f.beta);
  assert.equal((await running).code, 0);
  const binding = await f.bindings.read(f.id); assert.equal(binding?.projectId, f.alpha);
  assert.equal(f.identity.inputs.length, 2); assert.equal(f.state.killed, 1); assert.equal(f.state.neighbor, true);
  assert.ok(f.identity.inputs[1].toString().includes('.config/autostart/fcitx5.desktop'));
  assert.doesNotMatch(output.join(''), /desktop-secret/);
  assert.ok(f.state.commands.every(command => !command.includes('id sakura-desktop') && !command.includes('/home/sakura-desktop')));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: public IME retains exact administration proof on cleanup503 and stop retries only the original live
 * 状态影响 / State effects: `f.state.beforePrepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `publicFixture`, `f.publicStart`, `assert.rejects`, `f.scope`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scope(f.alpha, () => f.desktops.installIme(f.id, new AbortController().signal, () => {})), { status: 503, code: '…`; `assert.equal(f.identity.inputs.length, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('public IME retains exact administration proof on cleanup503 and stop retries only the original live', async t => {
  const f = await publicFixture(t); await f.publicStart(f.alpha);
  f.state.beforePrepare = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: public IME retains exact administration proof on cleanup503 and stop retries only the original live
   * 协作入口 / Collaborators: `f.machines.live.set`.
   */
  async () => { f.machines.live.set(f.id, { ...f.live, startedAt: 'replacement-ime-live' } as any); };
  await assert.rejects(f.scope(f.alpha, () => f.desktops.installIme(f.id, new AbortController().signal, () => {})),
    { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' });
  assert.equal(f.identity.inputs.length, 1); assert.equal(f.state.detached, false);
  assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
  const before = f.state.commands.length;
  await assert.rejects(f.desktops.stop(f.id), { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' });
  assert.equal(f.state.commands.length, before);
  f.machines.live.set(f.id, f.live as any); await f.desktops.stop(f.id);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: public IME cancellation completes original package task cleanup and does not start a legacy or new UID desktop
 * 状态影响 / State effects: `f.state.beforePrepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `publicFixture`, `f.publicStart`, `f.scope`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(result)`; `assert.equal(f.state.preparations, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('public IME cancellation completes original package task cleanup and does not start a legacy or new UID desktop', async t => {
  const f = await publicFixture(t); await f.publicStart(f.alpha);
  f.state.beforePrepare = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: signal。
   * 结果：返回分支计算值（`delay(60000, undefined, { signal })`）。
   * Result: Return the branch-computed value (`delay(60000, undefined, { signal })`).
   * 验证场景 / Scenario: public IME cancellation completes original package task cleanup and does not start a legacy or new UID desktop
   * 协作入口 / Collaborators: `delay`.
   */
  signal => delay(60000, undefined, { signal });
  const controller = new AbortController();
  const result = f.scope(f.alpha, () => f.desktops.installIme(f.id, controller.signal, () => {}));
  const failed = assert.rejects(result);
  for (let i = 0; i < 500 && !f.state.preparations; ++i) await delay(5);
  assert.equal(f.state.preparations, 1); controller.abort(); await failed;
  assert.equal(f.identity.inputs.length, 1); assert.equal(f.state.detached, false);
  assert.ok(f.state.commands.some(command => command.startsWith('# SAKURA_GUEST_TASK_CLEANUP')));
  await f.desktops.stop(f.id);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed Desktop cleanup exposes explicit stop retry before and after controller reload
 * 状态影响 / State effects: `f.state.onProbe`, `f.state.cleanupFailure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `publicFixture`, `f.publicStart`, `assert.equal`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.equal(view.status, 'error')`; `assert.equal(view.cleanupPending, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('failed Desktop cleanup exposes explicit stop retry before and after controller reload', async t => {
  const f = await publicFixture(t);
  f.state.onProbe = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: failed Desktop cleanup exposes explicit stop retry before and after controller reload
   * 失败 / Failure: `new AppError('readiness failed', 409, 'MODEL_UID_START_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw new AppError('readiness failed', 409, 'MODEL_UID_START_FAILED'); };
  f.state.cleanupFailure = true;
  const view = await f.publicStart(f.alpha);
  assert.equal(view.status, 'error'); assert.equal(view.cleanupPending, true);
  assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
  await f.desktops.close();
  const reloaded = new Desktops(f.machines, f.workspaces, f.options); t.after(() => reloaded.close());
  const recovered = await f.scope(f.alpha, () => reloaded.view(f.id));
  assert.equal(recovered.status, 'error'); assert.equal(recovered.cleanupPending, true);
  f.state.cleanupFailure = false; await reloaded.stop(f.id);
  assert.equal((await f.scope(f.alpha, () => reloaded.view(f.id))).status, 'stopped');
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancelled IME cleanup503 is visible in Desktop status instead of an unfinished installation
 * 状态影响 / State effects: `f.state.onCommit`, `f.state.cleanupFailure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `publicFixture`, `f.publicStart`, `assert.rejects`, `f.scope`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.scope(f.alpha, () => f.desktops.installIme(f.id, controller.signal, () => {})), { status: 503, code: 'DESKTOP_CLE…`; `assert.equal(view.status, 'error')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cancelled IME cleanup503 is visible in Desktop status instead of an unfinished installation', async t => {
  const f = await publicFixture(t); await f.publicStart(f.alpha);
  const controller = new AbortController();
  f.state.onCommit = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: cancelled IME cleanup503 is visible in Desktop status instead of an unfinished installation
   * 状态影响 / State effects: `f.state.cleanupFailure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `controller.abort`.
   */
  () => { f.state.cleanupFailure = true; controller.abort(); };
  await assert.rejects(f.scope(f.alpha, () => f.desktops.installIme(f.id, controller.signal, () => {})),
    { status: 503, code: 'DESKTOP_CLEANUP_FAILED' });
  const view = await f.scope(f.alpha, () => f.desktops.view(f.id));
  assert.equal(view.status, 'error'); assert.equal(view.cleanupPending, true);
  assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
  f.state.cleanupFailure = false; await f.desktops.stop(f.id);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});
