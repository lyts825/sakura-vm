/**
 * 模块职责：回归验证模块，围绕 `machines-input` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `machines-input`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: bounded SSH input sends exact binary bytes and EOF outside the command argv; input is captured before a delayed connection and explicitly empty input still sends EOF.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Machines } from '../server/machines.ts';
import { AppError } from '../server/model.ts';

class Channel extends EventEmitter {
  stderr = new EventEmitter();
  inputs: Buffer[] = [];
  closes = 0;
  onInput?: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: input: Buffer。
   * 结果：返回分支计算值（`this`）。
   * Result: Return the branch-computed value (`this`).
   * 协作入口 / Collaborators: `this.inputs.push`, `Buffer.from`, `this.onInput`.
   */
  end(input: Buffer) { this.inputs.push(Buffer.from(input)); this.onInput?.(); return this; }
  /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `this.emit`.
   */
  close() { ++this.closes; this.emit('close', -1); }
}

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `machine, channel, client, calls, ready, rejectOpen, counts`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machine, channel, client, calls, ready, rejectOpen, counts`; the actual branch determines its shape.
 * 状态影响 / State effects: `machine.connect`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Object.assign`, `Object.create`.
 */
function fixture() {
  const channel = new Channel(), client = new EventEmitter();
  const calls: { command: string; options?: unknown }[] = [];
  let connects = 0, ends = 0, destroys = 0, complete: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: error: Error | null; stream: Channel。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (error: Error | null, stream?: Channel) => void) | undefined;
  Object.assign(client, {
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: command: string; options: unknown; callback: typeof complete。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `complete`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `calls.push`.
     */
    exec: (command: string, options: unknown, callback?: typeof complete) => {
      calls.push({ command, options: callback ? options : undefined });
      complete = callback || options as typeof complete;
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    end: () => { ++ends; },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `client.emit`.
     */
    destroy: () => { ++destroys; client.emit('close'); },
  });
  const machine = Object.create(Machines.prototype) as Machines;
  machine.connect = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`client as any`），以 Promise 交付。
   * Result: Return the branch-computed value (`client as any`) through a Promise.
   */
  async () => { ++connects; return client as any; };
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `Promise.resolve`, `assert.ok`, `complete`.
   * 检查边界 / Checked boundaries: `assert.ok(complete, 'command channel was requested')`.
   */
  const ready = async () => {
    await Promise.resolve(); await Promise.resolve();
    assert.ok(complete, 'command channel was requested');
    complete(null, channel);
  };
  return { machine, channel, client, calls, ready,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: error: Error。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `Promise.resolve`, `complete!`.
     */
    rejectOpen: async (error: Error) => { await Promise.resolve(); await Promise.resolve(); complete!(error); },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ connects, ends, destroys })`）。
     * Result: Return the branch-computed value (`({ connects, ends, destroys })`).
     */
    counts: () => ({ connects, ends, destroys }) };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: bounded SSH input sends exact binary bytes and EOF outside the command argv
 * 协作入口 / Collaborators: `fixture`, `Buffer.from`, `f.machine.execInput`, `f.ready`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(f.channel.inputs, [payload])`; `assert.deepEqual(f.calls, [{ command: '/fixed/helper --run fixed-id', options: undefined }])`.
 */
test('bounded SSH input sends exact binary bytes and EOF outside the command argv', async () => {
  const f = fixture(), payload = Buffer.from('private\0文本\n$(unchanged)', 'utf8');
  const operation = f.machine.execInput('owned', '/fixed/helper --run fixed-id', payload);
  await f.ready();
  assert.deepEqual(f.channel.inputs, [payload]);
  assert.deepEqual(f.calls, [{ command: '/fixed/helper --run fixed-id', options: undefined }]);
  f.channel.emit('data', Buffer.from('result'));
  f.channel.stderr.emit('data', Buffer.from('warning'));
  f.channel.emit('close', 7);
  assert.deepEqual(await operation, { stdout: 'result', stderr: 'warning', code: 7 });
  assert.deepEqual(f.counts(), { connects: 1, ends: 1, destroys: 0 });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: input is captured before a delayed connection and explicitly empty input still sends EOF
 * 协作入口 / Collaborators: `fixture`, `Buffer.from`, `f.machine.execInput`, `payload.fill`.
 * 检查边界 / Checked boundaries: `assert.equal(f.channel.inputs[0].toString(), 'original')`; `assert.deepEqual(empty.channel.inputs, [Buffer.alloc(0)])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('input is captured before a delayed connection and explicitly empty input still sends EOF', async () => {
  const f = fixture(), payload = Buffer.from('original');
  const operation = f.machine.execInput('owned', '/fixed/helper', payload);
  payload.fill(0);
  await f.ready(); f.channel.emit('close', 0); await operation;
  assert.equal(f.channel.inputs[0].toString(), 'original');
  const empty = fixture(), pending = empty.machine.execInput('owned', '/fixed/helper', Buffer.alloc(0));
  await empty.ready(); empty.channel.emit('close', 0); await pending;
  assert.deepEqual(empty.channel.inputs, [Buffer.alloc(0)]);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: ordinary exec keeps stdin open and preserves agent forwarding and split UTF-8 output
 * 协作入口 / Collaborators: `fixture`, `f.machine.exec`, `f.ready`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(f.calls[0].options, { agentForward: true })`; `assert.equal(f.channel.inputs.length, 0)`.
 */
test('ordinary exec keeps stdin open and preserves agent forwarding and split UTF-8 output', async () => {
  const f = fixture(), seen: string[] = [];
  const operation = f.machine.exec('owned', 'ordinary command', 30000, undefined, text => seen.push(text), 'owned-agent');
  await f.ready();
  assert.deepEqual(f.calls[0].options, { agentForward: true });
  assert.equal(f.channel.inputs.length, 0);
  const bytes = Buffer.from('中文');
  f.channel.emit('data', bytes.subarray(0, 2)); f.channel.emit('data', bytes.subarray(2));
  f.channel.stderr.emit('data', Buffer.from('err')); f.channel.emit('close', 0);
  assert.deepEqual(await operation, { stdout: '中文', stderr: 'err', code: 0 });
  assert.equal(seen.join(''), '中文err');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: invalid or oversized input is rejected before connecting; the exact limit is accepted
 * 协作入口 / Collaborators: `fixture`, `Buffer.alloc`, `assert.rejects`, `invalid.machine.execInput`.
 * 检查边界 / Checked boundaries: `assert.rejects(invalid.machine.execInput('owned', '/fixed/helper', input as Buffer), error => error instanceof AppError && error.s…`; `assert.equal(invalid.counts().connects, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('invalid or oversized input is rejected before connecting; the exact limit is accepted', async () => {
  const invalid = fixture();
  for (const input of [Buffer.alloc(128 * 1024 + 1), 'not a Buffer'])
    await assert.rejects(invalid.machine.execInput('owned', '/fixed/helper', input as Buffer),
      error => error instanceof AppError && error.status === 413 && error.code === 'GUEST_INPUT_INVALID');
  assert.equal(invalid.counts().connects, 0);
  const full = fixture(), operation = full.machine.execInput('owned', '/fixed/helper', Buffer.alloc(128 * 1024, 0x61));
  await full.ready(); full.channel.emit('close', 0); await operation;
  assert.equal(full.channel.inputs[0].length, 128 * 1024);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancellation before channel creation sends no payload and closes a late channel
 * 协作入口 / Collaborators: `fixture`, `f.machine.execInput`, `Buffer.from`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(operation, error => error instanceof AppError && error.status === 409)`; `assert.equal(f.channel.inputs.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cancellation before channel creation sends no payload and closes a late channel', async () => {
  const f = fixture(), controller = new AbortController();
  const operation = f.machine.execInput('owned', '/fixed/helper', Buffer.from('private'), 30000, controller.signal);
  const rejected = assert.rejects(operation, error => error instanceof AppError && error.status === 409);
  await Promise.resolve(); await Promise.resolve(); controller.abort(); await rejected;
  await f.ready();
  assert.equal(f.channel.inputs.length, 0); assert.equal(f.channel.closes, 1);
  assert.equal(f.counts().destroys, 1); assert.equal(f.counts().ends, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancellation during input destroys the connection and ignores late output
 * 状态影响 / State effects: `f.channel.onInput`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.machine.execInput`, `Buffer.from`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(operation, error => error instanceof AppError && error.status === 409)`; `assert.equal(f.counts().destroys, 1)`.
 */
test('cancellation during input destroys the connection and ignores late output', async () => {
  const f = fixture(), controller = new AbortController();
  f.channel.onInput = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`controller.abort()`）。
   * Result: Return the branch-computed value (`controller.abort()`).
   * 验证场景 / Scenario: cancellation during input destroys the connection and ignores late output
   * 协作入口 / Collaborators: `controller.abort`.
   */
  () => controller.abort();
  const operation = f.machine.execInput('owned', '/fixed/helper', Buffer.from('private'), 30000, controller.signal);
  const rejected = assert.rejects(operation, error => error instanceof AppError && error.status === 409);
  await f.ready(); await rejected;
  f.channel.emit('data', Buffer.from('late')); f.channel.emit('close', 0);
  assert.equal(f.counts().destroys, 1); assert.equal(f.client.listenerCount('close'), 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: input transport timeout destroys the connection
 * 协作入口 / Collaborators: `fixture`, `f.machine.execInput`, `Buffer.from`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(operation, error => error instanceof AppError && error.status === 408)`; `assert.equal(f.counts().destroys, 1)`.
 */
test('input transport timeout destroys the connection', async () => {
  const f = fixture(), operation = f.machine.execInput('owned', '/fixed/helper', Buffer.from('private'), 25);
  const rejected = assert.rejects(operation, error => error instanceof AppError && error.status === 408);
  await f.ready(); await rejected;
  assert.equal(f.counts().destroys, 1); assert.equal(f.counts().ends, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: broken pipe and synchronous input failure remain errors and close the connection
 * 状态影响 / State effects: `f.channel.onInput`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.machine.execInput`, `Buffer.from`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(operation, /input pipe closed/)`; `assert.equal(f.counts().ends, 1)`.
 */
test('broken pipe and synchronous input failure remain errors and close the connection', async () => {
  for (const synchronous of [false, true]) {
    const f = fixture();
    f.channel.onInput = /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: broken pipe and synchronous input failure remain errors and close the connection
     * 失败 / Failure: `new Error('input pipe closed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `f.channel.emit`, `Object.assign`.
     */
    () => {
      if (synchronous) throw new Error('input pipe closed');
      f.channel.emit('error', Object.assign(new Error('input pipe closed'), { code: 'EPIPE' }));
    };
    const operation = f.machine.execInput('owned', '/fixed/helper', Buffer.from('private'));
    const rejected = assert.rejects(operation, /input pipe closed/);
    await f.ready(); await rejected;
    assert.equal(f.counts().ends, 1);
    assert.equal(f.channel.closes, synchronous ? 1 : 0);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: early command failure and channel-open failure preserve the actual failure
 * 协作入口 / Collaborators: `fixture`, `early.machine.execInput`, `Buffer.from`, `early.ready`.
 * 检查边界 / Checked boundaries: `assert.equal((await operation).code, 126)`; `assert.rejects(opening, /open refused/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('early command failure and channel-open failure preserve the actual failure', async () => {
  const early = fixture(), operation = early.machine.execInput('owned', '/fixed/helper', Buffer.from('private'));
  await early.ready(); early.channel.emit('close', 126);
  assert.equal((await operation).code, 126);
  const failed = fixture(), opening = failed.machine.execInput('owned', '/fixed/helper', Buffer.from('private'));
  const rejected = assert.rejects(opening, /open refused/);
  await failed.rejectOpen(new Error('open refused')); await rejected;
  assert.equal(failed.channel.inputs.length, 0); assert.equal(failed.counts().ends, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: output budget remains enforced for commands carrying input
 * 协作入口 / Collaborators: `fixture`, `f.machine.execInput`, `Buffer.from`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(operation, /输出超过 1 MiB/)`; `assert.equal(f.channel.closes, 1)`.
 */
test('output budget remains enforced for commands carrying input', async () => {
  const f = fixture(), operation = f.machine.execInput('owned', '/fixed/helper', Buffer.from('private'));
  const rejected = assert.rejects(operation, /输出超过 1 MiB/);
  await f.ready(); f.channel.emit('data', Buffer.alloc(1024 * 1024 + 1)); await rejected;
  assert.equal(f.channel.closes, 1); assert.equal(f.counts().ends, 1);
});
