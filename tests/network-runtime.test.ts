/**
 * 回归范围（完整情景见下方用例与断言）：
 * - connection pool scales to its cap, refuses excess work and shrinks without moving a live stream
 * - simultaneous admissions respect the process cap and keep each stream independent
 * - large bidirectional streams preserve bytes and half-close with backpressure
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

async function eventually(check: () => boolean) {
  const end = Date.now() + 6000;
  while (!check()) {
    assert.ok(Date.now() < end, 'Network state did not settle');
    await delay(20);
  }
}
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
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

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
    const through = (authenticated: boolean) =>
      new Promise<{ status: number; text: string }>((resolve, reject) => {
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

test('network boundary detects raw primitives, global fetch and SDK defaults, while allowing pure/type helpers', () => {
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
        onFailure: () => {},
      });
      assert.equal(fresh.generation, 'boot-2');
      await fresh.close();
    } finally {
      await backend.close();
    }
  },
);
