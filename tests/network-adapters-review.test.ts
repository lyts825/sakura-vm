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
const runtime = () => new NetworkRuntime({ ...networkDefaults(), maxWorkers: 1, maxVmWorkers: 1 });
async function eventually(check: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Network state did not settle');
    await delay(10);
  }
}
async function listen(server: net.Server, host = '127.0.0.1') {
  server.listen(0, host);
  await once(server, 'listening');
  return (server.address() as net.AddressInfo).port;
}
const close = (server: net.Server) => new Promise<void>((resolve) => server.close(() => resolve()));
function pendingDials(backend: NetworkRuntime) {
  const signals: AbortSignal[] = [];
  backend.host.dial = async (_destination, signal) => {
    assert.ok(signal);
    signals.push(signal);
    signal.throwIfAborted();
    return new Promise<net.Socket>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  };
  return signals;
}

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

test('authenticated CONNECT preserves initial payloads and the HTTP proxy contains policy rejections', async () => {
  let denyDial = false;
  const backend = new NetworkRuntime({
    ...networkDefaults(),
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
    const status = await new Promise<number>((resolve, reject) => {
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

test('scope shutdown cancels pending DNS lookups', async () => {
  const backend = runtime(),
    scope = new NetworkScope(identity, backend);
  let resolverSignal: AbortSignal | undefined;
  backend.host.lookup = async (_hostname, _options, signal) => {
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

test('VM management endpoints remain revoked throughout generation renewal', async () => {
  const backend = runtime();
  let epoch = new AbortController();
  let completeRenew!: () => void;
  const makeLease = (generation: string): VmNetworkLease => ({
    vmId: 'vm-review',
    generation,
    netdev: 'fixture',
    signal: epoch.signal,
    connected: true,
    setConnected: async () => {},
    policy: { isolated: true, ipv6: false, forwards: [] },
    forward: async () => {},
    close: async () => epoch.abort(),
    renew: async (next) => {
      epoch.abort(new Error('generation revoked'));
      await new Promise<void>((resolve) => (completeRenew = resolve));
      epoch = new AbortController();
      return makeLease(next);
    },
  });
  backend.vm.attach = async () => makeLease('old');
  const options = {
    vmId: 'vm-review',
    generation: 'old',
    isolated: true,
    sshPort: 35110,
    forwards: [],
    managementPorts: { qmp: 35111, serial: 35112, agent: 35113 },
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

test('shutdown still closes both pools if a disposer throws synchronously', async () => {
  const backend = runtime();
  let hostClosed = false,
    vmClosed = false;
  const hostClose = backend.host.close.bind(backend.host),
    vmClose = backend.vm.close.bind(backend.vm);
  backend.host.close = async () => {
    hostClosed = true;
    await hostClose();
  };
  backend.vm.close = async () => {
    vmClosed = true;
    await vmClose();
  };
  backend.own(() => {
    throw new Error('broken owner cleanup');
  });
  await assert.rejects(backend.close(), AggregateError);
  assert.ok(hostClosed && vmClosed);
});
