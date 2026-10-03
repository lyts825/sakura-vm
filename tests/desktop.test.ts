import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer, createConnection, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';
import { Desktops } from '../server/desktop.ts';
import { defaultDesktopPreferences, parseDesktopPreferencesFile } from '../server/desktop-preferences.ts';
import { desktopPreferencesProbe } from '../server/desktop-guest.ts';
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

test('desktop shutdown reports application cleanup failure, closes other bridges and retries the original service', async () => {
  const { desktops } = fixture();
  const originalAppClose = desktops.apps.close.bind(desktops.apps);
  const originalX11Close = desktops.clipboard.close.bind(desktops.clipboard);
  const originalWaylandClose = desktops.waylandClipboard.close.bind(desktops.waylandClipboard);
  const cleanupError = new Error('original application cgroup cleanup unconfirmed');
  let appAttempts = 0, x11Attempts = 0, waylandAttempts = 0;
  desktops.apps.close = async () => {
    if (++appAttempts === 1) throw cleanupError;
    await originalAppClose();
  };
  desktops.clipboard.close = async () => { x11Attempts++; await originalX11Close(); };
  desktops.waylandClipboard.close = async () => { waylandAttempts++; await originalWaylandClose(); };
  try {
    await assert.rejects(desktops.close(), error => error instanceof AggregateError &&
      error.errors.length === 1 && error.errors[0] === cleanupError);
    assert.equal(appAttempts, 1); assert.equal(x11Attempts, 1); assert.equal(waylandAttempts, 1);
    await desktops.close();
    assert.equal(appAttempts, 2); assert.equal(x11Attempts, 2); assert.equal(waylandAttempts, 2);
  } finally { await originalAppClose(); }
});

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

test('desktop discovery restores persisted preferences and tolerates one bad field', async () => {
  const { desktops, machines } = fixture();
  let probe = true;
  machines.exec = async (_id, command) => {
    if (probe) {
      probe = false;
      return { stdout: 'ready\n', stderr: '', code: 0 };
    }
    assert.equal(command, desktopPreferencesProbe);
    return {
      stdout:
        "RESOLUTION='1920x1080'\nSCALE='not-a-number'\nTHEME='midnight'\nWALLPAPER='midnight'\nACCENT='#e6a6cb'\nPANEL='top'\nAUTO_HIDE_PANEL='true'\nANIMATIONS='false'\n",
      stderr: '',
      code: 0,
    };
  };
  const view = await desktops.view('vm');
  assert.deepEqual(view.preferences, {
    ...defaultDesktopPreferences,
    resolution: '1920x1080',
    theme: 'midnight',
    wallpaper: 'midnight',
    accent: '#e6a6cb',
    panel: 'top',
    autoHidePanel: true,
    animations: false,
  });
  assert.equal(parseDesktopPreferencesFile("THEME='paper'\nBROKEN='ignored'\n").theme, 'paper');
});

test('configure operations carry the full preference set into the guest restart', async () => {
  const { desktops, machines } = fixture();
  const preferences = {
    sessionType: 'wayland' as const,
    resolution: '1600x1000' as const,
    monitorLayout: 'dual-horizontal' as const,
    scale: 150,
    theme: 'paper' as const,
    wallpaper: 'plain' as const,
    accent: '#6d7fb3',
    panel: 'floating' as const,
    autoHidePanel: true,
    animations: false,
  };
  let command = '';
  machines.exec = async (_id, value) => {
    command = value;
    return { stdout: '', stderr: '', code: 0 };
  };
  const view = desktops.start('vm', 'configure', preferences);
  assert.deepEqual(view.preferences, preferences);
  assert.match(command, /SESSION_TYPE='wayland'/);
  assert.match(command, /RESOLUTION='1600x1000'/);
  assert.match(command, /MONITOR_LAYOUT='dual-horizontal'/);
  assert.match(command, /WALLPAPER='plain'/);
  assert.match(command, /PANEL='floating'/);
  assert.match(command, /AUTO_HIDE_PANEL='true'/);
  assert.match(command, /ANIMATIONS='false'/);
  await delay(0);
});

test('starting a stopped desktop reapplies requested preferences before reconnecting', async () => {
  const { desktops, machines } = fixture();
  const preferences = { theme: 'midnight' as const, wallpaper: 'midnight' as const, panel: 'top' as const };
  let command = '';
  machines.exec = async (_id, value) => {
    command = value;
    return { stdout: '', stderr: '', code: 0 };
  };
  desktops.start('vm', 'start', preferences);
  assert.match(command, /THEME='midnight'/);
  assert.match(command, /WALLPAPER='midnight'/);
  assert.match(command, /PANEL='top'/);
  await delay(0);
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

for (const loss of ['browser', 'SSH then VNC', 'VNC then SSH']) {
  test(`desktop bridge preserves binary data and releases the tunnel on ${loss} loss`, async (t) => {
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
    let ssh: EventEmitter;
    let connections = 0;
    machines.connect = async () =>
      Object.assign((ssh = new EventEmitter()), {
        destroy: () => {
          destroyed = true;
          channel?.destroy();
        },
        exec: (command: string, callback: Function) => {
          connections++;
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
    const closed = once(client, 'close');
    if (loss === 'browser') client.close();
    else if (loss === 'SSH then VNC') {
      ssh!.emit('close');
      channel!.destroy();
    } else {
      channel!.destroy();
      ssh!.emit('close');
    }
    await closed;
    await delay(10);
    assert.equal(destroyed, true);
    const recovered = new WebSocket(`ws://127.0.0.1:${(http.address() as { port: number }).port}`);
    t.after(() => recovered.terminate());
    assert.equal((await once(recovered, 'message'))[0].toString(), 'RFB 003.008\n');
    assert.equal(connections, 2, 'reconnection opens a fresh tunnel to the same guest service');
  });
}

test('shared desktop bridge forwards framebuffer requests but closes on keyboard input', async (t) => {
  const tcpSockets = new Set<Socket>();
  let received = Buffer.alloc(0);
  const tcp = createServer((socket) => {
    tcpSockets.add(socket);
    socket.on('close', () => tcpSockets.delete(socket));
    socket.on('error', () => {});
    socket.on('data', (chunk: Buffer) => { received = Buffer.concat([received, chunk]); });
    socket.write('RFB 003.008\n');
  });
  tcp.listen(0, '127.0.0.1');
  await once(tcp, 'listening');
  const http = createHttpServer();
  const wss = new WebSocketServer({ server: http });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const { machines, desktops } = fixture();
  let channel: Socket;
  machines.connect = async () => Object.assign(new EventEmitter(), {
    destroy: () => channel?.destroy(),
    exec: (_command: string, callback: Function) => {
      channel = createConnection({ host: '127.0.0.1', port: (tcp.address() as { port: number }).port });
      channel.once('connect', () => callback(null, channel));
    },
  }) as unknown as Awaited<ReturnType<Machines['connect']>>;
  wss.on('connection', (socket) => {
    void desktops.attach('vm', socket, true).catch(() => socket.close());
  });
  t.after(async () => {
    for (const socket of wss.clients) socket.terminate();
    for (const socket of tcpSockets) socket.destroy();
    wss.close();
    await desktops.close();
    await Promise.all([
      new Promise<void>((resolve) => http.close(() => resolve())),
      new Promise<void>((resolve) => tcp.close(() => resolve())),
    ]);
  });
  const client = new WebSocket(`ws://127.0.0.1:${(http.address() as { port: number }).port}`);
  t.after(() => client.terminate());
  assert.equal((await once(client, 'message'))[0].toString(), 'RFB 003.008\n');
  const allowed = Buffer.concat([
    Buffer.from('RFB 003.008\n'), Buffer.from([1, 1]),
    Buffer.from([3, 0, 0, 0, 0, 0, 0, 0, 64, 64]),
  ]);
  client.send(allowed.subarray(0, 7));
  client.send(allowed.subarray(7));
  for (let attempt = 0; attempt < 30 && received.length < allowed.length; attempt++) await delay(10);
  assert.deepEqual(received, allowed);
  const closed = once(client, 'close');
  client.send(Buffer.from([4, 1, 0, 0, 0, 0, 0, 65]));
  await closed;
  assert.deepEqual(received, allowed);
});
