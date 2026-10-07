/**
 * 模块职责：回归验证模块，围绕 `project-session-lifetime` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-session-lifetime`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: VM barriers retire the original plugin session through its receipt after revocation without new execution admission; plugin exit retains failed session cleanup and quota until the original receipt succeeds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HostRuntime } from '../server/host-runtime/index.ts';
import { Machines } from '../server/machines.ts';
import { ProjectSessionLifetime } from '../server/project-session-lifetime.ts';
import { ExecutionScope } from '../server/execution-scope.ts';
import { vmLifetime } from '../server/vm-lifetime.ts';
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import { withOperationCheck } from '../server/operation-context.ts';
import { PluginDirectory } from '../server/plugin-directory.ts';
import { pluginCleanup, withPluginAuthority } from '../server/plugin-authority.ts';
import { vmAccess } from '../server/vm-access.ts';
import { resourceContext } from '../server/host-runtime/context.ts';
import { AppError } from '../shared/errors.ts';

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
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `machines, vmId, live, lifetime, governor, receipt, used`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, vmId, live, lifetime, governor, receipt, used`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `machines.live.set`, `vmLifetime`.
 */
function fixture() {
  const machines = new Machines({} as never, fakeVmNetwork),
    vmId = randomUUID();
  const live = { status: 'running', abort: new AbortController() } as any;
  machines.live.set(vmId, live);
  const lifetime = vmLifetime(vmId, live);
  const governor = new HostRuntime({
    budgets: { execution: { capacity: 1 }, 'execution.session': { capacity: 32 } },
  });
  const receipt = {
    projectId: 'default',
    runId: randomUUID(),
    bootId: randomUUID(),
    inode: '100',
    phase: 'running',
  };
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`governor.snapshot().budgets.find((b) => b.key === 'execution.session')!.used`）。
   * Result: Return the branch-computed value (`governor.snapshot().budgets.find((b) => b.key === 'execution.session')!.used`).
   * 协作入口 / Collaborators: `governor.snapshot().budgets.find`, `governor.snapshot`.
   */
  const used = () => governor.snapshot().budgets.find((b) => b.key === 'execution.session')!.used;
  return { machines, vmId, live, lifetime, governor, receipt, used };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: VM barriers retire the original plugin session through its receipt after revocation without new execution admission
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `directory.begin`, `directory.publish`, `vmAccess`.
 * 检查边界 / Checked boundaries: `assert.equal(scheduled, 1)`; `assert.equal(commands, 2)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('VM barriers retire the original plugin session through its receipt after revocation without new execution admission', async () => {
  const f = fixture(),
    directory = new PluginDirectory();
  const instance = directory.begin('official', 'session-owner', '1', 'artifact');
  directory.publish(instance);
  let scheduled = 0,
    commands = 0,
    cleaned = false;
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: VM barriers retire the original plugin session through its receipt after revocation without new execution admission
   */
  async () => {
    ++commands;
    return { code: 0, stdout: '', stderr: '' };
  };
  const port = vmAccess(f.machines, instance.scope, instance, async (_id, _signal, work) => {
    ++scheduled;
    assert.equal(
      f.lifetime.admitting,
      true,
      'cleanup must not request new execution while VM admission is closed',
    );
    return work();
  });
  await withPluginAuthority(instance, () => port.exec(f.vmId, 'original setup'));
  const session = await withPluginAuthority(instance, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`ProjectSessionLifetime.acquire({ ...f, machines: port, live: port.live.get(f.vmI…`）。
   * Result: Return the branch-computed value (`ProjectSessionLifetime.acquire({ ...f, machines: port, live: port.live.get(f.vmI…`).
   * 验证场景 / Scenario: VM barriers retire the original plugin session through its receipt after revocation without new execution admission
   * 协作入口 / Collaborators: `ProjectSessionLifetime.acquire`, `port.live.get`.
   */
  () =>
    ProjectSessionLifetime.acquire({
      ...f,
      machines: port,
      live: port.live.get(f.vmId),
      kind: 'terminal',
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: receipt。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: VM barriers retire the original plugin session through its receipt after revocation without new execution admission
       * 状态影响 / State effects: `cleaned`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `assert.deepEqual`, `assert.equal`, `pluginCleanup`, `resourceContext`.
       * 检查边界 / Checked boundaries: `assert.deepEqual(receipt, f.receipt)`; `assert.equal(pluginCleanup(), instance)`.
       */
      cleanup: async (receipt) => {
        assert.deepEqual(receipt, f.receipt);
        assert.equal(pluginCleanup(), instance);
        assert.equal(resourceContext()?.pluginGeneration, instance.generation);
        assert.equal(resourceContext()?.vmId, f.vmId);
        assert.equal(resourceContext()?.projectId, receipt.projectId);
        await port.exec(f.vmId, 'original fixed stop protocol');
        cleaned = true;
      },
    }),
  );
  instance.revoke();
  await f.lifetime.barrier(async () => assert.equal(cleaned, true));
  assert.equal(scheduled, 1);
  assert.equal(commands, 2);
  assert.equal(f.used(), 0);
  await session.close();
  await instance.scope.dispose();
  await f.lifetime.close();
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: plugin exit retains failed session cleanup and quota until the original receipt succeeds
 * 状态影响 / State effects: `confirmed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `directory.begin`, `directory.publish`, `withPluginAuthority`.
 * 检查边界 / Checked boundaries: `assert.equal(attempts, 1)`; `assert.equal(f.used(), 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('plugin exit retains failed session cleanup and quota until the original receipt succeeds', async () => {
  const f = fixture(),
    directory = new PluginDirectory();
  const instance = directory.begin('official', 'session-owner', '1', 'artifact');
  directory.publish(instance);
  const failure = new AppError('original native descendants still live', 503, 'SESSION_CLEANUP_PENDING');
  let confirmed = false,
    attempts = 0;
  const session = await withPluginAuthority(instance, () =>
    ProjectSessionLifetime.acquire({
      ...f,
      kind: 'service',
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: receipt。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: plugin exit retains failed session cleanup and quota until the original receipt succeeds
       * 失败 / Failure: `failure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       * 协作入口 / Collaborators: `assert.deepEqual`, `assert.equal`, `pluginCleanup`.
       * 检查边界 / Checked boundaries: `assert.deepEqual(receipt, f.receipt)`; `assert.equal(pluginCleanup(), instance)`.
       */
      cleanup: async (receipt) => {
        assert.deepEqual(receipt, f.receipt);
        assert.equal(pluginCleanup(), instance);
        ++attempts;
        if (!confirmed) throw failure;
      },
    }),
  );
  instance.revoke();
  await instance.scope.settled();
  assert.equal(attempts, 1);
  assert.equal(f.used(), 1);
  assert.equal(instance.scope.diagnostics().cleanup.length, 1);
  await assert.rejects(instance.scope.dispose(), AggregateError);
  assert.equal(f.used(), 1);
  confirmed = true;
  await session.close();
  assert.equal(f.used(), 0);
  assert.equal(instance.scope.diagnostics().cleanup.length, 0);
  await instance.scope.dispose();
  await f.lifetime.close();
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: persistent sessions use independent atomic budgets and retain ordinary domain start/stop access
 * 协作入口 / Collaborators: `fixture`, `ProjectSessionLifetime.acquire`, `assert.equal`, `f.used`.
 * 检查边界 / Checked boundaries: `assert.equal(f.used(), 1)`; `assert.equal(f.used(), 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('persistent sessions use independent atomic budgets and retain ordinary domain start/stop access', async () => {
  const f = fixture();
  let stops = 0;
  const session = await ProjectSessionLifetime.acquire({
    ...f,
    kind: 'main',
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: persistent sessions use independent atomic budgets and retain ordinary domain start/stop access
     */
    cleanup: async () => {
      stops++;
    },
  });
  assert.equal(f.used(), 1);
  await f.machines.locked(f.vmId, async () => {});
  await ExecutionScope.run(
    { ...f, projectId: 'default', signal: new AbortController().signal },
    async () => {},
  );
  assert.equal(f.used(), 1);
  assert.equal(stops, 0);
  await session.close();
  assert.equal(stops, 1);
  assert.equal(f.used(), 0);
  await f.lifetime.close();
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: VM transition cancels session startup, waits for it to settle, and then awaits full domain cleanup
 * 协作入口 / Collaborators: `fixture`, `deferred`, `ProjectSessionLifetime.acquire`, `session.perform`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(events, ['startup-retired', 'cleanup'])`; `assert.equal(f.used(), 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('VM transition cancels session startup, waits for it to settle, and then awaits full domain cleanup', async () => {
  const f = fixture(),
    startup = deferred(),
    stopped = deferred(),
    closeAllowed = deferred();
  const events: string[] = [];
  const session = await ProjectSessionLifetime.acquire({
    ...f,
    kind: 'service',
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: VM transition cancels session startup, waits for it to settle, and then awaits full domain cleanup
     * 协作入口 / Collaborators: `events.push`, `stopped.resolve`.
     */
    cleanup: async () => {
      events.push('cleanup');
      stopped.resolve();
      await closeAllowed.promise;
    },
  });
  const starting = session.perform(async (signal) => {
    startup.resolve();
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    events.push('startup-retired');
  });
  await startup.promise;
  const barrier = f.lifetime.barrier(async () => {
    events.push('snapshot');
  });
  await stopped.promise;
  assert.deepEqual(events, ['startup-retired', 'cleanup']);
  assert.equal(f.used(), 1);
  await assert.rejects(
    ProjectSessionLifetime.acquire({
      ...f,
      receipt: { ...f.receipt, runId: randomUUID() },
      kind: 'service',
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: VM transition cancels session startup, waits for it to settle, and then awaits full domain cleanup
       */
      cleanup: async () => {},
    }),
    { code: 'VM_EXECUTION_DRAINING' },
  );
  closeAllowed.resolve();
  await Promise.all([starting, barrier]);
  assert.deepEqual(events, ['startup-retired', 'cleanup', 'snapshot']);
  assert.equal(f.used(), 0);
  await f.lifetime.close();
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed session stop keeps quota and VM barrier until the exact full receipt is retired
 * 状态影响 / State effects: `confirmed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `ProjectSessionLifetime.acquire`, `assert.rejects`, `f.lifetime.barrier`.
 * 检查边界 / Checked boundaries: `assert.rejects( f.lifetime.barrier(async () => assert.fail('snapshot must remain fenced')), { code: 'EXECUTION_CLEANUP_PENDING' },…`; `assert.equal(f.used(), 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('failed session stop keeps quota and VM barrier until the exact full receipt is retired', async () => {
  const f = fixture();
  let confirmed = false,
    calls = 0;
  const session = await ProjectSessionLifetime.acquire({
    ...f,
    kind: 'ssh',
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: failed session stop keeps quota and VM barrier until the exact full receipt is retired
     * 失败 / Failure: `Error('native descendants still live')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `Error`.
     */
    cleanup: async () => {
      calls++;
      if (!confirmed) throw Error('native descendants still live');
    },
  });
  await assert.rejects(
    f.lifetime.barrier(async () => assert.fail('snapshot must remain fenced')),
    { code: 'EXECUTION_CLEANUP_PENDING' },
  );
  assert.equal(f.used(), 1);
  await assert.rejects(
    ProjectSessionLifetime.retire(f.machines, f.vmId, { ...f.receipt, inode: 'other' }, async () =>
      assert.fail('wrong receipt'),
    ),
    { code: 'SESSION_CLEANUP_PENDING' },
  );
  confirmed = true;
  await session.close();
  assert.equal(calls, 2);
  assert.equal(f.used(), 0);
  assert.equal(f.lifetime.active, 0);
  await f.lifetime.close();
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: session project partitions preserve 16 independent runs and cannot be bypassed by another domain kind
 * 协作入口 / Collaborators: `fixture`, `Promise.all`, `Array.from`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(f.used(), 16)`; `assert.rejects( ProjectSessionLifetime.acquire({ ...f, kind: 'ssh', receipt: { ...f.receipt, runId: randomUUID() }, cleanup: async…`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('session project partitions preserve 16 independent runs and cannot be bypassed by another domain kind', async () => {
  const f = fixture();
  const sessions = await Promise.all(
    Array.from({ length: 16 }, (_, i) =>
      ProjectSessionLifetime.acquire({
        ...f,
        kind: i % 2 ? 'terminal' : 'main',
        receipt: { ...f.receipt, runId: randomUUID() },
        /**
         * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
         * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 验证场景 / Scenario: session project partitions preserve 16 independent runs and cannot be bypassed by another domain kind
         */
        cleanup: async () => {},
      }),
    ),
  );
  assert.equal(f.used(), 16);
  await assert.rejects(
    ProjectSessionLifetime.acquire({
      ...f,
      kind: 'ssh',
      receipt: { ...f.receipt, runId: randomUUID() },
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: session project partitions preserve 16 independent runs and cannot be bypassed by another domain kind
       */
      cleanup: async () => {},
    }),
    { code: 'RESOURCE_CAPACITY' },
  );
  assert.equal(f.used(), 16);
  await Promise.all(sessions.map((session) => session.close()));
  await f.lifetime.close();
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: session native identity can only grow and old intents retire using the captured complete receipt
 * 协作入口 / Collaborators: `fixture`, `ProjectSessionLifetime.acquire`, `session.pin`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.throws(() => session.pin(intent), { code: 'SESSION_CLEANUP_PENDING' })`; `assert.equal(observed, f.receipt.inode)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('session native identity can only grow and old intents retire using the captured complete receipt', async () => {
  const f = fixture(),
    intent = { ...f.receipt, inode: null as string | null };
  const session = await ProjectSessionLifetime.acquire({
    ...f,
    receipt: intent,
    kind: 'main',
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: session native identity can only grow and old intents retire using the captured complete receipt
     */
    cleanup: async () => {},
  });
  session.pin(f.receipt);
  assert.throws(() => session.pin(intent), { code: 'SESSION_CLEANUP_PENDING' });
  let observed: unknown;
  await ProjectSessionLifetime.retire(f.machines, f.vmId, intent, async (receipt) => {
    observed = receipt.inode;
  });
  assert.equal(observed, f.receipt.inode);
  assert.equal(f.used(), 0);
  await f.lifetime.close();
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a retained session cannot admit or control a replacement Live even when its old abort was not signalled
 * 协作入口 / Collaborators: `fixture`, `ProjectSessionLifetime.acquire`, `f.machines.live.set`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects( session.perform(async () => assert.fail('stale session control')), { code: 'PROJECT_IDENTITY_HOST_CHANGED' }, )`; `assert.rejects(ProjectSessionLifetime.acquire({ ...f, kind: 'main', cleanup: async () => {} }), { code: 'PROJECT_IDENTITY_HOST_CHA…`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a retained session cannot admit or control a replacement Live even when its old abort was not signalled', async () => {
  const f = fixture();
  const session = await ProjectSessionLifetime.acquire({ ...f, kind: 'main', /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: a retained session cannot admit or control a replacement Live even when its old abort was not signalled
   */
  cleanup: async () => {} });
  f.machines.live.set(f.vmId, { status: 'running', abort: new AbortController() } as any);
  await assert.rejects(
    session.perform(async () => assert.fail('stale session control')),
    { code: 'PROJECT_IDENTITY_HOST_CHANGED' },
  );
  await assert.rejects(ProjectSessionLifetime.acquire({ ...f, kind: 'main', /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: a retained session cannot admit or control a replacement Live even when its old abort was not signalled
   */
  cleanup: async () => {} }), {
    code: 'PROJECT_IDENTITY_HOST_CHANGED',
  });
  assert.equal(f.used(), 1);
  await session.close();
  await f.lifetime.close();
  f.governor.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: revoked request cannot admit sessions but original full-receipt cleanup retains its authority
 * 协作入口 / Collaborators: `fixture`, `ProjectSessionLifetime.acquire`, `withOperationCheck`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(cleaned, true)`; `assert.equal(f.used(), 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('revoked request cannot admit sessions but original full-receipt cleanup retains its authority', async () => {
  const f = fixture();
  let cleaned = false;
  const session = await ProjectSessionLifetime.acquire({
    ...f,
    kind: 'dap',
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: receipt。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: revoked request cannot admit sessions but original full-receipt cleanup retains its authority
     * 状态影响 / State effects: `cleaned`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `assert.deepEqual`, `f.governor.acquire`, `lease.release`.
     * 检查边界 / Checked boundaries: `assert.deepEqual(receipt, f.receipt)`.
     */
    cleanup: async (receipt) => {
      assert.deepEqual(receipt, f.receipt);
      const lease = await f.governor.acquire({
        owner: 'original-cleanup',
        kind: 'cleanup',
        label: 'original',
        cost: { execution: 1 },
      });
      lease.release();
      cleaned = true;
    },
  });
  await withOperationCheck(
    async () => {
      throw new Error('request revoked');
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: revoked request cannot admit sessions but original full-receipt cleanup retains its authority
     * 协作入口 / Collaborators: `assert.rejects`, `ProjectSessionLifetime.acquire`, `randomUUID`, `ProjectSessionLifetime.retireOriginal`.
     * 检查边界 / Checked boundaries: `assert.rejects( ProjectSessionLifetime.acquire({ ...f, kind: 'dap', receipt: { ...f.receipt, runId: randomUUID() }, cleanup: async…`.
     */
    async () => {
      await assert.rejects(
        ProjectSessionLifetime.acquire({
          ...f,
          kind: 'dap',
          receipt: { ...f.receipt, runId: randomUUID() },
          /**
           * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
           * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
           * 输入 / Inputs: 无 / none。
           * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
           * Result: No explicit result value; callers observe completion, state changes or an exception.
           * 验证场景 / Scenario: revoked request cannot admit sessions but original full-receipt cleanup retains its authority
           */
          cleanup: async () => {},
        }),
        /request revoked/,
      );
      await ProjectSessionLifetime.retireOriginal(f.machines, f.vmId, f.receipt, async () =>
        assert.fail('lost owner'),
      );
    },
  );
  assert.equal(cleaned, true);
  assert.equal(f.used(), 0);
  await session.close();
  await f.lifetime.close();
  f.governor.close();
});
