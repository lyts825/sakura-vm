import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { SFTPWrapper } from 'ssh2';
import type { Machines } from '../server/machines.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-sync-test-'));
process.env.SAKURA_DATA_DIR = join(root, 'data');
const { vmDir } = await import('../server/model.ts');
const { FolderSync } = await import('../server/sync.ts');
after(() => rm(root, { recursive: true, force: true }));

type RemoteFile = { bytes: Buffer; mode: number; uid: number; gid: number };
async function fixture(
  t: TestContext,
  options: {
    failMetadata?: boolean;
    failReadClose?: boolean;
    disconnectAfterRead?: number;
    cancelOnWrite?: boolean;
  } = {},
) {
  const id = randomUUID();
  const host = join(root, id);
  await mkdir(host);
  await mkdir(vmDir(id), { recursive: true });
  const remote = new Map<string, RemoteFile>([
    ['/workspace/notes.txt', { bytes: Buffer.from('original'), mode: 0o100660, uid: 1000, gid: 1001 }],
  ]);
  const directories = new Set(['/workspace']);
  let openReadHandles = 0;
  let reads = 0;
  let closedBeforeReadHandles = false;
  const transport = new AbortController();
  const missing = () => Object.assign(new Error('No such file'), { code: 2 });
  const attrs = (path: string) => ({
    size: remote.get(path)?.bytes.length || 0,
    ...remote.get(path),
    mode: remote.get(path)?.mode || 0o40755,
    isFile: () => remote.has(path),
    isDirectory: () => directories.has(path),
  });
  const ftp = {
    lstat(path: string, cb: (error: Error | undefined, attrs?: unknown) => void) {
      cb(remote.has(path) || directories.has(path) ? undefined : missing(), attrs(path));
    },
    readdir(path: string, cb: (error: Error | undefined, entries: unknown[]) => void) {
      cb(
        undefined,
        [...remote.keys()]
          .filter((name) => name.startsWith(path + '/'))
          .map((name) => ({
            filename: name.slice(path.length + 1),
            attrs: attrs(name),
          })),
      );
    },
    createReadStream(path: string) {
      openReadHandles++;
      const readNumber = ++reads;
      const stream = new Readable({
        autoDestroy: false,
        emitClose: false,
        read() {
          this.push(remote.get(path)!.bytes);
          this.push(null);
        },
        destroy(error, cb) {
          setImmediate(() => {
            openReadHandles--;
            const failure = error || (options.failReadClose ? new Error('read handle close failed') : null);
            cb(failure);
            if (!failure) {
              this.emit('close');
              if (readNumber === options.disconnectAfterRead)
                transport.abort(new Error('SFTP connection closed'));
            }
          });
        },
      });
      stream.on('end', () => stream.destroy());
      return stream;
    },
    createWriteStream(path: string, settings: { flags: string; mode: number }) {
      assert.equal(settings.flags, 'wx');
      assert.equal(remote.has(path), false);
      remote.set(path, { bytes: Buffer.alloc(0), mode: settings.mode & ~0o022, uid: 0, gid: 0 });
      return new Writable({
        write(chunk: Buffer, _encoding, cb) {
          const file = remote.get(path)!;
          file.bytes = Buffer.concat([file.bytes, chunk]);
          if (options.cancelOnWrite) sync.jobs.cancel(id);
          cb();
        },
      });
    },
    chown(path: string, uid: number, gid: number, cb: (error?: Error) => void) {
      if (options.failMetadata) return cb(new Error('metadata failed'));
      Object.assign(remote.get(path)!, { uid, gid });
      cb();
    },
    chmod(path: string, mode: number, cb: () => void) {
      remote.get(path)!.mode = 0o100000 | mode;
      cb();
    },
    ext_openssh_rename(from: string, to: string, cb: () => void) {
      remote.set(to, remote.get(from)!);
      remote.delete(from);
      cb();
    },
    unlink(path: string, cb: () => void) {
      if (!transport.signal.aborted) remote.delete(path);
      cb();
    },
  } as unknown as SFTPWrapper;
  const machines = Object.assign(new EventEmitter(), {
    records: new Map([[id, {}]]),
    get: () => ({}),
    state: () => 'running',
    locked: async (_key: string, work: () => Promise<unknown>) => work(),
    sftp: async (
      _id: string,
      work: (ftp: SFTPWrapper, signal?: AbortSignal) => Promise<unknown>,
      signal?: AbortSignal,
    ) => {
      const abort = () => transport.abort(signal?.reason);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        return await work(ftp, transport.signal);
      } finally {
        signal?.removeEventListener('abort', abort);
        closedBeforeReadHandles ||= openReadHandles > 0;
      }
    },
  }) as unknown as Machines;
  const sync = new FolderSync(machines);
  t.after(() => sync.close());
  await sync.save(id, { host, guest: '/workspace' });
  return { id, host, remote, machines, sync, closedBeforeReadHandles: () => closedBeforeReadHandles };
}

async function finished(sync: InstanceType<typeof FolderSync>, id: string) {
  const deadline = Date.now() + 5000;
  while (sync.jobs.view(id)?.status === 'running') {
    assert.ok(Date.now() < deadline, 'sync job did not finish');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return sync.jobs.view(id)!;
}

test('sync preview is read-only and stale previews cannot overwrite subsequent changes', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await writeFile(join(host, 'notes.txt'), 'host edit');
  const preview = await sync.preview(id);
  assert.deepEqual(preview.changes, [{ path: 'notes.txt', action: 'conflict' }]);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'original');
  await assert.rejects(readFile(join(vmDir(id), 'sync-state.json')), { code: 'ENOENT' });
  await writeFile(join(host, 'notes.txt'), 'newer host edit');
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'pull' });
  assert.match((await finished(sync, id)).error!, /重新预览/);
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'newer host edit');
});

test('offline sync requests survive restart, obey windows, retry failures and can be cancelled', async (t) => {
  const { id, host, remote, machines, sync } = await fixture(t);
  let online = false;
  machines.state = () => (online ? 'running' : 'stopped');
  await sync.queue(id);
  await sync.tick();
  assert.equal((await sync.view(id)).queue?.attempts, 0);
  await sync.close();
  const restarted = new FolderSync(machines);
  t.after(() => restarted.close());
  assert.ok((await restarted.view(id)).queue);
  online = true;
  await restarted.save(id, {
    host,
    guest: '/workspace',
    window: { days: [1], start: '09:00', end: '10:00', timeZone: 'UTC' },
  });
  const monday = Date.parse('2026-09-28T09:30:00Z');
  await restarted.tick(Date.parse('2026-09-28T11:00:00Z'));
  assert.equal(restarted.jobs.view(id), null);
  const originalSftp = machines.sftp;
  machines.sftp = async () => {
    throw new Error('temporary network failure');
  };
  await restarted.tick(monday);
  assert.equal((await finished(restarted, id)).status, 'error');
  await restarted.tick(monday + 1000);
  assert.match((await restarted.view(id)).queue!.lastError!, /temporary network failure/);
  assert.equal((await restarted.view(id)).queue?.attempts, 1);
  machines.sftp = originalSftp;
  await restarted.tick(monday + 40000);
  assert.equal((await finished(restarted, id)).status, 'done');
  await restarted.tick(monday + 50000);
  assert.equal((await restarted.view(id)).queue, null);
  assert.equal(
    await readFile(join(host, 'notes.txt'), 'utf8'),
    remote.get('/workspace/notes.txt')!.bytes.toString(),
  );
  await restarted.queue(id);
  await restarted.queue(id, true);
  assert.equal((await restarted.view(id)).queue, null);
});

test('maintenance windows prevent new automatic sync without cancelling manual work', async (t) => {
  const { id, host, sync } = await fixture(t);
  const { saveMaintenancePolicy } = await import('../server/automation-policy.ts');
  await sync.save(id, { host, guest: '/workspace', auto: true });
  await saveMaintenancePolicy(id, {
    enabled: true,
    windows: [{ days: [1], start: '00:00', end: '00:00', timeZone: 'UTC' }],
  });
  await sync.tick(Date.parse('2026-09-28T10:00:00Z'));
  assert.equal(sync.jobs.view(id), null);
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
});
test('per-file conflict resolution keeps both versions on both sides', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await writeFile(join(host, 'notes.txt'), 'host edit');
  const preview = await sync.preview(id);
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'both' });
  const result = await finished(sync, id);
  assert.equal(result.status, 'done', result.error);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'host edit');
  const backup = [...remote.keys()].find((v) => v.includes('.linux-conflict-'))!;
  assert.equal(remote.get(backup)!.bytes.toString(), 'original');
  assert.equal(await readFile(join(host, backup.split('/').at(-1)!), 'utf8'), 'original');
});

test('three-way sync uses a persisted common version and preserves overlapping changes', async (t) => {
  const { id, host, remote, sync, closedBeforeReadHandles } = await fixture(t);
  await sync.save(id, { host, guest: '/workspace', mergeText: true });
  const base = '\ufeffone\ntwo\nthree\n';
  await writeFile(join(host, 'notes.txt'), base);
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from(base);
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
  const saved = JSON.parse(await readFile(join(vmDir(id), 'sync-base.json'), 'utf8'));
  assert.equal(saved['notes.txt'], base);
  await writeFile(join(host, 'notes.txt'), '\ufeffONE\ntwo\nthree\n');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('\ufeffone\ntwo\nTHREE\n');
  const preview = await sync.preview(id);
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'merge' });
  const merged = await finished(sync, id);
  assert.equal(merged.status, 'done', merged.error);
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), '\ufeffONE\ntwo\nTHREE\n');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), '\ufeffONE\ntwo\nTHREE\n');
  assert.equal(remote.get('/workspace/notes.txt')!.mode, 0o100660);
  assert.equal(remote.get('/workspace/notes.txt')!.uid, 1000);
  await writeFile(join(host, 'notes.txt'), 'host\n');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('guest\n');
  const conflicted = await sync.preview(id);
  await sync.run(id, 'both', conflicted.token, { 'notes.txt': 'merge' });
  assert.match((await finished(sync, id)).log, /重叠修改/);
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'host\n');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'guest\n');
  assert.equal(closedBeforeReadHandles(), false);
  await sync.save(id, { host, guest: '/workspace', mergeText: false });
  await assert.rejects(readFile(join(vmDir(id), 'sync-base.json')), { code: 'ENOENT' });
});

test('three-way sync rejects a tampered baseline without replacing either side', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await sync.save(id, { host, guest: '/workspace', mergeText: true });
  await writeFile(join(host, 'notes.txt'), 'original');
  await sync.run(id, 'both');
  await finished(sync, id);
  await writeFile(join(vmDir(id), 'sync-base.json'), JSON.stringify({ 'notes.txt': 'tampered' }));
  await writeFile(join(host, 'notes.txt'), 'host');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('guest');
  const preview = await sync.preview(id);
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'merge' });
  assert.equal((await finished(sync, id)).status, 'error');
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'host');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'guest');
});

test('folder sync preserves guest ownership and full permissions when replacing an existing file', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await writeFile(join(host, 'notes.txt'), 'updated');
  await sync.run(id, 'push');
  const result = await finished(sync, id);
  assert.equal(result.status, 'done', result.error);
  assert.deepEqual(remote.get('/workspace/notes.txt'), {
    bytes: Buffer.from('updated'),
    mode: 0o100660,
    uid: 1000,
    gid: 1001,
  });
  assert.equal(remote.size, 1);
});

test('folder sync leaves the original intact when replacement metadata cannot be preserved', async (t) => {
  const { id, host, remote, sync } = await fixture(t, { failMetadata: true });
  await writeFile(join(host, 'notes.txt'), 'updated');
  await sync.run(id, 'push');
  const result = await finished(sync, id);
  assert.equal(result.status, 'error');
  assert.match(result.error!, /metadata failed/);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'original');
  assert.equal(remote.size, 1);
  await assert.rejects(readFile(join(vmDir(id), 'sync-state.json')), { code: 'ENOENT' });
});

test('folder sync releases the machine lifecycle observer on shutdown', async (t) => {
  const { machines, sync } = await fixture(t);
  assert.equal(machines.listenerCount('change'), 1);
  await sync.close();
  assert.equal(machines.listenerCount('change'), 0);
});

test('folder sync waits for the final read handle to close before releasing SSH', async (t) => {
  const { id, host, sync, closedBeforeReadHandles } = await fixture(t);
  await writeFile(join(host, 'notes.txt'), 'original');
  await sync.run(id, 'both');
  const result = await finished(sync, id);
  assert.equal(result.status, 'done', result.error);
  assert.equal(closedBeforeReadHandles(), false);
});

test('folder sync reports delayed read handle closure failures without publishing comparison state', async (t) => {
  const { id, host, sync } = await fixture(t, { failReadClose: true });
  await writeFile(join(host, 'notes.txt'), 'original');
  await sync.run(id, 'both');
  const result = await finished(sync, id);
  assert.equal(result.status, 'error');
  assert.match(result.error!, /read handle close failed/);
  await assert.rejects(readFile(join(vmDir(id), 'sync-state.json')), { code: 'ENOENT' });
});

test('folder sync does not publish a downloaded host file after the SFTP connection closes', async (t) => {
  const { id, host, sync } = await fixture(t, { disconnectAfterRead: 2 });
  await sync.run(id, 'pull');
  const result = await finished(sync, id);
  assert.equal(result.status, 'error');
  assert.match(result.error!, /connection closed|aborted/);
  await assert.rejects(readFile(join(host, 'notes.txt')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(vmDir(id), 'sync-state.json')), { code: 'ENOENT' });
});

test('cancelled folder uploads clean their temporary file through the live SFTP connection', async (t) => {
  const { id, host, remote, sync } = await fixture(t, { cancelOnWrite: true });
  await writeFile(join(host, 'notes.txt'), 'updated');
  await sync.run(id, 'push');
  const result = await finished(sync, id);
  assert.equal(result.status, 'cancelled');
  assert.equal(remote.size, 1);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'original');
});
