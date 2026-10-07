/**
 * 模块职责：回归验证模块，围绕 `network-adapters-review` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `network-adapters-review`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: management connections cannot replace loopback DNS or use remote named pipes and count once; a revoked scope cannot resolve DNS or reopen its listeners and removes its parent subscription.
 */
import assert from 'node:assert/strict';
import { getEventListeners, once } from 'node:events';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { generate } from 'selfsigned';
import { WebSocketServer } from 'ws';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { NetworkRuntime, NetworkScope, networkDefaults } from '../server/network/index.ts';
import type { VmNetworkLease } from '../server/network/vm-backend.ts';

const identity = { owner: 'adapter-review', purpose: 'test' };
/**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`new NetworkRuntime({ ...networkDefaults(), maxWorkers: 1, maxVmWorkers: 1 })`）。
 * Result: Return the branch-computed value (`new NetworkRuntime({ ...networkDefaults(), maxWorkers: 1, maxVmWorkers: 1 })`).
 * 协作入口 / Collaborators: `networkDefaults`.
 */
const runtime = () => new NetworkRuntime({ ...networkDefaults(), maxWorkers: 1, maxVmWorkers: 1 });
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: check: () => boolean。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `Date.now`, `check`, `assert.ok`, `delay`.
 * 检查边界 / Checked boundaries: `assert.ok(Date.now() < deadline, 'Network state did not settle')`.
 */
async function eventually(check: /**
 * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
 * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => boolean) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Network state did not settle');
    await delay(10);
  }
}
/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: server: net.Server; host = '127.0.0.1'。
 * 结果：返回分支计算值（`(server.address() as net.AddressInfo).port`），以 Promise 交付。
 * Result: Return the branch-computed value (`(server.address() as net.AddressInfo).port`) through a Promise.
 * 协作入口 / Collaborators: `server.listen`, `once`, `server.address`.
 */
async function listen(server: net.Server, host = '127.0.0.1') {
  server.listen(0, host);
  await once(server, 'listening');
  return (server.address() as net.AddressInfo).port;
}
/**
 * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
 * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
 * 输入 / Inputs: server: net.Server。
 * 结果：返回分支计算值（`new Promise<void>((resolve) => server.close(() => resolve()))`）。
 * Result: Return the branch-computed value (`new Promise<void>((resolve) => server.close(() => resolve()))`).
 */
const close = (server: net.Server) => new Promise<void>((resolve) => server.close(() => resolve()));
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: backend: NetworkRuntime。
 * 结果：返回分支计算值（`signals`）。
 * Result: Return the branch-computed value (`signals`).
 * 状态影响 / State effects: `backend.host.dial`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 */
function pendingDials(backend: NetworkRuntime) {
  const signals: AbortSignal[] = [];
  backend.host.dial = /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: _destination; signal。
   * 结果：返回分支计算值（`new Promise<net.Socket>((_resolve, reject) => { signal.addEventListener('abort',…`），以 Promise 交付。
   * Result: Return the branch-computed value (`new Promise<net.Socket>((_resolve, reject) => { signal.addEventListener('abort',…`) through a Promise.
   * 协作入口 / Collaborators: `assert.ok`, `signals.push`, `signal.throwIfAborted`.
   * 检查边界 / Checked boundaries: `assert.ok(signal)`.
   */
  async (_destination, signal) => {
    assert.ok(signal);
    signals.push(signal);
    signal.throwIfAborted();
    return new Promise<net.Socket>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  };
  return signals;
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: management connections cannot replace loopback DNS or use remote named pipes and count once
 * 协作入口 / Collaborators: `runtime`, `net.createServer`, `listen`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.throws( () => backend.connectLocal(identity, { host: 'localhost', port, lookup: (_hostname, _options, callback) => callback…`; `assert.throws( () => backend.connectLocal(identity, { path: '\\\\remote-host\\pipe\\network' }), /local pipe/, )`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('management connections cannot replace loopback DNS or use remote named pipes and count once', async () => {
  const backend = runtime(),
    peer = net.createServer((socket) => socket.on('error', () => {}));
  const port = await listen(peer);
  try {
    assert.throws(
      () =>
        backend.connectLocal(identity, {
          host: 'localhost',
          port,
          /**
           * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
           * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
           * 输入 / Inputs: _hostname; _options; callback。
           * 结果：返回分支计算值（`callback(null, '192.0.2.1', 4)`）。
           * Result: Return the branch-computed value (`callback(null, '192.0.2.1', 4)`).
           * 验证场景 / Scenario: management connections cannot replace loopback DNS or use remote named pipes and count once
           * 协作入口 / Collaborators: `callback`.
           */
          lookup: (_hostname, _options, callback) => callback(null, '192.0.2.1', 4),
        }),
      /local/,
    );
    if (process.platform === 'win32')
      assert.throws(
        () => backend.connectLocal(identity, { path: '\\\\remote-host\\pipe\\network' }),
        /local pipe/,
      );
    backend.beginDrain();
    const socket = await backend.dial(identity, { host: 'localhost', port }, undefined, 1000, true);
    assert.equal(socket.remoteAddress, '127.0.0.1');
    assert.equal(backend.snapshot().leases.length, 1);
    socket.destroy();
    await eventually(() => backend.snapshot().leases.length === 0);
  } finally {
    await backend.close();
    await close(peer);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a revoked scope cannot resolve DNS or reopen its listeners and removes its parent subscription
 * 协作入口 / Collaborators: `runtime`, `scope.createServer`, `listen`, `close`.
 * 检查边界 / Checked boundaries: `assert.equal(backend.snapshot().leases.length, 0)`; `assert.equal(backend.snapshot().leases.filter((lease) => lease.kind === 'listen').length, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a revoked scope cannot resolve DNS or reopen its listeners and removes its parent subscription', async () => {
  const backend = runtime(),
    parent = new AbortController();
  const scope = new NetworkScope(identity, backend, parent.signal);
  const server = scope.createServer();
  try {
    await listen(server);
    await close(server);
    assert.equal(backend.snapshot().leases.length, 0);
    await listen(server);
    assert.equal(backend.snapshot().leases.filter((lease) => lease.kind === 'listen').length, 1);
    assert.throws(() => scope.manageServer(server), /already managed/);
    const closing = scope.close();
    assert.equal(scope.close(), closing);
    await closing;
    assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
    assert.throws(() => server.listen(0, '127.0.0.1'), /abort/i);
    await assert.rejects(scope.lookup('localhost'), /abort/i);
    const aborted = new AbortController();
    aborted.abort(new Error('parent ended'));
    const child = new NetworkScope(identity, backend, aborted.signal);
    await assert.rejects(child.lookup('localhost'), /parent ended/);
    await child.close();
  } finally {
    await backend.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: manual HTTP destruction cancels pending worker dials before a socket exists
 * 协作入口 / Collaborators: `runtime`, `pendingDials`, `scope.httpRequest`, `once`.
 * 检查边界 / Checked boundaries: `assert.match(String((await error)[0]), /request cancelled/)`; `assert.equal(signals[0].aborted, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('manual HTTP destruction cancels pending worker dials before a socket exists', async () => {
  const backend = runtime(),
    scope = new NetworkScope(identity, backend),
    signals = pendingDials(backend);
  try {
    const request = scope.httpRequest('http://example.invalid');
    const error = once(request, 'error');
    request.end();
    await eventually(() => signals.length === 1);
    request.destroy(new Error('request cancelled'));
    assert.match(String((await error)[0]), /request cancelled/);
    await eventually(() => backend.snapshot().leases.length === 0);
    assert.equal(signals[0].aborted, true);
  } finally {
    await scope.close();
    await backend.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: WebSocket termination and parent scope closure cancel pending handshakes
 * 协作入口 / Collaborators: `runtime`, `pendingDials`, `scope.webSocket`, `socket.on`.
 * 检查边界 / Checked boundaries: `assert.ok(signals.every((signal) => signal.aborted))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('WebSocket termination and parent scope closure cancel pending handshakes', async () => {
  const backend = runtime(),
    scope = new NetworkScope(identity, backend),
    signals = pendingDials(backend);
  try {
    const socket = scope.webSocket('ws://example.invalid');
    socket.on('error', () => {});
    const socketClosed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    await eventually(() => signals.length === 1);
    socket.terminate();
    await socketClosed;
    const request = scope.httpsRequest('https://example.invalid');
    request.on('error', () => {});
    request.end();
    const requestClosed = new Promise<void>((resolve) => request.once('close', resolve));
    await eventually(() => signals.length === 2);
    await scope.close();
    await requestClosed;
    assert.ok(signals.every((signal) => signal.aborted));
    await eventually(() => backend.snapshot().leases.length === 0);
  } finally {
    await scope.close();
    await backend.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: scope shutdown completes queued SDK-agent requests as well as active requests
 * 状态影响 / State effects: `httpAgent.maxSockets`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `runtime`, `http.createServer`, `server.on`, `listen`.
 * 检查边界 / Checked boundaries: `assert.ok(first.destroyed && second.destroyed)`; `assert.equal(Object.keys(httpAgent.requests).length, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('scope shutdown completes queued SDK-agent requests as well as active requests', async () => {
  const backend = runtime(),
    scope = new NetworkScope(identity, backend);
  const peers = new Set<net.Socket>();
  const server = http.createServer();
  server.on('connection', (socket) => {
    peers.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => peers.delete(socket));
  });
  const port = await listen(server);
  try {
    const { httpAgent, httpsAgent } = scope.requestHandler();
    httpAgent.maxSockets = 1;
    const first = http.request({ host: '127.0.0.1', port, agent: httpAgent });
    first.on('error', () => {});
    first.end();
    await once(first, 'socket');
    const second = http.request({ host: '127.0.0.1', port, agent: httpAgent });
    second.on('error', () => {});
    second.end();
    const closed = [first, second].map(
      (request) => new Promise<void>((resolve) => request.once('close', resolve)),
    );
    await scope.close();
    await Promise.all(closed);
    assert.ok(first.destroyed && second.destroyed);
    assert.equal(Object.keys(httpAgent.requests).length, 0);
    httpsAgent.destroy();
  } finally {
    await scope.close();
    await backend.close();
    for (const socket of peers) socket.destroy();
    await close(server);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: HTTP, WebSocket and AWS S3 adapters exchange bytes through the managed worker
 * 协作入口 / Collaborators: `runtime`, `http.createServer`, `websocket.on`, `listen`.
 * 检查边界 / Checked boundaries: `assert.equal((await client.send(new ListBucketsCommand({}))).Buckets?.[0].Name, 'managed')`; `assert.equal(String((await message)[0]), 'managed websocket')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('HTTP, WebSocket and AWS S3 adapters exchange bytes through the managed worker', async () => {
  const backend = runtime(),
    scope = new NetworkScope(identity, backend);
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'application/xml');
    response.end(
      '<ListAllMyBucketsResult><Buckets><Bucket><Name>managed</Name></Bucket></Buckets></ListAllMyBucketsResult>',
    );
  });
  const websocket = new WebSocketServer({ server });
  websocket.on('connection', (socket) => socket.on('message', (data) => socket.send(data)));
  const port = await listen(server);
  const client = new S3Client({
    endpoint: `http://127.0.0.1:${port}`,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'fixture', secretAccessKey: 'fixture' },
    requestHandler: scope.requestHandler(),
  });
  try {
    assert.equal((await client.send(new ListBucketsCommand({}))).Buckets?.[0].Name, 'managed');
    const socket = scope.webSocket(`ws://127.0.0.1:${port}`);
    await once(socket, 'open');
    const message = once(socket, 'message');
    socket.send('managed websocket');
    assert.equal(String((await message)[0]), 'managed websocket');
    socket.close();
    await once(socket, 'close');
    assert.equal(backend.snapshot().hostWorkers.length, 1);
  } finally {
    client.destroy();
    await scope.close();
    await backend.close();
    websocket.close();
    await close(server);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: authenticated CONNECT preserves initial payloads and the HTTP proxy contains policy rejections
 * 状态影响 / State effects: `denyDial`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `networkDefaults`, `net.createServer`, `listen`, `scope.proxyEnvironment`.
 * 检查边界 / Checked boundaries: `assert.match(await echoed, /^HTTP\/1.1 200 Connection Established\r\n\r\ninitial tunnel bytes$/)`; `assert.equal(status, 502)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('authenticated CONNECT preserves initial payloads and the HTTP proxy contains policy rejections', async () => {
  let denyDial = false;
  const backend = new NetworkRuntime({
    ...networkDefaults(),
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: _identity; operation。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: authenticated CONNECT preserves initial payloads and the HTTP proxy contains policy rejections
     * 失败 / Failure: `new Error('Policy denies destination')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    authorize: (_identity, operation) => {
      if (denyDial && operation === 'dial') throw new Error('Policy denies destination');
    },
  });
  const scope = new NetworkScope(identity, backend),
    peers = new Set<net.Socket>();
  const peer = net.createServer((socket) => {
    peers.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => peers.delete(socket));
    socket.pipe(socket);
  });
  const port = await listen(peer),
    proxy = await scope.proxyEnvironment(),
    endpoint = new URL(proxy.env.HTTP_PROXY);
  const authorization =
    'Basic ' + Buffer.from(`${endpoint.username}:${endpoint.password}`).toString('base64');
  try {
    const socket = net.createConnection({ host: '127.0.0.1', port: Number(endpoint.port) });
    socket.on('error', () => {});
    await once(socket, 'connect');
    const echoed = new Promise<string>((resolve) => {
      let bytes = '';
      socket.on('data', (data) => {
        bytes += data;
        if (bytes.endsWith('initial tunnel bytes')) resolve(bytes);
      });
    });
    socket.write(
      `CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nProxy-Authorization: ${authorization}\r\n\r\ninitial tunnel bytes`,
    );
    assert.match(await echoed, /^HTTP\/1.1 200 Connection Established\r\n\r\ninitial tunnel bytes$/);
    socket.destroy();
    denyDial = true;
    const status = await new Promise<number>(/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: resolve; reject。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: authenticated CONNECT preserves initial payloads and the HTTP proxy contains policy rejections
     * 协作入口 / Collaborators: `http.request`, `request.once`, `request.end`.
     */
    (resolve, reject) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port: endpoint.port,
          path: `http://127.0.0.1:${port}/`,
          headers: { 'proxy-authorization': authorization },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      request.once('error', reject);
      request.end();
    });
    assert.equal(status, 502);
  } finally {
    await proxy.close();
    await scope.close();
    await backend.close();
    for (const socket of peers) socket.destroy();
    await close(peer);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: scope shutdown cancels pending DNS lookups
 * 状态影响 / State effects: `backend.host.lookup`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `runtime`, `assert.rejects`, `scope.lookup`, `scope.close`.
 * 检查边界 / Checked boundaries: `assert.rejects(scope.lookup('example.invalid'), /abort/i)`; `assert.equal(resolverSignal?.aborted, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('scope shutdown cancels pending DNS lookups', async () => {
  const backend = runtime(),
    scope = new NetworkScope(identity, backend);
  let resolverSignal: AbortSignal | undefined;
  backend.host.lookup = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: _hostname; _options; signal。
   * 结果：返回分支计算值（`new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject…`），以 Promise 交付。
   * Result: Return the branch-computed value (`new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject…`) through a Promise.
   * 验证场景 / Scenario: scope shutdown cancels pending DNS lookups
   * 状态影响 / State effects: `resolverSignal`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  async (_hostname, _options, signal) => {
    resolverSignal = signal;
    return new Promise((_resolve, reject) =>
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }),
    );
  };
  try {
    const result = assert.rejects(scope.lookup('example.invalid'), /abort/i);
    await scope.close();
    await result;
    assert.equal(resolverSignal?.aborted, true);
    assert.equal(backend.snapshot().leases.length, 0);
  } finally {
    await backend.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: context。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: HTTPS adapters preserve CA validation and fetch checks the target IP rather than the worker IP
 * 协作入口 / Collaborators: `context.skip`, `generate`, `tls.getCACertificates`, `tls.setDefaultCACertificates`.
 * 检查边界 / Checked boundaries: `assert.equal(response, 'secure')`; `assert.equal(await (await scope.fetch(`https://127.0.0.1:${port}`)).text(), 'secure')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('HTTPS adapters preserve CA validation and fetch checks the target IP rather than the worker IP', async (context) => {
  if (typeof tls.setDefaultCACertificates !== 'function') {
    context.skip('Node does not expose test-local CA configuration');
    return;
  }
  const certificate = await generate([{ name: 'commonName', value: 'network-adapter-test' }], {
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }],
  });
  const original = tls.getCACertificates('default');
  tls.setDefaultCACertificates([...original, certificate.cert]);
  const backend = runtime(),
    scope = new NetworkScope(identity, backend);
  const server = https.createServer(
    { key: certificate.private, cert: certificate.cert },
    (_request, response) => response.end('secure'),
  );
  const port = await listen(server, '0.0.0.0');
  try {
    const response = await new Promise<string>((resolve, reject) => {
      const request = scope.httpsGet(`https://127.0.0.1:${port}`, { ca: certificate.cert }, (reply) => {
        let body = '';
        reply.on('data', (data) => (body += data));
        reply.once('end', () => resolve(body));
      });
      request.once('error', reject);
    });
    assert.equal(response, 'secure');
    assert.equal(await (await scope.fetch(`https://127.0.0.1:${port}`)).text(), 'secure');
    await assert.rejects(
      scope.fetch(`https://127.0.0.2:${port}`),
      (error: any) => error.cause?.code === 'ERR_TLS_CERT_ALTNAME_INVALID',
    );
  } finally {
    await scope.close();
    await backend.close();
    await close(server);
    tls.setDefaultCACertificates(original);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: VM management endpoints remain revoked throughout generation renewal
 * 状态影响 / State effects: `backend.vm.attach`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `runtime`, `backend.attachVm`, `lease.renew`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.throws( () => backend.connectLocal(identity, { host: '127.0.0.1', port: 35111 }), /generation revoked/, )`; `assert.throws( () => backend.connectLocal( { ...identity, vmId: 'vm-review', generation: 'old' }, { host: '127.0.0.1', port: 35111…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('VM management endpoints remain revoked throughout generation renewal', async () => {
  const backend = runtime();
  let epoch = new AbortController();
  let completeRenew!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: generation: string。
   * 结果：返回分支计算值（`({ vmId: 'vm-review', generation, netdev: 'fixture', signal: epoch.signal, conne…`）。
   * Result: Return the branch-computed value (`({ vmId: 'vm-review', generation, netdev: 'fixture', signal: epoch.signal, conne…`).
   * 验证场景 / Scenario: VM management endpoints remain revoked throughout generation renewal
   */
  const makeLease = (generation: string): VmNetworkLease => ({
    vmId: 'vm-review',
    generation,
    netdev: 'fixture',
    signal: epoch.signal,
    connected: true,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: VM management endpoints remain revoked throughout generation renewal
     */
    setConnected: async () => {},
    policy: { isolated: true, ipv6: false, forwards: [] },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: VM management endpoints remain revoked throughout generation renewal
     */
    forward: async () => {},
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`epoch.abort()`），以 Promise 交付。
     * Result: Return the branch-computed value (`epoch.abort()`) through a Promise.
     * 验证场景 / Scenario: VM management endpoints remain revoked throughout generation renewal
     * 协作入口 / Collaborators: `epoch.abort`.
     */
    close: async () => epoch.abort(),
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: next。
     * 结果：返回分支计算值（`makeLease(next)`），以 Promise 交付。
     * Result: Return the branch-computed value (`makeLease(next)`) through a Promise.
     * 验证场景 / Scenario: VM management endpoints remain revoked throughout generation renewal
     * 状态影响 / State effects: `epoch`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `epoch.abort`, `makeLease`.
     */
    renew: async (next) => {
      epoch.abort(new Error('generation revoked'));
      await new Promise<void>((resolve) => (completeRenew = resolve));
      epoch = new AbortController();
      return makeLease(next);
    },
  });
  backend.vm.attach = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`makeLease('old')`），以 Promise 交付。
   * Result: Return the branch-computed value (`makeLease('old')`) through a Promise.
   * 验证场景 / Scenario: VM management endpoints remain revoked throughout generation renewal
   * 协作入口 / Collaborators: `makeLease`.
   */
  async () => makeLease('old');
  const options = {
    vmId: 'vm-review',
    generation: 'old',
    isolated: true,
    sshPort: 35110,
    forwards: [],
    managementPorts: { qmp: 35111, serial: 35112, agent: 35113 },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: VM management endpoints remain revoked throughout generation renewal
     */
    onFailure: () => {},
  };
  try {
    const lease = await backend.attachVm(options);
    const renewing = lease.renew('new');
    assert.throws(
      () => backend.connectLocal(identity, { host: '127.0.0.1', port: 35111 }),
      /generation revoked/,
    );
    completeRenew();
    const renewed = await renewing;
    assert.throws(
      () =>
        backend.connectLocal(
          { ...identity, vmId: 'vm-review', generation: 'old' },
          { host: '127.0.0.1', port: 35111 },
        ),
      /generation no longer matches/,
    );
    assert.ok(backend.snapshot().managementListeners.every((entry) => entry.generation === 'new'));
    await assert.rejects(backend.attachVm({ ...options, vmId: 'collision' }), /already owned/);
    await renewed.close();
    assert.equal(backend.snapshot().managementListeners.length, 0);
  } finally {
    await backend.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: shutdown still closes both pools if a disposer throws synchronously
 * 状态影响 / State effects: `backend.host.close`, `backend.vm.close`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `runtime`, `backend.host.close.bind`, `backend.vm.close.bind`, `backend.own`.
 * 检查边界 / Checked boundaries: `assert.rejects(backend.close(), AggregateError)`; `assert.ok(hostClosed && vmClosed)`.
 */
test('shutdown still closes both pools if a disposer throws synchronously', async () => {
  const backend = runtime();
  let hostClosed = false,
    vmClosed = false;
  const hostClose = backend.host.close.bind(backend.host),
    vmClose = backend.vm.close.bind(backend.vm);
  backend.host.close = /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: shutdown still closes both pools if a disposer throws synchronously
   * 状态影响 / State effects: `hostClosed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `hostClose`.
   */
  async () => {
    hostClosed = true;
    await hostClose();
  };
  backend.vm.close = /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: shutdown still closes both pools if a disposer throws synchronously
   * 状态影响 / State effects: `vmClosed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `vmClose`.
   */
  async () => {
    vmClosed = true;
    await vmClose();
  };
  backend.own(() => {
    throw new Error('broken owner cleanup');
  });
  await assert.rejects(backend.close(), AggregateError);
  assert.ok(hostClosed && vmClosed);
});
