import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Downloads as DownloadsType } from '../server/downloads.ts';
import type { Machines } from '../server/machines.ts';
import type { Files } from '../server/files.ts';
import type { Bundles } from '../server/bundles.ts';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = await mkdtemp(join(tmpdir(), 'sakura-downloads-'));
process.env.SAKURA_DATA_DIR = root;
const { DownloadTickets, Downloads } = await import('../server/downloads.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-downloads-'));
  await rm(root, { recursive: true, force: true });
});

test('download tickets are single-use, expire, bind one target and bound abandoned requests', () => {
  let now = 1000;
  const tickets = new DownloadTickets(() => now);
  const target = { id: 'vm', type: 'file' as const, path: '/workspace/秘密.bin', name: '秘密.bin' };
  const first = tickets.issue(target);
  assert.match(first.url, /^\/api\/downloads\/[a-f0-9]{64}$/);
  target.path = '/etc/other';
  const key = first.url.split('/').at(-1)!;
  assert.deepEqual(tickets.take(key), {
    id: 'vm',
    type: 'file',
    path: '/workspace/秘密.bin',
    name: '秘密.bin',
  });
  assert.throws(() => tickets.take(key), /失效/);
  const expired = tickets.issue(target);
  now = expired.expiresAt;
  assert.throws(() => tickets.take(expired.url.split('/').at(-1)!), /失效/);
  for (let i = 0; i < 64; i++) tickets.issue(target);
  assert.throws(() => tickets.issue(target), /过多/);
  now += 60000;
  const fresh = tickets.issue(target);
  tickets.clear();
  assert.throws(() => tickets.take(fresh.url.split('/').at(-1)!), /失效/);
});

function fixture() {
  const bytes = Buffer.from([0, 255, 10, ...Buffer.from('中文')]);
  const machines = { get: () => ({ name: 'test' }), requireStopped: () => {} } as unknown as Machines;
  const files = {
    info: async () => ({ size: bytes.length }),
    download: async (_id: string, path: string, res: ServerResponse, headers: (size: number) => void) => {
      assert.equal(path, '/workspace/秘密.bin');
      headers(bytes.length);
      res.end(bytes);
    },
  } as unknown as Files;
  const bundles = {
    export: async () => {
      throw new Error('Unexpected export');
    },
  } as unknown as Bundles;
  return { bytes, machines, files, downloads: new Downloads(machines, { files, bundles }) };
}
async function server(t: TestContext, downloads: DownloadsType) {
  const http = createServer(async (req, res) => {
    try {
      if (!(await downloads.route(req, res, new URL(req.url!, 'http://localhost')))) res.writeHead(404).end();
    } catch (error: any) {
      if (!res.headersSent) res.writeHead(error.status || 500);
      res.end(error.message);
    }
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  t.after(async () => {
    await downloads.close();
    http.closeAllConnections();
    await new Promise<void>((done) => http.close(() => done()));
  });
  return `http://127.0.0.1:${(http.address() as { port: number }).port}`;
}

test('native download streams original binary bytes, ignores path substitution and rejects replay', async (t) => {
  const { downloads, bytes } = fixture();
  const base = await server(t, downloads);
  const { url } = await downloads.issue('vm', { type: 'file', path: '/workspace/秘密.bin' });
  assert.equal((await fetch(base + url, { method: 'POST' })).status, 405);
  const response = await fetch(base + url + '?path=/etc/other');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-disposition')!, /%E7%A7%98/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal((await fetch(base + url)).status, 410);
  assert.equal((await fetch(base + url + '/extra')).status, 404);
});

test('preflight rejects failed downloads and export while running without issuing a capability', async () => {
  const { downloads, files, machines } = fixture();
  files.info = async () => {
    throw new Error('file unavailable');
  };
  await assert.rejects(downloads.issue('vm', { type: 'file', path: '/missing' }), /file unavailable/);
  machines.requireStopped = () => {
    throw new Error('running');
  };
  await assert.rejects(downloads.issue('vm', { type: 'export' }), /running/);
  await assert.rejects(downloads.issue('vm', { type: 'export', path: '/etc/other' }));
  downloads.close();
  await assert.rejects(downloads.issue('vm', { type: 'export' }), /关闭/);
});

test('generated backup downloads only finish after integrity verification and reject an invalid final hash', async (t) => {
  const { downloads } = fixture(),
    base = await server(t, downloads);
  for (const valid of [true, false]) {
    const bytes = Buffer.alloc(1024, 7);
    const ticket = downloads.issueStream('vm', {
      name: 'backup.sakura',
      bytes: bytes.length,
      write: async (output, signal) =>
        pipeline(
          Readable.from(
            (async function* () {
              yield bytes;
              await new Promise((resolve) => setTimeout(resolve, 20));
              if (!valid) throw new Error('whole-file hash mismatch');
            })(),
          ),
          output,
          { signal },
        ),
    });
    const response = await fetch(base + ticket.url);
    assert.equal(response.headers.get('content-length'), null);
    if (valid) assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    else await assert.rejects(response.arrayBuffer());
    assert.equal((await fetch(base + ticket.url)).status, 410);
  }
});

test('disconnect and shutdown cancel active download work', async () => {
  for (const trigger of ['disconnect', 'shutdown']) {
    const { downloads, files } = fixture();
    const response = Object.assign(new EventEmitter(), {
      writableFinished: false,
      destroyed: false,
    }) as unknown as ServerResponse;
    let activeSignal: AbortSignal | undefined;
    files.download = async (_id, _path, _res, _headers, signal) => {
      activeSignal = signal;
      await new Promise<void>((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }),
      );
    };
    const task = downloads.send(
      { id: 'vm', type: 'file', path: '/workspace/秘密.bin', name: '秘密.bin' },
      response,
    );
    const cancelled = assert.rejects(task, { name: 'AbortError' });
    if (trigger === 'disconnect') response.emit('close');
    else downloads.close();
    await cancelled;
    assert.equal(activeSignal?.aborted, true);
    assert.equal(response.listenerCount('close'), 0);
    downloads.close();
  }
});

test('shutdown waits for aborted download cleanup before releasing the runtime', async () => {
  const { downloads, files } = fixture();
  const response = Object.assign(new EventEmitter(), {
    writableFinished: false,
    destroyed: false,
  }) as unknown as ServerResponse;
  let cleanup!: () => void;
  const cleaned = new Promise<void>((resolve) => {
    cleanup = resolve;
  });
  files.download = async (_id, _path, _res, _headers, signal) => {
    await new Promise<void>((resolve) => signal!.addEventListener('abort', () => resolve(), { once: true }));
    await cleaned;
    signal!.throwIfAborted();
  };
  const operation = assert.rejects(
    downloads.send({ id: 'vm', type: 'file', path: '/workspace/秘密.bin', name: '秘密.bin' }, response),
    { name: 'AbortError' },
  );
  let closed = false;
  const closing = downloads.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  cleanup();
  await Promise.all([operation, closing]);
  assert.equal(closed, true);
});
