import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer, createConnection, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';
import { Desktops } from '../server/desktop.ts';
import type { Machines } from '../server/machines.ts';

function fixture() {
  const live = { status: 'running', startedAt: 'first-boot' };
  const machines = Object.assign(new EventEmitter(), {
    closing: false,
    live: new Map([['vm', live]]),
    get: () => ({ memoryMiB: 2048 }),
    state: () => live.status,
    exec: async () => ({ stdout: 'not-installed\n', stderr: '', code: 0 }),
  }) as unknown as Machines;
  return { machines, live, desktops: new Desktops(machines) };
}

test('desktop discovery reads the guest disk and does not connect before boot completes', async () => {
  const { desktops, machines, live } = fixture();
  live.status = 'starting';
  machines.exec = async () => {
    throw new Error('must not connect');
  };
  assert.equal((await desktops.view('vm')).status, 'unavailable');
  assert.throws(() => desktops.start('vm', 'install'), /启动完成/);
  live.status = 'running';
  for (const status of ['not-installed', 'starting', 'ready', 'stopped']) {
    machines.exec = async () => ({ stdout: `${status}\n`, stderr: '', code: 0 });
    assert.equal((await desktops.view('vm')).status, status);
  }
  machines.exec = async () => ({ stdout: 'unexpected', stderr: '', code: 0 });
  await assert.rejects(desktops.view('vm'), /检查桌面状态/);
});

test('installation enforces memory, deduplicates concurrent requests, and makes failures retryable', async () => {
  const { desktops, machines } = fixture();
  machines.get = () => ({ memoryMiB: 512 }) as ReturnType<Machines['get']>;
  assert.throws(() => desktops.start('vm', 'install'), /1024 MiB/);
  machines.get = () => ({ memoryMiB: 2048 }) as ReturnType<Machines['get']>;
  let calls = 0;
  let complete!: (value: Awaited<ReturnType<Machines['exec']>>) => void;
  machines.exec = async (_id, _script, _timeout, _signal, output) => {
    calls++;
    output?.('x'.repeat(20000));
    return new Promise((resolve) => {
      complete = resolve;
    });
  };
  desktops.start('vm', 'install');
  desktops.start('vm', 'start');
  assert.equal(calls, 1);
  assert.equal((await desktops.view('vm')).log.length, 16384);
  complete({ stdout: '', stderr: 'repository unavailable', code: 1 });
  await delay(0);
  assert.equal((await desktops.view('vm')).status, 'error');
  assert.equal((await desktops.view('vm')).error, 'repository unavailable');
  desktops.start('vm', 'install');
  assert.equal(calls, 2);
  complete({ stdout: '', stderr: '', code: 0 });
  await delay(0);
  machines.exec = async () => ({ stdout: 'ready\n', stderr: '', code: 0 });
  assert.equal((await desktops.view('vm')).status, 'ready');
});

test('stopping cancels installation and stale completions cannot overwrite a new boot', async () => {
  const { desktops, machines, live } = fixture();
  let installationSignal: AbortSignal | undefined;
  let fail!: (error: Error) => void;
  machines.exec = async (_id, _command, _timeout, signal) => {
    installationSignal = signal;
    return new Promise((_resolve, reject) => {
      fail = reject;
    });
  };
  desktops.start('vm', 'install');
  live.status = 'stopping';
  machines.emit('change');
  assert.equal(installationSignal?.aborted, true);
  live.status = 'running';
  live.startedAt = 'second-boot';
  machines.exec = async () => ({ stdout: 'not-installed\n', stderr: '', code: 0 });
  fail(new Error('old operation failed'));
  await delay(0);
  assert.equal((await desktops.view('vm')).status, 'not-installed');
});

test('desktop bridge preserves binary data, pins the guest target, and releases SSH on disconnect', async (t) => {
  const tcpSockets = new Set<Socket>();
  const tcp = createServer((socket) => {
    tcpSockets.add(socket);
    socket.on('close', () => tcpSockets.delete(socket));
    socket.on('error', () => {});
    socket.write('RFB 003.008\n');
    socket.pipe(socket);
  });
  tcp.listen(0, '127.0.0.1');
  await once(tcp, 'listening');
  const http = createHttpServer();
  const wss = new WebSocketServer({ server: http });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  t.after(async () => {
    for (const socket of wss.clients) socket.terminate();
    for (const socket of tcpSockets) socket.destroy();
    wss.close();
    await Promise.all([
      new Promise<void>((resolve) => http.close(() => resolve())),
      new Promise<void>((resolve) => tcp.close(() => resolve())),
    ]);
  });
  const { machines, desktops } = fixture();
  let destroyed = false;
  let channel: Socket;
  machines.connect = async () =>
    Object.assign(new EventEmitter(), {
      destroy: () => {
        destroyed = true;
        channel?.destroy();
      },
      exec: (command: string, callback: Function) => {
        assert.equal(command, 'exec nc 127.0.0.1 5901');
        channel = createConnection({ host: '127.0.0.1', port: (tcp.address() as { port: number }).port });
        channel.once('connect', () => callback(null, channel));
      },
    }) as unknown as Awaited<ReturnType<Machines['connect']>>;
  wss.on('connection', (socket) => {
    void desktops.attach('vm', socket).catch(() => socket.close());
  });
  const client = new WebSocket(`ws://127.0.0.1:${(http.address() as { port: number }).port}`);
  t.after(() => client.terminate());
  const [banner, binary] = await once(client, 'message');
  assert.equal(binary, true);
  assert.equal(banner.toString(), 'RFB 003.008\n');
  const reply = once(client, 'message');
  const payload = Buffer.from([0, 1, 128, 255, 0, 37]);
  client.send(payload);
  assert.deepEqual((await reply)[0], payload);
  client.close();
  await once(client, 'close');
  await delay(10);
  assert.equal(destroyed, true);
});
