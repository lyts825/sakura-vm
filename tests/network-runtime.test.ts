/**
 * 模块职责：回归验证模块，围绕 `network-runtime` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `network-runtime`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: connection pool scales to its cap, refuses excess work and shrinks without moving a live stream; simultaneous admissions respect the process cap and keep each stream independent.
 */
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createConnection, createServer, type Socket } from 'node:net';
import { createServer as httpServer, request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import ts from 'typescript';
import { NetworkRuntime, NetworkScope, networkDefaults } from '../server/network/index.ts';
import { availablePort } from '../server/network/vm-backend.ts';
import { ROOT } from '../server/paths.ts';
import { join } from 'node:path';
import { networkBoundaryErrors } from '../scripts/network-boundaries.ts';

/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: check: () => boolean。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `Date.now`, `check`, `assert.ok`, `delay`.
 * 检查边界 / Checked boundaries: `assert.ok(Date.now() < end, 'Network state did not settle')`.
 */
async function eventually(check: /**
 * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
 * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => boolean) {
  const end = Date.now() + 6000;
  while (!check()) {
    assert.ok(Date.now() < end, 'Network state did not settle');
    await delay(20);
  }
}
/**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: options: Partial<ReturnType<typeof networkDefaults>> = {}。
 * 结果：返回分支计算值（`new NetworkRuntime({ ...networkDefaults(), maxWorkers: 2, connectionsPerWorker: …`）。
 * Result: Return the branch-computed value (`new NetworkRuntime({ ...networkDefaults(), maxWorkers: 2, connectionsPerWorker: …`).
 * 协作入口 / Collaborators: `networkDefaults`.
 */
function runtime(options: Partial<ReturnType<typeof networkDefaults>> = {}) {
  return new NetworkRuntime({
    ...networkDefaults(),
    maxWorkers: 2,
    connectionsPerWorker: 2,
    scaleAt: 1,
    idleMs: 120,
    ...options,
  });
}
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `port, close`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `port, close`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `createServer`, `server.listen`, `once`, `server.address`.
 */
async function echo() {
  const sockets = new Set<Socket>();
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    socket.pipe(socket);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: (server.address() as { port: number }).port,
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`new Promise<void>((resolve) => { for (const socket of sockets) socket.destroy();…`）。
     * Result: Return the branch-computed value (`new Promise<void>((resolve) => { for (const socket of sockets) socket.destroy();…`).
     */
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: connection pool scales to its cap, refuses excess work and shrinks without moving a live stream
 * 协作入口 / Collaborators: `runtime`, `echo`, `sockets.push`, `scope.dial`.
 * 检查边界 / Checked boundaries: `assert.equal(backend.snapshot().hostWorkers.length, 2)`; `assert.rejects(scope.dial({ host: '127.0.0.1', port: peer.port }), { code: 'NETWORK_BUSY' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('connection pool scales to its cap, refuses excess work and shrinks without moving a live stream', async () => {
  const backend = runtime(),
    scope = new NetworkScope({ owner: 'test', purpose: 'load' }, backend),
    peer = await echo();
  const sockets: Socket[] = [];
  try {
    for (let i = 0; i < 4; i++) sockets.push(await scope.dial({ host: '127.0.0.1', port: peer.port }));
    assert.equal(backend.snapshot().hostWorkers.length, 2);
    await assert.rejects(scope.dial({ host: '127.0.0.1', port: peer.port }), { code: 'NETWORK_BUSY' });
    assert.equal(backend.snapshot().leases.filter((lease) => lease.kind === 'dial').length, 4);
    for (const socket of sockets.slice(1)) socket.destroy();
    await eventually(() => backend.snapshot().hostWorkers.length === 1);
    const socket = sockets[0];
    socket.resume();
    const reply = once(socket, 'data');
    socket.write('still-pinned');
    assert.equal(String((await reply)[0]), 'still-pinned');
    socket.destroy();
    await eventually(() => backend.snapshot().hostWorkers.length === 0);
    assert.equal(backend.snapshot().leases.length, 0);
  } finally {
    await backend.close();
    await peer.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: simultaneous admissions respect the process cap and keep each stream independent
 * 协作入口 / Collaborators: `runtime`, `echo`, `Promise.allSettled`, `Array.from`.
 * 检查边界 / Checked boundaries: `assert.equal(result.reason.code, 'NETWORK_BUSY')`; `assert.equal(sockets.length, 48)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('simultaneous admissions respect the process cap and keep each stream independent', async () => {
  const backend = runtime({ maxWorkers: 3, connectionsPerWorker: 16, scaleAt: 8, idleMs: 60_000 });
  const scope = new NetworkScope({ owner: 'test:burst', purpose: 'concurrency' }, backend);
  const peer = await echo();
  const sockets: Socket[] = [];
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 64 }, () => scope.dial({ host: '127.0.0.1', port: peer.port })),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') sockets.push(result.value);
      else assert.equal(result.reason.code, 'NETWORK_BUSY');
    }
    assert.equal(sockets.length, 48);
    assert.deepEqual(
      backend.snapshot().hostWorkers.map((worker) => worker.connections),
      [16, 16, 16],
    );
    await Promise.all(
      sockets.map(async (socket, index) => {
        const payload = Buffer.alloc(4096, index);
        const received: Buffer[] = [];
        socket.on('data', (chunk: Buffer) => received.push(chunk));
        const end = once(socket, 'end');
        socket.resume();
        socket.end(payload);
        await end;
        assert.deepEqual(Buffer.concat(received), payload);
        socket.destroy();
      }),
    );
    await eventually(() => backend.snapshot().leases.length === 0);
  } finally {
    await backend.close();
    await peer.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: large bidirectional streams preserve bytes and half-close with backpressure
 * 协作入口 / Collaborators: `runtime`, `echo`, `backend.dial`, `randomBytes`.
 * 检查边界 / Checked boundaries: `assert.equal(count, bytes.length)`; `assert.equal(hash.digest('hex'), createHash('sha256').update(bytes).digest('hex'))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('large bidirectional streams preserve bytes and half-close with backpressure', async () => {
  const backend = runtime(),
    peer = await echo();
  try {
    const socket = await backend.dial(
      { owner: 'test', purpose: 'binary' },
      { host: '127.0.0.1', port: peer.port },
    );
    const bytes = randomBytes(2 * 1024 * 1024),
      hash = createHash('sha256');
    let count = 0;
    socket.on('data', (chunk) => {
      count += chunk.length;
      hash.update(chunk);
    });
    socket.resume();
    const end = once(socket, 'end');
    socket.end(bytes);
    await end;
    assert.equal(count, bytes.length);
    assert.equal(hash.digest('hex'), createHash('sha256').update(bytes).digest('hex'));
    socket.destroy();
  } finally {
    await backend.close();
    await peer.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: worker crash closes affected streams, never replays bytes, and a new connection can use a replacement
 * 协作入口 / Collaborators: `runtime`, `echo`, `backend.dial`, `socket.on`.
 * 检查边界 / Checked boundaries: `assert.equal(String((await reply)[0]), 'new-request')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('worker crash closes affected streams, never replays bytes, and a new connection can use a replacement', async () => {
  const backend = runtime(),
    peer = await echo();
  try {
    const socket = await backend.dial(
      { owner: 'test', purpose: 'crash' },
      { host: '127.0.0.1', port: peer.port },
    );
    socket.on('error', () => {});
    const closed = new Promise<void>((resolve) => socket.once('close', resolve));
    process.kill(backend.snapshot().hostWorkers[0].pid!);
    await closed;
    await eventually(() => backend.snapshot().hostWorkers.length === 0);
    const replacement = await backend.dial(
      { owner: 'test', purpose: 'new' },
      { host: '127.0.0.1', port: peer.port },
    );
    replacement.resume();
    const reply = once(replacement, 'data');
    replacement.write('new-request');
    assert.equal(String((await reply)[0]), 'new-request');
    replacement.destroy();
  } finally {
    await backend.close();
    await peer.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancellation and refused connects release capacity; management remains available during drain
 * 协作入口 / Collaborators: `runtime`, `echo`, `backend.dial`, `signal.abort`.
 * 检查边界 / Checked boundaries: `assert.rejects(cancelled, { name: 'AbortError' })`; `assert.rejects( backend.dial({ owner: 'test', purpose: 'refused' }, { host: '127.0.0.1', port: await availablePort() }), { code: '…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('cancellation and refused connects release capacity; management remains available during drain', async () => {
  const backend = runtime(),
    peer = await echo();
  try {
    const signal = new AbortController();
    const cancelled = backend.dial(
      { owner: 'test', purpose: 'cancel' },
      { host: '127.0.0.1', port: peer.port },
      signal.signal,
    );
    signal.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });
    await assert.rejects(
      backend.dial({ owner: 'test', purpose: 'refused' }, { host: '127.0.0.1', port: await availablePort() }),
      { code: 'ECONNREFUSED' },
    );
    await eventually(() => backend.snapshot().leases.length === 0);
    backend.beginDrain();
    await assert.rejects(
      backend.dial({ owner: 'test', purpose: 'blocked' }, { host: '127.0.0.1', port: peer.port }),
      /shutting down/,
    );
    const socket = await backend.dial(
      { owner: 'test', purpose: 'shutdown' },
      { host: '127.0.0.1', port: peer.port },
      undefined,
      1000,
      true,
    );
    socket.resume();
    const reply = once(socket, 'data');
    socket.write('stop');
    assert.equal(String((await reply)[0]), 'stop');
    socket.destroy();
    assert.throws(
      () => backend.connectLocal({ owner: 'test', purpose: 'invalid' }, { host: 'example.com', port: 80 }),
      /local/,
    );
  } finally {
    await backend.close();
    await peer.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: fetch, DNS and an authenticated tool proxy use the runtime; revocation cancels owned listeners
 * 状态影响 / State effects: `proxy`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `runtime`, `httpServer`, `peer.listen`, `once`.
 * 检查边界 / Checked boundaries: `assert.equal(await (await scope.fetch(target)).text(), 'managed-http')`; `assert.equal((await scope.lookup('localhost', { family: 4 })).family, 4)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('fetch, DNS and an authenticated tool proxy use the runtime; revocation cancels owned listeners', async () => {
  const backend = runtime(),
    scope = new NetworkScope({ owner: 'plugin:fixture', purpose: 'http' }, backend);
  const peer = httpServer((request, response) => {
    assert.equal(request.headers['proxy-authorization'], undefined);
    response.end('managed-http');
  });
  peer.listen(0, '127.0.0.1');
  await once(peer, 'listening');
  const target = `http://127.0.0.1:${(peer.address() as { port: number }).port}`;
  let proxy: Awaited<ReturnType<NetworkScope['proxyEnvironment']>> | undefined;
  try {
    assert.equal(await (await scope.fetch(target)).text(), 'managed-http');
    assert.equal((await scope.lookup('localhost', { family: 4 })).family, 4);
    proxy = await scope.proxyEnvironment();
    const endpoint = new URL(proxy.env.HTTP_PROXY);
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: authenticated: boolean。
     * 结果：返回分支计算值（`new Promise<{ status: number; text: string }>((resolve, reject) => { const req =…`）。
     * Result: Return the branch-computed value (`new Promise<{ status: number; text: string }>((resolve, reject) => { const req =…`).
     * 验证场景 / Scenario: fetch, DNS and an authenticated tool proxy use the runtime; revocation cancels owned listeners
     */
    const through = (authenticated: boolean) =>
      new Promise<{ status: number; text: string }>(/**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: resolve; reject。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: fetch, DNS and an authenticated tool proxy use the runtime; revocation cancels owned listeners
       * 协作入口 / Collaborators: `request`, `Buffer.from(`${endpoint.username}:${endpoint.password}`).toString`, `Buffer.from`, `req.on`.
       */
      (resolve, reject) => {
        const req = request(
          {
            hostname: endpoint.hostname,
            port: endpoint.port,
            path: target,
            headers: authenticated
              ? {
                  'proxy-authorization':
                    'Basic ' + Buffer.from(`${endpoint.username}:${endpoint.password}`).toString('base64'),
                }
              : {},
          },
          (response) => {
            let text = '';
            response.on('data', (bytes) => (text += bytes));
            response.on('end', () => resolve({ status: response.statusCode!, text }));
          },
        );
        req.on('error', reject);
        req.end();
      });
    assert.equal((await through(false)).status, 407);
    assert.deepEqual(await through(true), { status: 200, text: 'managed-http' });
    assert.ok(backend.snapshot().leases.some((lease) => lease.owner === 'plugin:fixture'));
    await proxy.close();
    proxy = undefined;
    await scope.close();
    assert.throws(() => scope.createServer(), /abort/i);
  } finally {
    await proxy?.close();
    await backend.close();
    await new Promise<void>((resolve) => peer.close(() => resolve()));
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: network boundary detects raw primitives, global fetch and SDK defaults, while allowing pure/type helpers
 * 协作入口 / Collaborators: `assert.equal`, `check`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.equal( check("import { isIP, type Socket } from 'node:net'; import type { Server } from 'node:http';").length, 0, )`; `assert.ok(check(code).length > 0, code)`.
 */
test('network boundary detects raw primitives, global fetch and SDK defaults, while allowing pure/type helpers', () => {
  /**
   * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
   * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
   * 输入 / Inputs: code: string。
   * 结果：返回分支计算值（`networkBoundaryErrors( 'server/example.ts', ts.createSourceFile('example.ts', co…`）。
   * Result: Return the branch-computed value (`networkBoundaryErrors( 'server/example.ts', ts.createSourceFile('example.ts', co…`).
   * 验证场景 / Scenario: network boundary detects raw primitives, global fetch and SDK defaults, while allowing pure/type helpers
   * 协作入口 / Collaborators: `networkBoundaryErrors`, `ts.createSourceFile`.
   */
  const check = (code: string) =>
    networkBoundaryErrors(
      'server/example.ts',
      ts.createSourceFile('example.ts', code, ts.ScriptTarget.Latest, true),
    );
  assert.equal(
    check("import { isIP, type Socket } from 'node:net'; import type { Server } from 'node:http';").length,
    0,
  );
  for (const code of [
    "import { createConnection as dial } from 'node:net';",
    "import * as https from 'https';",
    "await import('node:dgram');",
    'globalThis.fetch(url);',
    'fetch(url);',
    'new S3Client({});',
    'new WebSocket(url);',
  ])
    assert.ok(check(code).length > 0, code);
  assert.equal(
    check(
      "const { fetch } = networkFor('plugin:test'); fetch(url); new S3Client({ requestHandler: network.requestHandler(), credentials: managedCredentials });",
    ).length,
    0,
  );
});

const qemu = join(
  process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu'),
  `qemu-system-x86_64${process.platform === 'win32' ? '.exe' : ''}`,
);
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: VM generation transition isolates Ethernet until the current lease reconnects it
 * 状态影响 / State effects: `wire`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `runtime`, `backend.attachVm`, `availablePort`, `Number`.
 * 检查边界 / Checked boundaries: `assert.equal(replies(), 1)`; `assert.equal(backend.snapshot().vms.length, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test(
  'VM generation transition isolates Ethernet until the current lease reconnects it',
  { skip: !existsSync(qemu) },
  async () => {
    const backend = runtime({ idleMs: 60_000 });
    let wire: Socket | undefined;
    let failures = 0;
    try {
      const lease = await backend.attachVm({
        vmId: 'ethernet-fixture',
        generation: 'before',
        isolated: false,
        ipv6: false,
        sshPort: await availablePort(),
        forwards: [],
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`failures++`）。
         * Result: Return the branch-computed value (`failures++`).
         * 验证场景 / Scenario: VM generation transition isolates Ethernet until the current lease reconnects it
         */
        onFailure: () => failures++,
      });
      const port = Number(/addr.port=(\d+)/.exec(lease.netdev)![1]);
      wire = createConnection({ host: '127.0.0.1', port });
      wire.on('error', () => {});
      let input = Buffer.alloc(0);
      const frames: Buffer[] = [];
      wire.on('data', (chunk) => {
        input = Buffer.concat([input, chunk]);
        while (input.length >= 4 && input.length >= 4 + input.readUInt32BE(0)) {
          const size = input.readUInt32BE(0);
          frames.push(input.subarray(4, 4 + size));
          input = input.subarray(4 + size);
        }
      });
      await once(wire, 'connect');
      const arp = Buffer.from(
        'ffffffffffff525400123456080600010800060400015254001234560a00020f0000000000000a000202',
        'hex',
      );
      const header = Buffer.alloc(4);
      header.writeUInt32BE(arp.length);
      const request = Buffer.concat([header, arp]);
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`frames.filter( (frame) => frame.length >= 42 && frame.readUInt16BE(12) === 0x080…`）。
       * Result: Return the branch-computed value (`frames.filter( (frame) => frame.length >= 42 && frame.readUInt16BE(12) === 0x080…`).
       * 验证场景 / Scenario: VM generation transition isolates Ethernet until the current lease reconnects it
       * 协作入口 / Collaborators: `frames.filter`.
       */
      const replies = () =>
        frames.filter(
          (frame) => frame.length >= 42 && frame.readUInt16BE(12) === 0x0806 && frame.readUInt16BE(20) === 2,
        ).length;
      wire.write(request);
      await eventually(() => replies() === 1);
      await lease.setConnected(false);
      wire.write(request);
      await delay(100);
      assert.equal(replies(), 1);
      const renewing = lease.renew('after');
      const staleClose = lease.close();
      const renewed = await renewing;
      await staleClose;
      assert.equal(backend.snapshot().vms.length, 1);
      assert.equal(renewed.connected, false);
      await assert.rejects(lease.setConnected(true), /generation replaced/);
      wire.write(request);
      await delay(100);
      assert.equal(replies(), 1);
      await renewed.setConnected(true);
      wire.write(request);
      await eventually(() => replies() === 2);
      assert.equal(backend.snapshot().vms[0].connected, true);
      assert.equal(failures, 0);
    } finally {
      wire?.destroy();
      await backend.close();
    }
  },
);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: real CPU-less backend owns independent VM generations and reaps QEMU after supervisor failure
 * 协作入口 / Collaborators: `runtime`, `backend.attachVm`, `availablePort`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.match(lease.netdev, /^stream,/)`; `assert.equal(lease.policy.ipv6, false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test(
  'real CPU-less backend owns independent VM generations and reaps QEMU after supervisor failure',
  { skip: !existsSync(qemu) },
  async () => {
    const backend = runtime({ idleMs: 60_000 });
    let failed = 0;
    try {
      const lease = await backend.attachVm({
        vmId: 'fixture',
        generation: 'boot-1',
        isolated: true,
        sshPort: await availablePort(),
        forwards: [],
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`failed++`）。
         * Result: Return the branch-computed value (`failed++`).
         * 验证场景 / Scenario: real CPU-less backend owns independent VM generations and reaps QEMU after supervisor failure
         */
        onFailure: () => failed++,
      });
      assert.match(lease.netdev, /^stream,/);
      assert.equal(lease.policy.ipv6, false);
      assert.equal(lease.policy.forwards.length, 1);
      await assert.rejects(
        backend.attachVm({
          vmId: 'fixture',
          generation: 'boot-2',
          isolated: false,
          sshPort: await availablePort(),
          forwards: [],
          /**
           * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
           * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
           * 输入 / Inputs: 无 / none。
           * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
           * Result: No explicit result value; callers observe completion, state changes or an exception.
           * 验证场景 / Scenario: real CPU-less backend owns independent VM generations and reaps QEMU after supervisor failure
           */
          onFailure: () => {},
        }),
        /already/,
      );
      const renewed = await lease.renew('restored');
      assert.equal(lease.signal.aborted, true);
      assert.equal(renewed.signal.aborted, false);
      await lease.close();
      assert.equal(backend.snapshot().vms[0].generation, 'restored');
      const worker = backend.snapshot().vmWorkers[0];
      assert.ok(worker.backendPid);
      process.kill(worker.pid!);
      await eventually(() => failed === 1);
      assert.equal(renewed.signal.aborted, true);
      await eventually(() => {
        try {
          process.kill(worker.backendPid!, 0);
          return false;
        } catch {
          return true;
        }
      });
      await assert.rejects(renewed.forward('add', { host: 32111, guest: 22 }), /exited/);
      await renewed.close();
      const fresh = await backend.attachVm({
        vmId: 'fixture',
        generation: 'boot-2',
        isolated: false,
        sshPort: await availablePort(),
        forwards: [],
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 验证场景 / Scenario: real CPU-less backend owns independent VM generations and reaps QEMU after supervisor failure
         */
        onFailure: () => {},
      });
      assert.equal(fresh.generation, 'boot-2');
      await fresh.close();
    } finally {
      await backend.close();
    }
  },
);
