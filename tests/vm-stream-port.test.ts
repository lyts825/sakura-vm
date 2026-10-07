/**
 * 模块职责：回归验证模块，围绕 `vm-stream-port` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `vm-stream-port`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: managed streams support Node pipelines, callback identity and independently owned listener removal; SFTP streams and SSH channel stderr retain public streaming interfaces.
 */
import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import test from 'node:test';
import { vmStreamPort } from '../server/vm-stream-port.ts';
import { vmTransportPort } from '../server/vm-transport-port.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: managed streams support Node pipelines, callback identity and independently owned listener removal
 * 协作入口 / Collaborators: `Object.assign`, `vmStreamPort`, `assert.throws`, `native.on`.
 * 检查边界 / Checked boundaries: `assert.throws(() => Reflect.get(port, key), { code: 'PLUGIN_SERVICE_PRIVATE' })`; `assert.equal(hostFired, 1)`.
 */
test('managed streams support Node pipelines, callback identity and independently owned listener removal', async () => {
  const native = Object.assign(new PassThrough(), { sftp: {}, _client: {} });
  const port = vmStreamPort(native, (work) => work());
  for (const key of ['sftp', '_client', 'constructor'])
    assert.throws(() => Reflect.get(port, key), { code: 'PLUGIN_SERVICE_PRIVATE' });
  const chunks: Buffer[] = [];
  let fired = 0,
    hostFired = 0;
  native.on('original', () => {
    hostFired++;
  });
  port.on('original', () => {
    fired++;
  });
  port.removeAllListeners('original');
  native.emit('original');
  assert.equal(hostFired, 1);
  assert.equal(fired, 0);
  port.once('data', function (this: unknown) {
    assert.equal(this, port);
    fired++;
  });
  await pipeline(
    Readable.from(['a', 'b']),
    port,
    new Writable({
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: chunk; _encoding; done。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: managed streams support Node pipelines, callback identity and independently owned listener removal
       * 协作入口 / Collaborators: `chunks.push`, `Buffer.from`, `done`.
       */
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        done();
      },
    }),
  );
  assert.equal(Buffer.concat(chunks).toString(), 'ab');
  assert.equal(fired, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SFTP streams and SSH channel stderr retain public streaming interfaces
 * 协作入口 / Collaborators: `Object.assign`, `Readable.from`, `vmTransportPort`, `ftp.createReadStream`.
 * 检查边界 / Checked boundaries: `assert.throws(() => Reflect.get(stream, 'sftp'), { code: 'PLUGIN_SERVICE_PRIVATE' })`; `assert.equal(Buffer.concat(chunks).toString(), 'contents')`.
 */
test('SFTP streams and SSH channel stderr retain public streaming interfaces', async () => {
  const read = Object.assign(Readable.from(['contents']), { sftp: {} });
  const ftp = vmTransportPort({ /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`read`）。
   * Result: Return the branch-computed value (`read`).
   * 验证场景 / Scenario: SFTP streams and SSH channel stderr retain public streaming interfaces
   */
  createReadStream: () => read }, 'sftp', (work) => work());
  const stream = ftp.createReadStream();
  assert.throws(() => Reflect.get(stream, 'sftp'), { code: 'PLUGIN_SERVICE_PRIVATE' });
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  assert.equal(Buffer.concat(chunks).toString(), 'contents');
  const channel = Object.assign(new PassThrough(), { _client: {}, stderr: new PassThrough() });
  const client = vmTransportPort(
    {
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: callback: (error: null, value: typeof channel) => void。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: SFTP streams and SSH channel stderr retain public streaming interfaces
       * 协作入口 / Collaborators: `callback`.
       */
      exec(callback: /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: error: null; value: typeof channel。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      (error: null, value: typeof channel) => void) {
        callback(null, channel);
      },
    },
    'client',
    (work) => work(),
  );
  client.exec((_error, exposed) => {
    assert.throws(() => Reflect.get(exposed, '_client'), { code: 'PLUGIN_SERVICE_PRIVATE' });
    assert.throws(() => Reflect.get(exposed.stderr, '_channel'), { code: 'PLUGIN_SERVICE_PRIVATE' });
    exposed.destroy();
    exposed.stderr.destroy();
  });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pipeline cancellation and input failure finish the original managed stream
 * 协作入口 / Collaborators: `vmStreamPort`, `pipeline`, `assert.rejects`, `controller.abort`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, abort ? { name: 'AbortError' } : /interrupted input/)`; `assert.equal(native.destroyed, true)`.
 */
test('pipeline cancellation and input failure finish the original managed stream', async () => {
  for (const abort of [false, true]) {
    const native = new PassThrough();
    const port = vmStreamPort(native, (work) => work());
    const source = new Readable({
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: pipeline cancellation and input failure finish the original managed stream
       * 协作入口 / Collaborators: `this.push`, `this.destroy`.
       */
      read() {
        this.push('partial');
        if (!abort) this.destroy(new Error('interrupted input'));
      },
    });
    const controller = new AbortController();
    const pending = pipeline(
      source,
      port,
      new Writable({
        /**
         * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
         * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
         * 输入 / Inputs: _chunk; _encoding; done。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 验证场景 / Scenario: pipeline cancellation and input failure finish the original managed stream
         * 协作入口 / Collaborators: `done`.
         */
        write(_chunk, _encoding, done) {
          done();
        },
      }),
      { signal: controller.signal },
    );
    const failure = assert.rejects(pending, abort ? { name: 'AbortError' } : /interrupted input/);
    if (abort) controller.abort();
    await failure;
    assert.equal(native.destroyed, true);
  }
});
