import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { connect, createServer } from 'node:net';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type { ClientChannel } from 'ssh2';
import type { Machines } from '../server/machines.ts';
import type { Project } from '../server/workspaces.ts';
import { ProjectNetworkBridges } from '../server/project-network-bridges.ts';
import { freePort } from '../server/qmp.ts';

const id = '11111111-1111-4111-8111-111111111111';
const project = { directory: '/workspace', template: 'none', networkIsolation: 'private',
  _workspace: '0123456789abcdef' } as Project;

class Guest extends EventEmitter {
  running = true;
  locked = false;
  clients = new Set<EventEmitter>();
  commands: string[] = [];
  reservations = new Map<string, number[]>();
  probeCode = 0;
  state() { return this.running ? 'running' : 'stopped'; }
  requireUnlocked() { if (this.locked) throw new Error('locked'); }
  reserveHostPorts(owner: string, ports: number[]) {
    if (ports.length) this.reservations.set(owner, ports); else this.reservations.delete(owner);
  }
  async exec(_id: string, command: string) {
    this.commands.push(command);
    return { code: this.probeCode, stdout: '', stderr: this.probeCode ? 'bad routes' : '' };
  }
  async connect(_id: string, _timeout: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const client = new EventEmitter();
    this.clients.add(client);
    return Object.assign(client, {
      destroy: () => { this.clients.delete(client); client.emit('close'); },
      exec: (command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
        this.commands.push(command);
        const stream = Object.assign(new PassThrough(), { stderr: new PassThrough() });
        client.once('close', () => stream.destroy());
        callback(undefined, stream as unknown as ClientChannel);
      },
    });
  }
}

async function eventually(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await delay(10);
  assert.equal(check(), true);
}

async function rejected(port: number) {
  await assert.rejects(new Promise<void>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('error', reject);
  }));
}

test('private loopback bridge carries binary streams, validates each namespace connection and revokes on lifecycle changes', async () => {
  const guest = new Guest();
  const bridges = new ProjectNetworkBridges(guest as unknown as Machines);
  try {
    await assert.rejects(bridges.open(id, { ...project, networkIsolation: 'host' }, 8888, 18888), /私有/);
    await assert.rejects(bridges.open(id, project, 8888, 0), /端口/);
    const port = await freePort();
    await Promise.all([bridges.open(id, project, 8888, port), bridges.open(id, project, 8888, port)]);
    assert.equal(guest.reservations.size, 1);
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    const response = once(socket, 'data');
    socket.write(Buffer.from([0, 255, 13, 10, 128]));
    assert.deepEqual((await response)[0], Buffer.from([0, 255, 13, 10, 128]));
    assert.equal(guest.clients.size, 1);
    const command = guest.commands.at(-1)!;
    assert.match(command, /ip netns exec sk-0123456789abcdef/);
    assert.match(command, /sakura_ipv4=/);
    assert.match(command, /sakura_ipv6=/);
    assert.match(command, /exec python3 -I -S -u/);
    assert.match(command, /127\.0\.0\.1/);
    const halfClosed = connect(port, '127.0.0.1');
    halfClosed.on('error', () => {});
    await once(halfClosed, 'connect');
    const chunks: Buffer[] = [];
    halfClosed.on('data', (data) => chunks.push(data));
    const ended = once(halfClosed, 'end');
    const payload = Buffer.alloc(256 * 1024, 137);
    halfClosed.end(payload);
    await ended;
    assert.deepEqual(Buffer.concat(chunks), payload,
      'a TCP half-close must flush the response before destroying SSH');
    await eventually(() => halfClosed.destroyed && guest.clients.size === 1);
    await assert.rejects(bridges.open(id, project, 9999, port), /先关闭/);
    guest.running = false;
    guest.emit('change');
    await bridges.stop(id, project._workspace!);
    await eventually(() => socket.destroyed && guest.clients.size === 0);
    assert.equal(guest.reservations.size, 0);
    await rejected(port);
    guest.running = true;
    await bridges.open(id, project, 8888, port);
    guest.locked = true;
    guest.emit('incident-lockdown', id);
    await bridges.stop(id, project._workspace!);
    await rejected(port);
    await assert.rejects(bridges.open(id, project, 8888, port), /locked/);
  } finally { await bridges.close(); }
  await assert.rejects(bridges.open(id, project, 8888, 18888), /已关闭/);
});

test('bridge failures release the requested host port, and shutdown cancels a pending namespace probe', async () => {
  const guest = new Guest();
  const bridges = new ProjectNetworkBridges(guest as unknown as Machines);
  const port = await freePort();
  try {
    guest.probeCode = 1;
    await assert.rejects(bridges.open(id, project, 8888, port), /bad routes/);
    assert.equal(guest.reservations.size, 0);
    await rejected(port);
    guest.probeCode = 0;
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(port, '127.0.0.1', resolve));
    try {
      await assert.rejects(bridges.open(id, project, 8888, port), /EADDRINUSE/);
      assert.equal(guest.reservations.size, 0);
    } finally { await new Promise<void>((resolve) => occupied.close(() => resolve())); }
    guest.exec = async (_id: string, _command: string, _timeout?: number, signal?: AbortSignal) => {
      await delay(60_000, undefined, { signal });
      return { code: 0, stdout: '', stderr: '' };
    };
    const opening = bridges.open(id, project, 8888, port);
    const failure = assert.rejects(opening, /abort/i);
    await eventually(() => guest.reservations.size === 1);
    await bridges.close();
    await failure;
    assert.equal(guest.reservations.size, 0);
    await rejected(port);
  } finally { await bridges.close(); }
});

test('a late SSH connection is destroyed when its local bridge has already been revoked', async () => {
  const guest = new Guest();
  const original = guest.connect.bind(guest);
  let release!: () => void;
  let connecting = false;
  let supplied = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  guest.connect = async (vmId: string, timeout: number) => {
    connecting = true;
    await gate;
    const client = await original(vmId, timeout);
    supplied = true;
    return client;
  };
  const bridges = new ProjectNetworkBridges(guest as unknown as Machines);
  try {
    const port = await freePort();
    await bridges.open(id, project, 8888, port);
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    await eventually(() => connecting);
    await bridges.stop(id, project._workspace!);
    release();
    await eventually(() => supplied && socket.destroyed && guest.clients.size === 0);
    assert.equal(guest.reservations.size, 0);
    await rejected(port);
    assert.equal(guest.commands.some((command) => command.includes('python3 -I -S -u')), false,
      'a cancelled connection must never execute the relay');
  } finally { release(); await bridges.close(); }
});

test('project runtime validation rejects stale new connections and repeated opens without executing a relay', async () => {
  const guest = new Guest();
  let valid = false, checks = 0;
  const bridges = new ProjectNetworkBridges(guest as unknown as Machines, async () => {
    checks++;
    if (!valid) throw new Error('runtime binding changed');
  });
  const port = await freePort();
  try {
    await assert.rejects(bridges.open(id, project, 8888, port), /binding changed/);
    assert.equal(guest.reservations.size, 0);
    await rejected(port);
    valid = true;
    await bridges.open(id, project, 8888, port);
    valid = false;
    await assert.rejects(bridges.open(id, project, 8888, port), /binding changed/);
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    await eventually(() => socket.destroyed);
    assert.equal(checks, 4);
    assert.equal(guest.clients.size, 0);
    assert.equal(guest.commands.some((command) => command.includes('python3 -I -S -u')), false);
  } finally { await bridges.close(); }
  assert.equal(guest.reservations.size, 0);
});

test('an explicitly allowed shared project bridge is separately stopped and still validates its runtime', async () => {
  const guest = new Guest();
  let checks = 0;
  const shared = { ...project, networkIsolation: 'host' as const };
  const bridges = new ProjectNetworkBridges(guest as unknown as Machines, async () => { checks++; });
  const port = await freePort();
  try {
    await bridges.open(id, shared, 8888, port, undefined, true);
    assert.equal(checks, 1);
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    const response = once(socket, 'data');
    socket.write('shared');
    assert.equal((await response)[0].toString(), 'shared');
    assert.equal(checks, 2);
    assert.ok(guest.commands.every((command) => !command.includes('ip netns exec')));
    await bridges.stop(id, shared._workspace!);
    await eventually(() => socket.destroyed && guest.clients.size === 0);
    await rejected(port);
  } finally { await bridges.close(); }
});
