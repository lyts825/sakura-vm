/**
 * 模块职责：回归验证模块，围绕 `project-protocol-channel` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-protocol-channel`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: SSH exec setup retains cancellation after connect readiness and destroys a late channel; SSH connection closure before exec acknowledgment rejects and never adopts a late channel.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { openProjectProtocolChannel } from '../server/project-protocol-stream.ts';
import type { Machines } from '../server/machines.ts';

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `id, live, client, commands, machines, callback, destroyed`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, live, client, commands, machines, callback, destroyed`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `Object.assign`.
 */
function fixture() {
  const id = 'protocol-channel-model', live = {}, client = new EventEmitter();
  let callback: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: error: Error | undefined; wire: PassThrough。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (error: Error | undefined, wire: PassThrough) => void) | undefined, destroyed = false;
  const commands: string[] = [], transport = Object.assign(client, {
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: command: string; ready: typeof callback。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `callback`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `commands.push`.
     */
    exec: (command: string, ready: typeof callback) => { commands.push(command); callback = ready; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `destroyed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `client.emit`.
     */
    destroy: () => { if (!destroyed) { destroyed = true; client.emit('close'); } },
  });
  const machines = { live: new Map([[id, live]]), /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'running'`）。
   * Result: Return the branch-computed value (`'running'`).
   */
  state: () => 'running', /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`transport`），以 Promise 交付。
   * Result: Return the branch-computed value (`transport`) through a Promise.
   */
  connect: async () => transport } as unknown as
    Pick<Machines, 'connect' | 'live' | 'state'>;
  return { id, live, client, commands, machines, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`callback`）。
   * Result: Return the branch-computed value (`callback`).
   */
  callback: () => callback, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`destroyed`）。
   * Result: Return the branch-computed value (`destroyed`).
   */
  destroyed: () => destroyed };
}
/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: f: ReturnType<typeof fixture>。
 * 结果：返回分支计算值（`f.callback()!`），以 Promise 交付。
 * Result: Return the branch-computed value (`f.callback()!`) through a Promise.
 * 协作入口 / Collaborators: `f.callback`, `delay`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(f.callback())`.
 */
async function ready(f: ReturnType<typeof fixture>) {
  for (let n = 0; n < 100 && !f.callback(); ++n) await delay(1);
  assert.ok(f.callback()); return f.callback()!;
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH exec setup retains cancellation after connect readiness and destroys a late channel
 * 协作入口 / Collaborators: `fixture`, `openProjectProtocolChannel`, `assert.rejects`, `ready`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, (error: Error) => error.name === 'AbortError')`; `assert.equal(registered, true)`.
 */
test('SSH exec setup retains cancellation after connect readiness and destroys a late channel', async () => {
  const f = fixture(), abort = new AbortController(); let registered = false;
  const pending = openProjectProtocolChannel(f.machines, f.id, 'fixed-root-relay', f.live, abort.signal,
    async () => { registered = true; });
  const rejected = assert.rejects(pending, (error: Error) => error.name === 'AbortError');
  const callback = await ready(f); assert.equal(registered, true); abort.abort(); await rejected;
  assert.equal(f.destroyed(), true); const late = new PassThrough(); callback(undefined, late);
  assert.equal(late.destroyed, true); assert.deepEqual(f.commands, ['fixed-root-relay']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH connection closure before exec acknowledgment rejects and never adopts a late channel
 * 协作入口 / Collaborators: `fixture`, `openProjectProtocolChannel`, `assert.rejects`, `ready`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, /应答前已关闭/)`; `assert.equal(late.destroyed, true)`.
 */
test('SSH connection closure before exec acknowledgment rejects and never adopts a late channel', async () => {
  const f = fixture(), pending = openProjectProtocolChannel(f.machines, f.id, 'fixed-root-relay', f.live,
    new AbortController().signal, async () => {});
  const rejected = assert.rejects(pending, /应答前已关闭/), callback = await ready(f);
  f.client.emit('close'); await rejected; const late = new PassThrough(); callback(undefined, late);
  assert.equal(late.destroyed, true); assert.equal(f.destroyed(), true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH exec setup deadline cancels a stalled durable launch callback without issuing a command
 * 协作入口 / Collaborators: `fixture`, `openProjectProtocolChannel`, `assert.rejects`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, (error: any) => error.status === 408)`; `assert.equal(f.destroyed(), true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH exec setup deadline cancels a stalled durable launch callback without issuing a command', async () => {
  const f = fixture(); let unblock!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, entering!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const entered = new Promise<void>(resolve => { entering = resolve; });
  const pending = openProjectProtocolChannel(f.machines, f.id, 'fixed-root-relay', f.live,
    new AbortController().signal, async () => { entering(); await new Promise<void>(resolve => { unblock = resolve; }); }, 20);
  const rejected = assert.rejects(pending, (error: any) => error.status === 408);
  await entered; await rejected; assert.equal(f.destroyed(), true); assert.deepEqual(f.commands, []);
  unblock(); await delay(1); assert.deepEqual(f.commands, []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH exec setup refuses a live replacement before any durable launch callback
 * 状态影响 / State effects: `f.machines.connect`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `openProjectProtocolChannel`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(openProjectProtocolChannel(f.machines, f.id, 'fixed-root-relay', f.live, new AbortController().signal, async () => …`; `assert.equal(launched, false)`.
 */
test('SSH exec setup refuses a live replacement before any durable launch callback', async () => {
  const f = fixture(); let launched = false;
  f.machines.connect = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`f.client as never`），以 Promise 交付。
   * Result: Return the branch-computed value (`f.client as never`) through a Promise.
   * 验证场景 / Scenario: SSH exec setup refuses a live replacement before any durable launch callback
   * 协作入口 / Collaborators: `f.machines.live.set`.
   */
  async () => { f.machines.live.set(f.id, {} as never); return f.client as never; };
  await assert.rejects(openProjectProtocolChannel(f.machines, f.id, 'fixed-root-relay', f.live,
    new AbortController().signal, async () => { launched = true; }), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal(launched, false); assert.deepEqual(f.commands, []); assert.equal(f.destroyed(), true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH exec acknowledgment rechecks original live and closes an unaccepted channel
 * 协作入口 / Collaborators: `fixture`, `openProjectProtocolChannel`, `assert.rejects`, `ready`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, { code: 'PROJECT_IDENTITY_HOST_CHANGED' })`; `assert.equal(wire.destroyed, true)`.
 */
test('SSH exec acknowledgment rechecks original live and closes an unaccepted channel', async () => {
  const f = fixture(), pending = openProjectProtocolChannel(f.machines, f.id, 'fixed-root-relay', f.live,
    new AbortController().signal, async () => {});
  const rejected = assert.rejects(pending, { code: 'PROJECT_IDENTITY_HOST_CHANGED' }), callback = await ready(f);
  f.machines.live.set(f.id, {} as never); const wire = new PassThrough(); callback(undefined, wire); await rejected;
  assert.equal(wire.destroyed, true); assert.equal(f.destroyed(), true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: accepted SSH channel cancels its setup deadline and closes both transport owners explicitly
 * 协作入口 / Collaborators: `fixture`, `openProjectProtocolChannel`, `ready`, `callback`.
 * 检查边界 / Checked boundaries: `assert.equal(channel.wire, wire)`; `assert.equal(wire.destroyed, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('accepted SSH channel cancels its setup deadline and closes both transport owners explicitly', async () => {
  const f = fixture(), pending = openProjectProtocolChannel(f.machines, f.id, 'fixed-root-relay', f.live,
    new AbortController().signal, async () => {}, 40);
  const callback = await ready(f), wire = new PassThrough(); callback(undefined, wire);
  const channel = await pending; await delay(50);
  assert.equal(channel.wire, wire); assert.equal(wire.destroyed, false); assert.equal(f.destroyed(), false);
  channel.close(); assert.equal(wire.destroyed, true); assert.equal(f.destroyed(), true);
});
