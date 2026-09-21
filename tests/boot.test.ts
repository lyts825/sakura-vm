import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { Engine } from '../server/runtime.ts';
import { createSshKey } from '../server/seed.ts';
import { freePort } from '../server/qmp.ts';
import ssh2 from 'ssh2';
const { Server: SshServer } = ssh2;

const root = await mkdtemp(join(tmpdir(), 'sakura-boot-test-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
const key = createSshKey();
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-boot-test-'));
  await rm(root, { recursive: true, force: true });
});

async function fixture(t: TestContext, whpxAvailable = false) {
  const commands: string[][] = [];
  const engine = {
    whpxAvailable,
    runtime: { close: async () => {} },
    run: async (_tool, args, options = {}) => {
      commands.push(args);
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) resolve();
        else options.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return '';
    },
  } as Engine;
  const machines = new Machines(engine);
  await machines.init();
  const id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'boot-test' }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  await mkdir(vmDir(id));
  await writeFile(join(vmDir(id), 'id_rsa'), key.privateText);
  t.after(async () => {
    if (machines.live.has(id)) await machines.stop(id, true);
    await machines.close();
  });
  return { machines, id, commands };
}

async function eventually(condition: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'State transition did not finish');
    await delay(10);
  }
}

function deferredProbe() {
  let resolve!: (result: { stdout: string; stderr: string; code: number }) => void;
  const promise = new Promise<{ stdout: string; stderr: string; code: number }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const [available, requested, expected] of [
  [true, 'auto', 'whpx'],
  [false, 'auto', 'tcg'],
  [true, 'tcg', 'tcg'],
  [false, 'whpx', 'whpx'],
] as const) {
  test(`acceleration ${requested} resolves to ${expected} when WHPX availability is ${available}`, async (t) => {
    const { machines, id } = await fixture(t, available);
    machines.get(id).accelerator = requested;
    machines.exec = async () => ({ stdout: '', stderr: '', code: 0 });
    await machines.start(id);
    assert.equal((await machines.view(id)).activeAccelerator, expected);
    assert.equal(machines.get(id).accelerator, requested);
  });
}

for (const distro of ['alpine', 'debian', 'ubuntu'] as const) {
  test(`${distro} exposes a readable NoCloud seed and waits for its own initialization marker`, async (t) => {
    const { machines, id, commands } = await fixture(t);
    machines.get(id).distro = distro;
    machines.exec = async (_id, command) => {
      assert.match(command, distro === 'alpine' ? /\.bootstrap-complete/ : /instance\/boot-finished/);
      return { stdout: '', stderr: '', code: 0 };
    };
    await machines.start(id);
    const args = commands[0];
    const seed = args.find((arg) => arg.includes('seed.iso'))!;
    assert.ok(seed);
    if (distro === 'alpine') {
      assert.match(seed, /media=cdrom/);
      assert.ok(args.includes('type=1,serial=ds=nocloud'));
    } else {
      assert.match(seed, /if=virtio,format=raw/);
      assert.ok(!args.some((arg) => arg.includes('ds=nocloud')));
    }
    await eventually(() => machines.state(id) === 'running');
  });
}

test('SSH authentication alone cannot mark an unprovisioned guest ready', async (t) => {
  const { machines, id } = await fixture(t);
  let provisioned = false;
  let probes = 0;
  machines.exec = async (_id, command) => {
    assert.match(command, /test -f \/var\/lib\/cloud\/\.bootstrap-complete/);
    probes++;
    return { stdout: '', stderr: '', code: provisioned ? 0 : 1 };
  };
  await machines.start(id);
  assert.ok(probes > 0);
  assert.equal(machines.state(id), 'starting');
  provisioned = true;
  await eventually(() => machines.state(id) === 'running');
  assert.ok(probes > 1);
});

test('stopping during a readiness probe cancels it and cannot revive the guest', async (t) => {
  const { machines, id } = await fixture(t);
  const probe = deferredProbe();
  let signal: AbortSignal | undefined;
  machines.exec = async (_id, _command, _timeout, bootSignal) => {
    signal = bootSignal;
    return Promise.race([
      probe.promise,
      new Promise<never>((_resolve, reject) =>
        bootSignal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }),
      ),
    ]);
  };
  await machines.start(id);
  await machines.stop(id, true);
  assert.equal(signal?.aborted, true);
  probe.resolve({ stdout: '', stderr: '', code: 0 });
  await delay(20);
  assert.equal(machines.state(id), 'stopped');
  assert.equal(machines.live.size, 0);
});

test('a fragmented kernel panic fails immediately even if SSH later responds', async (t) => {
  const { machines, id } = await fixture(t);
  const probe = deferredProbe();
  machines.exec = async () => probe.promise;
  await machines.start(id);
  machines.log(id, '[0.123] Kernel panic - not sync');
  assert.equal(machines.state(id), 'starting');
  machines.log(id, 'ing: IO-APIC + timer does not work!\n');
  assert.equal(machines.state(id), 'error');
  assert.match((await machines.view(id)).lastError!, /Kernel panic/);
  probe.resolve({ stdout: '', stderr: '', code: 0 });
  await delay(20);
  assert.equal(machines.state(id), 'error');
});

test('an SSH peer that never sends its banner is bounded and cancellable', async (t) => {
  const { machines, id } = await fixture(t);
  machines.exec = async () => ({ stdout: '', stderr: '', code: 0 });
  await machines.start(id);
  await eventually(() => machines.state(id) === 'running');
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const live = machines.live.get(id)!;
  live.sshPort = (server.address() as { port: number }).port;
  await assert.rejects(machines.connect(id, 100), /timed out/);
  const abort = new AbortController();
  const accepted = once(server, 'connection');
  const rejected = assert.rejects(machines.connect(id, 10000, abort.signal));
  await accepted;
  abort.abort();
  await rejected;
  await eventually(() => live.clients.size === 0);
});

test('aborting or timing out a command after SSH is ready closes the session promptly', async (t) => {
  const { machines, id } = await fixture(t);
  const exec = machines.exec.bind(machines);
  machines.exec = async () => ({ stdout: '', stderr: '', code: 0 });
  await machines.start(id);
  await eventually(() => machines.state(id) === 'running');
  machines.exec = exec;
  const peers = new Set<import('ssh2').Connection>();
  const server = new SshServer({ hostKeys: [key.privateText] }, (peer) => {
    peers.add(peer);
    peer.on('error', () => {});
    peer.on('close', () => peers.delete(peer));
    peer.on('authentication', (context) => context.accept());
    peer.on('ready', () =>
      peer.on('session', (accept) => {
        accept().on('exec', (acceptCommand) => {
          const channel = acceptCommand();
          channel.on('error', () => {});
          channel.write('command started\n');
        });
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const peer of peers) peer.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const live = machines.live.get(id)!;
  live.sshPort = (server.address() as { port: number }).port;
  const abort = new AbortController();
  let started = false;
  const cancelled = assert.rejects(
    machines.exec(id, 'long command', 10000, abort.signal, () => {
      started = true;
    }),
    /已取消/,
  );
  await eventually(() => started);
  abort.abort();
  await cancelled;
  await eventually(() => live.clients.size === 0);
  await assert.rejects(machines.exec(id, 'long command', 250), /超时/);
  await eventually(() => live.clients.size === 0);
});

test('a briefly refused SSH connection retries within the original deadline', async (t) => {
  const { machines, id } = await fixture(t);
  machines.exec = async () => ({ stdout: '', stderr: '', code: 0 });
  await machines.start(id);
  await eventually(() => machines.state(id) === 'running');
  const live = machines.live.get(id)!;
  live.sshPort = await freePort();
  const peers = new Set<import('ssh2').Connection>();
  const server = new SshServer({ hostKeys: [key.privateText] }, (peer) => {
    peers.add(peer);
    peer.on('error', () => {});
    peer.on('close', () => peers.delete(peer));
    peer.on('authentication', (context) => context.accept());
  });
  t.after(async () => {
    for (const peer of peers) peer.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const connection = machines.connect(id, 2000);
  await delay(150);
  server.listen(live.sshPort, '127.0.0.1');
  await once(server, 'listening');
  const client = await connection;
  assert.equal(live.clients.size, 1, 'failed attempts release their clients');
  client.end();
  await eventually(() => live.clients.size === 0);
});

test('SSH refusal retries honor cancellation and cannot cross a VM restart', async (t) => {
  const { machines, id } = await fixture(t);
  machines.exec = async () => ({ stdout: '', stderr: '', code: 0 });
  await machines.start(id);
  await eventually(() => machines.state(id) === 'running');
  const live = machines.live.get(id)!;
  live.sshPort = await freePort();
  const abort = new AbortController();
  const cancelled = assert.rejects(machines.connect(id, 2000, abort.signal), { name: 'AbortError' });
  await delay(50);
  abort.abort();
  await cancelled;
  await eventually(() => live.clients.size === 0);
  const stopped = assert.rejects(machines.connect(id, 2000), /已停止/);
  await delay(50);
  await machines.stop(id, true);
  await machines.start(id);
  await stopped;
  assert.notEqual(machines.live.get(id), live);
});

test('interrupting a clone rekey preserves the old key until the new host identity is durable', async (t) => {
  const { machines, id } = await fixture(t);
  const pending = createSshKey();
  await writeFile(join(vmDir(id), 'identity.json'), JSON.stringify(pending));
  const authorized = new Set([key.publicText]);
  let prepared = false;
  machines.exec = async (_id, command, _timeout, signal) => {
    if (!command.includes('authorized_keys')) return { stdout: '', stderr: '', code: 0 };
    if (!command.includes('>> /root/.ssh/authorized_keys')) authorized.clear();
    authorized.add(pending.publicText);
    prepared = true;
    return new Promise((_resolve, reject) =>
      signal?.addEventListener('abort', () => reject(new Error('interrupted')), { once: true }),
    );
  };
  await machines.start(id);
  await eventually(() => prepared);
  await machines.stop(id, true);
  assert.equal(authorized.has(key.publicText), true, 'the on-disk controller key must still authenticate');
  assert.equal(await readFile(join(vmDir(id), 'id_rsa'), 'utf8'), key.privateText);
  assert.equal(
    JSON.parse(await readFile(join(vmDir(id), 'identity.json'), 'utf8')).privateText,
    pending.privateText,
  );
});

test('a completed clone rekey publishes the host key before removing guest access through the old key', async (t) => {
  const { machines, id } = await fixture(t);
  const pending = createSshKey();
  await writeFile(join(vmDir(id), 'identity.json'), JSON.stringify(pending));
  const stages: string[] = [];
  let correctOrder = true;
  machines.exec = async (_id, command) => {
    if (command.includes('authorized_keys')) {
      const stored = await readFile(join(vmDir(id), 'id_rsa'), 'utf8');
      if (command.includes('>> /root/.ssh/authorized_keys')) {
        stages.push('add');
        correctOrder &&= stored === key.privateText;
      } else {
        stages.push('remove');
        correctOrder &&= stored === pending.privateText;
      }
    }
    return { stdout: '', stderr: '', code: 0 };
  };
  await machines.start(id);
  await eventually(() => machines.state(id) === 'running');
  assert.deepEqual(stages, ['add', 'remove']);
  assert.equal(correctOrder, true);
  assert.equal(await readFile(join(vmDir(id), 'id_rsa'), 'utf8'), pending.privateText);
  await assert.rejects(readFile(join(vmDir(id), 'identity.json')), { code: 'ENOENT' });
});
