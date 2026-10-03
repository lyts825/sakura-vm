// Deliberately standalone: production and setup use the same worker without a TS loader.
// IPC carries capabilities/control only. Socket payloads use bounded, backpressured pipes.
import { createServer, createConnection } from 'node:net';
import { lookup } from 'node:dns/promises';
import { randomBytes } from 'node:crypto';

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
const failed = (message, code = 'NETWORK_FAILED') => Object.assign(new Error(message), { code });
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
const errorValue = (error) => ({
  message: error?.message || String(error),
  code: error?.code || 'NETWORK_FAILED',
});
function rejectQmp(error) {
  for (const pending of qmpPending.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  qmpPending.clear();
}
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
function backendClosed() {
  backend.closed = true;
  clearTimeout(backend.timer);
  backend.resolveStopped();
  const error = failed('Network backend exited');
  backend.rejectReady(error);
  rejectQmp(error);
  if (!closing) void shutdown(1);
}
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
function shutdown(exitCode = 0) {
  return (shutdownTask ||= (async () => {
    closing = true;
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
