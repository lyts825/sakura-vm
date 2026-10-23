/**
 * 模块职责：运行宿主网络池的独立工作进程，处理连接和查询请求并通过控制通道返回状态。
 * Module purpose: Runs independent host network pool work, serving connection/lookup requests and returning control state over IPC.
 */
// Deliberately standalone: production and setup use the same worker without a TS loader.
// IPC carries capabilities/control only. Socket payloads use bounded, backpressured pipes.
import { createServer, createConnection } from 'node:net';
import { lookup } from 'node:dns/promises';
import { randomBytes } from 'node:crypto';
import { BoundedQmpPolicy } from './bounded-qmp-policy.mjs';

const limit = Number(process.env.SAKURA_NETWORK_WORKER_LIMIT || 128);
if (!Number.isInteger(limit) || limit < 1 || limit > 1024) process.exit(1);
const tickets = new Map(),
  connections = new Map(),
  clients = new Set(),
  controls = new Map();
let closing = false,
  shutdownTask;
let backend,
  qmpInput = '',
  qmpSequence = 0;
const qmpPending = new Map();
const boundedPolicies = new BoundedQmpPolicy((execute, args) => qmp(execute, args), () => { void shutdown(1); });
/**
 * 入口 / Entry: failed.
 * 功能：从当前输入或状态计算 `Object.assign(new Error(message), { code })`，供调用方后续验证或使用。
 * Purpose: Computes `Object.assign(new Error(message), { code })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: message; code: default='NETWORK_FAILED'
 * 输出 / Returns: `Object.assign(new Error(message), { code })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const failed = (message, code = 'NETWORK_FAILED') => Object.assign(new Error(message), { code });
/**
 * 入口 / Entry: send.
 * 功能：在运行宿主网络池的独立工作进程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`network/worker.mjs`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `network/worker.mjs`; this entry produces `void` for its caller. Module context: Runs independent host network pool work, serving connection/lookup requests and returning control state over IPC.
 * 处理：通过 `process.send`, `shutdown` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `process.send`, `shutdown`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!process.connected`.
 * 输入 / Inputs: message
 * 输出 / Returns: `void`.
 * 副作用 / Effects: `process.send`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `void shutdown(1);`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `void shutdown(1);`; these statements determine whether a failure is absorbed or rejected again.
 */
const send = (message) => {
  if (!process.connected) return;
  try {
    process.send(message, (error) => {
      if (error) void shutdown(1);
    });
  } catch {
    void shutdown(1);
  }
};
/**
 * 入口 / Entry: errorValue.
 * 功能：从当前输入或状态计算 `({ message: error?.message || String(error), code: error?.code || 'NETWORK_FAILED', })`，供调用方后续验证或使用。
 * Purpose: Computes `({ message: error?.message || String(error), code: error?.code || 'NETWORK_FAILED', })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: error
 * 输出 / Returns: `({ message: error?.message || String(error), code: error?.code || 'NETWORK_FAILED', })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const errorValue = (error) => ({
  message: error?.message || String(error),
  code: error?.code || 'NETWORK_FAILED',
});
/**
 * 入口 / Entry: rejectQmp.
 * 功能：在运行宿主网络池的独立工作进程中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`network/worker.mjs`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `network/worker.mjs`; the calls and state transitions below complete the operation. Module context: Runs independent host network pool work, serving connection/lookup requests and returning control state over IPC.
 * 处理：通过 `qmpPending.values`, `clearTimeout`, `pending.reject`, `qmpPending.clear` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `qmpPending.values`, `clearTimeout`, `pending.reject`, `qmpPending.clear`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: error
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `clearTimeout`; `qmpPending.clear`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function rejectQmp(error) {
  for (const pending of qmpPending.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  qmpPending.clear();
}
/**
 * 入口 / Entry: qmp.
 * 功能：在运行宿主网络池的独立工作进程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Promise.reject(failed('Network backend is unavailable'))` / `Promise.reject(failed('Network QMP queue is full', 'NETWORK_BUSY'))` 供上层消费（`network/worker.mjs`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `network/worker.mjs`; this entry produces `Promise.reject(failed('Network backend is unavailable'))` / `Promise.reject(failed('Network QMP queue is full', 'NETWORK_BUSY'))` for its caller. Module context: Runs independent host network pool work, serving connection/lookup requests and returning control state over IPC.
 * 处理：通过 `Promise.reject`, `failed` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `Promise.reject`, `failed`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `closing || !backend || backend.closed`; `qmpPending.size >= limit + 16`; `Buffer.byteLength(bytes) > 1024 * 1024`.
 * 输入 / Inputs: execute; args
 * 输出 / Returns: `Promise.reject(failed('Network backend is unavailable'))`; `Promise.reject(failed('Network QMP queue is full', 'NETWORK_BUSY'))`; `Promise.reject(error)`；另有分支返回 / additional branch-specific returns.
 * 副作用 / Effects: 更新 / updates `bytes`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `return Promise.reject(error);`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return Promise.reject(error);`; these statements determine whether a failure is absorbed or rejected again.
 */
function qmp(execute, args) {
  if (closing || !backend || backend.closed) return Promise.reject(failed('Network backend is unavailable'));
  if (qmpPending.size >= limit + 16)
    return Promise.reject(failed('Network QMP queue is full', 'NETWORK_BUSY'));
  const id = String(++qmpSequence);
  let bytes;
  try {
    bytes = JSON.stringify({ execute, arguments: args, id }) + '\n';
  } catch (error) {
    return Promise.reject(error);
  }
  if (Buffer.byteLength(bytes) > 1024 * 1024)
    return Promise.reject(failed('Network QMP command is too large'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      rejectQmp(failed('Network QMP timed out', 'ETIMEDOUT'));
      void shutdown(1);
    }, 10_000);
    qmpPending.set(id, { resolve, reject, timer });
    send({ event: 'backend-write', backendId: backend.id, bytes });
  });
}
/**
 * 入口 / Entry: openBackend.
 * 功能：在运行宿主网络池的独立工作进程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void shutdown(1)` 供上层消费（`network/worker.mjs`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `network/worker.mjs`; this entry produces `void shutdown(1)` for its caller. Module context: Runs independent host network pool work, serving connection/lookup requests and returning control state over IPC.
 * 处理：通过 `shutdown`, `ready.catch`, `setTimeout` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `shutdown`, `ready.catch`, `setTimeout`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `backend || typeof id !== 'string' || !id`.
 * 输入 / Inputs: id
 * 输出 / Returns: `void shutdown(1)`.
 * 副作用 / Effects: `setTimeout`; 更新 / updates `backend`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function openBackend(id) {
  if (backend || typeof id !== 'string' || !id) return void shutdown(1);
  let resolveReady, rejectReady, stopped;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => {});
  backend = {
    id,
    ready,
    resolveReady,
    rejectReady,
    closed: false,
    greeted: false,
    stopped: new Promise((done) => {
      stopped = done;
    }),
    resolveStopped: stopped,
    timer: setTimeout(() => {
      rejectReady(failed('Network backend startup timed out', 'ETIMEDOUT'));
      void shutdown(1);
    }, 10_000),
  };
}
/**
 * 入口 / Entry: receiveBackend.
 * 功能：在运行宿主网络池的独立工作进程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void shutdown(1)` 供上层消费（`network/worker.mjs`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `network/worker.mjs`; this entry produces `void shutdown(1)` for its caller. Module context: Runs independent host network pool work, serving connection/lookup requests and returning control state over IPC.
 * 处理：通过 `shutdown`, `qmpInput.indexOf`, `qmpInput.slice`, `qmp().then` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `shutdown`, `qmpInput.indexOf`, `qmpInput.slice`, `qmp().then`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `typeof bytes !== 'string'`; `Buffer.byteLength(qmpInput) > 1024 * 1024`; `!message || typeof message !== 'object'`.
 * 输入 / Inputs: bytes
 * 输出 / Returns: `void shutdown(1)`.
 * 副作用 / Effects: `qmpPending.delete`; `clearTimeout`; 更新 / updates `qmpInput`, `end`, `message`, `backend.greeted`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `return void shutdown(1);`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return void shutdown(1);`; these statements determine whether a failure is absorbed or rejected again.
 */
function receiveBackend(bytes) {
  if (typeof bytes !== 'string') return void shutdown(1);
  qmpInput += bytes;
  if (Buffer.byteLength(qmpInput) > 1024 * 1024) return void shutdown(1);
  let end;
  while ((end = qmpInput.indexOf('\n')) >= 0) {
    const line = qmpInput.slice(0, end);
    qmpInput = qmpInput.slice(end + 1);
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return void shutdown(1);
    }
    if (!message || typeof message !== 'object') return void shutdown(1);
    if (message.QMP && !backend.greeted) {
      backend.greeted = true;
      qmp('qmp_capabilities').then(
        () => {
          clearTimeout(backend.timer);
          backend.resolveReady();
        },
        (error) => {
          backend.rejectReady(error);
          void shutdown(1);
        },
      );
    }
    const pending = qmpPending.get(message.id);
    if (pending) {
      qmpPending.delete(message.id);
      clearTimeout(pending.timer);
      message.error ? pending.reject(failed(message.error.desc)) : pending.resolve(message.return);
    }
  }
}
/**
 * 入口 / Entry: backendClosed.
 * 功能：在运行宿主网络池的独立工作进程中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `backend.closed`（`network/worker.mjs`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `network/worker.mjs`; the outcome is recorded in `backend.closed`. Module context: Runs independent host network pool work, serving connection/lookup requests and returning control state over IPC.
 * 处理：通过 `clearTimeout`, `backend.resolveStopped`, `failed`, `backend.rejectReady` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `clearTimeout`, `backend.resolveStopped`, `failed`, `backend.rejectReady`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!closing`.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `clearTimeout`; 更新 / updates `backend.closed`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function backendClosed() {
  backend.closed = true;
  clearTimeout(backend.timer);
  backend.resolveStopped();
  const error = failed('Network backend exited');
  backend.rejectReady(error);
  rejectQmp(error);
  if (!closing) void shutdown(1);
}
/**
 * 入口 / Entry: release.
 * 功能：在运行宿主网络池的独立工作进程中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`network/worker.mjs`）。
 * Purpose: Ends, revokes or cleans resources owned by this domain action in `network/worker.mjs`; the calls and state transitions below complete the operation. Module context: Runs independent host network pool work, serving connection/lookup requests and returning control state over IPC.
 * 处理：通过 `tickets.get`, `clearTimeout`, `tickets.delete`, `connections.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `tickets.get`, `clearTimeout`, `tickets.delete`, `connections.get`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `ticket`; `connection`.
 * 输入 / Inputs: id
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `clearTimeout`; `tickets.delete`; `connections.get`; `connections.delete`; `connection.client.destroy`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function release(id) {
  const ticket = tickets.get(id);
  if (ticket) {
    clearTimeout(ticket.timer);
    tickets.delete(id);
  }
  const connection = connections.get(id);
  if (connection) {
    connections.delete(id);
    clearTimeout(connection.timer);
    connection.client.destroy();
    connection.upstream.destroy();
  }
}
/**
 * 入口 / Entry: callback@150.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（createServer）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (createServer).
 * 输入 / Inputs: client
 * 输出 / Returns: `client.destroy()`.
 * 副作用 / Effects: `client.destroy`; `clients.add`; `client.setNoDelay`; `setTimeout`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const server = createServer({ allowHalfOpen: true }, (client) => {
  if (closing || clients.size >= limit + 16) return client.destroy();
  clients.add(client);
  client.once('close', () => clients.delete(client));
  client.on('error', () => {});
  client.setNoDelay();
  // An absolute authentication deadline also covers a client sending a slow drip.
  const helloTimer = setTimeout(() => client.destroy(), 10_000);
  client.once('close', () => clearTimeout(helloTimer));
  let input = Buffer.alloc(0);
  /**
   * 入口 / Entry: hello.
   * 功能：在运行宿主网络池的独立工作进程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `client.destroy()` / `void` 供上层消费（`network/worker.mjs`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `network/worker.mjs`; this entry produces `client.destroy()` / `void` for its caller. Module context: Runs independent host network pool work, serving connection/lookup requests and returning control state over IPC.
   * 处理：通过 `input.indexOf`, `client.destroy`, `client.pause`, `client.off` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `input.indexOf`, `client.destroy`, `client.pause`, `client.off`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `end > 4096 || (end < 0 && input.length > 4096)`; `end < 0`; `!message || typeof message !== 'object'`.
   * 输入 / Inputs: chunk
   * 输出 / Returns: `client.destroy()`; `void`.
   * 副作用 / Effects: `client.destroy`; `tickets.delete`; `clearTimeout`; `createConnection`; `connections.set`; 更新 / updates `input`, `message`, `upstream`, `connection.timer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return client.destroy();`; `client.end(JSON.stringify({ error: errorValue(error) }) + '\n');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return client.destroy();`; `client.end(JSON.stringify({ error: errorValue(error) }) + '\n');`; these statements determine whether a failure is absorbed or rejected again.
   */
  const hello = (chunk) => {
    input = Buffer.concat([input, chunk]);
    const end = input.indexOf(10);
    if (end > 4096 || (end < 0 && input.length > 4096)) return client.destroy();
    if (end < 0) return;
    client.pause();
    client.off('data', hello);
    let message;
    try {
      message = JSON.parse(input.subarray(0, end));
    } catch {
      return client.destroy();
    }
    if (!message || typeof message !== 'object') return client.destroy();
    const ticket = tickets.get(message.id);
    if (!ticket || ticket.token !== message.token) return client.destroy();
    tickets.delete(message.id);
    clearTimeout(ticket.timer);
    clearTimeout(helloTimer);
    // Destination is supplied by the parent over IPC, never by the connecting client.
    let upstream;
    try {
      upstream = createConnection({ ...ticket.destination, allowHalfOpen: true });
    } catch (error) {
      client.end(JSON.stringify({ error: errorValue(error) }) + '\n');
      return;
    }
    const connection = { client, upstream, timer: undefined };
    connections.set(message.id, connection);
    connection.timer = setTimeout(
      () => upstream.destroy(failed('Connection timed out', 'ETIMEDOUT')),
      Math.max(1, ticket.expiresAt - Date.now()),
    );
    upstream.setNoDelay();
    let connected = false,
      reportedError = false;
    /**
     * 入口 / Entry: callback@196.
     * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（upstream.on / error）。
     * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (upstream.on / error).
     * 输入 / Inputs: error
     * 输出 / Returns: `release(message.id)`.
     * 副作用 / Effects: `clearTimeout`; `release`; `setTimeout`; 更新 / updates `reportedError`, `connection.timer`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    upstream.on('error', (error) => {
      clearTimeout(connection.timer);
      if (connected || client.destroyed) return release(message.id);
      reportedError = true;
      // Preserve the handshake error until it has crossed the loopback connection.
      // After connect, errors must never inject control JSON into the byte stream.
      client.end(JSON.stringify({ error: errorValue(error) }) + '\n');
      connection.timer = setTimeout(() => release(message.id), 1000);
    });
    upstream.once('close', (hadError) => {
      if (reportedError) return;
      clearTimeout(connection.timer);
      // A natural EOF may leave bytes queued to a slow reader. Let pipe/end drain.
      if (hadError || !upstream.readableEnded) release(message.id);
    });
    client.once('close', () => release(message.id));
    /**
     * 入口 / Entry: callback@212.
     * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（upstream.once / connect）。
     * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (upstream.once / connect).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `release(message.id)`.
     * 副作用 / Effects: `clearTimeout`; `release`; `client.write`; `client.unshift`; 更新 / updates `connected`, `input`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    upstream.once('connect', () => {
      clearTimeout(connection.timer);
      connected = true;
      if (client.destroyed) return release(message.id);
      client.write('{"ok":true}\n');
      const remaining = input.subarray(end + 1);
      if (remaining.length) client.unshift(remaining);
      input = Buffer.alloc(0);
      client.pipe(upstream);
      upstream.pipe(client);
      client.resume();
    });
  };
  client.on('data', hello);
});
server.on('error', () => {
  void shutdown(1);
});
server.listen(0, '127.0.0.1', () => send({ event: 'ready', port: server.address().port }));
/**
 * 入口 / Entry: callback@231.
 * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（process.on / message）。
 * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (process.on / message).
 * 输入 / Inputs: message
 * 输出 / Returns: `void`.
 * 副作用 / Effects: `release`; `send`; `setTimeout`; `controls.set`; `connections.has`; 更新 / updates `control.cancelled`, `value`.
 * 拒绝 / Refusals: 条件 / conditions `command === 'open'`; `tickets.size + connections.size >= limit`; `typeof id !== 'string' || !id || id.length > 128 || !destination || typeof destination.host !== 'string' || !destination.host…`; 异常 / errors `failed('Network worker is at capacity', 'NETWORK_BUSY')`; `failed('Invalid network destination or lease')`.
 * 收尾：退出 try 区域时始终执行 `clearTimeout(control.timer);`; `controls.delete(requestId);`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `clearTimeout(control.timer);`; `controls.delete(requestId);`; these steps also apply to exceptional exits.
 * 失败处理：catch 分支执行 `if (!closing && !control.cancelled) send({ requestId, error: errorValue(error) });`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (!closing && !control.cancelled) send({ requestId, error: errorValue(error) });`; these statements determine whether a failure is absorbed or rejected again.
 */
process.on('message', async (message) => {
  if (!message || typeof message !== 'object') return;
  const { requestId, command, id } = message;
  if (command === 'backend-closed' && backend && message.backendId === backend.id) {
    backendClosed();
    return;
  }
  if (closing) return;
  if (command === 'backend-open') {
    openBackend(message.backendId);
    return;
  }
  if (command === 'backend-data') {
    if (backend && message.backendId === backend.id) receiveBackend(message.bytes);
    else void shutdown(1);
    return;
  }
  if (command === 'close') {
    void shutdown();
    return;
  }
  if (command === 'cancel-control') {
    const control = controls.get(message.targetRequestId);
    if (control) control.cancelled = true;
    return;
  }
  // Cancellation is never blocked by a full work queue.
  if (command === 'cancel') {
    release(id);
    send({ requestId });
    return;
  }
  if (typeof requestId !== 'string' || controls.has(requestId)) return;
  if (controls.size >= limit + 16) {
    send({ requestId, error: errorValue(failed('Network control queue is full', 'NETWORK_BUSY')) });
    return;
  }
  const control = {
    cancelled: false,
    timer: setTimeout(() => {
      // dns.lookup has no cancellation API; retiring the process bounds abandoned work.
      void shutdown(1);
    }, 10_000),
  };
  controls.set(requestId, control);
  try {
    let value;
    if (command === 'open') {
      if (tickets.size + connections.size >= limit)
        throw failed('Network worker is at capacity', 'NETWORK_BUSY');
      const destination = message.destination;
      if (
        typeof id !== 'string' ||
        !id ||
        id.length > 128 ||
        !destination ||
        typeof destination.host !== 'string' ||
        !destination.host ||
        destination.host.length > 253 ||
        !Number.isInteger(destination.port) ||
        destination.port < 1 ||
        destination.port > 65535 ||
        (destination.family !== undefined && ![0, 4, 6].includes(destination.family)) ||
        !Number.isFinite(message.timeoutMs) ||
        message.timeoutMs <= 0 ||
        tickets.has(id) ||
        connections.has(id)
      )
        throw failed('Invalid network destination or lease');
      const token = randomBytes(32).toString('hex');
      const timeoutMs = Math.min(60_000, Math.ceil(message.timeoutMs));
      const timer = setTimeout(() => release(id), Math.min(10_000, timeoutMs));
      tickets.set(id, {
        destination: { host: destination.host, port: destination.port, family: destination.family },
        token,
        timer,
        expiresAt: Date.now() + timeoutMs,
      });
      value = { token };
    } else if (command === 'qmp-policy' || command === 'qmp-policy-observe' || command === 'qmp-policy-forget') {
      if (!backend || message.backendId !== backend.id) throw failed('Network backend is not authorized');
      await backend.ready;
      value = command === 'qmp-policy' ? await boundedPolicies.apply(message)
        : command === 'qmp-policy-observe' ? await boundedPolicies.observe(message.id)
        : await boundedPolicies.forget(message.id);
    } else if (command === 'qmp') {
      if (!backend || message.backendId !== backend.id) throw failed('Network backend is not authorized');
      await backend.ready;
      value = await qmp(message.execute, message.args);
    } else if (command === 'lookup') value = await lookup(message.hostname, message.options);
    else throw failed('Unknown network command');
    if (!closing && !control.cancelled) send({ requestId, value });
  } catch (error) {
    if (!closing && !control.cancelled) send({ requestId, error: errorValue(error) });
  } finally {
    clearTimeout(control.timer);
    controls.delete(requestId);
  }
});
/**
 * 入口 / Entry: shutdown.
 * 功能：在运行宿主网络池的独立工作进程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(shutdownTask ||= (async () => { closing = true; const fallback = setTimeout(() => { process.exit(1); }, 1500); rejectQmp(fai…` 供上层消费（`network/worker.mjs`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `network/worker.mjs`; this entry produces `(shutdownTask ||= (async () => { closing = true; const fallback = setTimeout(() => { process.exit(1); }, 1500); rejectQmp(fai…` for its caller. Module context: Runs independent host network pool work, serving connection/lookup requests and returning control state over IPC.
 * 处理：通过 `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: exitCode: default=0
 * 输出 / Returns: `(shutdownTask ||= (async () => { closing = true; const fallback = setTimeout(() => { process.exit(1); }, 1500); rejectQmp(fai…`.
 * 副作用 / Effects: 更新 / updates `shutdownTask`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function shutdown(exitCode = 0) {
  /**
   * 入口 / Entry: shutdown.callback@325.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `setTimeout`; `clearTimeout`; `connections.keys`; `release`; `client.destroy`; 更新 / updates `closing`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  return (shutdownTask ||= (async () => {
    closing = true;
      boundedPolicies.close();
    const fallback = setTimeout(() => {
      process.exit(1);
    }, 1500);
    rejectQmp(failed('Network worker is closing'));
    for (const control of controls.values()) clearTimeout(control.timer);
    for (const id of new Set([...tickets.keys(), ...connections.keys()])) release(id);
    for (const client of clients) client.destroy();
    const serverClosed = new Promise((resolve) => server.close(resolve));
    if (backend && !backend.closed) {
      clearTimeout(backend.timer);
      backend.rejectReady(failed('Network worker is closing'));
      send({ event: 'backend-stop', backendId: backend.id });
      if (process.connected) await backend.stopped;
    }
    await serverClosed;
    clearTimeout(fallback);
    process.exit(exitCode);
  })());
}
process.on('disconnect', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
