/**
 * 模块职责：回归验证模块，围绕 `process-supervisor` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `process-supervisor`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: VM, tools and reserved control admission remain independent and bounded; cancellation holds the execution slot until the adapter acknowledges completion.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { HostRuntime } from '../server/host-runtime/index.ts';
import { ProcessSupervisor, spawnObserved } from '../server/process-supervisor.ts';
import { withOperationCheck } from '../server/operation-context.ts';

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `promise, resolve`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `promise, resolve`; the actual branch determines its shape.
 */
function deferred() {
  let resolve!: /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    /**
     * 中文功能：完成夹具中预先保存的 Promise，使等待它的异步步骤取得传入值。
     * English: Settle the Promise retained by the fixture so waiting asynchronous steps receive the supplied value.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`resolve()`）。
     * Result: Return the branch-computed value (`resolve()`).
     * 协作入口 / Collaborators: `resolve`.
     */
    resolve: () => resolve(),
  };
}
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`new HostRuntime({ budgets: { process: { capacity: 4, reserved: 1 }, 'process.vm'…`）。
 * Result: Return the branch-computed value (`new HostRuntime({ budgets: { process: { capacity: 4, reserved: 1 }, 'process.vm'…`).
 */
const governor = () =>
  new HostRuntime({
    budgets: {
      process: { capacity: 4, reserved: 1 },
      'process.vm': { capacity: 1 },
      'process.tool': { capacity: 2, reserved: 1 },
      'process.helper': { capacity: 1 },
    },
  });
/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `child, signals`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `child, signals`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `Object.assign`.
 */
function fakeChild() {
  const signals: NodeJS.Signals[] = [];
  const child = Object.assign(new EventEmitter(), {
    stderr: new PassThrough(),
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: signal: NodeJS.Signals = 'SIGTERM'。
     * 结果：返回布尔判定，供用例选择路径或核对受控条件。
     * Result: Return a boolean decision for path selection or controlled-condition assertions.
     * 协作入口 / Collaborators: `signals.push`.
     */
    kill(signal: NodeJS.Signals = 'SIGTERM') {
      signals.push(signal);
      return true;
    },
  }) as unknown as ChildProcess;
  return { child, signals };
}
const helperOptions = {
  owner: 'vm:fixture',
  helper: 'virtiofsd' as const,
  label: 'fixture',
  file: 'fixture',
  args: [],
  graceMs: 1,
  closeTimeoutMs: 5,
};

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: VM, tools and reserved control admission remain independent and bounded
 * 协作入口 / Collaborators: `governor`, `deferred`, `supervisor.run`, `delay`.
 * 检查边界 / Checked boundaries: `assert.rejects(queued)`; `assert.equal(host.snapshot().resources.filter((value) => value.state === 'active').length, 3)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('VM, tools and reserved control admission remain independent and bounded', async () => {
  const host = governor(),
    supervisor = new ProcessSupervisor(host),
    release = deferred();
  const vm = supervisor.run({ owner: 'vm:one', kind: 'vm', label: 'QEMU' }, () => release.promise);
  await delay(0);
  const cancel = new AbortController();
  let started = false;
  const queued = supervisor.run(
    { owner: 'vm:two', kind: 'vm', label: 'QEMU', signal: cancel.signal },
    async () => {
      started = true;
    },
  );
  const rejected = assert.rejects(queued);
  const tool = supervisor.run({ owner: 'disk', kind: 'tool', label: 'qemu-img' }, () => release.promise);
  const control = supervisor.run(
    { owner: 'probe', kind: 'tool', label: 'probe', lane: 'control' },
    () => release.promise,
  );
  await delay(0);
  assert.equal(host.snapshot().resources.filter((value) => value.state === 'active').length, 3);
  assert.equal(host.snapshot().queued, 1);
  cancel.abort();
  await rejected;
  assert.equal(started, false);
  release.resolve();
  await Promise.all([vm, tool, control]);
  assert.equal(host.snapshot().resources.length, 0);
  host.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancellation holds the execution slot until the adapter acknowledges completion
 * 协作入口 / Collaborators: `governor`, `deferred`, `supervisor.run`, `delay`.
 * 检查边界 / Checked boundaries: `assert.equal(host.snapshot().budgets.find((value) => value.key === 'process.vm')?.used, 1)`; `assert.equal(host.snapshot().resources.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cancellation holds the execution slot until the adapter acknowledges completion', async () => {
  const host = governor(),
    supervisor = new ProcessSupervisor(host),
    release = deferred(),
    cancel = new AbortController();
  const task = supervisor.run(
    { owner: 'vm:one', kind: 'vm', label: 'QEMU', signal: cancel.signal },
    () => release.promise,
  );
  await delay(0);
  cancel.abort();
  await delay(0);
  assert.equal(host.snapshot().budgets.find((value) => value.key === 'process.vm')?.used, 1);
  release.resolve();
  await task;
  assert.equal(host.snapshot().resources.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unconfirmed native retirement retains its visible budget
 * 协作入口 / Collaborators: `governor`, `assert.rejects`, `supervisor.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects( supervisor.run({ owner: 'vm:one', kind: 'vm', label: 'QEMU' }, async (control) => { const error = new Error('missi…`; `assert.equal(host.snapshot().resources[0].state, 'cleanup-pending')`.
 */
test('unconfirmed native retirement retains its visible budget', async () => {
  const host = governor(),
    supervisor = new ProcessSupervisor(host);
  await assert.rejects(
    supervisor.run({ owner: 'vm:one', kind: 'vm', label: 'QEMU' }, async (control) => {
      const error = new Error('missing native receipt');
      control.cleanupPending(error);
      throw error;
    }),
    /missing native receipt/,
  );
  assert.equal(host.snapshot().resources[0].state, 'cleanup-pending');
  assert.equal(host.snapshot().budgets.find((value) => value.key === 'process.vm')?.used, 1);
  assert.throws(() => host.close(), /未确认释放/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: helper cancellation and exit do not release its slot before physical close
 * 协作入口 / Collaborators: `governor`, `fakeChild`, `supervisor.helper`, `helper.ready`.
 * 检查边界 / Checked boundaries: `assert.equal(helper.close(), close)`; `assert.equal(host.snapshot().resources.length, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('helper cancellation and exit do not release its slot before physical close', async () => {
  const host = governor(),
    fake = fakeChild(),
    cancel = new AbortController();
  const supervisor = new ProcessSupervisor(host, () => fake.child);
  const helper = await supervisor.helper({ ...helperOptions, signal: cancel.signal, closeTimeoutMs: 100 });
  await helper.ready(async () => true);
  cancel.abort();
  const close = helper.close();
  assert.equal(helper.close(), close);
  fake.child.emit('exit', 0, null);
  await delay(0);
  assert.equal(host.snapshot().resources.length, 1);
  fake.child.emit('close', 0, null);
  await close;
  assert.equal(host.snapshot().resources.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed helper termination keeps its budget and a later close retires it
 * 协作入口 / Collaborators: `governor`, `fakeChild`, `supervisor.helper`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(helper.close(), { code: 'HOST_PROCESS_CLEANUP_PENDING' })`; `assert.deepEqual(fake.signals, ['SIGTERM', 'SIGKILL'])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('failed helper termination keeps its budget and a later close retires it', async () => {
  const host = governor(),
    fake = fakeChild(),
    supervisor = new ProcessSupervisor(host, () => fake.child);
  const helper = await supervisor.helper(helperOptions);
  await assert.rejects(helper.close(), { code: 'HOST_PROCESS_CLEANUP_PENDING' });
  assert.deepEqual(fake.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(host.snapshot().resources[0].state, 'cleanup-pending');
  fake.child.emit('close', null, 'SIGKILL');
  await helper.close();
  assert.equal(host.snapshot().resources.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: helper readiness cannot succeed after exit or wait forever on a probe
 * 协作入口 / Collaborators: `governor`, `fakeChild`, `supervisor.helper`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects( helper.ready(() => new Promise(() => {}), 5), /未在限时内就绪/, )`; `assert.rejects( helper.ready(async () => true), /未在限时内就绪/, )`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('helper readiness cannot succeed after exit or wait forever on a probe', async () => {
  const host = governor(),
    fake = fakeChild(),
    supervisor = new ProcessSupervisor(host, () => fake.child);
  const helper = await supervisor.helper(helperOptions);
  await assert.rejects(
    helper.ready(() => new Promise(() => {}), 5),
    /未在限时内就绪/,
  );
  fake.child.emit('exit', 0, null);
  await assert.rejects(
    helper.ready(async () => true),
    /未在限时内就绪/,
  );
  fake.child.emit('close', 0, null);
  await helper.close();
  assert.equal(host.snapshot().resources.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: helper spawn failure still waits for close and reports the exact owner exit
 * 协作入口 / Collaborators: `governor`, `fakeChild`, `new ProcessSupervisor(host, () => fake.child).helper`, `fake.child.emit`.
 * 检查边界 / Checked boundaries: `assert.rejects( helper.ready(async () => false), /spawn denied/, )`; `assert.equal(host.snapshot().resources.length, 1)`.
 */
test('helper spawn failure still waits for close and reports the exact owner exit', async () => {
  const host = governor(),
    fake = fakeChild(),
    exits: unknown[] = [];
  const helper = await new ProcessSupervisor(host, () => fake.child).helper({
    ...helperOptions,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: value。
     * 结果：返回分支计算值（`exits.push(value)`）。
     * Result: Return the branch-computed value (`exits.push(value)`).
     * 验证场景 / Scenario: helper spawn failure still waits for close and reports the exact owner exit
     * 协作入口 / Collaborators: `exits.push`.
     */
    onExit: (value) => exits.push(value),
  });
  fake.child.emit('error', new Error('spawn denied'));
  await assert.rejects(
    helper.ready(async () => false),
    /spawn denied/,
  );
  assert.equal(host.snapshot().resources.length, 1);
  fake.child.emit('close', -1, null);
  assert.equal(exits.length, 1);
  assert.equal(host.snapshot().resources.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a real dedicated helper is killed and accounted until its observed close
 * 协作入口 / Collaborators: `governor`, `supervisor.helper`, `helper.ready`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(child.pid)`; `assert.equal(host.snapshot().resources.length, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a real dedicated helper is killed and accounted until its observed close', async () => {
  const host = governor();
  let child!: ChildProcess;
  const supervisor = new ProcessSupervisor(
    host,
    (file, args) =>
      (child = spawn(file, args, { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })),
  );
  const helper = await supervisor.helper({
    ...helperOptions,
    file: process.execPath,
    args: ['-e', "process.stderr.write('READY'); setInterval(()=>{},1000)"],
    graceMs: 200,
    closeTimeoutMs: 2000,
  });
  try {
    await helper.ready(async () => helper.failure.includes('READY'));
    assert.ok(child.pid);
    assert.equal(host.snapshot().resources.length, 1);
  } finally {
    await helper.close();
  }
  assert.equal(host.snapshot().resources.length, 0);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: observed protocol error and exit retain quota until physical close, including a late receipt
 * 协作入口 / Collaborators: `governor`, `fakeChild`, `supervisor.observe`, `fake.child.emit`.
 * 检查边界 / Checked boundaries: `assert.rejects(owned.waitForClose(5), { code: 'HOST_PROCESS_CLEANUP_PENDING' })`; `assert.equal(host.snapshot().resources[0].state, 'cleanup-pending')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('observed protocol error and exit retain quota until physical close, including a late receipt', async () => {
  const host = governor(),
    fake = fakeChild(),
    supervisor = new ProcessSupervisor(host);
  const owned = await supervisor.observe('gpg-native-relay', () => fake.child);
  fake.child.emit('error', new Error('protocol stopped'));
  fake.child.emit('exit', 1, null);
  await assert.rejects(owned.waitForClose(5), { code: 'HOST_PROCESS_CLEANUP_PENDING' });
  assert.equal(host.snapshot().resources[0].state, 'cleanup-pending');
  await assert.rejects(
    supervisor.observe('gpg-native-relay', () => assert.fail('over capacity')),
    { code: 'RESOURCE_CAPACITY' },
  );
  fake.child.emit('close', 1, null);
  assert.equal((await owned.waitForClose()).failure, 'protocol stopped');
  assert.equal(host.snapshot().resources.length, 0);
  host.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: raw launcher capability expires after one synchronous admitted spawn and constructor failure awaits cleanup
 * 协作入口 / Collaborators: `assert.throws`, `governor`, `supervisor.observe`, `child.kill`.
 * 检查边界 / Checked boundaries: `assert.throws(() => spawnObserved(process.execPath, ['--version']), /admission/)`; `assert.rejects( supervisor.observe('gpg-native-relay', () => { child = spawnObserved(process.execPath, ['-e', 'setInterval(()=>{},…`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('raw launcher capability expires after one synchronous admitted spawn and constructor failure awaits cleanup', async () => {
  assert.throws(() => spawnObserved(process.execPath, ['--version']), /admission/);
  const host = governor(),
    supervisor = new ProcessSupervisor(host);
  let child!: ChildProcess, detached!: Promise<void>;
  const owned = await supervisor.observe('gpg-native-relay', () => {
    child = spawnObserved(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    assert.throws(() => spawnObserved(process.execPath, ['--version']), /admission/);
    detached = Promise.resolve().then(() => {
      assert.throws(() => spawnObserved(process.execPath, ['--version']), /admission/);
    });
    return child;
  });
  await detached;
  child.kill();
  await owned.waitForClose();
  await assert.rejects(
    supervisor.observe('gpg-native-relay', () => {
      child = spawnObserved(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      throw new Error('bad constructor frame');
    }),
    /bad constructor frame/,
  );
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  assert.equal(host.snapshot().resources.length, 0);
  host.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: only explicitly handed-off user applications can release a still-running observed child
 * 协作入口 / Collaborators: `governor`, `fakeChild`, `supervisor.observe`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.throws(() => owned.handoffToUser(), /handed off/)`; `assert.equal(host.snapshot().resources.length, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('only explicitly handed-off user applications can release a still-running observed child', async () => {
  const host = governor(),
    supervisor = new ProcessSupervisor(host),
    fake = fakeChild();
  const owned = await supervisor.observe('clipboard-command', () => fake.child);
  assert.throws(() => owned.handoffToUser(), /handed off/);
  assert.equal(host.snapshot().resources.length, 1);
  fake.child.emit('close', 0, null);
  await owned.closed;
  const user = await supervisor.observe('windows-user-application', () => fakeChild().child);
  user.handoffToUser();
  assert.equal(host.snapshot().resources.length, 0);
  host.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Native Host atomically reserves wrapper plus target while classification and direct children remain single
 * 协作入口 / Collaborators: `deferred`, `fakeChild`, `supervisor.run`, `delay`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(host.snapshot().resources[0].cost, { process: 2, 'process.vm': 1 })`; `assert.deepEqual(host.snapshot().resources.find((value) => value.kind === 'process.helper')!.cost, { process: 1, 'process.helper':…`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('Native Host atomically reserves wrapper plus target while classification and direct children remain single', async () => {
  const host = new HostRuntime({
    budgets: {
      process: { capacity: 4 },
      'process.vm': { capacity: 1 },
      'process.tool': { capacity: 1 },
      'process.helper': { capacity: 1 },
    },
  });
  const supervisor = new ProcessSupervisor(host),
    done = deferred(),
    fake = fakeChild();
  const vm = supervisor.run(
    { owner: 'vm:native', kind: 'vm', label: 'QEMU', mode: 'native-owner' },
    () => done.promise,
  );
  await delay(0);
  assert.deepEqual(host.snapshot().resources[0].cost, { process: 2, 'process.vm': 1 });
  const direct = await supervisor.observe('gpg-native-relay', () => fake.child);
  assert.deepEqual(host.snapshot().resources.find((value) => value.kind === 'process.helper')!.cost, {
    process: 1,
    'process.helper': 1,
  });
  assert.equal(host.snapshot().budgets.find((value) => value.key === 'process')!.used, 3);
  fake.child.emit('close', 0, null);
  await direct.closed;
  done.resolve();
  await vm;
  assert.equal(host.snapshot().resources.length, 0);
  host.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Native Host exhaustion holds no partial classification and reserved control admits one whole cleanup owner
 * 协作入口 / Collaborators: `deferred`, `supervisor.run`, `delay`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(queued)`; `assert.equal(host.snapshot().queued, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('Native Host exhaustion holds no partial classification and reserved control admits one whole cleanup owner', async () => {
  const host = new HostRuntime({
    budgets: {
      process: { capacity: 4, reserved: 2 },
      'process.vm': { capacity: 1 },
      'process.tool': { capacity: 2, reserved: 1 },
    },
  });
  const supervisor = new ProcessSupervisor(host),
    done = deferred(),
    cancel = new AbortController();
  const vm = supervisor.run(
    { owner: 'vm:native', kind: 'vm', label: 'QEMU', mode: 'native-owner' },
    () => done.promise,
  );
  await delay(0);
  const queued = supervisor.run(
    { owner: 'tool:queued', kind: 'tool', label: 'disk', mode: 'native-owner', signal: cancel.signal },
    async () => assert.fail('cancelled capacity waiter started'),
  );
  const rejected = assert.rejects(queued);
  await delay(0);
  assert.equal(host.snapshot().queued, 1);
  assert.equal(host.snapshot().budgets.find((value) => value.key === 'process.tool')!.used, 0);
  const cleanup = supervisor.run(
    { owner: 'cleanup:original', kind: 'tool', label: 'receipt', mode: 'native-owner', lane: 'control' },
    () => done.promise,
  );
  await delay(0);
  assert.equal(host.snapshot().budgets.find((value) => value.key === 'process')!.used, 4);
  assert.equal(host.snapshot().budgets.find((value) => value.key === 'process.tool')!.used, 1);
  cancel.abort();
  await rejected;
  assert.equal(host.snapshot().budgets.find((value) => value.key === 'process')!.used, 4);
  done.resolve();
  await Promise.all([vm, cleanup]);
  host.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Native Host unresolved cleanup retains both participants after cancellation
 * 协作入口 / Collaborators: `assert.rejects`, `supervisor.run`, `assert.equal`, `host.snapshot`.
 * 检查边界 / Checked boundaries: `assert.rejects( supervisor.run( { owner: 'native:pending', kind: 'tool', label: 'tool', mode: 'native-owner', signal: cancel.signa…`; `assert.equal(host.snapshot().resources[0].state, 'cleanup-pending')`.
 */
test('Native Host unresolved cleanup retains both participants after cancellation', async () => {
  const host = new HostRuntime({ budgets: { process: { capacity: 2 }, 'process.tool': { capacity: 1 } } });
  const supervisor = new ProcessSupervisor(host),
    cancel = new AbortController();
  await assert.rejects(
    supervisor.run(
      { owner: 'native:pending', kind: 'tool', label: 'tool', mode: 'native-owner', signal: cancel.signal },
      async (control) => {
        cancel.abort();
        const error = new Error('whole tree unconfirmed');
        control.cleanupPending(error);
        throw error;
      },
    ),
    /whole tree unconfirmed/,
  );
  assert.equal(host.snapshot().resources[0].state, 'cleanup-pending');
  assert.deepEqual(host.snapshot().resources[0].cost, { process: 2, 'process.tool': 1 });
  assert.equal(host.snapshot().budgets.find((value) => value.key === 'process')!.used, 2);
  assert.throws(() => host.close(), /未确认释放/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: helper admission rechecks authority while exact recovery retains control capacity
 * 协作入口 / Collaborators: `governor`, `fakeChild`, `withOperationCheck`, `host.close`.
 */
test('helper admission rechecks authority while exact recovery retains control capacity', async () => {
  const host = governor(),
    supervisor = new ProcessSupervisor(host),
    fake = fakeChild();
  await withOperationCheck(
    async () => {
      throw new Error('authority revoked');
    },
    async () => {
      await assert.rejects(
        supervisor.observe('gpg-native-relay', () => assert.fail('unauthorized spawn')),
        /authority revoked/,
      );
      const recovery = await supervisor.observe('gpg-native-relay', () => fake.child, { lane: 'control' });
      fake.child.emit('close', 0, null);
      await recovery.closed;
    },
  );
  host.close();
});
