import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { connect } from 'node:net';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { ReverseTunnels } from '../server/reverse-tunnels.ts';
import type { Machines } from '../server/machines.ts';

const id = '11111111-1111-4111-8111-111111111111';

class Guest extends EventEmitter {
  running = true;
  reservations = new Map<string, number[]>();
  state() { return this.running ? 'running' : 'stopped'; }
  requireUnlocked() {}
  reserveHostPorts(owner: string, ports: number[]) { this.reservations.set(owner, ports); }
  async exec() { return { code: 0, stdout: '', stderr: '' }; }
  async openGuestTcpStream(_id: string, _port: number, signal?: AbortSignal) {
    const stream = new PassThrough();
    signal?.addEventListener('abort', () => stream.destroy(), { once: true });
    return stream;
  }
}

async function rejected(port: number) {
  await assert.rejects(new Promise<void>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('error', reject);
  }));
}

async function eventually(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50 && !predicate(); attempt++) await delay(10);
  assert.equal(predicate(), true);
}

test('temporary TCP entrance forwards bytes and revokes on close, stop and lockdown', async () => {
  const guest = new Guest();
  const tunnels = new ReverseTunnels(guest as unknown as Machines);
  try {
    assert.equal((await tunnels.check(id)).ready, true);
    await assert.rejects(tunnels.open(id, 0, 10), /端口/);
    const opened = await tunnels.open(id, 8765, 10);
    assert.equal(opened.active, true);
    assert.ok(opened.localPort);
    const socket = connect(opened.localPort!, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    socket.write('ping');
    const [echo] = await once(socket, 'data');
    assert.equal(echo.toString(), 'ping');
    assert.equal(tunnels.status(id).active, true);
    assert.equal(await tunnels.stop(id), true);
    await eventually(() => socket.destroyed);
    await rejected(opened.localPort!);

    const stopped = await tunnels.open(id, 8765, 10);
    guest.running = false;
    guest.emit('change');
    await tunnels.stop(id);
    assert.equal((await tunnels.check(id)).ready, false);
    assert.equal(tunnels.status(id).active, false);
    await rejected(stopped.localPort!);

    guest.running = true;
    const locked = await tunnels.open(id, 8765, 10);
    guest.emit('incident-lockdown', id);
    await tunnels.stop(id);
    assert.equal(tunnels.status(id).active, false);
    await rejected(locked.localPort!);
  } finally {
    await tunnels.close();
  }
});
