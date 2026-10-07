/**
 * 模块职责：回归验证模块，围绕 `http` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `http`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: a full-size UTF-8 text file remains saveable when JSON escapes enlarge its request; oversized JSON returns an HTTP error instead of resetting the client connection.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { MAX_TEXT_REQUEST_BYTES, readJsonBody, requestUrl } from '../server/http.ts';

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: t: TestContext。
 * 结果：返回分支计算值（``http://127.0.0.1:${(http.address() as { port: number }).port}``），以 Promise 交付。
 * Result: Return the branch-computed value (``http://127.0.0.1:${(http.address() as { port: number }).port}``) through a Promise.
 * 协作入口 / Collaborators: `createServer`, `http.listen`, `once`, `t.after`.
 */
async function server(t: TestContext) {
  const http = createServer(async (req, res) => {
    try {
      const value = await readJsonBody(req, req.url === '/text' ? MAX_TEXT_REQUEST_BYTES : 1024);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(value));
    } catch (error) {
      res.writeHead((error as { status: number }).status || 500);
      res.end((error as Error).message);
    }
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  t.after(async () => {
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  return `http://127.0.0.1:${(http.address() as { port: number }).port}`;
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a full-size UTF-8 text file remains saveable when JSON escapes enlarge its request
 * 协作入口 / Collaborators: `server`, `'\t'.repeat`, `fetch`, `JSON.stringify`.
 * 检查边界 / Checked boundaries: `assert.equal(response.status, 200)`; `assert.equal((await response.json()).content, content)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a full-size UTF-8 text file remains saveable when JSON escapes enlarge its request', async (t) => {
  const base = await server(t);
  const content = '\t'.repeat(1024 ** 2);
  const response = await fetch(base + '/text', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/workspace/text.txt', content }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).content, content);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: oversized JSON returns an HTTP error instead of resetting the client connection
 * 协作入口 / Collaborators: `server`, `fetch`, `JSON.stringify`, `'x'.repeat`.
 * 检查边界 / Checked boundaries: `assert.equal(response.status, 413)`; `assert.match(await response.text(), /请求内容过大/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('oversized JSON returns an HTTP error instead of resetting the client connection', async (t) => {
  const base = await server(t);
  const response = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'x'.repeat(1500001) }),
  });
  assert.equal(response.status, 413);
  assert.match(await response.text(), /请求内容过大/);
  const next = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"ok":true}',
  });
  assert.deepEqual(await next.json(), { ok: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a still-streaming oversized request receives 413 without an abrupt socket reset
 * 协作入口 / Collaborators: `server`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(status, 413)`.
 */
test('a still-streaming oversized request receives 413 without an abrupt socket reset', async (t) => {
  const base = await server(t);
  const status = await new Promise<number>(/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: resolve; reject。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: a still-streaming oversized request receives 413 without an abrupt socket reset
   * 协作入口 / Collaborators: `request`, `t.after`, `req.on`, `req.setTimeout`.
   */
  (resolve, reject) => {
    const req = request(base, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode!));
    });
    t.after(() => req.destroy());
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('HTTP response timed out'));
    });
    // Do not end the upload: the server must reject before the client sends the rest.
    req.write('x'.repeat(1500001));
  });
  assert.equal(status, 413);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: JSON limits are enforced for each route and malformed bodies retain useful errors
 * 协作入口 / Collaborators: `server`, `'x'.repeat`, `fetch`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(response.status, status)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('JSON limits are enforced for each route and malformed bodies retain useful errors', async (t) => {
  const base = await server(t);
  for (const [body, contentType, status] of [
    ['x'.repeat(1025), 'application/json', 413],
    ['{', 'application/json', 400],
    ['{}', 'text/plain', 415],
  ] as const) {
    const response = await fetch(base, { method: 'POST', headers: { 'Content-Type': contentType }, body });
    assert.equal(response.status, status);
    await response.text();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: malformed upgrade URLs are rejected without throwing from the server event listener
 * 协作入口 / Collaborators: `assert.equal`, `requestUrl`.
 * 检查边界 / Checked boundaries: `assert.equal(requestUrl(value, 7337), null)`; `assert.equal(requestUrl('/ws/events?token=test', 7337)?.pathname, '/ws/events')`.
 */
test('malformed upgrade URLs are rejected without throwing from the server event listener', () => {
  for (const value of ['http://[', 'http://127.0.0.1:invalid/ws/events', '//['])
    assert.equal(requestUrl(value, 7337), null);
  assert.equal(requestUrl('/ws/events?token=test', 7337)?.pathname, '/ws/events');
  assert.equal(requestUrl(undefined, 7337)?.pathname, '/');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: shutdown cancels a JSON request that has not finished sending its body
 * 协作入口 / Collaborators: `Object.assign`, `readJsonBody`, `assert.rejects`, `abort.abort`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, { name: 'AbortError' })`; `assert.equal(req.destroyed, true)`.
 */
test('shutdown cancels a JSON request that has not finished sending its body', async () => {
  const req = Object.assign(new Readable({ /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: shutdown cancels a JSON request that has not finished sending its body
   */
  read() {} }), {
    headers: { 'content-type': 'application/json' },
  }) as IncomingMessage;
  const abort = new AbortController();
  const pending = readJsonBody(req, 1500000, abort.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  abort.abort();
  await rejected;
  assert.equal(req.destroyed, true);
});
