/**
 * 模块职责：回归验证模块，围绕 `vm-execution-lifetime` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `vm-execution-lifetime`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: process identity, RAM execution generation, observed kernel boot and NIC generation remain independent; legacy Live fixtures receive actual identities and cannot reuse another VM lifetime.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import { HostRuntime, withResourceContext, resourceContext } from '../server/host-runtime/index.ts';
import { Machines } from '../server/machines.ts';
import { ExecutionScope } from '../server/execution-scope.ts';
import { VmLifetime, vmLifetime, registerVmBootProvider, vmBootProviders } from '../server/vm-lifetime.ts';
import type { Live } from '../server/vm-state.ts';
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import { withOperationCheck } from '../server/operation-context.ts';

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `promise, resolve`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `promise, resolve`; the actual branch determines its shape.
 */
const deferred = () => {
  let resolve!: /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`new Promise<void>((resolve) => setImmediate(resolve))`）。
 * Result: Return the branch-computed value (`new Promise<void>((resolve) => setImmediate(resolve))`).
 */
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: capacity = 16。
 * 结果：返回受控对象，公开字段包括 `machines, id, live, lifetime, governor, options, used`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, id, live, lifetime, governor, options, used`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `machines.live.set`, `vmLifetime`.
 */
function fixture(capacity = 16) {
  const id = randomUUID(),
    governor = new HostRuntime({ budgets: { execution: { capacity } } });
  const machines = new Machines({ runtime: { /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   */
  close: async () => {} } } as never, fakeVmNetwork);
  const live = { status: 'running', abort: new AbortController(), clients: new Set() } as Live;
  machines.live.set(id, live);
  const lifetime = vmLifetime(id, live),
    signal = new AbortController().signal;
  const options = { machines, vmId: id, projectId: 'default', live, signal, governor };
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`governor.snapshot().budgets.find((value) => value.key === 'execution')!.used`）。
   * Result: Return the branch-computed value (`governor.snapshot().budgets.find((value) => value.key === 'execution')!.used`).
   * 协作入口 / Collaborators: `governor.snapshot().budgets.find`, `governor.snapshot`.
   */
  const used = () => governor.snapshot().budgets.find((value) => value.key === 'execution')!.used;
  return { machines, id, live, lifetime, governor, options, used };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: process identity, RAM execution generation, observed kernel boot and NIC generation remain independent
 * 协作入口 / Collaborators: `randomUUID`, `lifetime.observeBoot`, `fakeVmNetwork.attachVm`, `lifetime.setNetwork`.
 * 检查边界 / Checked boundaries: `assert.equal(restored.vmProcessId, captured.vmProcessId)`; `assert.notEqual(restored.executionGeneration, captured.executionGeneration)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('process identity, RAM execution generation, observed kernel boot and NIC generation remain independent', async () => {
  const lifetime = new VmLifetime(randomUUID()),
    bootId = randomUUID();
  lifetime.observeBoot(bootId);
  const lease = await fakeVmNetwork.attachVm({
    vmId: lifetime.vmId,
    generation: 'network-before',
    sshPort: 35001,
    forwards: [],
    isolated: false,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: process identity, RAM execution generation, observed kernel boot and NIC generation remain independent
     */
    onFailure: () => {},
  });
  await lifetime.setNetwork(lease);
  const captured = lifetime.capture(),
    signal = lifetime.signal;
  lifetime.advanceExecution();
  const restored = lifetime.capture();
  assert.equal(restored.vmProcessId, captured.vmProcessId);
  assert.notEqual(restored.executionGeneration, captured.executionGeneration);
  assert.equal(restored.bootId, undefined);
  assert.equal(lifetime.lastObservedBootId, bootId);
  assert.equal(restored.networkGeneration, captured.networkGeneration);
  assert.equal(signal.aborted, true);
  assert.throws(() => lifetime.assert(captured), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  await lifetime.setNetwork(await lease.renew('network-after'));
  assert.equal(lifetime.capture().networkGeneration, 'network-after');
  assert.throws(() => lifetime.assert(restored), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  const generation = lifetime.capture().executionGeneration;
  const restoredBootId = randomUUID();
  lifetime.observeBoot(restoredBootId);
  assert.equal(lifetime.capture().executionGeneration, generation);
  assert.equal(lifetime.capture().bootId, restoredBootId);
  lifetime.observeBoot(randomUUID());
  assert.notEqual(lifetime.capture().executionGeneration, generation);
  await lifetime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy Live fixtures receive actual identities and cannot reuse another VM lifetime
 * 协作入口 / Collaborators: `randomUUID`, `vmLifetime`, `assert.equal`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.equal(vmLifetime(id, live), first)`; `assert.throws(() => vmLifetime(randomUUID(), live), { code: 'PROJECT_IDENTITY_HOST_CHANGED' })`.
 */
test('legacy Live fixtures receive actual identities and cannot reuse another VM lifetime', () => {
  const live = {} as Live,
    id = randomUUID(),
    first = vmLifetime(id, live);
  assert.equal(vmLifetime(id, live), first);
  assert.throws(() => vmLifetime(randomUUID(), live), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  first.advanceExecution();
  assert.equal(live.lifetime, first);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: late network adoption after process death closes the returned lease
 * 协作入口 / Collaborators: `randomUUID`, `lifetime.end`, `fakeVmNetwork.attachVm`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(lifetime.setNetwork(lease), { code: 'PROJECT_IDENTITY_HOST_CHANGED' })`; `assert.equal(lease.signal.aborted, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('late network adoption after process death closes the returned lease', async () => {
  const lifetime = new VmLifetime(randomUUID());
  lifetime.end();
  const lease = await fakeVmNetwork.attachVm({
    vmId: lifetime.vmId,
    generation: 'late',
    sshPort: 35001,
    forwards: [],
    isolated: false,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: late network adoption after process death closes the returned lease
     */
    onFailure: () => {},
  });
  await assert.rejects(lifetime.setNetwork(lease), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal(lease.signal.aborted, true);
  await lifetime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: attachments are named registrations and failed resource disposal is retained for explicit retry
 * 状态影响 / State effects: `failed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `registerVmBootProvider`, `assert.throws`, `remove`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.throws(() => registerVmBootProvider(owner, 'share', provider), /already registered/)`; `assert.deepEqual( vmBootProviders(owner).map(([name]) => name), ['tpm'], )`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('attachments are named registrations and failed resource disposal is retained for explicit retry', async () => {
  const owner = {},
    provider = { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`undefined`），以 Promise 交付。
     * Result: Return the branch-computed value (`undefined`) through a Promise.
     * 验证场景 / Scenario: attachments are named registrations and failed resource disposal is retained for explicit retry
     */
    prepare: async () => undefined };
  const remove = registerVmBootProvider(owner, 'share', provider);
  assert.throws(() => registerVmBootProvider(owner, 'share', provider), /already registered/);
  registerVmBootProvider(owner, 'tpm', provider);
  remove();
  remove();
  assert.deepEqual(
    vmBootProviders(owner).map(([name]) => name),
    ['tpm'],
  );
  const lifetime = new VmLifetime(randomUUID()),
    calls: string[] = [];
  let failed = true;
  await lifetime.own(
    'first',
    {
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: attachments are named registrations and failed resource disposal is retained for explicit retry
       * 协作入口 / Collaborators: `calls.push`.
       */
      close: async () => {
        calls.push('first');
      },
    },
    1,
  );
  await lifetime.own(
    'helper',
    {
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: attachments are named registrations and failed resource disposal is retained for explicit retry
       * 失败 / Failure: `Error('still alive')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       * 协作入口 / Collaborators: `calls.push`, `Error`.
       */
      close: async () => {
        calls.push('helper');
        if (failed) throw Error('still alive');
      },
    },
    2,
  );
  await assert.rejects(lifetime.close(), /cleanup failed/);
  failed = false;
  await lifetime.close();
  assert.deepEqual(calls, ['first', 'helper', 'helper']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: VM transition cancels execution and waits for control cleanup before taking the VM lock
 * 状态影响 / State effects: `(f.machines as any).stopInternal`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `deferred`, `ExecutionScope.run`, `f.machines.stop`.
 * 检查边界 / Checked boundaries: `assert.equal(f.used(), 1)`; `assert.equal(f.lifetime.admitting, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('VM transition cancels execution and waits for control cleanup before taking the VM lock', async () => {
  const f = fixture(),
    started = deferred(),
    cleanup = deferred(),
    release = deferred();
  const order: string[] = [];
  const running = ExecutionScope.run(f.options, async (scope) => {
    started.resolve();
    await new Promise<void>((resolve) =>
      scope.signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    assert.equal(f.machines.isBusy(f.id), false);
    await f.machines.locked(`cleanup:${f.id}`, async () => {
      order.push('cleanup');
      cleanup.resolve();
      await release.promise;
    });
  });
  await started.promise;
  (f.machines as any).stopInternal = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: VM transition cancels execution and waits for control cleanup before taking the VM lock
   * 协作入口 / Collaborators: `assert.equal`, `f.used`, `order.push`.
   * 检查边界 / Checked boundaries: `assert.equal(f.used(), 0)`.
   */
  async () => {
    assert.equal(f.used(), 0);
    order.push('stop');
  };
  const stopping = f.machines.stop(f.id);
  await cleanup.promise;
  assert.equal(f.used(), 1);
  assert.equal(f.lifetime.admitting, false);
  await assert.rejects(
    ExecutionScope.run(f.options, async () => assert.fail('must not enter')),
    { code: 'VM_EXECUTION_DRAINING' },
  );
  release.resolve();
  await Promise.all([running, stopping]);
  assert.deepEqual(order, ['cleanup', 'stop']);
  assert.equal(f.used(), 0);
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: ordinary VM mutation rejects active executions and a held VM lock closes unrelated execution admission
 * 协作入口 / Collaborators: `fixture`, `deferred`, `ExecutionScope.run`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects( f.machines.locked(f.id, async () => {}), { code: 'VM_EXECUTION_ACTIVE' }, )`; `assert.rejects( ExecutionScope.run(f.options, async () => {}), { code: 'VM_EXECUTION_DRAINING' }, )`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('ordinary VM mutation rejects active executions and a held VM lock closes unrelated execution admission', async () => {
  const f = fixture(),
    started = deferred(),
    release = deferred();
  const task = ExecutionScope.run(f.options, async () => {
    started.resolve();
    await release.promise;
  });
  await started.promise;
  await assert.rejects(
    f.machines.locked(f.id, async () => {}),
    { code: 'VM_EXECUTION_ACTIVE' },
  );
  release.resolve();
  await task;
  const holding = deferred(),
    unlock = deferred();
  const locked = f.machines.locked(f.id, async () => {
    await ExecutionScope.run(f.options, async () => {}); // Native child of this exact exclusive operation.
    holding.resolve();
    await unlock.promise;
  });
  await holding.promise;
  await assert.rejects(
    ExecutionScope.run(f.options, async () => {}),
    { code: 'VM_EXECUTION_DRAINING' },
  );
  unlock.resolve();
  await locked;
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an execution cannot wait on its own VM transition
 * 协作入口 / Collaborators: `fixture`, `ExecutionScope.run`, `f.governor.close`.
 */
test('an execution cannot wait on its own VM transition', async () => {
  const f = fixture();
  await ExecutionScope.run(f.options, async () => {
    await assert.rejects(f.machines.stop(f.id), { code: 'VM_EXECUTION_REENTRANT' });
  });
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a callback from a completed exclusive operation cannot bypass a later transition barrier
 * 协作入口 / Collaborators: `fixture`, `deferred`, `f.machines.locked`, `f.lifetime.barrier`.
 * 检查边界 / Checked boundaries: `assert.rejects(stale, { code: 'VM_EXECUTION_DRAINING' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a callback from a completed exclusive operation cannot bypass a later transition barrier', async () => {
  const f = fixture(),
    callback = deferred(),
    locked = deferred(),
    unlock = deferred();
  let stale!: Promise<unknown>;
  await f.machines.locked(f.id, async () => {
    stale = callback.promise.then(() =>
      ExecutionScope.run(f.options, async () => assert.fail('stale exclusive permit')),
    );
  });
  const transition = f.lifetime.barrier(async () => {
    locked.resolve();
    await unlock.promise;
  });
  await locked.promise;
  const refused = assert.rejects(stale, { code: 'VM_EXECUTION_DRAINING' });
  callback.resolve();
  await refused;
  unlock.resolve();
  await transition;
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: four same-project slots remain concurrent and queued work holds no partial global budget
 * 协作入口 / Collaborators: `fixture`, `deferred`, `Array.from`, `turn`.
 * 检查边界 / Checked boundaries: `assert.equal(started, 4)`; `assert.equal(f.used(), 4)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('four same-project slots remain concurrent and queued work holds no partial global budget', async () => {
  const f = fixture(8),
    release = deferred();
  let started = 0;
  const tasks = Array.from({ length: 5 }, () =>
    ExecutionScope.run(f.options, async () => {
      started++;
      await release.promise;
    }),
  );
  await turn();
  assert.equal(started, 4);
  assert.equal(f.used(), 4);
  assert.equal(f.governor.snapshot().queued, 1);
  await ExecutionScope.run({ ...f.options, projectId: '1111111111111111' }, async () => {
    assert.equal(f.used(), 5);
  });
  release.resolve();
  await Promise.all(tasks);
  assert.equal(started, 5);
  assert.equal(f.lifetime.active, 0);
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: queued cancellation and generation changes reject before guest launch without leaking a budget
 * 协作入口 / Collaborators: `fixture`, `deferred`, `ExecutionScope.run`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(queued)`; `assert.equal(f.used(), 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('queued cancellation and generation changes reject before guest launch without leaking a budget', async () => {
  const f = fixture(1),
    started = deferred(),
    release = deferred(),
    abort = new AbortController();
  const first = ExecutionScope.run(f.options, async () => {
    started.resolve();
    await release.promise;
  });
  await started.promise;
  const queued = ExecutionScope.run({ ...f.options, signal: abort.signal }, async () =>
    assert.fail('queued task entered'),
  );
  const rejected = assert.rejects(queued);
  abort.abort();
  await rejected;
  assert.equal(f.used(), 1);
  assert.equal(f.governor.snapshot().queued, 0);
  const stale = f.lifetime.capture();
  release.resolve();
  await first;
  f.lifetime.advanceExecution();
  await assert.rejects(
    ExecutionScope.run({ ...f.options, identity: stale }, async () => {}),
    { code: 'PROJECT_IDENTITY_HOST_CHANGED' },
  );
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: same operation borrows exactly one slot and parent completion waits for unawaited child cleanup
 * 协作入口 / Collaborators: `fixture`, `deferred`, `ExecutionScope.run({ ...f.options, delegate: true }, async () => { child = …`, `ExecutionScope.run`.
 * 检查边界 / Checked boundaries: `assert.equal(f.used(), 1)`; `assert.equal(f.lifetime.active, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('same operation borrows exactly one slot and parent completion waits for unawaited child cleanup', async () => {
  const f = fixture(1),
    started = deferred(),
    cleanup = deferred();
  let child!: Promise<void>,
    done = false;
  const parent = ExecutionScope.run({ ...f.options, delegate: true }, async () => {
    child = ExecutionScope.run(f.options, async () => {
      started.resolve();
      await cleanup.promise;
    });
  }).then(() => {
    done = true;
  });
  await started.promise;
  await turn();
  assert.equal(f.used(), 1);
  assert.equal(f.lifetime.active, 1);
  assert.equal(done, false);
  cleanup.resolve();
  await Promise.all([parent, child]);
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: siblings in one explicit operation borrow serially at full capacity and child cancellation remains effective
 * 协作入口 / Collaborators: `fixture`, `deferred`, `ExecutionScope.run`, `f.governor.close`.
 */
test('siblings in one explicit operation borrow serially at full capacity and child cancellation remains effective', async () => {
  const f = fixture(1),
    cleanup = deferred(),
    firstStarted = deferred(),
    abort = new AbortController();
  let started = 0;
  await ExecutionScope.run({ ...f.options, delegate: true }, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: siblings in one explicit operation borrow serially at full capacity and child cancellation remains effective
   * 协作入口 / Collaborators: `ExecutionScope.run`, `assert.equal`, `f.used`, `abort.abort`.
   * 检查边界 / Checked boundaries: `assert.equal(f.used(), 1)`; `assert.equal(started, 1)`.
   */
  async () => {
    const first = ExecutionScope.run({ ...f.options, signal: abort.signal }, async (scope) => {
      started++;
      firstStarted.resolve();
      await new Promise<void>((resolve) =>
        scope.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      await cleanup.promise;
    });
    const second = ExecutionScope.run(f.options, async () => {
      started++;
      await cleanup.promise;
    });
    await firstStarted.promise;
    assert.equal(f.used(), 1);
    assert.equal(started, 1);
    abort.abort();
    cleanup.resolve();
    await Promise.all([first, second]);
    assert.equal(started, 2);
  });
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: queued delegated execution rechecks authority and preserves the original cleanup capability
 * 协作入口 / Collaborators: `fixture`, `deferred`, `t.after`, `withOperationCheck`.
 * 检查边界 / Checked boundaries: `assert.equal(f.used(), 0)`; `assert.equal(f.lifetime.active, 0)`.
 */
test('queued delegated execution rechecks authority and preserves the original cleanup capability', async (t) => {
  const f = fixture(2),
    started = deferred(),
    release = deferred(),
    denied = new AppError('authority revoked', 403, 'OPERATION_FORBIDDEN');
  t.after(() => f.governor.close());
  let revoked = false,
    ran = false,
    cleaned = 0,
    cleanup!: /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<void>;
  await withOperationCheck(
    async () => {
      if (revoked) throw denied;
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`ExecutionScope.run({ ...f.options, delegate: true }, async () => { const first =…`）。
     * Result: Return the branch-computed value (`ExecutionScope.run({ ...f.options, delegate: true }, async () => { const first =…`).
     * 验证场景 / Scenario: queued delegated execution rechecks authority and preserves the original cleanup capability
     * 协作入口 / Collaborators: `ExecutionScope.run`.
     */
    () => ExecutionScope.run({ ...f.options, delegate: true }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: queued delegated execution rechecks authority and preserves the original cleanup capability
     * 状态影响 / State effects: `revoked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `ExecutionScope.run`, `assert.rejects`, `release.resolve`, `Promise.all`.
     * 检查边界 / Checked boundaries: `assert.rejects(second, (error) => error === denied)`; `assert.equal(ran, false)`.
     * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
     * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
     */
    async () => {
      const first = ExecutionScope.run(f.options, /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: child。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: queued delegated execution rechecks authority and preserves the original cleanup capability
       * 状态影响 / State effects: `cleanup`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `child.deferCleanup`, `started.resolve`.
       */
      async (child) => {
        cleanup = child.deferCleanup(/**
         * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
         * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 验证场景 / Scenario: queued delegated execution rechecks authority and preserves the original cleanup capability
         * 协作入口 / Collaborators: `f.governor.acquire`, `assert.equal`, `f.used`, `lease.release`.
         * 检查边界 / Checked boundaries: `assert.equal(f.used(), 2)`.
         * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
         * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
         */
        async () => {
          const lease = await f.governor.acquire({
            owner: 'original-child-cleanup',
            kind: 'cleanup',
            label: 'original receipt',
            cost: { execution: 1 },
          });
          try {
            assert.equal(f.used(), 2);
            cleaned++;
          } finally {
            lease.release();
          }
        });
        started.resolve();
        await release.promise;
      });
      await started.promise;
      const second = ExecutionScope.run(f.options, async () => { ran = true; });
      const refused = assert.rejects(second, (error) => error === denied);
      revoked = true;
      release.resolve();
      await Promise.all([first, refused]);
      assert.equal(ran, false);
      assert.equal(f.used(), 1, 'refusing a borrower must retain the parent budget');
      assert.equal(f.lifetime.active, 1);
      await cleanup();
      assert.equal(cleaned, 1, 'revocation must not prevent original resource cleanup');
      assert.equal(f.used(), 1);
    }),
  );
  assert.equal(f.used(), 0);
  assert.equal(f.lifetime.active, 0);
  assert.equal(f.governor.snapshot().resources.length, 0);
  await cleanup();
  assert.equal(cleaned, 1, 'confirmed cleanup remains idempotent');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: delegated execution observes cancellation while its authorization check is pending
 * 协作入口 / Collaborators: `fixture`, `deferred`, `t.after`, `ExecutionScope.run`.
 * 检查边界 / Checked boundaries: `assert.equal(f.used(), 0)`; `assert.equal(f.lifetime.active, 0)`.
 */
test('delegated execution observes cancellation while its authorization check is pending', { timeout: 2000 }, async (t) => {
  const f = fixture(1),
    checking = deferred(),
    release = deferred(),
    abort = new AbortController();
  t.after(() => f.governor.close());
  await ExecutionScope.run({ ...f.options, delegate: true }, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: delegated execution observes cancellation while its authorization check is pending
   * 协作入口 / Collaborators: `withOperationCheck`, `assert.rejects`, `abort.abort`, `release.resolve`.
   * 检查边界 / Checked boundaries: `assert.rejects(child, { name: 'AbortError' })`; `assert.equal(f.used(), 1)`.
   */
  async () => {
    const child = withOperationCheck(async () => {
      checking.resolve();
      await release.promise;
    }, () => ExecutionScope.run({ ...f.options, signal: abort.signal }, async () => {
      assert.fail('cancelled child entered');
    }));
    const refused = assert.rejects(child, { name: 'AbortError' });
    await checking.promise;
    abort.abort();
    release.resolve();
    await refused;
    assert.equal(f.used(), 1);
  });
  assert.equal(f.used(), 0);
  assert.equal(f.lifetime.active, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: undelegated and cross-project nesting fail immediately instead of waiting on their own occupied slot
 * 协作入口 / Collaborators: `fixture`, `ExecutionScope.run`, `f.governor.close`.
 */
test('undelegated and cross-project nesting fail immediately instead of waiting on their own occupied slot', async () => {
  const f = fixture(1);
  await ExecutionScope.run(f.options, async () => {
    await assert.rejects(
      ExecutionScope.run(f.options, async () => {}),
      { code: 'EXECUTION_NESTING_INVALID' },
    );
  });
  await ExecutionScope.run({ ...f.options, delegate: true }, async () => {
    await assert.rejects(
      ExecutionScope.run({ ...f.options, projectId: 'other' }, async () => {}),
      { code: 'EXECUTION_NESTING_INVALID' },
    );
  });
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: plugin ownership survives admission and multiple explicit orchestration layers without another slot
 * 协作入口 / Collaborators: `fixture`, `withResourceContext`, `f.governor.close`.
 */
test('plugin ownership survives admission and multiple explicit orchestration layers without another slot', async () => {
  const f = fixture(1),
    owner = 'plugin:search';
  await withResourceContext({ owner, pluginId: 'search', actorId: 'actor-fixture' }, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`ExecutionScope.run({ ...f.options, owner, delegate: true }, async (parent) => { …`）。
   * Result: Return the branch-computed value (`ExecutionScope.run({ ...f.options, owner, delegate: true }, async (parent) => { …`).
   * 验证场景 / Scenario: plugin ownership survives admission and multiple explicit orchestration layers without another slot
   * 协作入口 / Collaborators: `ExecutionScope.run`.
   */
  () =>
    ExecutionScope.run({ ...f.options, owner, delegate: true }, /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: parent。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: plugin ownership survives admission and multiple explicit orchestration layers without another slot
     * 协作入口 / Collaborators: `ExecutionScope.run`.
     */
    async (parent) => {
      await ExecutionScope.run({ ...f.options, delegate: true }, async (child) => {
        await ExecutionScope.run(f.options, async (leaf) => {
          assert.equal(parent.identity, child.identity);
          assert.equal(parent.identity, leaf.identity);
          assert.equal(f.used(), 1);
          const resource = f.governor.snapshot().resources[0];
          assert.equal(resource.owner, owner);
          assert.equal(resource.identity.pluginId, 'search');
          assert.equal(resourceContext()?.actorId, 'actor-fixture');
          assert.equal(resourceContext()?.owner, owner);
        });
      });
    }),
  );
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancellation never releases an unconfirmed native cleanup quota or allows a snapshot
 * 状态影响 / State effects: `(f.machines as any).stopInternal`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `ExecutionScope.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects( ExecutionScope.run(f.options, async () => { throw failure; }), (error) => error === failure, )`; `assert.equal(f.used(), 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cancellation never releases an unconfirmed native cleanup quota or allows a snapshot', async () => {
  const f = fixture(),
    failure = new AppError('native cleanup not confirmed', 503, 'GUEST_TASK_CLEANUP_FAILED');
  await assert.rejects(
    ExecutionScope.run(f.options, async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(f.used(), 1);
  assert.equal(f.lifetime.active, 1);
  assert.equal(f.governor.snapshot().resources[0].state, 'cleanup-pending');
  await assert.rejects(
    f.lifetime.barrier(async () => {}),
    { code: 'EXECUTION_CLEANUP_PENDING' },
  );
  let stopped = false;
  (f.machines as any).stopInternal = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: cancellation never releases an unconfirmed native cleanup quota or allows a snapshot
   * 状态影响 / State effects: `stopped`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  async () => {
    stopped = true;
  };
  await f.machines.stop(f.id, true);
  assert.equal(stopped, true);
  assert.equal(f.used(), 1, 'guest stop alone is not a host resource retirement receipt');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: only the original cleanup closure can retire a failed execution after a successful explicit retry
 * 状态影响 / State effects: `ready`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `ExecutionScope.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects( ExecutionScope.run(f.options, async (scope) => { recover = scope.recovery(); const cleanup = scope.deferCleanup(as…`; `assert.equal(f.used(), 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('only the original cleanup closure can retire a failed execution after a successful explicit retry', async () => {
  const f = fixture(),
    failure = new AppError('guest cleanup pending', 503, 'GUEST_TASK_CLEANUP_FAILED');
  let ready = false,
    attempts = 0,
    recover!: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<void>;
  await assert.rejects(
    ExecutionScope.run(f.options, async (scope) => {
      recover = scope.recovery();
      const cleanup = scope.deferCleanup(async () => {
        attempts++;
        if (!ready) throw failure;
      });
      await cleanup();
    }),
    (error) => error === failure,
  );
  assert.equal(f.used(), 1);
  assert.equal(f.lifetime.active, 1);
  await assert.rejects(recover(), (error) => error === failure);
  assert.equal(f.used(), 1);
  ready = true;
  await recover();
  assert.equal(attempts, 3);
  assert.equal(f.used(), 0);
  assert.equal(f.lifetime.active, 0);
  await recover();
  assert.equal(attempts, 3);
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: execution cleanup uses its original capability after request authority is revoked
 * 协作入口 / Collaborators: `fixture`, `withOperationCheck`, `assert.equal`, `f.used`.
 * 检查边界 / Checked boundaries: `assert.equal(cleaned, true)`; `assert.equal(f.used(), 0)`.
 */
test('execution cleanup uses its original capability after request authority is revoked', async () => {
  const f = fixture(2);
  let revoked = false,
    cleaned = false;
  await withOperationCheck(
    async () => {
      if (revoked) throw new Error('authority revoked');
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`ExecutionScope.run(f.options, async (scope) => { scope.deferCleanup(async () => …`）。
     * Result: Return the branch-computed value (`ExecutionScope.run(f.options, async (scope) => { scope.deferCleanup(async () => …`).
     * 验证场景 / Scenario: execution cleanup uses its original capability after request authority is revoked
     * 协作入口 / Collaborators: `ExecutionScope.run`.
     */
    () =>
      ExecutionScope.run(f.options, /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: scope。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: execution cleanup uses its original capability after request authority is revoked
       * 状态影响 / State effects: `revoked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `scope.deferCleanup`.
       */
      async (scope) => {
        scope.deferCleanup(async () => {
          const child = await f.governor.acquire({
            owner: 'original-cleanup',
            kind: 'cleanup',
            label: 'receipt',
            cost: { execution: 1 },
          });
          assert.equal(f.used(), 2);
          child.release();
          cleaned = true;
        });
        revoked = true;
      }),
  );
  assert.equal(cleaned, true);
  assert.equal(f.used(), 0);
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a child recovery cannot retire an unrelated parent cleanup failure
 * 状态影响 / State effects: `ready`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `ExecutionScope.run`, `recover`.
 * 检查边界 / Checked boundaries: `assert.rejects( ExecutionScope.run({ ...f.options, delegate: true }, async () => { await ExecutionScope.run(f.options, async (scop…`; `assert.equal(f.used(), 1)`.
 */
test('a child recovery cannot retire an unrelated parent cleanup failure', async () => {
  const f = fixture(),
    native = new AppError('native', 503, 'GUEST_TASK_CLEANUP_FAILED');
  let ready = false,
    recover!: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<void>;
  await assert.rejects(
    ExecutionScope.run({ ...f.options, delegate: true }, async () => {
      await ExecutionScope.run(f.options, async (scope) => {
        recover = scope.recovery();
        await scope.deferCleanup(async () => {
          if (!ready) throw native;
        })();
      }).catch(() => {});
      throw new AppError('another owner remains', 503, 'HOST_PROCESS_CLEANUP_PENDING');
    }),
  );
  ready = true;
  await recover();
  assert.equal(f.used(), 1);
  assert.equal(f.governor.snapshot().resources[0].state, 'cleanup-pending');
});
