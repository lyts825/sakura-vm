/**
 * 模块职责：回归验证模块，围绕 `vm-transport-port` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `vm-transport-port`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: transport listeners receive the public port and the captured continuation context; listener removal maps originals, removes the last duplicate and retains host cleanup handlers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { vmTransportPort } from '../server/vm-transport-port.ts';
import { PassThrough } from 'node:stream';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: transport listeners receive the public port and the captured continuation context
 * 协作入口 / Collaborators: `vmTransportPort`, `listener`, `assert.equal`, `port.on`.
 * 检查边界 / Checked boundaries: `assert.equal(port.on('ready', regular), port)`; `assert.equal(port.listenerCount('ready', regular), 1)`.
 */
test('transport listeners receive the public port and the captured continuation context', () => {
  const context = new AsyncLocalStorage<string>();
  const raw = new EventEmitter();
  const port = vmTransportPort(
    raw,
    'client',
    (work) => context.run('original', work),
    (work) => context.run('original', work),
  );
  const calls: string[] = [];
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: name: string。
   * 结果：返回分支计算值（`function (this: EventEmitter, value: string) { assert.equal(this, port); assert.…`）。
   * Result: Return the branch-computed value (`function (this: EventEmitter, value: string) { assert.equal(this, port); assert.…`).
   * 验证场景 / Scenario: transport listeners receive the public port and the captured continuation context
   */
  const listener = (name: string) =>
    function (this: EventEmitter, value: string) {
      assert.equal(this, port);
      assert.equal(context.getStore(), 'original');
      calls.push(name + ':' + value);
    };
  const regular = listener('regular');
  assert.equal(port.on('ready', regular), port);
  port.once('ready', listener('once'));
  port.prependListener('ready', listener('prepend'));
  port.prependOnceListener('ready', listener('prependOnce'));
  assert.equal(port.listenerCount('ready', regular), 1);
  context.run('emitter', () => raw.emit('ready', 'first'));
  context.run('emitter', () => raw.emit('ready', 'second'));
  assert.deepEqual(calls, [
    'prependOnce:first',
    'prepend:first',
    'regular:first',
    'once:first',
    'prepend:second',
    'regular:second',
  ]);
  assert.equal(port.listenerCount('ready'), 2);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: listener removal maps originals, removes the last duplicate and retains host cleanup handlers
 * 协作入口 / Collaborators: `vmTransportPort`, `raw.on`, `port.on`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(port.off('ready', duplicate), port)`; `assert.deepEqual(calls, ['duplicate', 'middle'])`.
 */
test('listener removal maps originals, removes the last duplicate and retains host cleanup handlers', () => {
  const raw = new EventEmitter();
  const port = vmTransportPort(raw, 'client', (work) => work());
  const calls: string[] = [];
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`calls.push('duplicate')`）。
   * Result: Return the branch-computed value (`calls.push('duplicate')`).
   * 验证场景 / Scenario: listener removal maps originals, removes the last duplicate and retains host cleanup handlers
   * 协作入口 / Collaborators: `calls.push`.
   */
  const duplicate = () => calls.push('duplicate');
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`calls.push('middle')`）。
   * Result: Return the branch-computed value (`calls.push('middle')`).
   * 验证场景 / Scenario: listener removal maps originals, removes the last duplicate and retains host cleanup handlers
   * 协作入口 / Collaborators: `calls.push`.
   */
  const middle = () => calls.push('middle');
  let hostCloses = 0;
  raw.on('close', () => {
    hostCloses++;
  });
  port.on('ready', duplicate);
  port.on('ready', middle);
  port.on('ready', duplicate);
  assert.equal(port.off('ready', duplicate), port);
  raw.emit('ready');
  assert.deepEqual(calls, ['duplicate', 'middle']);
  assert.equal(port.listenerCount('ready', duplicate), 1);
  assert.equal(port.removeListener('ready', duplicate), port);
  assert.equal(port.listenerCount('ready', duplicate), 0);
  port.once('ready', duplicate);
  port.off('ready', duplicate);
  port.prependOnceListener('close', duplicate);
  port.removeAllListeners('ready');
  assert.equal(port.listenerCount('ready'), 0);
  assert.equal(port.removeAllListeners(), port);
  raw.emit('close');
  assert.equal(hostCloses, 1);
  assert.deepEqual(calls, ['duplicate', 'middle']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: command and SFTP callbacks retain their public this and original context
 * 协作入口 / Collaborators: `Object.assign`, `vmTransportPort`, `port.exec`, `context.run`.
 * 检查边界 / Checked boundaries: `assert.equal(result, 'complete')`; `assert.notEqual(filePort, ftp)`.
 */
test('command and SFTP callbacks retain their public this and original context', () => {
  const context = new AsyncLocalStorage<string>();
  let execCallback: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: error: Error | undefined; value: string。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (error: Error | undefined, value: string) => void) | undefined;
  let sftpCallback: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: error: Error | undefined; value: object。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (error: Error | undefined, value?: object) => void) | undefined;
  let readCallback: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: error: Error | undefined; value: string。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (error: Error | undefined, value: string) => void) | undefined;
  const ftp = Object.assign(new EventEmitter(), {
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _path: string; callback: typeof readCallback。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: command and SFTP callbacks retain their public this and original context
     * 状态影响 / State effects: `readCallback`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    readFile(_path: string, callback: typeof readCallback) {
      readCallback = callback;
    },
  });
  const raw = Object.assign(new EventEmitter(), {
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _command: string; callback: typeof execCallback。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: command and SFTP callbacks retain their public this and original context
     * 状态影响 / State effects: `execCallback`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    exec(_command: string, callback: typeof execCallback) {
      execCallback = callback;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: callback: typeof sftpCallback。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: command and SFTP callbacks retain their public this and original context
     * 状态影响 / State effects: `sftpCallback`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    sftp(callback: typeof sftpCallback) {
      sftpCallback = callback;
    },
  });
  const port = vmTransportPort(
    raw,
    'client',
    (work) => context.run('original', work),
    (work) => context.run('original', work),
  );
  let result = '';
  port.exec('memory-task', function (this: typeof raw, error, value) {
    assert.equal(this, port);
    assert.equal(context.getStore(), 'original');
    assert.equal(error, undefined);
    result = value;
  });
  context.run('emitter', () => execCallback!.call(raw, undefined, 'complete'));
  assert.equal(result, 'complete');
  let filePort: typeof ftp | undefined;
  port.sftp(function (this: typeof raw, error, value) {
    assert.equal(this, port);
    assert.equal(context.getStore(), 'original');
    assert.equal(error, undefined);
    filePort = value as typeof ftp;
  });
  context.run('emitter', () => sftpCallback!.call(raw, undefined, ftp));
  assert.notEqual(filePort, ftp);
  filePort!.readFile('/memory', function (this: typeof ftp, error, value) {
    assert.equal(this, filePort);
    assert.equal(context.getStore(), 'original');
    assert.equal(error, undefined);
    result = value;
  });
  context.run('emitter', () => readCallback!.call(ftp, undefined, 'contents'));
  assert.equal(result, 'contents');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: admitted callback completion and close notifications survive cancellation while new commands stop
 * 状态影响 / State effects: `active`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Object.assign`, `vmTransportPort`, `port.on`, `port.once`.
 * 检查边界 / Checked boundaries: `assert.throws(() => exec('memory-task', () => {}), /admission is inactive/)`; `assert.equal(port.destroy(), port)`.
 */
test('admitted callback completion and close notifications survive cancellation while new commands stop', () => {
  let active = true;
  let pending: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: error: Error。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (error?: Error) => void) | undefined;
  let ends = 0,
    destroys = 0,
    errors = 0,
    closes = 0;
  const raw = Object.assign(new EventEmitter(), {
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _command: string; callback: typeof pending。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: admitted callback completion and close notifications survive cancellation while new commands stop
     * 状态影响 / State effects: `pending`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    exec(_command: string, callback: typeof pending) {
      pending = callback;
    },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`raw`）。
     * Result: Return the branch-computed value (`raw`).
     * 验证场景 / Scenario: admitted callback completion and close notifications survive cancellation while new commands stop
     */
    end() {
      ends++;
      return raw;
    },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`raw`）。
     * Result: Return the branch-computed value (`raw`).
     * 验证场景 / Scenario: admitted callback completion and close notifications survive cancellation while new commands stop
     */
    destroy() {
      destroys++;
      return raw;
    },
  });
  const port = vmTransportPort(raw, 'client', (work) => {
    assert.ok(active, 'transport admission is inactive');
    return work();
  });
  const expected = new Error('cancelled');
  port.on('error', function (this: typeof raw, error) {
    assert.equal(this, port);
    assert.equal(error, expected);
    errors++;
    this.end();
  });
  port.once('close', function (this: typeof raw) {
    assert.equal(this, port);
    closes++;
  });
  let completed = false;
  const exec = port.exec;
  exec('memory-task', function (this: typeof raw, error) {
    assert.equal(this, port);
    assert.equal(error, expected);
    completed = true;
  });
  active = false;
  assert.throws(() => exec('memory-task', () => {}), /admission is inactive/);
  pending!.call(raw, expected);
  raw.emit('error', expected);
  assert.equal(port.destroy(), port);
  raw.emit('close');
  raw.emit('close');
  assert.deepEqual(
    { completed, errors, closes, ends, destroys },
    { completed: true, errors: 1, closes: 1, ends: 1, destroys: 1 },
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: exclusive temporary-file removal consumes its receipt on success and preserves it on failure
 * 状态影响 / State effects: `active`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Object.assign`, `vmTransportPort`, `port.createWriteStream`, `stream.emit`.
 * 检查边界 / Checked boundaries: `assert.equal(observed, fail)`; `assert.equal(observed, undefined)`.
 */
test('exclusive temporary-file removal consumes its receipt on success and preserves it on failure', () => {
  let active = true;
  const stream = new EventEmitter();
  let pending: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: error: Error。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (error?: Error) => void) | undefined;
  const raw = Object.assign(new EventEmitter(), {
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: _path: string; _options: { flags: string }。
     * 结果：返回分支计算值（`stream`）。
     * Result: Return the branch-computed value (`stream`).
     * 验证场景 / Scenario: exclusive temporary-file removal consumes its receipt on success and preserves it on failure
     */
    createWriteStream(_path: string, _options: { flags: string }) {
      return stream;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _path: string; callback: typeof pending。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: exclusive temporary-file removal consumes its receipt on success and preserves it on failure
     * 状态影响 / State effects: `pending`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    unlink(_path: string, callback: typeof pending) {
      pending = callback;
    },
  });
  const port = vmTransportPort(raw, 'sftp', (work) => {
    assert.ok(active, 'inactive');
    return work();
  });
  port.createWriteStream('/temporary', { flags: 'wx' });
  stream.emit('open');
  active = false;
  const fail = new Error('retry');
  let observed: Error | undefined;
  port.unlink('/temporary', (error) => {
    observed = error;
  });
  pending!.call(raw, fail);
  assert.equal(observed, fail);
  port.unlink('/temporary', (error) => {
    observed = error;
  });
  pending!.call(raw, undefined);
  assert.equal(observed, undefined);
  assert.throws(() => port.unlink('/temporary', () => {}), /inactive/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: successful temporary-file rename consumes the original removal receipt
 * 状态影响 / State effects: `active`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Object.assign`, `vmTransportPort`, `port.createWriteStream`, `stream.emit`.
 * 检查边界 / Checked boundaries: `assert.throws(() => port.unlink('/temporary', () => {}), /inactive/)`.
 */
test('successful temporary-file rename consumes the original removal receipt', () => {
  let active = true;
  const stream = new EventEmitter();
  let pending: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: error: Error。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (error?: Error) => void) | undefined;
  const raw = Object.assign(new EventEmitter(), {
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: _path: string; _options: { flags: string }。
     * 结果：返回分支计算值（`stream`）。
     * Result: Return the branch-computed value (`stream`).
     * 验证场景 / Scenario: successful temporary-file rename consumes the original removal receipt
     */
    createWriteStream(_path: string, _options: { flags: string }) {
      return stream;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _path: string; callback: typeof pending。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: successful temporary-file rename consumes the original removal receipt
     * 状态影响 / State effects: `pending`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    unlink(_path: string, callback: typeof pending) {
      pending = callback;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _path: string; _next: string; callback: typeof pending。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: successful temporary-file rename consumes the original removal receipt
     * 状态影响 / State effects: `pending`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    rename(_path: string, _next: string, callback: typeof pending) {
      pending = callback;
    },
  });
  const port = vmTransportPort(raw, 'sftp', (work) => {
    assert.ok(active, 'inactive');
    return work();
  });
  port.createWriteStream('/temporary', { flags: 'wx' });
  stream.emit('open');
  port.rename('/temporary', '/published', () => {});
  pending!.call(raw, undefined);
  active = false;
  assert.throws(() => port.unlink('/temporary', () => {}), /inactive/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: connection event handles return managed channels and retain admission for new acceptance
 * 状态影响 / State effects: `active`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Object.assign`, `vmTransportPort`, `port.on`, `native.emit`.
 * 检查边界 / Checked boundaries: `assert.throws(() => Reflect.get(stream, '_client'), { code: 'PLUGIN_SERVICE_PRIVATE' })`; `assert.throws(() => accept(), /original admission/)`.
 */
test('connection event handles return managed channels and retain admission for new acceptance', () => {
  const native = new EventEmitter();
  let active = true,
    accepted = 0;
  const channel = Object.assign(new PassThrough(), { _client: native });
  const port = vmTransportPort(native, 'client', (work) => {
    assert.equal(active, true, 'new acceptance requires the original admission');
    return work();
  });
  let accept!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => typeof channel;
  port.on('connection', (_info, callback: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => typeof channel) => {
    accept = callback;
  });
  native.emit('connection', {}, () => {
    accepted++;
    return channel;
  });
  const stream = accept();
  assert.throws(() => Reflect.get(stream, '_client'), { code: 'PLUGIN_SERVICE_PRIVATE' });
  active = false;
  assert.throws(() => accept(), /original admission/);
  assert.equal(accepted, 1);
  stream.destroy();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pending SSH connection rejection retains its original one-use cleanup receipt after revocation
 * 状态影响 / State effects: `active`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `vmTransportPort`, `port.on`, `native.emit`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.throws(() => accept(), /original admission/)`; `assert.deepEqual({ accepted, rejected }, { accepted: 0, rejected: 1 })`.
 */
test('pending SSH connection rejection retains its original one-use cleanup receipt after revocation', () => {
  for (const event of ['tcp connection', 'unix connection']) {
    const native = new EventEmitter();
    let active = true,
      accepted = 0,
      rejected = 0,
      callbackContext = false;
    const port = vmTransportPort(
      native,
      'client',
      (work) => {
        assert.ok(active, 'new acceptance requires the original admission');
        return work();
      },
      (work) => {
        callbackContext = true;
        try {
          return work();
        } finally {
          callbackContext = false;
        }
      },
    );
    let accept!: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => PassThrough, reject!: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void;
    port.on(event, (_info, next: typeof accept, decline: typeof reject) => {
      accept = next;
      reject = decline;
    });
    native.emit(
      event,
      {},
      () => {
        accepted++;
        return new PassThrough();
      },
      () => {
        assert.equal(callbackContext, true);
        rejected++;
      },
    );
    active = false;
    assert.throws(() => accept(), /original admission/);
    reject();
    reject();
    assert.deepEqual({ accepted, rejected }, { accepted: 0, rejected: 1 });
    active = true;
    assert.throws(() => accept(), { code: 'PLUGIN_TRANSPORT_SETTLED' });
  }
});
