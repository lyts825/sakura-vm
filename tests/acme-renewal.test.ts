/**
 * 模块职责：回归验证模块，围绕 `acme-renewal` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `acme-renewal`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: Certbot renewal checks existing lineages, schedules due runs, and persists results; failed renewal records failure and exact guest command is not replayed while active.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcmeRenewal } from '../server/acme-renewal.ts';
import type { Machines } from '../server/machines.ts';

const vmId = '00000000-0000-4000-8000-000000000001';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Certbot renewal checks existing lineages, schedules due runs, and persists results
 * 状态影响 / State effects: `ready`, `allowed`, `now`, `running`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `Date.UTC`.
 * 检查边界 / Checked boundaries: `assert.equal((await service.check(vmId)).ready, false)`; `assert.rejects(service.run(vmId, { mode: 'renew' }, 'run'), /锁定或数据迁移/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('Certbot renewal checks existing lineages, schedules due runs, and persists results', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-acme-'));
  const file = join(directory, 'acme.json');
  let now = Date.UTC(2026, 0, 1), ready = false, running = true, allowed = false;
  const commands: string[] = [];
  const machines = {
    records: new Map([[vmId, {}]]), /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({})`）。
     * Result: Return the branch-computed value (`({})`).
     * 验证场景 / Scenario: Certbot renewal checks existing lineages, schedules due runs, and persists results
     */
    get: () => ({}),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`running ? 'running' : 'stopped'`）。
     * Result: Return the branch-computed value (`running ? 'running' : 'stopped'`).
     * 验证场景 / Scenario: Certbot renewal checks existing lineages, schedules due runs, and persists results
     */
    state: () => running ? 'running' : 'stopped', /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: Certbot renewal checks existing lineages, schedules due runs, and persists results
     */
    requireUnlocked: () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: Certbot renewal checks existing lineages, schedules due runs, and persists results
     * 协作入口 / Collaborators: `commands.push`, `command.includes`.
     */
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: command.includes('command -v certbot') ? (ready ? 0 : 1) : 0,
        stdout: '', stderr: '' };
    },
  } as unknown as Machines;
  const service = new AcmeRenewal(machines, file, () => now, { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`allowed`）。
   * Result: Return the branch-computed value (`allowed`).
   * 验证场景 / Scenario: Certbot renewal checks existing lineages, schedules due runs, and persists results
   */
  allowed: () => allowed, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: Certbot renewal checks existing lineages, schedules due runs, and persists results
   */
  mutation: () => {} });
  await service.init();
  try {
    assert.equal((await service.check(vmId)).ready, false);
    await assert.rejects(service.run(vmId, { mode: 'renew' }, 'run'), /锁定或数据迁移/);
    ready = true;
    assert.equal((await service.check(vmId)).ready, true);
    const saved = await service.save(vmId,
      { mode: 'save', enabled: true, intervalHours: 12 });
    assert.equal(saved.policy?.enabled, true);
    assert.equal(commands.filter((item) => item.startsWith('certbot renew')).length, 0);
    allowed = true;
    await new Promise<void>((resolve) => setImmediate(resolve));
    await service.tick();
    assert.equal(commands.filter((item) => item ===
      'certbot renew --non-interactive --quiet').length, 1);
    assert.equal(service.view(vmId).attempts[0].status, 'success');
    await service.tick();
    assert.equal(commands.filter((item) => item.startsWith('certbot renew')).length, 1);
    now += 12 * 3_600_000;
    running = false;
    await service.tick();
    assert.equal(commands.filter((item) => item.startsWith('certbot renew')).length, 1);
    running = true;
    await service.tick();
    assert.equal(commands.filter((item) => item.startsWith('certbot renew')).length, 2);
    const dryRun = await service.run(vmId, { mode: 'dry-run' }, 'run');
    assert.equal(dryRun.ready, true);
    assert.equal(commands.at(-1), 'certbot renew --non-interactive --quiet --dry-run');
    assert.equal(service.view(vmId).attempts.length, 3);
    const before = service.view(vmId).policy?.nextAttemptAt;
    await service.save(vmId, { mode: 'save', enabled: false });
    now += 12 * 3_600_000;
    await service.tick();
    assert.equal(commands.filter((item) => item.startsWith('certbot renew')).length, 3);
    assert.ok(before);
    await service.close();
    const restored = new AcmeRenewal(machines, file, () => now);
    await restored.init();
    assert.equal(restored.view(vmId).policy?.enabled, false);
    assert.equal(restored.view(vmId).attempts.length, 3);
    await restored.close();
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed renewal records failure and exact guest command is not replayed while active
 * 状态影响 / State effects: `ready`, `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `Date.UTC`.
 * 检查边界 / Checked boundaries: `assert.rejects(service.run(vmId, { mode: 'renew' }, 'run'), /Certbot/)`; `assert.equal(service.view(vmId).attempts[0].status, 'failed')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('failed renewal records failure and exact guest command is not replayed while active', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-acme-'));
  let now = Date.UTC(2026, 0, 1), ready = false, finish: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void) | undefined;
  let renewals = 0;
  const machines = {
    records: new Map([[vmId, {}]]), /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({})`）。
     * Result: Return the branch-computed value (`({})`).
     * 验证场景 / Scenario: failed renewal records failure and exact guest command is not replayed while active
     */
    get: () => ({}),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: failed renewal records failure and exact guest command is not replayed while active
     */
    state: () => 'running', /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: failed renewal records failure and exact guest command is not replayed while active
     */
    requireUnlocked: () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: failed renewal records failure and exact guest command is not replayed while active
     * 协作入口 / Collaborators: `command.includes`.
     */
    exec: async (_id: string, command: string) => {
      if (command.includes('command -v certbot'))
        return { code: ready ? 0 : 1, stdout: '', stderr: '' };
      renewals++;
      await new Promise<void>((resolve) => { finish = resolve; });
      return { code: 2, stdout: '', stderr: 'challenge failed' };
    },
  } as unknown as Machines;
  let mutations = 0;
  const service = new AcmeRenewal(machines, join(directory, 'acme.json'), () => now,
    { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回布尔判定，供用例选择路径或核对受控条件。
     * Result: Return a boolean decision for path selection or controlled-condition assertions.
     * 验证场景 / Scenario: failed renewal records failure and exact guest command is not replayed while active
     */
    allowed: () => true, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: delta。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: failed renewal records failure and exact guest command is not replayed while active
     * 状态影响 / State effects: `mutations`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    mutation: delta => { mutations += delta; } });
  await service.init();
  try {
    await assert.rejects(service.run(vmId, { mode: 'renew' }, 'run'), /Certbot/);
    assert.equal(service.view(vmId).attempts[0].status, 'failed');
    ready = true;
    const first = service.run(vmId, { mode: 'renew' }, 'run');
    assert.equal(mutations, 1);
    await assert.rejects(service.run(vmId, { mode: 'renew' }, 'run'), /正在执行/);
    await assert.rejects(service.save(vmId,
      { mode: 'save', enabled: false }), /正在执行/);
    while (!finish) await new Promise((resolve) => setTimeout(resolve, 1));
    finish();
    const result = await first;
    assert.equal(result.ready, false);
    assert.ok('exitCode' in result);
    assert.equal(result.exitCode, 2);
    assert.equal(renewals, 1);
    assert.equal(mutations, 0);
    assert.equal(service.view(vmId).attempts[0].exitCode, 2);
    now += 1;
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
