/**
 * 模块职责：回归验证模块，围绕 `automation-rules` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `automation-rules`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: automation rules preview by default, deduplicate across restart and execute only new matching events; automation cooldown survives execution history eviction.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AutomationRules } from '../server/automation-rules.ts';
import type { WebhookEvent } from '../shared/webhooks.ts';
import type { Machines } from '../server/machines.ts';

const vmId = '11111111-1111-4111-8111-111111111111';
const filter = { types: ['job.finished'] as const, vmIds: [vmId], projectIds: [], tags: [],
  statuses: ['error'] as const, kinds: [] };
const rule = { name: '任务失败后启动实例', enabled: true, previewOnly: true,
  filter, action: 'start' as const, cooldownSeconds: 60 };
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: id: string; time: number。
 * 结果：返回分支计算值（`({ id, type: 'job.finished', occurredAt: new Date(time).toISOString(), vmId, sta…`）。
 * Result: Return the branch-computed value (`({ id, type: 'job.finished', occurredAt: new Date(time).toISOString(), vmId, sta…`).
 * 协作入口 / Collaborators: `new Date(time).toISOString`.
 */
const event = (id: string, time: number): WebhookEvent => ({
  id, type: 'job.finished', occurredAt: new Date(time).toISOString(),
  vmId, status: 'error', tags: [],
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: automation rules preview by default, deduplicate across restart and execute only new matching events
 * 状态影响 / State effects: `events`, `service`, `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.equal(saved.previewOnly, true)`; `assert.equal(service.view().executions[0].status, 'preview')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('automation rules preview by default, deduplicate across restart and execute only new matching events', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-automation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'rules.json');
  let now = Date.parse('2026-09-27T10:00:00.000Z');
  let events: WebhookEvent[] = [];
  const starts: string[] = [];
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回受控对象，公开字段包括 `id`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `id`; the actual branch determines its shape.
     * 验证场景 / Scenario: automation rules preview by default, deduplicate across restart and execute only new matching events
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(id, vmId)`.
     */
    get: (id: string) => { assert.equal(id, vmId); return { id }; },
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: id: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation rules preview by default, deduplicate across restart and execute only new matching events
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(id, vmId)`.
     */
    requireUnlocked: (id: string) => { assert.equal(id, vmId); },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: id: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation rules preview by default, deduplicate across restart and execute only new matching events
     * 协作入口 / Collaborators: `starts.push`.
     */
    start: async (id: string) => { starts.push(id); },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation rules preview by default, deduplicate across restart and execute only new matching events
     */
    stop: async () => {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation rules preview by default, deduplicate across restart and execute only new matching events
     */
    suspend: async () => {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation rules preview by default, deduplicate across restart and execute only new matching events
     */
    resume: async () => {},
  } as unknown as Machines;
  /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`service`），以 Promise 交付。
   * Result: Return the branch-computed value (`service`) through a Promise.
   * 验证场景 / Scenario: automation rules preview by default, deduplicate across restart and execute only new matching events
   * 协作入口 / Collaborators: `service.init`.
   */
  const create = async () => {
    const service = new AutomationRules(async () => events, machines, file, () => now);
    await service.init(false);
    return service;
  };
  let service = await create();
  await service.configure({ operation: 'save', rule });
  const saved = service.view().rules[0];
  assert.equal(saved.previewOnly, true);
  events = [event('a'.repeat(64), now)];
  await service.tick();
  assert.equal(service.view().executions[0].status, 'preview');
  assert.deepEqual(starts, []);
  await service.tick();
  assert.equal(service.view().executions.length, 1);
  await service.close();
  service = await create();
  await service.tick();
  assert.equal(service.view().executions.length, 1);
  now += 1000;
  await service.configure({ operation: 'save', id: saved.id, version: saved.version,
    rule: { ...rule, previewOnly: false } });
  await assert.rejects(service.configure({ operation: 'save', id: saved.id, version: saved.version,
    rule }), /规则已变化/);
  assert.equal(service.view().rules[0].version, 2);
  events.push(event('b'.repeat(64), now));
  const preview = await service.configure({ operation: 'preview', id: saved.id });
  assert.ok('matches' in preview);
  assert.equal(preview.matches[0].wouldExecute, true);
  await service.tick();
  assert.deepEqual(starts, [vmId]);
  assert.equal(service.view().executions[0].status, 'done');
  now += 10_000;
  events.push(event('c'.repeat(64), now));
  await service.tick();
  assert.equal(service.view().executions[0].status, 'skipped');
  assert.deepEqual(starts, [vmId]);
  now += 60_000;
  events.push(event('d'.repeat(64), now));
  await service.tick();
  assert.deepEqual(starts, [vmId, vmId]);
  const executing = service.view().rules[0];
  now += 1000;
  await service.configure({ operation: 'save', id: saved.id, version: executing.version,
    rule: { ...rule, previewOnly: true } });
  events.push(event('e'.repeat(64), now));
  await service.tick();
  assert.equal(service.view().executions[0].status, 'preview');
  assert.deepEqual(starts, [vmId, vmId]);
  await service.close();
  service = await create();
  await service.tick();
  assert.deepEqual(starts, [vmId, vmId]);
  await service.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: automation cooldown survives execution history eviction
 * 状态影响 / State effects: `now`, `latest`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.equal(starts, 1)`; `assert.equal(service.view().executions.length, 300)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('automation cooldown survives execution history eviction', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-automation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'rules.json');
  let now = Date.parse('2026-09-27T10:00:00.000Z');
  let latest: WebhookEvent[] = [];
  let starts = 0;
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id: vmId })`）。
     * Result: Return the branch-computed value (`({ id: vmId })`).
     * 验证场景 / Scenario: automation cooldown survives execution history eviction
     */
    get: () => ({ id: vmId }), /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation cooldown survives execution history eviction
     */
    requireUnlocked: () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation cooldown survives execution history eviction
     */
    start: async () => { starts++; },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation cooldown survives execution history eviction
     */
    stop: async () => {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation cooldown survives execution history eviction
     */
    suspend: async () => {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation cooldown survives execution history eviction
     */
    resume: async () => {},
  } as unknown as Machines;
  const service = new AutomationRules(async () => latest, machines, file, () => now);
  await service.init(false);
  await service.configure({ operation: 'save', rule: { ...rule, previewOnly: false } });
  for (let index = 0; index < 302; index++) {
    now += 1;
    latest = [event(index.toString(16).padStart(64, '0'), now)];
    await service.tick();
  }
  assert.equal(starts, 1);
  assert.equal(service.view().executions.length, 300);
  assert.equal(service.view().executions[0].status, 'skipped');
  await service.close();
  const restarted = new AutomationRules(async () => latest, machines, file, () => now);
  await restarted.init(false);
  now += 1;
  latest = [event('f'.repeat(64), now)];
  await restarted.tick();
  assert.equal(starts, 1);
  await restarted.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: automation rules reject stale saves and preserve ambiguous pending actions without replay
 * 状态影响 / State effects: `blocked`, `stored.executions[0].status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.rejects(service.configure({ operation: 'remove', id: service.view().rules[0].id, version: 1 }), /维护中/)`; `assert.equal(starts, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('automation rules reject stale saves and preserve ambiguous pending actions without replay', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-automation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'rules.json');
  let now = Date.parse('2026-09-27T10:00:00.000Z');
  const events = [event('e'.repeat(64), now)];
  let blocked = false;
  let starts = 0;
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id: vmId })`）。
     * Result: Return the branch-computed value (`({ id: vmId })`).
     * 验证场景 / Scenario: automation rules reject stale saves and preserve ambiguous pending actions without replay
     */
    get: () => ({ id: vmId }), /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation rules reject stale saves and preserve ambiguous pending actions without replay
     */
    requireUnlocked: () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation rules reject stale saves and preserve ambiguous pending actions without replay
     * 失败 / Failure: `new Error('实例启动失败')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    start: async () => { starts++; throw new Error('实例启动失败'); },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation rules reject stale saves and preserve ambiguous pending actions without replay
     */
    stop: async () => {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation rules reject stale saves and preserve ambiguous pending actions without replay
     */
    suspend: async () => {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation rules reject stale saves and preserve ambiguous pending actions without replay
     */
    resume: async () => {},
  } as unknown as Machines;
  const service = new AutomationRules(async () => events, machines, file, () => now,
    () => blocked);
  await service.init(false);
  await service.configure({ operation: 'save', rule: { ...rule, previewOnly: false } });
  blocked = true;
  await assert.rejects(service.configure({ operation: 'remove', id: service.view().rules[0].id,
    version: 1 }), /维护中/);
  await service.tick();
  assert.equal(starts, 0);
  blocked = false;
  await service.tick();
  assert.equal(starts, 1);
  assert.equal(service.view().executions[0].status, 'failed');
  await service.close();
  const stored = JSON.parse(await readFile(file, 'utf8'));
  stored.executions[0].status = 'pending';
  delete stored.executions[0].finishedAt;
  await writeFile(file, JSON.stringify(stored));
  const restarted = new AutomationRules(async () => events, machines, file, () => now);
  await restarted.init(false);
  await restarted.tick();
  assert.equal(starts, 1);
  assert.equal(restarted.view().executions[0].status, 'pending');
  await restarted.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: automation rules enforce the durable daily action ceiling
 * 状态影响 / State effects: `now`, `latest`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.equal(starts, 25)`; `assert.equal(service.view().executions[0].status, 'skipped')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('automation rules enforce the durable daily action ceiling', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-automation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'rules.json');
  let now = Date.parse('2026-09-27T10:00:00.000Z');
  let latest: WebhookEvent[] = [];
  let starts = 0;
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id: vmId })`）。
     * Result: Return the branch-computed value (`({ id: vmId })`).
     * 验证场景 / Scenario: automation rules enforce the durable daily action ceiling
     */
    get: () => ({ id: vmId }), /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation rules enforce the durable daily action ceiling
     */
    requireUnlocked: () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation rules enforce the durable daily action ceiling
     */
    start: async () => { starts++; },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation rules enforce the durable daily action ceiling
     */
    stop: async () => {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation rules enforce the durable daily action ceiling
     */
    suspend: async () => {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: automation rules enforce the durable daily action ceiling
     */
    resume: async () => {},
  } as unknown as Machines;
  const service = new AutomationRules(async () => latest, machines, file, () => now);
  await service.init(false);
  await service.configure({ operation: 'save', rule: { ...rule, previewOnly: false } });
  for (let index = 0; index < 26; index++) {
    now += 61_000;
    latest = [event(index.toString(16).padStart(64, '0'), now)];
    await service.tick();
  }
  assert.equal(starts, 25);
  assert.equal(service.view().executions[0].status, 'skipped');
  await service.close();
  const restarted = new AutomationRules(async () => latest, machines, file, () => now);
  await restarted.init(false);
  now += 61_000;
  latest = [event('f'.repeat(64), now)];
  await restarted.tick();
  assert.equal(starts, 25);
  assert.equal(restarted.view().executions[0].status, 'skipped');
  await restarted.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: runbook approval binds the reviewed steps and executes each event at most once
 * 状态影响 / State effects: `now`, `latest`, `fail`, `service`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.ok('approval' in preview && preview.approval)`; `assert.rejects(service.configure({ operation: 'save', id: saved.id, version: saved.version, rule: { ...repair, previewOnly: false …`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('runbook approval binds the reviewed steps and executes each event at most once', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-automation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'rules.json');
  let now = Date.parse('2026-09-27T10:00:00.000Z');
  let latest: WebhookEvent[] = [];
  let fail = false;
  const calls: Array<{ id: string; projectId?: string; commands: string[] }> = [];
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id: vmId })`）。
     * Result: Return the branch-computed value (`({ id: vmId })`).
     * 验证场景 / Scenario: runbook approval binds the reviewed steps and executes each event at most once
     */
    get: () => ({ id: vmId }), /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: runbook approval binds the reviewed steps and executes each event at most once
     */
    requireUnlocked: () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: runbook approval binds the reviewed steps and executes each event at most once
     */
    start: async () => {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: runbook approval binds the reviewed steps and executes each event at most once
     */
    stop: async () => {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: runbook approval binds the reviewed steps and executes each event at most once
     */
    suspend: async () => {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: runbook approval binds the reviewed steps and executes each event at most once
     */
    resume: async () => {},
  } as unknown as Machines;
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: id: string; steps: Array<{ command: string }>; projectId: string。
   * 结果：返回受控对象，公开字段包括 `code, results`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, results`; the actual branch determines its shape.
   * 验证场景 / Scenario: runbook approval binds the reviewed steps and executes each event at most once
   * 协作入口 / Collaborators: `calls.push`, `steps.map`.
   */
  const executor = async (id: string, steps: Array<{ command: string }>, projectId?: string) => {
    calls.push({ id, projectId, commands: steps.map((step) => step.command) });
    return { code: fail ? 1 : 0, results: steps.map((_, index) => ({ code: fail && index === 0 ? 1 : 0 })) };
  };
  /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`service`），以 Promise 交付。
   * Result: Return the branch-computed value (`service`) through a Promise.
   * 验证场景 / Scenario: runbook approval binds the reviewed steps and executes each event at most once
   * 协作入口 / Collaborators: `service.init`.
   */
  const create = async () => {
    const service = new AutomationRules(async () => latest, machines, file, () => now,
      () => false, () => {}, executor);
    await service.init(false);
    return service;
  };
  let service = await create();
  const repair = { ...rule, name: '重启服务', action: 'runbook' as const, steps: [
    { name: '检查', command: 'test -f /workspace/ready', timeout: 10 },
    { name: '修复', command: 'touch /workspace/repaired', timeout: 20 },
  ] };
  await service.configure({ operation: 'save', rule: repair });
  const saved = service.view().rules[0];
  const preview = await service.configure({ operation: 'preview', id: saved.id });
  assert.ok('approval' in preview && preview.approval);
  await assert.rejects(service.configure({ operation: 'save', id: saved.id,
    version: saved.version, rule: { ...repair, previewOnly: false } }), /预览/);
  await assert.rejects(service.configure({ operation: 'save', id: saved.id,
    version: saved.version, approval: preview.approval,
    rule: { ...repair, previewOnly: false, steps: [{ ...repair.steps[0], command: 'touch /workspace/changed' }] } }),
  /规则内容已变化/);
  await service.configure({ operation: 'save', id: saved.id, version: saved.version,
    approval: preview.approval, rule: { ...repair, previewOnly: false } });
  now += 1000;
  latest = [{ ...event('a'.repeat(64), now), projectId: 'default' }];
  await service.tick();
  assert.deepEqual(calls, [{ id: vmId, projectId: 'default', commands: repair.steps.map((step) => step.command) }]);
  assert.equal(service.view().executions[0].status, 'done');
  assert.deepEqual(service.view().executions[0].steps,
    [{ name: '检查', code: 0 }, { name: '修复', code: 0 }]);
  fail = true;
  now += 61_000;
  latest = [event('b'.repeat(64), now)];
  await service.tick();
  assert.equal(service.view().executions[0].status, 'failed');
  assert.deepEqual(service.view().executions[0].steps,
    [{ name: '检查', code: 1 }, { name: '修复', code: 0 }]);
  await service.close();
  service = await create();
  await service.tick();
  assert.equal(calls.length, 2);
  await service.close();
});
