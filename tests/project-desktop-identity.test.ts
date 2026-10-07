/**
 * 模块职责：回归验证模块，围绕 `project-desktop-identity` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-desktop-identity`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: initial endpoint absence retries but permanent authority refusal rolls back immediately; typed adapter waiting can authorize retry only for an uncommitted probe.
 */
import { projectMetadataFile } from '../server/project-catalog.ts';
import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type { Machines as MachinesType } from '../server/machines.ts';
import type { Project, Workspaces as WorkspacesType } from '../server/workspaces.ts';
import type { ProjectDesktopRecord } from '../server/project-service-scope.ts';

import { fixture, projectVersion, ProjectDesktops, ProjectDesktopScope, DesktopBindings, projectDesktopBindingSchema, desktopProjectCommand, desktopAdapterSource, desktopUidCommand, desktopProjectPrepare, desktopProjectEnvironment, desktopProjectImePrepare, desktopProjectImeCommand, projectIdentityPayload, assertProjectTerminalsStopped, vmDir, AppError, defaultDesktopPreferences } from './desktop-identity-fixture.ts';
import { desktopProjectControl, type DesktopControlProof } from '../server/desktop-project-control.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: initial endpoint absence retries but permanent authority refusal rolls back immediately
 * 状态影响 / State effects: `f.state.onProbe`, `f.state.probeFailure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.start`, `assert.ok`, `f.manager.stop`.
 * 检查边界 / Checked boundaries: `assert.ok(f.state.probes >= 2)`; `assert.rejects(f.start(), { code: 'DESKTOP_SCOPE_CHANGED' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('initial endpoint absence retries but permanent authority refusal rolls back immediately', async (t) => {
  const f = await fixture(t); let first = true;
  f.state.onProbe = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: initial endpoint absence retries but permanent authority refusal rolls back immediately
   * 状态影响 / State effects: `first`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 失败 / Failure: `new AppError('waiting for actual Plasma', 409, 'DESKTOP_NOT_READY')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => {
    if (first) { first = false; throw new AppError('waiting for actual Plasma', 409, 'DESKTOP_NOT_READY'); }
  };
  await f.start(); assert.ok(f.state.probes >= 2);
  await f.manager.stop(f.id); f.state.onProbe = undefined; f.state.probeFailure = true;
  const before = f.state.probes;
  await assert.rejects(f.start(), { code: 'DESKTOP_SCOPE_CHANGED' });
  assert.equal(f.state.probes - before, 1);
  const stoppedBinding = await f.bindings.read(f.id);
  if (stoppedBinding?.version !== 2) assert.fail();
  assert.equal(stoppedBinding.state, 'stopped');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: typed adapter waiting can authorize retry only for an uncommitted probe
 * 状态影响 / State effects: `waitingReason`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.start`, `f.bindings.read`, `assert.fail`.
 * 检查边界 / Checked boundaries: `assert.fail()`; `assert.rejects(desktopProjectControl(machines, f.id, 'probe', { ...proof, endpoint: null }), { code: 'DESKTOP_NOT_READY' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('typed adapter waiting can authorize retry only for an uncommitted probe', async (t) => {
  const f = await fixture(t); await f.start();
  const binding = await f.bindings.read(f.id); if (binding?.version !== 2) assert.fail();
  const proof: DesktopControlProof = { version: 1, ...binding.execution };
  let waitingReason = 'NOT_READY_PROCESS';
  const machines = { /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ code: 73, stdout: JSON.stringify({ ok: false, code: 'DESKTOP_NOT_READY', stag…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ code: 73, stdout: JSON.stringify({ ok: false, code: 'DESKTOP_NOT_READY', stag…`) through a Promise.
   * 验证场景 / Scenario: typed adapter waiting can authorize retry only for an uncommitted probe
   * 协作入口 / Collaborators: `JSON.stringify`.
   */
  exec: async () => ({ code: 73, stdout: JSON.stringify({ ok: false, code: 'DESKTOP_NOT_READY',
    stage: 'AUTHORITY', reason: waitingReason, checkLine: 0 }), stderr: '' }) } as unknown as MachinesType;
  for (const reason of ['NOT_READY_CREDENTIAL', 'NOT_READY_PROCESS', 'NOT_READY_NESTED_X11']) {
    waitingReason = reason;
    await assert.rejects(desktopProjectControl(machines, f.id, 'probe', { ...proof, endpoint: null }), { code: 'DESKTOP_NOT_READY' });
  }
  await assert.rejects(desktopProjectControl(machines, f.id, 'probe', proof), { code: 'DESKTOP_SCOPE_CHANGED' });
  await assert.rejects(desktopProjectControl(machines, f.id, 'guard', { ...proof, endpoint: null }), { code: 'DESKTOP_SCOPE_CHANGED' });
  await assert.rejects(desktopProjectControl(machines, f.id, 'unguard', proof), { status: 503, code: 'DESKTOP_CLEANUP_FAILED' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: adapter public refusals retain only validated fixed stages and lines, including malformed null replies
 * 状态影响 / State effects: `stdout`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.start`, `f.bindings.read`, `assert.fail`.
 * 检查边界 / Checked boundaries: `assert.fail()`; `assert.rejects(desktopProjectControl(machines, f.id, 'probe', proof), (error: unknown) => { assert.ok(error instanceof AppError); …`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('adapter public refusals retain only validated fixed stages and lines, including malformed null replies', async t => {
  const f = await fixture(t); await f.start();
  const binding = await f.bindings.read(f.id); if (binding?.version !== 2) assert.fail();
  const proof: DesktopControlProof = { version: 1, ...binding.execution };
  const refusal = { ok: false, code: 'DESKTOP_SCOPE_CHANGED', stage: 'AUTHORITY', reason: 'CHECK_REJECTED', checkLine: 215 };
  let stdout = JSON.stringify(refusal);
  const machines = { /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ code: 73, stdout, stderr: 'private-cookie-path' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ code: 73, stdout, stderr: 'private-cookie-path' })`) through a Promise.
   * 验证场景 / Scenario: adapter public refusals retain only validated fixed stages and lines, including malformed null replies
   */
  exec: async () => ({ code: 73, stdout, stderr: 'private-cookie-path' }) } as unknown as MachinesType;
  await assert.rejects(desktopProjectControl(machines, f.id, 'probe', proof), (error: unknown) => {
    assert.ok(error instanceof AppError); assert.equal(error.code, 'DESKTOP_SCOPE_CHANGED'); assert.equal(error.status, 409);
    assert.match(error.message, /probe\/AUTHORITY\/CHECK_REJECTED\/check=215/); assert.doesNotMatch(error.message, /private-cookie-path/);
    return true;
  });
  await assert.rejects(desktopProjectControl(machines, f.id, 'unguard', proof), { status: 503, code: 'DESKTOP_CLEANUP_FAILED' });
  for (const reply of [null, [], 'private-cookie-path', { ...refusal, stage: 'private-cookie-path' },
    { ...refusal, reason: 'private-cookie-path' }, { ...refusal, checkLine: -1 }, { ...refusal, checkLine: 8193 },
    { ...refusal, checkLine: 1.5 }, { ...refusal, details: 'private-cookie-path' }]) {
    stdout = JSON.stringify(reply);
    await assert.rejects(desktopProjectControl(machines, f.id, 'probe', { ...proof, endpoint: null }), (error: unknown) => {
      assert.ok(error instanceof AppError); assert.equal(error.code, 'DESKTOP_SCOPE_CHANGED');
      assert.match(error.message, /UNVERIFIED_REPLY/); assert.doesNotMatch(error.message, /private-cookie-path/); return true;
    });
  }
  for (const reply of [{ ...refusal, code: 'DESKTOP_NOT_READY' },
    { ...refusal, code: 'DESKTOP_NOT_READY', stage: 'GUARD_RECORD', reason: 'NOT_READY_PROCESS' }]) {
    stdout = JSON.stringify(reply);
    await assert.rejects(desktopProjectControl(machines, f.id, 'probe', { ...proof, endpoint: null }), { code: 'DESKTOP_SCOPE_CHANGED' });
  }
  stdout = 'private-cookie-path{';
  await assert.rejects(desktopProjectControl(machines, f.id, 'probe', proof), (error: unknown) => {
    assert.ok(error instanceof AppError); assert.equal(error.code, 'DESKTOP_CONTROL_FAILED'); assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /private-cookie-path/); return true;
  });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: named Desktop captures non-enumerable scope, binary body, native HOME/UID and original service ticket
 * 协作入口 / Collaborators: `fixture`, `f.start`, `f.bindings.read`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(binding?.version, 2)`; `assert.fail()`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('named Desktop captures non-enumerable scope, binary body, native HOME/UID and original service ticket', async (t) => {
  const f = await fixture(t); await f.start();
  const binding = await f.bindings.read(f.id); assert.equal(binding?.version, 2);
  if (binding?.version !== 2) assert.fail();
  assert.equal(binding.projectId, f.alpha); assert.equal(binding.enabled, true);
  assert.equal(binding.execution.identity.home.startsWith('/var/lib/sakura-project-homes/'), true);
  assert.equal(binding.execution.run!.cgroupName, 'sakura-service-' + binding.execution.record.runId);
  assert.equal(projectDesktopBindingSchema.safeParse(binding).success, true);
  assert.equal(binding.configVersion, projectVersion(f.config));
  const frame = f.identity.inputs[0]; assert.equal(frame.subarray(0, 8).toString(), 'SKIDP001');
  const script = frame.subarray(32, 32 + frame.readUInt32LE(24)).toString();
  assert.doesNotMatch(script, /cd |\/home\/sakura-desktop|killall|pgrep -u/);
  assert.match(script, /\/run\/sakura-desktop-uid\/20001/);
  assert.ok(frame.includes(Buffer.from('desktop-secret-雪')));
  assert.ok(f.state.commands.every(command => !command.includes('desktop-secret') && !command.includes('desktop-hook')));
  const serialized = await readFile(join(vmDir(f.id), 'desktop-binding.json'), 'utf8');
  assert.doesNotMatch(serialized, /desktop-secret|BASH_ENV|TOKEN/);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
  await f.workspaces.projects.with(f.id, f.beta, async () => assert.equal((await f.manager.view(f.id)).bindingMismatch, true));
  assert.equal((await f.manager.view(f.id, true)).status, 'ready');
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Desktop readiness retains the lease until the bound result is saved
 * 状态影响 / State effects: `f.state.onProbe`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.start`, `assert.equal`, `assert.doesNotThrow`.
 * 检查边界 / Checked boundaries: `assert.equal(held, true)`; `assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha))`.
 */
test('Desktop readiness retains the lease until the bound result is saved', async (t) => {
  const f = await fixture(t); let held = false;
  f.state.onProbe = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: Desktop readiness retains the lease until the bound result is saved
   * 状态影响 / State effects: `held`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `assert.throws`.
   * 检查边界 / Checked boundaries: `assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' })`.
   */
  async () => {
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' }); held = true;
  };
  // The final readonly check also executes while the preparation lease is held.
  await f.start(); assert.equal(held, true);
  f.state.onProbe = undefined;
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: asynchronous selection keeps the original named project; config/live replacement executes no body
 * 状态影响 / State effects: `f.state.beforeResolve`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.start`, `assert.equal`, `f.bindings.read`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.bindings.read(f.id))?.projectId, f.alpha)`; `assert.rejects(f.start(), { code: 'DESKTOP_SCOPE_CHANGED' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('asynchronous selection keeps the original named project; config/live replacement executes no body', async (t) => {
  const f = await fixture(t); f.state.beforeResolve = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: asynchronous selection keeps the original named project; config/live replacement executes no body
   * 协作入口 / Collaborators: `f.workspaces.projects.with`.
   */
  async () => {
    await f.workspaces.projects.with(f.id, f.beta, async () => assert.equal((await f.workspaces.config(f.id)).directory, '/workspace/beta'));
  };
  await f.start(); assert.equal((await f.bindings.read(f.id))?.projectId, f.alpha);
  await f.manager.stop(f.id);
  f.state.beforeResolve = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: asynchronous selection keeps the original named project; config/live replacement executes no body
   * 协作入口 / Collaborators: `f.machines.live.set`.
   */
  async () => { f.machines.live.set(f.id, { ...f.live, startedAt: 'replacement' } as any); };
  const before = f.identity.inputs.length;
  await assert.rejects(f.start(), { code: 'DESKTOP_SCOPE_CHANGED' }); assert.equal(f.identity.inputs.length, before);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: configuration drift before resolution refuses launch and releases the preparation lease
 * 状态影响 / State effects: `f.state.beforeResolve`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.start`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.start(), { code: 'DESKTOP_SCOPE_CHANGED' })`; `assert.equal(f.identity.inputs.length, 0)`.
 */
test('configuration drift before resolution refuses launch and releases the preparation lease', async (t) => {
  const f = await fixture(t); f.state.beforeResolve = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: configuration drift before resolution refuses launch and releases the preparation lease
   * 协作入口 / Collaborators: `writeFile`, `projectMetadataFile`, `f.workspaces.projects.current`, `JSON.stringify`.
   */
  async () => {
    await writeFile(projectMetadataFile(f.id, f.workspaces.projects.current(f.id)), JSON.stringify({ ...f.config, command: 'changed-during-resolution' }));
  };
  await assert.rejects(f.start(), { code: 'DESKTOP_SCOPE_CHANGED' }); assert.equal(f.identity.inputs.length, 0);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});
for (const mode of ['prepare-ack-lost', 'pane-ack-lost', 'commit-ack-lost'])
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: t。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.start`, `f.bindings.read`.
   * 检查边界 / Checked boundaries: `assert.rejects(f.start())`; `assert.equal(binding?.version, 2)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  test(`Desktop ${mode} cleans the original full domain and preserves a stopped receipt`, async (t) => {
    const f = await fixture(t, mode); await assert.rejects(f.start());
    const binding = await f.bindings.read(f.id); assert.equal(binding?.version, 2);
    if (binding?.version !== 2) assert.fail();
    assert.equal(binding.state, 'stopped'); assert.equal(binding.enabled, false);
    assert.equal(binding.execution.record.phase, 'stopped'); assert.equal(f.state.neighbor, true);
    for (const run of f.identity.tickets.values()) assert.equal(run.phase, 'closed');
  });
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: abort after native commit retires detached descendants and only the original run
 * 状态影响 / State effects: `f.state.onCommit`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.start`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.start(controller))`; `assert.equal(f.state.detached, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('abort after native commit retires detached descendants and only the original run', async (t) => {
  const f = await fixture(t), controller = new AbortController();
  f.state.onCommit = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`controller.abort(new Error('operation cancelled'))`）。
   * Result: Return the branch-computed value (`controller.abort(new Error('operation cancelled'))`).
   * 验证场景 / Scenario: abort after native commit retires detached descendants and only the original run
   * 协作入口 / Collaborators: `controller.abort`.
   */
  () => controller.abort(new Error('operation cancelled'));
  await assert.rejects(f.start(controller)); assert.equal(f.state.detached, false);
  assert.equal(f.state.neighbor, true); assert.equal((await f.bindings.read(f.id))?.enabled, false);
});
for (const mode of ['stop-ack-lost', 'first-stop-failure'])
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: t。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `f.state.stopFailures`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `fixture`, `f.start`, `f.manager.stop`, `assert.ok`.
   * 检查边界 / Checked boundaries: `assert.ok(f.state.stopCalls >= 2)`; `assert.equal(f.state.killed, 1)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  test(`Desktop ${mode} confirms complete native retirement on retry`, async (t) => {
    const f = await fixture(t, mode); await f.start();
    if (mode === 'first-stop-failure') f.state.stopFailures = 1;
    await f.manager.stop(f.id); assert.ok(f.state.stopCalls >= 2); assert.equal(f.state.killed, 1);
    assert.equal(f.state.neighbor, true); assert.equal((await f.bindings.read(f.id))?.enabled, false);
  });
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: all exact cleanup failures stay 503 with full active proof and permit accurate retry
 * 状态影响 / State effects: `f.state.stopFailures`, `binding`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.start`, `assert.rejects`, `f.manager.stop`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.manager.stop(f.id), { status: 503, code: 'SERVICE_CLEANUP_FAILED' })`; `assert.equal(binding?.version, 2)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('all exact cleanup failures stay 503 with full active proof and permit accurate retry', async (t) => {
  const f = await fixture(t); await f.start(); f.state.stopFailures = 3;
  await assert.rejects(f.manager.stop(f.id), { status: 503, code: 'SERVICE_CLEANUP_FAILED' });
  let binding = await f.bindings.read(f.id); assert.equal(binding?.version, 2);
  if (binding?.version !== 2) assert.fail();
  const original = binding.execution.run; assert.ok(original); assert.equal(binding.state, 'review');
  assert.equal(f.state.detached, true); assert.equal(f.identity.tickets.get(original.runId)!.phase, 'active');
  await f.manager.stop(f.id); binding = await f.bindings.read(f.id);
  assert.equal(binding?.version === 2 && binding.state, 'stopped'); assert.equal(f.state.neighbor, true);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: guard partial publication rolls back before any UID body; failed retirement retains full proof
 * 状态影响 / State effects: `f.state.guardFailure`, `f.state.cleanupFailure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.start`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.start(), { status: 503, code: 'DESKTOP_CLEANUP_FAILED' })`; `assert.equal(f.identity.inputs.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('guard partial publication rolls back before any UID body; failed retirement retains full proof', async (t) => {
  const f = await fixture(t); f.state.guardFailure = true; f.state.cleanupFailure = true;
  await assert.rejects(f.start(), { status: 503, code: 'DESKTOP_CLEANUP_FAILED' });
  assert.equal(f.identity.inputs.length, 0);
  const binding = await f.bindings.read(f.id); assert.equal(binding?.version === 2 && binding.state, 'review');
  f.state.cleanupFailure = false; await f.manager.stop(f.id);
  assert.equal((await f.bindings.read(f.id))?.version === 2 && (await f.bindings.read(f.id) as any).state, 'stopped');
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: replacement cgroup inode is never killed or adopted; original full ticket remains available
 * 状态影响 / State effects: `f.owner.inode`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.start`, `assert.rejects`, `f.manager.stop`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.manager.stop(f.id), { status: 503 })`; `assert.equal(f.state.killed, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('replacement cgroup inode is never killed or adopted; original full ticket remains available', async (t) => {
  const f = await fixture(t); await f.start(); const original = f.owner.inode; f.owner.inode = '887766';
  await assert.rejects(f.manager.stop(f.id), { status: 503 }); assert.equal(f.state.killed, 0);
  assert.equal(f.state.detached, true); assert.equal(f.state.neighbor, true);
  const binding = await f.bindings.read(f.id); assert.equal(binding?.version === 2 && binding.execution.run!.cgroupInode, original);
  f.owner.inode = original; await f.manager.stop(f.id); assert.equal(f.state.killed, 1);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: reload reads full ticket and endpoint without advancing host journals or reinstalling helpers
 * 状态影响 / State effects: `f.state.endpointDrift`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.start`, `join`, `vmDir`.
 * 检查边界 / Checked boundaries: `assert.equal(await f.manager.restore(f.id), null)`; `assert.deepEqual(await readFile(file), before)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('reload reads full ticket and endpoint without advancing host journals or reinstalling helpers', async (t) => {
  const f = await fixture(t); await f.start(); const file = join(vmDir(f.id), 'desktop-binding.json'), before = await readFile(file);
  const ensures = f.identity.state.ensureCalls, commands = f.state.commands.length;
  assert.equal(await f.manager.restore(f.id), null); await f.manager.view(f.id, true);
  assert.deepEqual(await readFile(file), before); assert.equal(f.identity.state.ensureCalls, ensures);
  assert.ok(f.state.commands.slice(commands).every(command => !/SAKURA_PROJECT_SERVICE_(PREPARE|START|COMMIT|STOP)/.test(command)));
  f.state.endpointDrift = true;
  await assert.rejects(f.manager.view(f.id, true), { code: 'DESKTOP_SCOPE_CHANGED' });
  assert.deepEqual(await readFile(file), before);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cold boot retires absent original domain without signaling new neighbors before authorized restore
 * 状态影响 / State effects: `f.state.boot`, `f.owner.record`, `f.owner.inode`, `f.state.detached`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.start`, `randomUUID`, `f.identity.tickets.clear`.
 * 检查边界 / Checked boundaries: `assert.equal(restored?.projectId, f.alpha)`; `assert.equal(f.state.stopCalls, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cold boot retires absent original domain without signaling new neighbors before authorized restore', async (t) => {
  const f = await fixture(t); await f.start(); const original = f.owner.record!;
  f.state.boot = randomUUID(); f.owner.record = null; f.owner.inode = null; f.state.detached = false;
  // Guest /run native receipts are volatile and absent after a true reboot.
  f.identity.tickets.clear();
  const restored = await f.manager.restore(f.id);
  assert.equal(restored?.projectId, f.alpha); assert.equal(f.state.stopCalls, 0); assert.equal(f.state.killed, 0);
  assert.equal(f.state.neighbor, true); assert.equal(f.identity.tickets.has(original.runId), false);
  assert.equal((await f.bindings.read(f.id))?.version === 2 && (await f.bindings.read(f.id) as any).execution.record.runId, original.runId);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy shared launcher records are review-only and never trigger global UID cleanup
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `join`, `vmDir`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.start(), { code: 'DESKTOP_LEGACY_REVIEW_REQUIRED' })`; `assert.rejects(f.manager.stop(f.id), { code: 'DESKTOP_LEGACY_REVIEW_REQUIRED' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('legacy shared launcher records are review-only and never trigger global UID cleanup', async (t) => {
  const f = await fixture(t);
  await writeFile(join(vmDir(f.id), 'desktop-binding.json'), JSON.stringify({ version: 1, projectId: f.alpha,
    directory: '/workspace/alpha', networkIsolation: 'private', launcherSha256: 'c'.repeat(64), enabled: true }));
  await assert.rejects(f.start(), { code: 'DESKTOP_LEGACY_REVIEW_REQUIRED' });
  await assert.rejects(f.manager.stop(f.id), { code: 'DESKTOP_LEGACY_REVIEW_REQUIRED' });
  assert.equal((await f.manager.view(f.id)).status, 'error'); assert.equal(f.identity.inputs.length, 0);
  assert.ok(f.state.commands.every(command => !command.includes('killall') && !command.includes('pgrep -u')));
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: clipboard preparation pins original project and retains lease through the caller result
 * 协作入口 / Collaborators: `fixture`, `f.start`, `f.workspaces.projects.with`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(context.desktop.identity.uid, context.desktop.run.projectId === f.alpha ? 20001 : -1)`; `assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('clipboard preparation pins original project and retains lease through the caller result', async (t) => {
  const f = await fixture(t); await f.start();
  const context = await f.workspaces.projects.with(f.id, f.alpha, () => f.manager.application(f.id));
  assert.equal(context.desktop.identity.uid, context.desktop.run.projectId === f.alpha ? 20001 : -1);
  assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
  await f.workspaces.projects.with(f.id, f.alpha, () => context.validate()); await context.release();
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: UID payload bounds and fixed Root package adapter keep commands/environment out of Root scope argv
 * 协作入口 / Collaborators: `desktopUidCommand`, `randomUUID`, `assert.doesNotMatch`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.doesNotMatch(uid, /cd |setpriv|killall|\/home\/sakura-desktop/)`; `assert.match(uid, /kwin_wayland_wrapper|startplasma-wayland/)`.
 */
test('UID payload bounds and fixed Root package adapter keep commands/environment out of Root scope argv', () => {
  const uid = desktopUidCommand(randomUUID(), { ...defaultDesktopPreferences, monitorLayout: 'dual-horizontal', sessionType: 'wayland' }, 'alpine', 20001);
  assert.doesNotMatch(uid, /cd |setpriv|killall|\/home\/sakura-desktop/);
  assert.match(uid, /kwin_wayland_wrapper|startplasma-wayland/); assert.match(uid, /xrandr --setmonitor/);
  assert.ok(projectIdentityPayload({ command: uid, environment: { TOKEN: 'snow-雪' } }).input.length < 131072);
  assert.deepEqual(desktopProjectEnvironment({ HOME: '/root', USER: 'root', DISPLAY: ':99', XAUTHORITY: '/tmp/x',
    SAKURA_DESKTOP_RUNTIME: '/tmp/fake', TOKEN: 'kept', BASH_ENV: 'uid-hook' }), { TOKEN: 'kept', BASH_ENV: 'uid-hook' });
  assert.throws(() => projectIdentityPayload({ command: uid, environment: { TOKEN: 'x'.repeat(8193) } }));
  const prepare = desktopProjectPrepare('alpine', defaultDesktopPreferences);
  assert.match(prepare, /env -i/); assert.doesNotMatch(prepare, /sakura-desktop-session|sakura-desktop-launcher|chown -R|\/home\/sakura-desktop/);
  assert.match(prepare, /apk add/);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: fixed adapter Python compiles and stream errors stay off binary stdout
 * 协作入口 / Collaborators: `spawnSync`, `assert.equal`, `assert.match`, `assert.doesNotMatch`.
 * 检查边界 / Checked boundaries: `assert.equal(parsed.status, 0, parsed.stderr)`; `assert.match(parsed.stdout, /compiled/)`.
 */
test('fixed adapter Python compiles and stream errors stay off binary stdout', () => {
  const parsed = spawnSync('python', ['-c', "import ast,sys;ast.parse(sys.stdin.read());print('compiled')"], { input: desktopAdapterSource, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr); assert.match(parsed.stdout, /compiled/);
  assert.match(desktopAdapterSource, /request\.get\('op'\)!='stream'/);
  assert.match(desktopAdapterSource, /desktop_authority\(proof\)/); assert.doesNotMatch(desktopAdapterSource, /eval\(.*command|killall/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: start rollback 503 retains reservation and config guard until original stop retry completes
 * 状态影响 / State effects: `f.state.stopFailures`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.start`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.start(), { status: 503, code: 'SERVICE_CLEANUP_FAILED' })`; `assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('start rollback 503 retains reservation and config guard until original stop retry completes', async t => {
  const f = await fixture(t, 'commit-ack-lost'); f.state.stopFailures = 3;
  await assert.rejects(f.start(), { status: 503, code: 'SERVICE_CLEANUP_FAILED' });
  assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
  await assert.rejects(f.start(), { status: 503, code: 'DESKTOP_CLEANUP_FAILED' });
  const retried = new ProjectDesktops(f.machines, f.workspaces, f.options);
  await retried.stop(f.id);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
  assert.equal(f.state.neighbor, true); assert.equal(f.state.detached, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: adapter cleanup 503 keeps pending lease after native closure until adapter retirement is confirmed
 * 状态影响 / State effects: `f.state.onProbe`, `f.state.cleanupFailure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.start`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.start(), { status: 503, code: 'DESKTOP_CLEANUP_FAILED' })`; `assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('adapter cleanup 503 keeps pending lease after native closure until adapter retirement is confirmed', async t => {
  const f = await fixture(t); f.state.onProbe = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: adapter cleanup 503 keeps pending lease after native closure until adapter retirement is confirmed
   * 失败 / Failure: `new AppError('readiness failed', 409, 'MODEL_FAILURE')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw new AppError('readiness failed', 409, 'MODEL_FAILURE'); };
  f.state.cleanupFailure = true;
  await assert.rejects(f.start(), { status: 503, code: 'DESKTOP_CLEANUP_FAILED' });
  assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
  f.state.cleanupFailure = false; await f.manager.stop(f.id);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: registered application full-domain cleanup precedes native retirement and its 503 retains original reservation
 * 状态影响 / State effects: `f.options.beforeRetire`, `f.state.onProbe`, `fail`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.start`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.start(), { status: 503, code: 'LINUX_CLIPBOARD_CLEANUP_FAILED' })`; `assert.equal(checked, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('registered application full-domain cleanup precedes native retirement and its 503 retains original reservation', async t => {
  const f = await fixture(t); let fail = true, checked = false;
  f.options.beforeRetire = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: registered application full-domain cleanup precedes native retirement and its 503 retains original reservation
   * 状态影响 / State effects: `checked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 失败 / Failure: `new AppError('original app group not confirmed', 503, 'LINUX_CLIPBOARD_CLEANUP_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `assert.ok`, `[...f.identity.tickets.values()].some`, `f.identity.tickets.values`.
   * 检查边界 / Checked boundaries: `assert.ok(f.state.detached)`; `assert.ok([...f.identity.tickets.values()].some(run => run.phase === 'active'))`.
   */
  async () => {
    assert.ok(f.state.detached); assert.ok([...f.identity.tickets.values()].some(run => run.phase === 'active'));
    checked = true; if (fail) throw new AppError('original app group not confirmed', 503, 'LINUX_CLIPBOARD_CLEANUP_FAILED');
  };
  f.state.onProbe = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: registered application full-domain cleanup precedes native retirement and its 503 retains original reservation
   * 失败 / Failure: `new AppError('readiness failed', 409, 'MODEL_FAILURE')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw new AppError('readiness failed', 409, 'MODEL_FAILURE'); };
  await assert.rejects(f.start(), { status: 503, code: 'LINUX_CLIPBOARD_CLEANUP_FAILED' });
  assert.equal(checked, true);
  assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
  fail = false; await f.manager.stop(f.id);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: partial preferences are copied before awaits and configure retains original saved preferences
 * 状态影响 / State effects: `(input as any).theme`, `configure.scale`, `binding`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.start`, `f.bindings.read`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(binding?.version === 2 && binding.preferences.theme, 'midnight')`; `assert.equal(binding?.version === 2 && binding.preferences.scale, 150)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('partial preferences are copied before awaits and configure retains original saved preferences', async t => {
  const f = await fixture(t), input = { theme: 'midnight' as const, panel: 'top' as const };
  const started = f.start(new AbortController(), input); (input as any).theme = 'paper';
  await started;
  let binding = await f.bindings.read(f.id); assert.equal(binding?.version === 2 && binding.preferences.theme, 'midnight');
  const configure = { scale: 150 }, updated = f.start(new AbortController(), configure, 'configure');
  configure.scale = 200; await updated;
  binding = await f.bindings.read(f.id);
  assert.equal(binding?.version === 2 && binding.preferences.scale, 150);
  assert.equal(binding?.version === 2 && binding.preferences.theme, 'midnight');
  assert.equal(binding?.version === 2 && binding.preferences.panel, 'top');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: administrative cleanup captures the original live object and refuses replacement control connections
 * 状态影响 / State effects: `f.state.installed`, `f.state.beforePrepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.start`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.start(new AbortController(), undefined, 'install'), { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' })`; `assert.ok(!f.state.commands.some(command => command.startsWith('# SAKURA_GUEST_TASK_CLEANUP')))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('administrative cleanup captures the original live object and refuses replacement control connections', async t => {
  const f = await fixture(t); f.state.installed = false;
  f.state.beforePrepare = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: administrative cleanup captures the original live object and refuses replacement control connections
   * 协作入口 / Collaborators: `f.machines.live.set`.
   */
  async () => { f.machines.live.set(f.id, { ...f.live, startedAt: 'replacement-live' } as any); };
  await assert.rejects(f.start(new AbortController(), undefined, 'install'), { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' });
  assert.ok(!f.state.commands.some(command => command.startsWith('# SAKURA_GUEST_TASK_CLEANUP')));
  assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
  const before = f.state.commands.length;
  await assert.rejects(f.manager.stop(f.id), { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' });
  assert.equal(f.state.commands.length, before);
  f.machines.live.set(f.id, f.live as any); await f.manager.stop(f.id);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: IME retires the original complete desktop and writes only its native HOME in the UID frame
 * 状态影响 / State effects: `f.state.beforePrepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.start`, `f.bindings.read`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(original?.version, 2)`; `assert.equal(binding?.version, 2)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('IME retires the original complete desktop and writes only its native HOME in the UID frame', async t => {
  const f = await fixture(t); await f.start(new AbortController(), { theme: 'midnight', panel: 'top' });
  const original = await f.bindings.read(f.id); assert.equal(original?.version, 2);
  f.state.beforePrepare = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: IME retires the original complete desktop and writes only its native HOME in the UID frame
   * 协作入口 / Collaborators: `assert.equal`, `assert.ok`, `[...f.identity.tickets.values()].every`, `f.identity.tickets.values`.
   * 检查边界 / Checked boundaries: `assert.equal(f.state.detached, false)`; `assert.ok([...f.identity.tickets.values()].every(ticket => ticket.phase === 'closed'))`.
   */
  async () => {
    assert.equal(f.state.detached, false);
    assert.ok([...f.identity.tickets.values()].every(ticket => ticket.phase === 'closed'));
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
    await f.workspaces.projects.update(f.id, f.beta);
  };
  await f.start(new AbortController(), undefined, 'ime');
  const binding = await f.bindings.read(f.id); assert.equal(binding?.version, 2);
  if (binding?.version !== 2 || original?.version !== 2) assert.fail();
  assert.equal(binding.projectId, f.alpha); assert.equal(binding.state, 'running');
  assert.equal(binding.preferences.theme, 'midnight'); assert.equal(binding.preferences.panel, 'top');
  assert.notEqual(binding.execution.run!.runId, original.execution.run!.runId);
  assert.equal(f.state.killed, 1); assert.equal(f.state.neighbor, true);
  const frame = f.identity.inputs.at(-1)!, script = frame.subarray(32, 32 + frame.readUInt32LE(24)).toString();
  assert.match(script, /"\$HOME\/\.config\/autostart\/fcitx5\.desktop"/);
  assert.match(script, /"\$HOME\/\.sakura-ime"/); assert.match(script, /\. \$HOME\/\.sakura-ime/);
  assert.doesNotMatch(script, /\/home\/sakura-desktop|chown -R|sakura-desktop-launcher|\bcd /);
  const administration = f.state.commands.find(command => command.startsWith('# SAKURA_GUEST_TASK_RUN') && command.includes('fcitx5'))!;
  assert.ok(administration); assert.match(administration, /env -i PATH=/);
  assert.doesNotMatch(administration, /desktop-secret|desktop-hook|\.sakura-ime|sakura-desktop-session|\/workspace\/alpha/);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: IME fixed package boundary and combined UID payload obey native limits without replacing existing profiles
 * 协作入口 / Collaborators: `desktopProjectImePrepare`, `assert.match`, `assert.doesNotMatch`, `desktopUidCommand`.
 * 检查边界 / Checked boundaries: `assert.match(root, /^env -i PATH=.*HOME=\//)`; `assert.match(root, /fcitx5/)`.
 */
test('IME fixed package boundary and combined UID payload obey native limits without replacing existing profiles', () => {
  for (const distro of ['alpine', 'debian']) {
    const root = desktopProjectImePrepare(distro);
    assert.match(root, /^env -i PATH=.*HOME=\//); assert.match(root, /fcitx5/);
    assert.doesNotMatch(root, /\/home|\.sakura-ime|autostart|sakura-desktop-launcher|chown|setpriv/);
    const script = desktopProjectImeCommand + '\n' + desktopUidCommand(randomUUID(), defaultDesktopPreferences, distro, 20001);
    assert.match(script, /if \[ ! -f "\$HOME\/\.config\/fcitx5\/profile" \]/);
    assert.ok(projectIdentityPayload({ command: script, environment: { TOKEN: '雪' } }).input.length < 131072);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: IME refuses unavailable Desktop and another project owner without issuing an administration task
 * 状态影响 / State effects: `f.state.installed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.start`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.start(new AbortController(), undefined, 'ime'), { status: 409 })`; `assert.equal(f.state.preparations, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('IME refuses unavailable Desktop and another project owner without issuing an administration task', async t => {
  const f = await fixture(t); f.state.installed = false;
  await assert.rejects(f.start(new AbortController(), undefined, 'ime'), { status: 409 });
  assert.equal(f.state.preparations, 0); assert.equal(f.identity.inputs.length, 0);
  f.state.installed = true; await f.start();
  await assert.rejects(f.manager.start(f.id, 'ime', undefined, { ...f.pins, projectId: f.beta },
    new AbortController().signal, () => {}, () => {}), { status: 409, code: 'DESKTOP_SCOPE_CHANGED' });
  assert.equal(f.state.preparations, 0); assert.equal(f.state.killed, 0);
});
