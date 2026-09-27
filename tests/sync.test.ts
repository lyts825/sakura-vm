import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { SFTPWrapper } from 'ssh2';
import type { Machines } from '../server/machines.ts';
import { mergeDriver } from '../shared/sync-policy.ts';

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
    onRead?: (path: string, number: number, remote: Map<string, RemoteFile>) => void;
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
        [...remote.keys(), ...directories]
          .filter((name) => name.startsWith(path + '/') && !name.slice(path.length + 1).includes('/'))
          .map((name) => ({
            filename: name.slice(path.length + 1),
            attrs: attrs(name),
          })),
      );
    },
    createReadStream(path: string) {
      openReadHandles++;
      const readNumber = ++reads;
      options.onRead?.(path, readNumber, remote);
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
    rename(from: string, to: string, cb: (error?: Error) => void) {
      if (remote.has(to)) return cb(new Error('File exists'));
      if (!remote.has(from)) return cb(missing());
      remote.set(to, remote.get(from)!);
      remote.delete(from);
      cb();
    },
    mkdir(path: string, cb: () => void) {
      directories.add(path);
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

test('deletion decisions remove exactly the selected peer and default to keeping the survivor', async (t) => {
  for (const side of ['host', 'guest'] as const) {
    const { id, host, remote, sync } = await fixture(t);
    await writeFile(join(host, 'notes.txt'), 'original');
    await sync.run(id, 'both');
    assert.equal((await finished(sync, id)).status, 'done');
    if (side === 'host') await rm(join(host, 'notes.txt'));
    else remote.delete('/workspace/notes.txt');
    const preview = await sync.preview(id);
    const action = side === 'host' ? 'delete-guest' : 'delete-host';
    assert.deepEqual(preview.changes, [{ path: 'notes.txt', action }]);
    await sync.run(id, 'both');
    assert.equal((await finished(sync, id)).status, 'done');
    if (side === 'host') assert.equal(remote.has('/workspace/notes.txt'), true);
    else assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'original');
    await sync.run(id, 'both', preview.token, { 'notes.txt': action });
    assert.equal((await finished(sync, id)).status, 'done');
    assert.equal(remote.has('/workspace/notes.txt'), false);
    await assert.rejects(readFile(join(host, 'notes.txt')), { code: 'ENOENT' });
  }
});

test('path policies constrain forced sync, conflict resolution and Linux permissions', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await writeFile(join(host, 'notes.txt'), 'private host');
  await sync.save(id, { host, guest: '/workspace', policies: [{ pattern: '*.txt', direction: 'readonly' }] });
  assert.deepEqual((await sync.preview(id)).changes, [{ path: 'notes.txt', action: 'skip' }]);
  await sync.run(id, 'push');
  assert.equal((await finished(sync, id)).status, 'done');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'original');
  await sync.save(id, {
    host,
    guest: '/workspace',
    policies: [{ pattern: '*.txt', direction: 'push', guestMode: '600' }],
  });
  const preview = await sync.preview(id);
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'pull' });
  assert.match((await finished(sync, id)).error!, /路径策略/);
  await sync.run(id, 'push');
  assert.equal((await finished(sync, id)).status, 'done');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'private host');
  assert.equal(remote.get('/workspace/notes.txt')!.mode & 0o777, 0o600);
  assert.equal(remote.get('/workspace/notes.txt')!.uid, 1000);
});

test('sync rollback restores originals, metadata, conflict copies and the shared baseline', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await sync.save(id, { host, guest: '/workspace', rollback: true, mergeText: true });
  await writeFile(join(host, 'notes.txt'), 'original');
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
  const baseline = await readFile(join(vmDir(id), 'sync-state.json'), 'utf8');
  await writeFile(join(host, 'notes.txt'), 'host edit');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('guest edit');
  const preview = await sync.preview(id);
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'both' });
  let result = await finished(sync, id);
  assert.equal(result.status, 'done', result.error);
  const point = (await sync.view(id)).history[0];
  assert.equal(point.changes, 3);
  assert.equal(point.status, 'done');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'host edit');
  await sync.rollback(id, point.id);
  result = await finished(sync, id);
  assert.equal(result.status, 'done', result.error);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'guest edit');
  assert.equal(remote.get('/workspace/notes.txt')!.mode & 0o777, 0o660);
  assert.equal(remote.get('/workspace/notes.txt')!.uid, 1000);
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'host edit');
  assert.equal(
    [...remote.keys()].some((key) => key.includes('.linux-conflict-')),
    false,
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(vmDir(id), 'sync-state.json'), 'utf8')),
    JSON.parse(baseline),
  );
  assert.equal((await sync.view(id)).history[0].status, 'rolled-back');
});

test('rollback refuses newer edits before any restoration and checks stored file hashes', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await sync.save(id, { host, guest: '/workspace', rollback: true });
  await writeFile(join(host, 'notes.txt'), 'new host');
  await sync.run(id, 'push');
  assert.equal((await finished(sync, id)).status, 'done');
  const point = (await sync.view(id)).history[0];
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('edited after sync');
  await sync.rollback(id, point.id);
  assert.match((await finished(sync, id)).error!, /同步后文件已被修改/);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'edited after sync');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('new host');
  const directory = join(vmDir(id), 'sync-history.json.d', point.id);
  const record = JSON.parse(await readFile(join(directory, 'checkpoint.json'), 'utf8'));
  await writeFile(join(directory, record.entries[0].before.sha), 'tampered');
  await sync.rollback(id, point.id);
  assert.match((await finished(sync, id)).error!, /回滚文件校验失败/);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'new host');
});

test('rollback can undo detected renames and explicit deletion without touching the originating side', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await sync.save(id, { host, guest: '/workspace', rollback: true, detectRenames: true });
  await writeFile(join(host, 'notes.txt'), 'original');
  await sync.run(id, 'both');
  await finished(sync, id);
  await rename(join(host, 'notes.txt'), join(host, 'moved.txt'));
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
  await sync.rollback(id, (await sync.view(id)).history[0].id);
  let job = await finished(sync, id);
  assert.equal(job.status, 'done', job.error);
  assert.equal(remote.has('/workspace/notes.txt'), true);
  assert.equal(remote.has('/workspace/moved.txt'), false);
  assert.equal(await readFile(join(host, 'moved.txt'), 'utf8'), 'original');
  await sync.save(id, { host, guest: '/workspace', rollback: true });
  const preview = await sync.preview(id);
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'delete-guest' });
  assert.equal((await finished(sync, id)).status, 'done');
  assert.equal(remote.has('/workspace/notes.txt'), false);
  await sync.rollback(id, (await sync.view(id)).history[0].id);
  job = await finished(sync, id);
  assert.equal(job.status, 'done', job.error);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'original');
  assert.equal(remote.has('/workspace/moved.txt'), false);
});

test('unique unchanged renames move the peer in either direction and ambiguous matches remain decisions', async (t) => {
  for (const side of ['host', 'guest'] as const) {
    const { id, host, remote, sync } = await fixture(t);
    await sync.save(id, { host, guest: '/workspace', detectRenames: true });
    await writeFile(join(host, 'notes.txt'), 'original');
    await sync.run(id, 'both');
    assert.equal((await finished(sync, id)).status, 'done');
    if (side === 'host') await rename(join(host, 'notes.txt'), join(host, 'renamed.txt'));
    else {
      remote.set('/workspace/renamed.txt', remote.get('/workspace/notes.txt')!);
      remote.delete('/workspace/notes.txt');
    }
    const preview = await sync.preview(id);
    assert.deepEqual(preview.changes, [
      { from: 'notes.txt', path: 'renamed.txt', action: side === 'host' ? 'rename-guest' : 'rename-host' },
    ]);
    await sync.run(id, 'both', preview.token);
    const result = await finished(sync, id);
    assert.equal(result.status, 'done', result.error);
    assert.equal(remote.has('/workspace/notes.txt'), false);
    await assert.rejects(readFile(join(host, 'notes.txt')), { code: 'ENOENT' });
    assert.equal(await readFile(join(host, 'renamed.txt'), 'utf8'), 'original');
    assert.equal(remote.get('/workspace/renamed.txt')!.mode & 0o777, 0o660);
    assert.equal((await sync.preview(id)).changes.length, 0);
  }
  const { detectSyncRenames } = await import('../shared/sync-policy.ts');
  assert.deepEqual(
    detectSyncRenames(
      new Map([['new', 'x']]),
      new Map([
        ['a', 'x'],
        ['b', 'x'],
      ]),
      { a: 'x', b: 'x' },
    ),
    [],
  );
});

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

test('merge drivers apply the first matching rule to binary conflicts and allow preview overrides', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  assert.equal(mergeDriver('notes.txt', [
    { pattern: '*.txt', mode: 'manual' },
    { pattern: 'notes.txt', mode: 'prefer-host' },
  ])?.mode, 'manual');
  await sync.save(id, { host, guest: '/workspace', drivers: [
    { pattern: '*.txt', mode: 'prefer-host' },
  ] });
  const hostBytes = Buffer.from([0, 1, 2, 3]);
  await writeFile(join(host, 'notes.txt'), hostBytes);
  const preview = await sync.preview(id);
  assert.deepEqual(preview.changes, [{
    path: 'notes.txt', action: 'conflict', driver: 'prefer-host', suggestedDecision: 'push',
  }]);
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'skip' });
  assert.equal((await finished(sync, id)).status, 'done');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'original');
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
  assert.deepEqual(remote.get('/workspace/notes.txt')!.bytes, hostBytes);
  assert.deepEqual((await sync.config(id))?.drivers, [{ pattern: '*.txt', mode: 'prefer-host' }]);
});

test('keep-both driver preserves binary versions and stale driver previews cannot be applied', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await sync.save(id, { host, guest: '/workspace', drivers: [
    { pattern: '*.txt', mode: 'keep-both' },
  ] });
  await writeFile(join(host, 'notes.txt'), Buffer.from([0, 10, 20]));
  const preview = await sync.preview(id);
  assert.equal(preview.changes[0].suggestedDecision, 'both');
  await sync.save(id, { host, guest: '/workspace', drivers: [
    { pattern: '*.txt', mode: 'prefer-guest' },
  ] });
  await sync.run(id, 'both', preview.token);
  assert.match((await finished(sync, id)).error || '', /重新预览/);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'original');
  await sync.save(id, { host, guest: '/workspace', drivers: [
    { pattern: '*.txt', mode: 'keep-both' },
  ] });
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
  assert.deepEqual(remote.get('/workspace/notes.txt')!.bytes, Buffer.from([0, 10, 20]));
  const backup = [...remote.keys()].find((path) => path.includes('.linux-conflict-'))!;
  assert.equal(remote.get(backup)!.bytes.toString(), 'original');
  assert.equal(await readFile(join(host, backup.split('/').at(-1)!), 'utf8'), 'original');
});

test('automatic text merge combines independent edits and retains overlapping or binary changes', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await assert.rejects(sync.save(id, { host, guest: '/workspace', drivers: [
    { pattern: '*.txt', mode: 'merge-text' },
  ] }), /需要启用共同文本版本/);
  await sync.save(id, { host, guest: '/workspace', mergeText: true, drivers: [
    { pattern: '*.txt', mode: 'merge-text' },
  ] });
  const base = 'one\ntwo\nthree\n';
  await writeFile(join(host, 'notes.txt'), base);
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from(base);
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
  await writeFile(join(host, 'notes.txt'), 'ONE\ntwo\nthree\n');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('one\ntwo\nTHREE\n');
  assert.equal((await sync.preview(id)).changes[0].suggestedDecision, 'merge');
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'ONE\ntwo\nTHREE\n');
  await writeFile(join(host, 'notes.txt'), 'host\n');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('guest\n');
  await sync.run(id, 'both');
  assert.match((await finished(sync, id)).log, /重叠修改/);
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'host\n');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'guest\n');
  await writeFile(join(host, 'notes.txt'), Buffer.from([0, 4, 5]));
  await sync.run(id, 'both');
  assert.match((await finished(sync, id)).log, /二进制文件/);
  assert.deepEqual(await readFile(join(host, 'notes.txt')), Buffer.from([0, 4, 5]));
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'guest\n');
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

test('manual sync merge reads reviewed sides and commits only against the current preview', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await sync.save(id, { host, guest: '/workspace', mergeText: true, rollback: true });
  await writeFile(join(host, 'notes.txt'), 'one\ntwo\n');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('one\ntwo\n');
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
  await writeFile(join(host, 'notes.txt'), 'ONE\ntwo\n');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('UNO\ntwo\n');
  const preview = await sync.preview(id);
  assert.deepEqual(preview.changes, [{ path: 'notes.txt', action: 'conflict' }]);
  const context = await sync.mergePreview(id, 'notes.txt', preview.token);
  assert.deepEqual(context, {
    path: 'notes.txt', token: preview.token,
    base: 'one\ntwo\n', ours: 'ONE\ntwo\n', theirs: 'UNO\ntwo\n',
  });
  await assert.rejects(sync.run(id, 'both', preview.token, { 'notes.txt': 'manual' }),
    /缺少已审阅的文本内容/);
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'manual' },
    { 'notes.txt': 'ONE + UNO\ntwo\n' });
  const merged = await finished(sync, id);
  assert.equal(merged.status, 'done', merged.error);
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'ONE + UNO\ntwo\n');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'ONE + UNO\ntwo\n');
  assert.equal(remote.get('/workspace/notes.txt')!.uid, 1000);
  await writeFile(join(host, 'notes.txt'), 'new host\n');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('new guest\n');
  const stale = await sync.preview(id);
  await sync.mergePreview(id, 'notes.txt', stale.token);
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('changed again\n');
  await assert.rejects(sync.mergePreview(id, 'notes.txt', stale.token), /重新预览/);
  await sync.run(id, 'both', stale.token, { 'notes.txt': 'manual' },
    { 'notes.txt': 'stale result\n' });
  assert.match((await finished(sync, id)).error!, /重新预览/);
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'new host\n');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'changed again\n');
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
