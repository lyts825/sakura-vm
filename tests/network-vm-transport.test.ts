import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import ssh2 from 'ssh2';
import { createSshKey } from '../server/seed.ts';
import type { Machines } from '../server/machines.ts';
import type { Live } from '../server/vm-state.ts';

const directory = await mkdtemp(join(tmpdir(), 'sakura-network-ssh-'));
process.env.SAKURA_DATA_DIR = directory;
const { MachineTransport } = await import('../server/vm-transport.ts');
const { networkRuntime } = await import('../server/network/index.ts');
const { vmDir } = await import('../server/paths.ts');
const key = createSshKey();
after(async () => {
  await networkRuntime.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-network-ssh-'));
  await rm(directory, { recursive: true, force: true });
});

test('VM transport retries a dropped SSH greeting but never replays an admitted command', async () => {
  let connections = 0, commands = 0;
  const sockets = new Set<Socket>();
  const ssh = new ssh2.Server({ hostKeys: [key.privateText] }, (peer) => {
    peer.on('error', () => {});
    peer.on('authentication', (auth) => auth.accept());
    peer.on('ready', () => peer.on('session', (accept) => {
      accept().on('exec', () => { commands++; peer.end(); });
    }));
  });
  const tcp = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    if (++connections === 1) socket.end();
    else ssh.injectSocket(socket);
  });
  await new Promise<void>((done) => tcp.listen(0, '127.0.0.1', done));
  const id = randomUUID();
  await mkdir(vmDir(id), { recursive: true });
  await writeFile(join(vmDir(id), 'id_rsa'), key.privateText);
  const live = { status: 'running', sshPort: (tcp.address() as { port: number }).port,
    abort: new AbortController(), clients: new Set() } as Live;
  let transport: InstanceType<typeof MachineTransport>;
  const host = { live: new Map([[id, live]]), requireUnlocked: () => {},
    connect: (...args: Parameters<Machines['connect']>) => transport.connect(...args) };
  transport = new MachineTransport(host);
  try {
    const connection = await transport.connect(id, 2000);
    assert.equal(connections, 2);
    connection.destroy();
    await assert.rejects(transport.exec(id, 'one-side-effect', 2000));
    assert.equal(commands, 1);
    assert.equal(connections, 3);
  } finally {
    for (const client of live.clients) client.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((done) => tcp.close(() => done()));
    ssh.close();
  }
});
