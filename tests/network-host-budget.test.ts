/**
 * 模块职责：回归验证模块，围绕 `network-host-budget` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `network-host-budget`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: tryAcquire is atomic, preserves queued fairness and leaves no failed partition allocations; independent pools share the global cap and an expansion failure reuses live worker capacity.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter, once } from 'node:events';
import { fork, spawn, type ChildProcess } from 'node:child_process';
import { PassThrough, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { HostRuntime } from '../server/host-runtime/index.ts';
import { HostNetworkPool } from '../server/network/host-pool.ts';
import { ROOT } from '../server/paths.ts';

const binary = join(
  process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu'),
  `qemu-system-x86_64${process.platform === 'win32' ? '.exe' : ''}`,
);
const options = { maxWorkers: 4, connectionsPerWorker: 8, scaleAt: 1, idleMs: 60_000 };
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: processes = 4; network = 4。
 * 结果：返回分支计算值（`new HostRuntime({ budgets: { process: { capacity: processes }, 'network.worker':…`）。
 * Result: Return the branch-computed value (`new HostRuntime({ budgets: { process: { capacity: processes }, 'network.worker':…`).
 */
const governor = (processes = 4, network = 4) =>
  new HostRuntime({ budgets: { process: { capacity: processes }, 'network.worker': { capacity: network } } });
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: runtime: HostRuntime; key = 'process'。
 * 结果：返回分支计算值（`runtime.snapshot().budgets.find((budget) => budget.key === key)!.used`）。
 * Result: Return the branch-computed value (`runtime.snapshot().budgets.find((budget) => budget.key === key)!.used`).
 * 协作入口 / Collaborators: `runtime.snapshot().budgets.find`, `runtime.snapshot`.
 */
const used = (runtime: HostRuntime, key = 'process') =>
  runtime.snapshot().budgets.find((budget) => budget.key === key)!.used;
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: check: () => boolean。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `Date.now`, `check`, `assert.ok`, `delay`.
 * 检查边界 / Checked boundaries: `assert.ok(Date.now() < until, 'Network resources did not settle')`.
 */
async function eventually(check: /**
 * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
 * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => boolean) {
  const until = Date.now() + 3000;
  while (!check()) {
    assert.ok(Date.now() < until, 'Network resources did not settle');
    await delay(5);
  }
}
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: file: string。
 * 结果：返回分支计算值（`fork(file, [], { execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'i…`）。
 * Result: Return the branch-computed value (`fork(file, [], { execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'i…`).
 * 协作入口 / Collaborators: `fork`.
 */
const forkWorker = (file: string) =>
  fork(file, [], { execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
const qmpFixture = `process.stdout.write(JSON.stringify({QMP:{version:{}}})+'\\n'); let text='';
process.stdin.setEncoding('utf8'); process.stdin.on('data', bytes=>{text+=bytes;let end;
while((end=text.indexOf('\\n'))>=0){const line=text.slice(0,end);text=text.slice(end+1);const m=JSON.parse(line);
process.stdout.write(JSON.stringify({id:m.id,return:{name:'fixture',value:m.arguments?.value}})+'\\n');}});`;
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`spawn(process.execPath, ['-e', qmpFixture], { windowsHide: true, stdio: ['pipe',…`）。
 * Result: Return the branch-computed value (`spawn(process.execPath, ['-e', qmpFixture], { windowsHide: true, stdio: ['pipe',…`).
 * 协作入口 / Collaborators: `spawn`.
 */
function fakeBackend() {
  return spawn(process.execPath, ['-e', qmpFixture], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
}
class UnconfirmedBackend extends EventEmitter {
  pid = 424242;
  kills = 0;
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new Writable({
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: chunk; _encoding; done。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `String(chunk).trim().split`, `String(chunk).trim`, `String`, `JSON.parse`.
     */
    write: (chunk, _encoding, done) => {
      for (const line of String(chunk).trim().split('\n')) {
        const message = JSON.parse(line);
        this.stdout.write(JSON.stringify({ id: message.id, return: {} }) + '\n');
      }
      done();
    },
  });
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回布尔判定，供用例选择路径或核对受控条件。
   * Result: Return a boolean decision for path selection or controlled-condition assertions.
   */
  kill() {
    this.kills++;
    return true;
  }
  /**
   * 中文功能：初始化测试夹具实例并保存构造输入，后续方法复用该实例状态。
   * English: Initialize a test-fixture instance and retain constructor inputs for subsequent stateful methods.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `super`, `setImmediate`.
   */
  constructor() {
    super();
    setImmediate(() => this.stdout.write('{"QMP":{}}\n'));
  }
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: tryAcquire is atomic, preserves queued fairness and leaves no failed partition allocations
 * 协作入口 / Collaborators: `governor`, `runtime.tryAcquire`, `runtime.snapshot`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal( runtime.tryAcquire({ owner: 'two', kind: 'fixture', label: 'blocked', cost: { process: 1, 'network.worker': 1 }, par…`; `assert.deepEqual({ ...after, resources: after.resources.map(({ timings, ...resource }) => resource) }, { ...before, resources: bef…`.
 */
test('tryAcquire is atomic, preserves queued fairness and leaves no failed partition allocations', async () => {
  const runtime = governor(2, 2);
  const first = runtime.tryAcquire({
    owner: 'one',
    kind: 'fixture',
    label: 'occupied',
    cost: { process: 2 },
  })!;
  const before = runtime.snapshot();
  assert.equal(
    runtime.tryAcquire({
      owner: 'two',
      kind: 'fixture',
      label: 'blocked',
      cost: { process: 1, 'network.worker': 1 },
      partitions: [{ key: 'never-created', limit: 1 }],
    }),
    undefined,
  );
  const after = runtime.snapshot();
  // Diagnostic clocks advance without changing admission or partition ownership.
  assert.deepEqual({ ...after, resources: after.resources.map(({ timings, ...resource }) => resource) },
    { ...before, resources: before.resources.map(({ timings, ...resource }) => resource) });
  assert.ok(after.resources[0].timings!.executionMs >= before.resources[0].timings!.executionMs);
  const queued = runtime.acquire({ owner: 'queued', kind: 'fixture', label: 'older', cost: { process: 1 } });
  assert.equal(
    runtime.tryAcquire({
      owner: 'new',
      kind: 'fixture',
      label: 'no overtaking',
      cost: { 'network.worker': 1 },
    }),
    undefined,
  );
  first.release();
  const second = await queued;
  second.release();
  const partition = runtime.tryAcquire({
    owner: 'partition',
    kind: 'fixture',
    label: 'atomic',
    cost: { process: 1, 'network.worker': 1 },
    partitions: [{ key: 'temporary', limit: 1 }],
  })!;
  assert.equal(used(runtime), 1);
  assert.equal(used(runtime, 'network.worker'), 1);
  partition.release();
  assert.equal(
    runtime.snapshot().budgets.some((budget) => budget.key.startsWith('partition:')),
    false,
  );
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: independent pools share the global cap and an expansion failure reuses live worker capacity
 * 协作入口 / Collaborators: `governor`, `first.pin`, `assert.equal`, `one.resources`.
 * 检查边界 / Checked boundaries: `assert.equal(one.resources().worker, two.resources().worker)`; `assert.equal(used(runtime), 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('independent pools share the global cap and an expansion failure reuses live worker capacity', async () => {
  const runtime = governor(3, 1),
    first = new HostNetworkPool(options, { governor: runtime }),
    second = new HostNetworkPool(options, { governor: runtime });
  try {
    const one = first.pin(() => {}),
      two = first.pin(() => {});
    assert.equal(one.resources().worker, two.resources().worker);
    assert.equal(used(runtime), 1);
    assert.throws(() => second.pin(() => {}), { code: 'NETWORK_BUSY' });
    const answers = await Promise.all([
      one.call('lookup', { hostname: 'localhost', options: {} }),
      two.call('lookup', { hostname: 'localhost', options: {} }),
    ]);
    assert.equal(answers.length, 2);
    one.release();
    two.release();
  } finally {
    await first.close();
    await second.close();
  }
  assert.equal(used(runtime), 0);
  assert.equal(runtime.snapshot().resources.length, 0);
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancelled startup and failed forks release budget only after owned process closure
 * 协作入口 / Collaborators: `governor`, `pool.lookup`, `abort.abort`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(lookup, (error) => error === reason)`; `assert.equal(used(runtime), 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cancelled startup and failed forks release budget only after owned process closure', async () => {
  const runtime = governor(),
    pool = new HostNetworkPool(options, { governor: runtime });
  const abort = new AbortController(),
    reason = new Error('cancelled startup');
  const lookup = pool.lookup('localhost', {}, abort.signal);
  abort.abort(reason);
  await assert.rejects(lookup, (error) => error === reason);
  await pool.close();
  assert.equal(used(runtime), 0);
  const failed = new HostNetworkPool(options, {
    governor: runtime,
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: cancelled startup and failed forks release budget only after owned process closure
     * 失败 / Failure: `new Error('fork refused')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    forkWorker: () => {
      throw new Error('fork refused');
    },
  });
  await assert.rejects(failed.start(), /fork refused/);
  assert.equal(used(runtime), 0);
  await failed.close();
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: backend must be authorized and budgeted before spawn
 * 协作入口 / Collaborators: `governor`, `pool.pin`, `assert.rejects`, `pin.call`.
 * 检查边界 / Checked boundaries: `assert.rejects( pin.call('qmp', { binary: process.execPath, execute: 'query-version', args: {} }), /program/, )`; `assert.rejects(pin.call('qmp', { binary, execute: 'query-version', args: {} }), { code: 'NETWORK_BUSY', })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('backend must be authorized and budgeted before spawn', async () => {
  const runtime = governor(1, 1);
  let started = 0;
  const pool = new HostNetworkPool(options, {
    governor: runtime,
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`fakeBackend()`）。
     * Result: Return the branch-computed value (`fakeBackend()`).
     * 验证场景 / Scenario: backend must be authorized and budgeted before spawn
     * 协作入口 / Collaborators: `fakeBackend`.
     */
    spawnBackend: () => {
      started++;
      return fakeBackend();
    },
  });
  const pin = pool.pin(() => {});
  try {
    await assert.rejects(
      pin.call('qmp', { binary: process.execPath, execute: 'query-version', args: {} }),
      /program/,
    );
    await assert.rejects(pin.call('qmp', { binary, execute: 'query-version', args: {} }), {
      code: 'NETWORK_BUSY',
    });
    assert.equal(started, 0);
    assert.equal(used(runtime), 1);
  } finally {
    await pool.close();
  }
  assert.equal(used(runtime), 0);
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: VM supervisor/backend reservations are acquired as a pair before spawning and can reuse an existing pair
 * 协作入口 / Collaborators: `governor`, `pool.pin`, `assert.equal`, `used`.
 * 检查边界 / Checked boundaries: `assert.equal(used(runtime), 2)`; `assert.ok(first.resources().backend)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('VM supervisor/backend reservations are acquired as a pair before spawning and can reuse an existing pair', async () => {
  const runtime = governor(3, 3);
  let forks = 0;
  const pool = new HostNetworkPool(
    { ...options, reserveBackend: true },
    {
      governor: runtime,
      /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: file。
       * 结果：返回分支计算值（`forkWorker(file)`）。
       * Result: Return the branch-computed value (`forkWorker(file)`).
       * 验证场景 / Scenario: VM supervisor/backend reservations are acquired as a pair before spawning and can reuse an existing pair
       * 协作入口 / Collaborators: `forkWorker`.
       */
      forkWorker: (file) => {
        forks++;
        return forkWorker(file);
      },
      spawnBackend: fakeBackend,
    },
  );
  try {
    const first = pool.pin(() => {});
    assert.equal(used(runtime), 2);
    assert.ok(first.resources().backend);
    const second = pool.pin(() => {});
    assert.equal(forks, 1);
    assert.equal(used(runtime), 2);
    assert.equal(first.resources().worker, second.resources().worker);
    await first.call('qmp', { binary, execute: 'query-version', args: {} });
    assert.equal(used(runtime), 2);
    first.release();
    second.release();
  } finally {
    await pool.close();
  }
  assert.equal(used(runtime), 0);
  const occupied = runtime.tryAcquire({
    owner: 'fixture',
    kind: 'fixture',
    label: 'one remaining slot',
    cost: { process: 2 },
  })!;
  const blocked = new HostNetworkPool(
    { ...options, reserveBackend: true },
    {
      governor: runtime,
      /**
       * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
       * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: VM supervisor/backend reservations are acquired as a pair before spawning and can reuse an existing pair
       * 失败 / Failure: `new Error('must not fork')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       */
      forkWorker: () => {
        throw new Error('must not fork');
      },
    },
  );
  assert.throws(() => blocked.pin(() => {}), { code: 'NETWORK_BUSY' });
  assert.equal(used(runtime), 2);
  await blocked.close();
  occupied.release();
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: backend spawn failures and closing a worker before backend launch return both reservations
 * 协作入口 / Collaborators: `governor`, `startup.pin`, `assert.equal`, `used`.
 * 检查边界 / Checked boundaries: `assert.equal(used(runtime), 2)`; `assert.equal(used(runtime), 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('backend spawn failures and closing a worker before backend launch return both reservations', async () => {
  const runtime = governor(2, 2);
  const startup = new HostNetworkPool({ ...options, reserveBackend: true }, { governor: runtime });
  startup.pin(() => {});
  assert.equal(used(runtime), 2);
  await startup.close();
  assert.equal(used(runtime), 0);
  const failed = new HostNetworkPool(
    { ...options, reserveBackend: true },
    {
      governor: runtime,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`spawn(join(ROOT, '__missing-network-budget-fixture__'), [], { windowsHide: true,…`）。
       * Result: Return the branch-computed value (`spawn(join(ROOT, '__missing-network-budget-fixture__'), [], { windowsHide: true,…`).
       * 验证场景 / Scenario: backend spawn failures and closing a worker before backend launch return both reservations
       * 协作入口 / Collaborators: `spawn`, `join`.
       */
      spawnBackend: () =>
        spawn(join(ROOT, '__missing-network-budget-fixture__'), [], {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
    },
  );
  const pin = failed.pin(() => {});
  await assert.rejects(pin.call('qmp', { binary, execute: 'query-version', args: {} }));
  await failed.close();
  assert.equal(used(runtime), 0);
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a worker crash reaps the originally owned backend handle and both resource leases
 * 协作入口 / Collaborators: `governor`, `pool.pin`, `pin.call`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(answer.value, '网络✓')`; `assert.equal(used(runtime), 2)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a worker crash reaps the originally owned backend handle and both resource leases', async () => {
  const runtime = governor(2, 2);
  let worker!: ChildProcess, backend!: ChildProcess;
  const pool = new HostNetworkPool(options, {
    governor: runtime,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: file。
     * 结果：返回分支计算值（`(worker = forkWorker(file))`）。
     * Result: Return the branch-computed value (`(worker = forkWorker(file))`).
     * 验证场景 / Scenario: a worker crash reaps the originally owned backend handle and both resource leases
     * 状态影响 / State effects: `worker`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `forkWorker`.
     */
    forkWorker: (file) => (worker = forkWorker(file)),
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`(backend = fakeBackend())`）。
     * Result: Return the branch-computed value (`(backend = fakeBackend())`).
     * 验证场景 / Scenario: a worker crash reaps the originally owned backend handle and both resource leases
     * 状态影响 / State effects: `backend`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `fakeBackend`.
     */
    spawnBackend: () => (backend = fakeBackend()),
  });
  const pin = pool.pin(() => {});
  try {
    const answer = await pin.call('qmp', { binary, execute: 'query-version', args: { value: '网络✓' } });
    assert.equal(answer.value, '网络✓');
    assert.equal(used(runtime), 2);
    assert.ok(pool.snapshot()[0].backendResourceId);
    assert.equal(pin.resources().backend, pool.snapshot()[0].backendResourceId);
    const stopped = once(backend, 'close');
    worker.kill('SIGKILL');
    await stopped;
    await eventually(() => used(runtime) === 0 && pool.snapshot().length === 0);
  } finally {
    await pool.close();
  }
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unconfirmed backend close retains budget, uses the original handle and ignores stale resource IDs
 * 协作入口 / Collaborators: `governor`, `pool.pin`, `pin.call`, `pin.resources`.
 * 检查边界 / Checked boundaries: `assert.rejects(pin.terminate(), { code: 'HOST_PROCESS_CLEANUP_PENDING' })`; `assert.equal(used(runtime), 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('unconfirmed backend close retains budget, uses the original handle and ignores stale resource IDs', async () => {
  const runtime = governor(3, 3);
  let original!: UnconfirmedBackend;
  const pool = new HostNetworkPool(options, {
    governor: runtime,
    closeTimeoutMs: 80,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`(original = new UnconfirmedBackend()) as unknown as ChildProcess`）。
     * Result: Return the branch-computed value (`(original = new UnconfirmedBackend()) as unknown as ChildProcess`).
     * 验证场景 / Scenario: unconfirmed backend close retains budget, uses the original handle and ignores stale resource IDs
     * 状态影响 / State effects: `original`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    spawnBackend: () => (original = new UnconfirmedBackend()) as unknown as ChildProcess,
  });
  const pin = pool.pin(() => {});
  try {
    await pin.call('qmp', { binary, execute: 'query-version', args: {} });
    const id = pin.resources().backend!;
    await assert.rejects(pin.terminate(), { code: 'HOST_PROCESS_CLEANUP_PENDING' });
    assert.equal(used(runtime), 1);
    assert.equal(
      runtime.snapshot().resources.find((resource) => resource.id === id)?.state,
      'cleanup-pending',
    );
    original.emit('exit', 0, null);
    const kills = original.kills;
    await assert.rejects(pool.retryCleanup(id), { code: 'HOST_PROCESS_CLEANUP_PENDING' });
    assert.equal(original.kills, kills, 'An exited PID must never be killed again while waiting for close');
    original.emit('close', 0, null);
    await eventually(() => used(runtime) === 0);
    const replacement = pool.pin(() => {});
    await replacement.call('lookup', { hostname: 'localhost', options: {} });
    await assert.rejects(pool.retryCleanup(id), { code: 'NETWORK_RESOURCE_NOT_FOUND' });
    assert.equal(used(runtime), 1);
    replacement.release();
  } finally {
    original?.emit('close', 0, null);
    await pool.close();
  }
  runtime.close();
});
