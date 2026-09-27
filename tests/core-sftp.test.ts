import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import ssh2, { type Connection, type SFTPWrapper } from 'ssh2';
import type { Engine } from '../server/runtime.ts';
import { createSshKey } from '../server/seed.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-core-sftp-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
const key = createSshKey();
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-core-sftp-'));
  await rm(root, { recursive: true, force: true });
});

async function fixture(t: TestContext, ready: (ftp: SFTPWrapper, peer: Connection) => void) {
  const peers = new Set<Connection>();
  const server = new ssh2.Server({ hostKeys: [key.privateText] }, (peer) => {
    peers.add(peer);
    peer.on('error', () => {});
    peer.on('close', () => peers.delete(peer));
    peer.on('authentication', (context) => context.accept());
    peer.on('ready', () =>
      peer.on('session', (accept) => {
        accept().on('sftp', (acceptSftp) => ready(acceptSftp(), peer));
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const machines = new Machines({} as Engine);
  await machines.init();
  const id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'sftp-test' }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  await mkdir(vmDir(id));
  await writeFile(join(vmDir(id), 'id_rsa'), key.privateText);
  const live = {
    status: 'running' as const,
    accelerator: 'tcg' as const,
    startedAt: new Date().toISOString(),
    sshPort: (server.address() as { port: number }).port,
    qmpPort: 0,
    agentPort: 0,
    serialPort: 0,
    abort: new AbortController(),
    bootAbort: new AbortController(),
    done: Promise.resolve(),
    clients: new Set<import('ssh2').Client>(),
  };
  machines.live.set(id, live);
  t.after(async () => {
    for (const client of live.clients) client.destroy();
    for (const peer of peers) peer.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { machines, id, live };
}

async function rejectionWithin(operation: Promise<unknown>) {
  const result = await Promise.race([
    operation.then(
      () => 'resolved',
      (error: unknown) => error,
    ),
    delay(1000, 'pending', { ref: false }),
  ]);
  assert.ok(result instanceof Error, `SFTP operation remained ${String(result)}`);
  return result;
}

test('an upload disconnect rejects even when cleanup queues a request on the closed SFTP channel', async (t) => {
  const { machines, id } = await fixture(t, (ftp, peer) => {
    ftp.on('LSTAT', (request) => ftp.status(request, 2));
    ftp.on('OPEN', (request) => ftp.handle(request, Buffer.from('file')));
    ftp.on('FSETSTAT', (request) => ftp.status(request, 0));
    ftp.on('WRITE', () => peer.end());
  });
  await rejectionWithin(machines.writeGuestFile(id, '/workspace/disconnected.txt', 'content', false));
});

test('cancellation settles SFTP work even while it is awaiting a cleanup callback', async (t) => {
  const { machines, id } = await fixture(t, () => {});
  const abort = new AbortController();
  const operation = machines.sftp(
    id,
    async (ftp) => {
      queueMicrotask(() => abort.abort());
      try {
        await new Promise<void>((resolve, reject) =>
          ftp.lstat('/workspace/file', (error) => (error ? reject(error) : resolve())),
        );
      } finally {
        await new Promise<void>((resolve) => ftp.unlink('/workspace/temp', () => resolve()));
      }
    },
    abort.signal,
  );
  assert.equal((await rejectionWithin(operation)).name, 'AbortError');
});

test('SFTP protocol errors reject the operation without an unhandled error event', async (t) => {
  const { machines, id } = await fixture(t, () => {});
  let handled = false;
  const operation = machines.sftp(id, async (ftp) => {
    queueMicrotask(() => {
      handled = ftp.listenerCount('error') > 0;
      // Keep the regression process alive when testing the broken implementation.
      if (!handled) ftp.on('error', () => {});
      ftp.emit('error', new Error('malformed SFTP response'));
    });
    return new Promise<never>(() => {});
  });
  const error = await rejectionWithin(operation);
  assert.equal(handled, true);
  assert.match(error.message, /malformed SFTP response/);
});

test('SFTP disconnect signals local work before rejecting the enclosing operation', async (t) => {
  let disconnect!: () => void;
  const { machines, id } = await fixture(t, (_ftp, peer) => {
    disconnect = () => peer.end();
  });
  let connectionSignal: AbortSignal | undefined;
  let finishLocal!: () => void;
  let cleaned = false;
  let committed = false;
  const operation = machines.sftp(id, async (_ftp, transportSignal) => {
    connectionSignal = transportSignal;
    disconnect();
    try {
      await new Promise<void>((resolve) => {
        finishLocal = resolve;
      });
      transportSignal?.throwIfAborted();
      committed = true;
    } finally {
      cleaned = true;
    }
  });
  await rejectionWithin(operation);
  finishLocal();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(connectionSignal?.aborted, true);
  assert.equal(committed, false);
  assert.equal(cleaned, true);
});
