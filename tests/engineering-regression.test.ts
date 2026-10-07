/**
 * 模块职责：回归验证模块，围绕 `engineering-regression` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `engineering-regression`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: all 37 operation envelopes reach the executor and failures mark jobs as error; all 200 configure branches accept the public envelope and reject unexpected fields.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'sakura-engineering-regression-'));
process.env.SAKURA_DATA_DIR = directory;
const { ExtendedFeatures, extendedFeatureCatalog } = await import('../server/extended-features.ts');
const { NextFeatures, nextFeatureCatalog } = await import('../server/next-features.ts');
const { FeatureSuite } = await import('../server/feature-suite.ts');
const { engineeringOperations, validateOperation } = await import('../server/engineering-operations.ts');
const { Machines } = await import('../server/machines.ts');
const id = '11111111-1111-4111-8111-111111111111';
after(async () => {
  assert.equal(dirname(directory), resolve(tmpdir()));
  await rm(directory, { recursive: true, force: true });
});
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `machines, workspaces, advance, busy, idle, fail, stopped, now`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, workspaces, advance, busy, idle, fail, stopped, now`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `Date.now`.
 */
function fixture() {
  let time = Date.now(),
    cpu = 0,
    stopped = 0,
    status = 'running',
    fail = false,
    locked = false;
  const machines: any = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    on() {},
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    off() {},
    records: new Map([[id, { id }]]),
    live: new Map(),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id })`）。
     * Result: Return the branch-computed value (`({ id })`).
     */
    get: () => ({ id }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`status`）。
     * Result: Return the branch-computed value (`status`).
     */
    state: () => status,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    stop: async () => {
      stopped++;
      status = 'stopped';
    },
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('locked')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    requireUnlocked: () => {
      if (locked) throw new Error('locked');
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`locked`）。
     * Result: Return the branch-computed value (`locked`).
     */
    incidentLocked: () => locked,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; action: () => Promise<unknown>。
     * 结果：返回分支计算值（`action()`），以 Promise 交付。
     * Result: Return the branch-computed value (`action()`) through a Promise.
     * 协作入口 / Collaborators: `action`.
     */
    locked: async (_id: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => action(),
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _id: string; value: boolean。
     * 结果：返回受控对象，公开字段包括 `locked`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `locked`; the actual branch determines its shape.
     * 状态影响 / State effects: `locked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setIncidentLockdown: async (_id: string, value: boolean) => {
      locked = value;
      return { locked };
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ stdout: '', stderr: 'missing', code: 127 })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ stdout: '', stderr: 'missing', code: 127 })`) through a Promise.
     */
    exec: async () => ({ stdout: '', stderr: 'missing', code: 127 }),
  };
  const workspaces: any = {
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`() => {}`）。
     * Result: Return the branch-computed value (`() => {}`).
     */
    beforeConfigChange: () => () => {},
    projects: { /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'default'`）。
     * Result: Return the branch-computed value (`'default'`).
     */
    current: () => 'default', /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`id + ':default'`）。
     * Result: Return the branch-computed value (`id + ':default'`).
     */
    key: () => id + ':default' },
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `sampledAt, cpuPercent, memoryUsed, memoryTotal, diskUsed, diskTotal`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `sampledAt, cpuPercent, memoryUsed, memoryTotal, diskUsed, diskTotal`; the actual branch determines its shape.
     * 失败 / Failure: `new Error('offline')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `new Date(time).toISOString`.
     */
    metrics: async () => {
      if (fail) throw new Error('offline');
      return {
        sampledAt: new Date(time).toISOString(),
        cpuPercent: cpu,
        memoryUsed: 1,
        memoryTotal: 10,
        diskUsed: 1,
        diskTotal: 10,
      };
    },
  };
  return {
    machines,
    workspaces,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: ms: number。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `time`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    advance: (ms: number) => {
      time += ms;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `cpu`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    busy: () => {
      cpu = 10;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `cpu`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    idle: () => {
      cpu = 0;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `fail`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    fail: (value: boolean) => {
      fail = value;
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`stopped`）。
     * Result: Return the branch-computed value (`stopped`).
     */
    stopped: () => stopped,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`time`）。
     * Result: Return the branch-computed value (`time`).
     */
    now: () => time,
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: all 37 operation envelopes reach the executor and failures mark jobs as error
 * 状态影响 / State effects: `(service as any).runOperation`, `parameters.commit`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `Object.entries`, `'a'.repeat`, `service.action`.
 * 检查边界 / Checked boundaries: `assert.equal(service.jobs.view(job.key)?.status, 'done', operation)`; `assert.equal(received.length, 37)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('all 37 operation envelopes reach the executor and failures mark jobs as error', async () => {
  const { machines, workspaces } = fixture();
  const service = new ExtendedFeatures(machines, workspaces);
  const received: string[] = [];
  (service as any).runOperation = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; operation: string。
   * 结果：返回受控对象，公开字段包括 `code`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code`; the actual branch determines its shape.
   * 验证场景 / Scenario: all 37 operation envelopes reach the executor and failures mark jobs as error
   * 协作入口 / Collaborators: `received.push`.
   */
  async (_id: string, operation: string) => {
    received.push(operation);
    return { code: 0 };
  };
  try {
    for (const [operation, spec] of Object.entries(engineeringOperations)) {
      const parameters = { ...spec.example };
      if (operation === 'git-cherry-pick') parameters.commit = 'a'.repeat(40);
      const job: any = await service.action(id, { action: 'operation', operation, parameters });
      await service.jobs.wait(job.key);
      assert.equal(service.jobs.view(job.key)?.status, 'done', operation);
    }
    assert.equal(received.length, 37);
    (service as any).runOperation = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ code: 7, error: 'intentional failure' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ code: 7, error: 'intentional failure' })`) through a Promise.
     * 验证场景 / Scenario: all 37 operation envelopes reach the executor and failures mark jobs as error
     */
    async () => ({ code: 7, error: 'intentional failure' });
    const job: any = await service.action(id, {
      action: 'operation',
      operation: 'hash-manifest',
      parameters: {},
    });
    await service.jobs.wait(job.key);
    assert.equal(service.jobs.view(job.key)?.status, 'error');
    assert.match(service.jobs.view(job.key)?.log || '', /"code":7/);
  } finally {
    await service.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: all 200 configure branches accept the public envelope and reject unexpected fields
 * 协作入口 / Collaborators: `fixture`, `[extendedFeatureCatalog, nextFeatureCatalog].entries`, `services[index].action`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.enabled, true, featureId)`; `assert.rejects( services[index].action(id, { action: 'configure', featureId: catalog[0][0], enabled: true, unwanted: true, }), )`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('all 200 configure branches accept the public envelope and reject unexpected fields', async () => {
  const { machines, workspaces } = fixture();
  const services = [
    new ExtendedFeatures(machines, workspaces),
    new NextFeatures(machines, workspaces),
  ] as const;
  try {
    for (const [index, catalog] of [extendedFeatureCatalog, nextFeatureCatalog].entries()) {
      for (const [featureId] of catalog) {
        const result: any = await services[index].action(id, {
          action: 'configure',
          featureId,
          enabled: true,
          options: {},
        });
        assert.equal(result.enabled, true, featureId);
      }
      await assert.rejects(
        services[index].action(id, {
          action: 'configure',
          featureId: catalog[0][0],
          enabled: true,
          unwanted: true,
        }),
      );
    }
  } finally {
    for (const service of services) await service.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: checks do not lock machines and GPU visibility requires real guest evidence
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.equal`, `next.action`, `machines.incidentLocked`.
 * 检查边界 / Checked boundaries: `assert.equal( ((await next.action(id, { action: 'check', featureId: 'incident-lockdown' })) as any).locked, false, )`; `assert.equal(machines.incidentLocked(id), false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('checks do not lock machines and GPU visibility requires real guest evidence', async () => {
  const { machines, workspaces } = fixture();
  const next = new NextFeatures(machines, workspaces);
  try {
    assert.equal(
      ((await next.action(id, { action: 'check', featureId: 'incident-lockdown' })) as any).locked,
      false,
    );
    assert.equal(machines.incidentLocked(id), false);
    await assert.rejects(next.action(id, { action: 'configure',
      featureId: 'vtpm-key-enrollment', enabled: true,
      options: { privateKey: 'must-not-persist' } }));
    const missing: any = await next.action(id, { action: 'check', featureId: 'gpu-compute-passthrough' });
    assert.equal(missing.ready, false);
    assert.equal(missing.cuda.available, false);
    machines.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回分支计算值（`({ stdout: command.includes('nvidia-smi') ? 'NVIDIA A10, GPU-123\n' : '', stderr…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ stdout: command.includes('nvidia-smi') ? 'NVIDIA A10, GPU-123\n' : '', stderr…`) through a Promise.
     * 验证场景 / Scenario: checks do not lock machines and GPU visibility requires real guest evidence
     * 协作入口 / Collaborators: `command.includes`.
     */
    async (_id: string, command: string) => ({
      stdout: command.includes('nvidia-smi') ? 'NVIDIA A10, GPU-123\n' : '',
      stderr: '',
      code: 0,
    });
    assert.equal(
      ((await next.action(id, { action: 'check', featureId: 'gpu-compute-passthrough' })) as any).ready,
      true,
    );
    const gpuJob: any = await next.action(id, { action: 'run', featureId: 'gpu-compute-passthrough' });
    await next.jobs.wait(gpuJob.key);
    assert.equal(next.jobs.view(gpuJob.key)?.status, 'done');
    const recording: any = await next.action(id, { action: 'check', featureId: 'desktop-recording' });
    assert.equal(recording.ready, true);
    assert.equal(recording.executed, false);
    assert.match(recording.message, /录制与回放/);
    await assert.rejects(next.action(id, { action: 'run', featureId: 'incident-lockdown' }));
    await next.action(id, { action: 'run', featureId: 'incident-lockdown', options: { locked: true } });
    assert.equal(machines.incidentLocked(id), true);
    await next.action(id, { action: 'run', featureId: 'incident-lockdown', options: { locked: false } });
    assert.equal(machines.incidentLocked(id), false);
  } finally {
    await next.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: idle shutdown requires fresh continuous low CPU samples and resets on activity or failure
 * 协作入口 / Collaborators: `fixture`, `t.mock.method`, `suite.update`, `suite.tick`.
 * 检查边界 / Checked boundaries: `assert.equal(f.stopped(), 0)`; `assert.equal(f.stopped(), 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('idle shutdown requires fresh continuous low CPU samples and resets on activity or failure', async (t) => {
  const f = fixture();
  const suite = new FeatureSuite(f.machines, f.workspaces);
  t.mock.method(Date, 'now', () => f.now());
  try {
    await suite.update(id, { schedule: { enabled: true, idleMinutes: 1 } });
    await suite.tick();
    f.advance(30_000);
    f.busy();
    await suite.tick();
    f.advance(30_000);
    f.idle();
    await suite.tick();
    f.advance(30_000);
    f.fail(true);
    await suite.tick();
    f.advance(30_000);
    f.fail(false);
    await suite.tick();
    f.advance(30_000);
    await suite.tick();
    assert.equal(f.stopped(), 0);
    f.advance(30_000);
    await suite.tick();
    assert.equal(f.stopped(), 1);
  } finally {
    await suite.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lockdown is persisted and blocks machine starts, writes and guest connections after restart
 * 状态影响 / State effects: `(machines as any).stopInternal`, `(restored as any).stopInternal`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `machines.records.set`, `machines.setIncidentLockdown`, `assert.throws`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.throws(() => machines.requireUnlocked(id), /应急锁定/)`; `assert.rejects(machines.connect(id), /应急锁定/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('lockdown is persisted and blocks machine starts, writes and guest connections after restart', async () => {
  const machines = new Machines({} as any, fakeVmNetwork);
  machines.records.set(id, { id } as any);
  (machines as any).stopInternal = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: lockdown is persisted and blocks machine starts, writes and guest connections after restart
   */
  async () => {};
  await machines.setIncidentLockdown(id, true);
  assert.throws(() => machines.requireUnlocked(id), /应急锁定/);
  await assert.rejects(machines.connect(id), /应急锁定/);
  await assert.rejects(
    machines.locked('git:' + id + ':default', async () => {}),
    /应急锁定/,
  );
  const restored = new Machines({} as any, fakeVmNetwork);
  await restored.init();
  restored.records.set(id, { id } as any);
  assert.equal(restored.incidentLocked(id), true);
  (restored as any).stopInternal = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: lockdown is persisted and blocks machine starts, writes and guest connections after restart
   */
  async () => {};
  await restored.setIncidentLockdown(id, false);
  assert.doesNotThrow(() => restored.requireUnlocked(id));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: mutating operation parameters reject missing targets, invalid routes and incomplete rebase plans
 * 协作入口 / Collaborators: `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.throws(() => validateOperation({ operation: 'static-routes', parameters }))`; `assert.throws(() => validateOperation({ operation: 'archive', parameters: { mode: 'extract', path: 'a.tar' } }), )`.
 */
test('mutating operation parameters reject missing targets, invalid routes and incomplete rebase plans', () => {
  for (const parameters of [
    { mode: 'add', destination: 'default' },
    { mode: 'delete', destination: '0.0.0.0/0' },
    { mode: 'add', destination: 'bad/24' },
    { mode: 'add', destination: '10.0.0.0/24', gateway: '::1' },
  ])
    assert.throws(() => validateOperation({ operation: 'static-routes', parameters }));
  assert.throws(() =>
    validateOperation({ operation: 'archive', parameters: { mode: 'extract', path: 'a.tar' } }),
  );
  assert.throws(() =>
    validateOperation({ operation: 'git-rebase', parameters: { mode: 'apply', base: 'HEAD~1', todo: [] } }),
  );
  assert.throws(() => validateOperation({ operation: 'git-cherry-pick', parameters: { mode: 'revert' } }));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: engineering executors exercise real files, Git repositories and failing child processes
 * 状态影响 / State effects: `env[pathKey]`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Object.keys(env).find`, `Object.keys`, `spawnSync`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr)`.
 */
test(
  'engineering executors exercise real files, Git repositories and failing child processes',
  { timeout: 120_000 },
  () => {
    const python = process.env.SAKURA_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const env: Record<string, string | undefined> = { ...process.env, PYTHONUTF8: '1' };
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
    if (process.platform === 'win32')
      env[pathKey] = 'C:\\Program Files\\Git\\bin;C:\\Program Files\\Git\\usr\\bin;' + env[pathKey];
    const result = spawnSync(python, ['tests/engineering_runner_test.py'], {
      env,
      encoding: 'utf8',
      timeout: 110_000,
    });
    assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  },
);
