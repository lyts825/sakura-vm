/**
 * 模块职责：回归验证模块，围绕 `ssh-agent-capability-policy` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ssh-agent-capability-policy`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: SSH Agent commands and confirmation cannot become persisted feature defaults; legacy saved SSH confirmation never starts a job without fresh complete parameters.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';

const directory = await mkdtemp(join(tmpdir(), 'sakura-agent-capability-'));
process.env.SAKURA_DATA_DIR = directory;
const { ExtendedFeatures } = await import('../server/extended-features.ts');
const id = '39b6dd1c-b788-43a9-8958-4811e6c859ad';
after(async () => {
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-agent-capability-'));
  await rm(directory, { recursive: true, force: true });
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `service, guestCalls`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `service, guestCalls`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `Object.assign`.
 */
function fixture() {
  let guestCalls = 0;
  const machines = Object.assign(new EventEmitter(), {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id })`）。
     * Result: Return the branch-computed value (`({ id })`).
     */
    get: () => ({ id }), /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    requireUnlocked: () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('No guest operation is permitted')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    exec: async () => { guestCalls++; throw new Error('No guest operation is permitted'); },
  }) as unknown as Machines;
  const workspaces = { /**
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
    key: () => id + ':default' } } as unknown as Workspaces;
  return { service: new ExtendedFeatures(machines, workspaces), /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`guestCalls`）。
   * Result: Return the branch-computed value (`guestCalls`).
   */
  guestCalls: () => guestCalls };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH Agent commands and confirmation cannot become persisted feature defaults
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `service.configure`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(service.configure(id, { featureId: 'ssh-agent-forward', enabled: true, options: { command: 'ssh-add -L', confirmed:…`; `assert.equal(guestCalls(), 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('SSH Agent commands and confirmation cannot become persisted feature defaults', async () => {
  const { service, guestCalls } = fixture();
  try {
    await assert.rejects(service.configure(id, { featureId: 'ssh-agent-forward', enabled: true,
      options: { command: 'ssh-add -L', confirmed: true } }), /一次性命令与确认不能保存/);
    assert.equal(guestCalls(), 0);
    assert.deepEqual(service.jobs.list(), []);
  } finally { await service.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy saved SSH confirmation never starts a job without fresh complete parameters
 * 状态影响 / State effects: `(service as any).stateValue`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `service.action`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(service.action(id, { action: 'run', featureId: 'ssh-agent-forward', options }), /command|confirmed/)`; `assert.equal(guestCalls(), 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('legacy saved SSH confirmation never starts a job without fresh complete parameters', async () => {
  const { service, guestCalls } = fixture();
  const legacy = { enabled: true, options: { command: 'ssh-add -L', confirmed: true },
    updatedAt: '2026-09-30T00:00:00.000Z' };
  (service as any).stateValue = { settings: { [id]: { 'ssh-agent-forward': legacy } },
    manifests: {}, executions: {} };
  try {
    for (const options of [undefined, { command: 'ssh-add -L' }, { command: 'ssh-add -L', confirmed: false }])
      await assert.rejects(service.action(id, { action: 'run', featureId: 'ssh-agent-forward', options }),
        /command|confirmed/);
    assert.equal(guestCalls(), 0);
    assert.deepEqual(service.jobs.list(), []);
    assert.deepEqual((service as any).stateValue.settings[id]['ssh-agent-forward'], legacy);
  } finally { await service.close(); }
});
