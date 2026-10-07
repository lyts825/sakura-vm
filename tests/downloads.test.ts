/**
 * 模块职责：回归验证模块，围绕 `downloads` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `downloads`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: download tickets are single-use, expire, bind one target and bound abandoned requests; native download streams original binary bytes, ignores path substitution and rejects replay.
 */
import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Downloads as DownloadsType } from '../server/downloads.ts';
import type { Machines } from '../server/machines.ts';
import type { Files } from '../server/files.ts';
import type { Bundles } from '../server/bundles.ts';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = await mkdtemp(join(tmpdir(), 'sakura-downloads-'));
process.env.SAKURA_DATA_DIR = root;
const { DownloadTickets, Downloads } = await import('../server/downloads.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-downloads-'));
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: download tickets are single-use, expire, bind one target and bound abandoned requests
 * 状态影响 / State effects: `target.path`, `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `tickets.issue`, `assert.match`, `first.url.split('/').at`, `first.url.split`.
 * 检查边界 / Checked boundaries: `assert.match(first.url, /^\/api\/downloads\/[a-f0-9]{64}$/)`; `assert.deepEqual(tickets.take(key), { id: 'vm', type: 'file', path: '/workspace/秘密.bin', name: '秘密.bin', })`.
 */
test('download tickets are single-use, expire, bind one target and bound abandoned requests', () => {
  let now = 1000;
  const tickets = new DownloadTickets(() => now);
  const target = { id: 'vm', type: 'file' as const, path: '/workspace/秘密.bin', name: '秘密.bin' };
  const first = tickets.issue(target);
  assert.match(first.url, /^\/api\/downloads\/[a-f0-9]{64}$/);
  target.path = '/etc/other';
  const key = first.url.split('/').at(-1)!;
  assert.deepEqual(tickets.take(key), {
    id: 'vm',
    type: 'file',
    path: '/workspace/秘密.bin',
    name: '秘密.bin',
  });
  assert.throws(() => tickets.take(key), /失效/);
  const expired = tickets.issue(target);
  now = expired.expiresAt;
  assert.throws(() => tickets.take(expired.url.split('/').at(-1)!), /失效/);
  for (let i = 0; i < 64; i++) tickets.issue(target);
  assert.throws(() => tickets.issue(target), /过多/);
  now += 60000;
  const fresh = tickets.issue(target);
  tickets.clear();
  assert.throws(() => tickets.take(fresh.url.split('/').at(-1)!), /失效/);
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `bytes, machines, files, downloads`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `bytes, machines, files, downloads`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `Buffer.from`.
 */
function fixture() {
  const bytes = Buffer.from([0, 255, 10, ...Buffer.from('中文')]);
  const machines = { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ name: 'test' })`）。
   * Result: Return the branch-computed value (`({ name: 'test' })`).
   */
  get: () => ({ name: 'test' }), /**
   * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
   * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   */
  requireStopped: () => {} } as unknown as Machines;
  const files = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ size: bytes.length })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ size: bytes.length })`) through a Promise.
     */
    info: async () => ({ size: bytes.length }),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; path: string; res: ServerResponse; headers: (size: number) => void。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `assert.equal`, `headers`, `res.end`.
     * 检查边界 / Checked boundaries: `assert.equal(path, '/workspace/秘密.bin')`.
     */
    download: async (_id: string, path: string, res: ServerResponse, headers: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: size: number。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (size: number) => void) => {
      assert.equal(path, '/workspace/秘密.bin');
      headers(bytes.length);
      res.end(bytes);
    },
  } as unknown as Files;
  const bundles = {
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('Unexpected export')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    export: async () => {
      throw new Error('Unexpected export');
    },
  } as unknown as Bundles;
  return { bytes, machines, files, downloads: new Downloads(machines, { files, bundles }) };
}
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: t: TestContext; downloads: DownloadsType。
 * 结果：返回分支计算值（``http://127.0.0.1:${(http.address() as { port: number }).port}``），以 Promise 交付。
 * Result: Return the branch-computed value (``http://127.0.0.1:${(http.address() as { port: number }).port}``) through a Promise.
 * 协作入口 / Collaborators: `createServer`, `http.listen`, `once`, `t.after`.
 */
async function server(t: TestContext, downloads: DownloadsType) {
  const http = createServer(async (req, res) => {
    try {
      if (!(await downloads.route(req, res, new URL(req.url!, 'http://localhost')))) res.writeHead(404).end();
    } catch (error: any) {
      if (!res.headersSent) res.writeHead(error.status || 500);
      res.end(error.message);
    }
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  t.after(async () => {
    await downloads.close();
    http.closeAllConnections();
    await new Promise<void>((done) => http.close(() => done()));
  });
  return `http://127.0.0.1:${(http.address() as { port: number }).port}`;
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: native download streams original binary bytes, ignores path substitution and rejects replay
 * 协作入口 / Collaborators: `fixture`, `server`, `downloads.issue`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal((await fetch(base + url, { method: 'POST' })).status, 405)`; `assert.equal(response.status, 200)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('native download streams original binary bytes, ignores path substitution and rejects replay', async (t) => {
  const { downloads, bytes } = fixture();
  const base = await server(t, downloads);
  const { url } = await downloads.issue('vm', { type: 'file', path: '/workspace/秘密.bin' });
  assert.equal((await fetch(base + url, { method: 'POST' })).status, 405);
  const response = await fetch(base + url + '?path=/etc/other');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-disposition')!, /%E7%A7%98/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal((await fetch(base + url)).status, 410);
  assert.equal((await fetch(base + url + '/extra')).status, 404);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: preflight rejects failed downloads and export while running without issuing a capability
 * 状态影响 / State effects: `files.info`, `machines.requireStopped`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `downloads.issue`, `downloads.close`.
 * 检查边界 / Checked boundaries: `assert.rejects(downloads.issue('vm', { type: 'file', path: '/missing' }), /file unavailable/)`; `assert.rejects(downloads.issue('vm', { type: 'export' }), /running/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('preflight rejects failed downloads and export while running without issuing a capability', async () => {
  const { downloads, files, machines } = fixture();
  files.info = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: preflight rejects failed downloads and export while running without issuing a capability
   * 失败 / Failure: `new Error('file unavailable')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => {
    throw new Error('file unavailable');
  };
  await assert.rejects(downloads.issue('vm', { type: 'file', path: '/missing' }), /file unavailable/);
  machines.requireStopped = /**
   * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
   * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: preflight rejects failed downloads and export while running without issuing a capability
   * 失败 / Failure: `new Error('running')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  () => {
    throw new Error('running');
  };
  await assert.rejects(downloads.issue('vm', { type: 'export' }), /running/);
  await assert.rejects(downloads.issue('vm', { type: 'export', path: '/etc/other' }));
  downloads.close();
  await assert.rejects(downloads.issue('vm', { type: 'export' }), /关闭/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: generated backup downloads only finish after integrity verification and reject an invalid final hash
 * 协作入口 / Collaborators: `fixture`, `server`, `Buffer.alloc`, `downloads.issueStream`.
 * 检查边界 / Checked boundaries: `assert.equal(response.headers.get('content-length'), null)`; `assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('generated backup downloads only finish after integrity verification and reject an invalid final hash', async (t) => {
  const { downloads } = fixture(),
    base = await server(t, downloads);
  for (const valid of [true, false]) {
    const bytes = Buffer.alloc(1024, 7);
    const ticket = downloads.issueStream('vm', {
      name: 'backup.sakura',
      bytes: bytes.length,
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: output; signal。
       * 结果：返回分支计算值（`pipeline( Readable.from( (async function* () { yield bytes; await new Promise((r…`），以 Promise 交付。
       * Result: Return the branch-computed value (`pipeline( Readable.from( (async function* () { yield bytes; await new Promise((r…`) through a Promise.
       * 验证场景 / Scenario: generated backup downloads only finish after integrity verification and reject an invalid final hash
       * 协作入口 / Collaborators: `pipeline`, `Readable.from`, `(async function* () { yield bytes; await new Promise((resolve) => setTimeou…`.
       */
      write: async (output, signal) =>
        pipeline(
          Readable.from(
            (async function* () {
              yield bytes;
              await new Promise((resolve) => setTimeout(resolve, 20));
              if (!valid) throw new Error('whole-file hash mismatch');
            })(),
          ),
          output,
          { signal },
        ),
    });
    const response = await fetch(base + ticket.url);
    assert.equal(response.headers.get('content-length'), null);
    if (valid) assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    else await assert.rejects(response.arrayBuffer());
    assert.equal((await fetch(base + ticket.url)).status, 410);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: disconnect and shutdown cancel active download work
 * 状态影响 / State effects: `files.download`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `Object.assign`, `downloads.send`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(task, { name: 'AbortError' })`; `assert.equal(activeSignal?.aborted, true)`.
 */
test('disconnect and shutdown cancel active download work', async () => {
  for (const trigger of ['disconnect', 'shutdown']) {
    const { downloads, files } = fixture();
    const response = Object.assign(new EventEmitter(), {
      writableFinished: false,
      destroyed: false,
    }) as unknown as ServerResponse;
    let activeSignal: AbortSignal | undefined;
    files.download = /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _id; _path; _res; _headers; signal。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: disconnect and shutdown cancel active download work
     * 状态影响 / State effects: `activeSignal`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    async (_id, _path, _res, _headers, signal) => {
      activeSignal = signal;
      await new Promise<void>((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }),
      );
    };
    const task = downloads.send(
      { id: 'vm', type: 'file', path: '/workspace/秘密.bin', name: '秘密.bin' },
      response,
    );
    const cancelled = assert.rejects(task, { name: 'AbortError' });
    if (trigger === 'disconnect') response.emit('close');
    else downloads.close();
    await cancelled;
    assert.equal(activeSignal?.aborted, true);
    assert.equal(response.listenerCount('close'), 0);
    downloads.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: shutdown waits for aborted download cleanup before releasing the runtime
 * 状态影响 / State effects: `files.download`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `Object.assign`, `assert.rejects`, `downloads.send`.
 * 检查边界 / Checked boundaries: `assert.rejects( downloads.send({ id: 'vm', type: 'file', path: '/workspace/秘密.bin', name: '秘密.bin' }, response), { name: 'AbortErr…`; `assert.equal(closed, false)`.
 */
test('shutdown waits for aborted download cleanup before releasing the runtime', async () => {
  const { downloads, files } = fixture();
  const response = Object.assign(new EventEmitter(), {
    writableFinished: false,
    destroyed: false,
  }) as unknown as ServerResponse;
  let cleanup!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const cleaned = new Promise<void>((resolve) => {
    cleanup = resolve;
  });
  files.download = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: _id; _path; _res; _headers; signal。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: shutdown waits for aborted download cleanup before releasing the runtime
   * 协作入口 / Collaborators: `signal!.throwIfAborted`.
   */
  async (_id, _path, _res, _headers, signal) => {
    await new Promise<void>((resolve) => signal!.addEventListener('abort', () => resolve(), { once: true }));
    await cleaned;
    signal!.throwIfAborted();
  };
  const operation = assert.rejects(
    downloads.send({ id: 'vm', type: 'file', path: '/workspace/秘密.bin', name: '秘密.bin' }, response),
    { name: 'AbortError' },
  );
  let closed = false;
  const closing = downloads.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  cleanup();
  await Promise.all([operation, closing]);
  assert.equal(closed, true);
});
