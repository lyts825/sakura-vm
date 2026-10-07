/**
 * 模块职责：回归验证模块，围绕 `transfers` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `transfers`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: multi-file uploads report cumulative progress and release event handlers after success; cancelling an active batch aborts the request and never sends subsequent files.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { uploadFiles, type UploadProgress } from '../src/transfers.ts';

class Request {
  static sent: Request[] = [];
  static respond: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: request: Request。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (request: Request) => void;
  status = 200;
  responseText = '';
  url = '';
  headers = new Map<string, string>();
  upload = { onprogress: null as null | (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: event: { loaded: number }。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (event: { loaded: number }) => void) };
  onload: null | (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void) = null;
  onerror: null | (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void) = null;
  onabort: null | (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void) = null;
  aborted = false;
  file?: File;
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: method: string; url: string。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `this.url`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `assert.equal`.
   * 检查边界 / Checked boundaries: `assert.equal(method, 'PUT')`.
   */
  open(method: string, url: string) {
    assert.equal(method, 'PUT');
    this.url = url;
  }
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: name: string; value: string。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `this.headers.set`.
   */
  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: file: File。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `this.file`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `Request.sent.push`, `queueMicrotask`.
   */
  send(file: File) {
    this.file = file;
    Request.sent.push(this);
    queueMicrotask(() => Request.respond(this));
  }
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `this.aborted`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `this.onabort`.
   */
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: TestContext; respond: (request: Request) => void。
 * 结果：返回受控对象，公开字段包括 `abort, progress, options`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `abort, progress, options`; the actual branch determines its shape.
 * 状态影响 / State effects: `Request.sent`, `Request.respond`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Object.getOwnPropertyDescriptor`, `Object.defineProperty`, `t.after`.
 */
function fixture(t: TestContext, respond: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: request: Request。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
(request: Request) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
  Object.defineProperty(globalThis, 'XMLHttpRequest', { configurable: true, writable: true, value: Request });
  Request.sent = [];
  Request.respond = respond;
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'XMLHttpRequest', descriptor);
    else Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
  });
  const abort = new AbortController();
  const progress: UploadProgress[] = [];
  const options = {
    files: [new File(['abc'], 'first.bin'), new File(['12345'], 'second.bin')],
    token: 'test-token',
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: name: string。
     * 结果：返回分支计算值（`'/upload/' + name`）。
     * Result: Return the branch-computed value (`'/upload/' + name`).
     */
    url: (name: string) => '/upload/' + name,
    signal: abort.signal,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: value: UploadProgress。
     * 结果：返回分支计算值（`progress.push(value)`）。
     * Result: Return the branch-computed value (`progress.push(value)`).
     * 协作入口 / Collaborators: `progress.push`.
     */
    progress: (value: UploadProgress) => progress.push(value),
  };
  return { abort, progress, options };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: multi-file uploads report cumulative progress and release event handlers after success
 * 协作入口 / Collaborators: `fixture`, `uploadFiles`, `assert.deepEqual`, `progress.map`.
 * 检查边界 / Checked boundaries: `assert.deepEqual( progress.map((p) => p.loaded), [0, 3, 3, 8], )`; `assert.ok(progress.every((p) => p.total === 8 && p.count === 2))`.
 */
test('multi-file uploads report cumulative progress and release event handlers after success', async (t) => {
  const { options, progress } = fixture(t, (req) => {
    req.upload.onprogress?.({ loaded: req.file!.size });
    req.onload?.();
  });
  await uploadFiles(options);
  assert.deepEqual(
    progress.map((p) => p.loaded),
    [0, 3, 3, 8],
  );
  assert.ok(progress.every((p) => p.total === 8 && p.count === 2));
  assert.deepEqual(
    Request.sent.map((req) => req.url),
    ['/upload/first.bin', '/upload/second.bin'],
  );
  for (const req of Request.sent) {
    assert.equal(req.headers.get('X-Sakura-Token'), 'test-token');
    assert.equal(req.onload, null);
    assert.equal(req.upload.onprogress, null);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancelling an active batch aborts the request and never sends subsequent files
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `uploadFiles`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(uploadFiles(options), { name: 'AbortError' })`; `assert.equal(Request.sent.length, 1)`.
 */
test('cancelling an active batch aborts the request and never sends subsequent files', async (t) => {
  const { abort, options } = fixture(t, () => abort.abort());
  await assert.rejects(uploadFiles(options), { name: 'AbortError' });
  assert.equal(Request.sent.length, 1);
  assert.equal(Request.sent[0].aborted, true);
  assert.equal(Request.sent[0].onabort, null);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed upload preserves server feedback, stops the batch and permits a fresh retry
 * 状态影响 / State effects: `Request.respond`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `uploadFiles`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(uploadFiles(options), /first.bin.*目标已存在/)`; `assert.equal(Request.sent.length, 1)`.
 */
test('failed upload preserves server feedback, stops the batch and permits a fresh retry', async (t) => {
  const { options } = fixture(t, (req) => {
    req.status = 409;
    req.responseText = JSON.stringify({ error: '目标已存在' });
    req.onload?.();
  });
  await assert.rejects(uploadFiles(options), /first.bin.*目标已存在/);
  assert.equal(Request.sent.length, 1);
  Request.respond = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: req。
   * 结果：返回分支计算值（`req.onload?.()`）。
   * Result: Return the branch-computed value (`req.onload?.()`).
   * 验证场景 / Scenario: failed upload preserves server feedback, stops the batch and permits a fresh retry
   * 协作入口 / Collaborators: `req.onload`.
   */
  (req) => req.onload?.();
  await uploadFiles(options);
  assert.equal(Request.sent.length, 3);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: oversized later files and already-cancelled batches are rejected before any upload
 * 协作入口 / Collaborators: `fixture`, `Object.defineProperty`, `assert.rejects`, `uploadFiles`.
 * 检查边界 / Checked boundaries: `assert.rejects(uploadFiles({ ...options, files: [...options.files, large] }), /large.bin.*2 GiB/)`; `assert.rejects(uploadFiles(options), { name: 'AbortError' })`.
 */
test('oversized later files and already-cancelled batches are rejected before any upload', async (t) => {
  const { options, abort } = fixture(t, (req) => req.onload?.());
  const large = new File([], 'large.bin');
  Object.defineProperty(large, 'size', { value: 2 * 1024 ** 3 + 1 });
  await assert.rejects(uploadFiles({ ...options, files: [...options.files, large] }), /large.bin.*2 GiB/);
  abort.abort();
  await assert.rejects(uploadFiles(options), { name: 'AbortError' });
  assert.equal(Request.sent.length, 0);
});
