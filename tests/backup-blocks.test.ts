import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { Machines as MachinesType } from '../server/machines.ts';
import type { Bundles } from '../server/bundles.ts';
const root = await mkdtemp(join(tmpdir(), 'sakura-backup-blocks-'));
process.env.SAKURA_DATA_DIR = root;
const { BackupBlocks, backupBlocks } = await import('../server/backup-blocks.ts');
const { Backups } = await import('../server/backups.ts');
const { Machines } = await import('../server/machines.ts');
after(() => rm(root, { recursive: true, force: true }));
const checksum = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const signal = new AbortController().signal;
const bytes = Buffer.concat([Buffer.alloc(1024 ** 2, 1), Buffer.alloc(1024 ** 2, 2), Buffer.alloc(700, 3)]);
function sink() {
  const chunks: Buffer[] = [];
  return {
    output: new Writable({
      write(chunk, _encoding, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    }),
    value: () => Buffer.concat(chunks),
  };
}

test('content blocks deduplicate across machines, survive restart and reconstruct an identical portable file', async () => {
  const directory = join(root, 'shared'),
    store = new BackupBlocks(directory),
    vm = randomUUID(),
    peer = randomUUID();
  const a = randomUUID(),
    b = randomUUID(),
    source = join(root, 'source');
  await writeFile(source, bytes);
  await store.pack(vm, a, source, checksum(bytes), signal);
  await store.pack(peer, b, source, checksum(bytes), signal);
  const loaded = new BackupBlocks(directory),
    stats = await loaded.inspect();
  assert.equal(stats.backups, 2);
  assert.equal(stats.physicalBytes, bytes.length);
  assert.equal(stats.savedBytes, bytes.length);
  const result = sink();
  await loaded.writeTo(vm, a, checksum(bytes), result.output, signal);
  assert.deepEqual(result.value(), bytes);
  await loaded.withFile(peer, b, checksum(bytes), signal, async (path) =>
    assert.deepEqual(await readFile(path), bytes),
  );
  assert.deepEqual(await readdir(join(directory, 'materialized')), []);
  await loaded.remove(vm, a);
  assert.equal((await loaded.inspect(true)).reclaimedBytes, 0);
  await loaded.remove(peer, b);
  assert.equal((await loaded.inspect(true)).reclaimedBytes, bytes.length);
  assert.equal((await loaded.inspect()).physicalBytes, 0);
});

test('corrupted chunks, mismatched manifests and cancellation cannot publish or restore an unverified backup', async () => {
  const directory = join(root, 'damaged'),
    store = new BackupBlocks(directory),
    vm = randomUUID(),
    id = randomUUID();
  const source = join(root, 'damaged-source');
  await writeFile(source, bytes);
  await assert.rejects(store.pack(vm, randomUUID(), source, checksum(bytes), AbortSignal.abort()));
  assert.equal((await store.inspect()).backups, 0);
  const manifest = await store.pack(vm, id, source, checksum(bytes), signal);
  await assert.rejects(store.read(vm, id, 'a'.repeat(64)), /不符/);
  const first = manifest.chunks[0].sha256;
  await writeFile(join(directory, 'chunks', first.slice(0, 2), first), Buffer.alloc(1024 ** 2, 9));
  await assert.rejects(
    store.withFile(vm, id, checksum(bytes), signal, async () =>
      assert.fail('must not expose corrupt backup'),
    ),
    /校验失败/,
  );
  await assert.rejects(store.pack(vm, randomUUID(), source, checksum(bytes), signal), /损坏/);
  assert.deepEqual(await readdir(join(directory, 'materialized')), []);
  await rm(join(directory, 'chunks', first.slice(0, 2), first));
  await assert.rejects(store.inspect(true), /缺失/);
});

test('deletion and garbage collection wait until an active reconstruction releases its blocks', async () => {
  const store = new BackupBlocks(join(root, 'concurrent')),
    vm = randomUUID(),
    id = randomUUID();
  const source = join(root, 'concurrent-source');
  await writeFile(source, bytes);
  await store.pack(vm, id, source, checksum(bytes), signal);
  let release!: () => void,
    started!: () => void,
    held = false,
    removed = false;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const output = new Writable({
    write(_chunk, _encoding, cb) {
      if (held) return cb();
      held = true;
      release = () => cb();
      started();
    },
  });
  const downloading = store.writeTo(vm, id, checksum(bytes), output, signal);
  await ready;
  const removing = store.remove(vm, id).then(() => {
    removed = true;
  });
  const collecting = store.inspect(true);
  const abort = new AbortController();
  const waiting = store.pack(vm, randomUUID(), source, checksum(bytes), abort.signal);
  abort.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  await delay(20);
  assert.equal(removed, false);
  release();
  await downloading;
  await removing;
  assert.equal((await collecting).physicalBytes, 0);
});

test('backup policy stores blocks, verifies and restores them, preserves retention and never silently downgrades encryption', async () => {
  const vm = randomUUID(),
    machines = new Machines({} as any);
  machines.get = () => ({ id: vm, name: 'dedup' }) as ReturnType<MachinesType['get']>;
  const disk = Buffer.alloc(3 * 1024 ** 2, 7),
    manifest = Buffer.from(JSON.stringify({ sha256: checksum(disk) })),
    size = Buffer.alloc(4);
  size.writeUInt32BE(manifest.length);
  const bundle = Buffer.concat([Buffer.from('SAKURA01'), size, manifest, disk]);
  let imports = 0;
  const bundles = {
    export: async (_id: string, output: Writable) => pipeline(Readable.from([bundle]), output),
    import: async (_name: string, input: Readable) => {
      const chunks = [];
      for await (const chunk of input) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), bundle);
      imports++;
      return { name: 'restored' };
    },
  } as unknown as Bundles;
  const backups = new Backups(machines, bundles);
  try {
    await backups.policy(vm, { deduplicate: true, lockDays: 1 });
    await assert.rejects(backups.run(vm, 'long-test-password'), /加密/);
    await assert.rejects(backups.policy(vm, { deduplicate: true, directory: root }), /本机未加密/);
    const job = await backups.run(vm);
    await backups.jobs.wait(vm);
    assert.equal(job.status, 'done', job.error);
    const item = (await backups.view(vm)).items[0];
    assert.equal(item.storage, 'blocks');
    await assert.rejects(backups.operate(vm, item.id, 'delete'), { code: 'BACKUP_LOCKED' });
    const download = await backups.downloadable(vm, item.id);
    assert.equal(download.type, 'stream');
    const downloaded = sink();
    await download.write(downloaded.output, signal);
    assert.deepEqual(downloaded.value(), bundle);
    await backups.operate(vm, item.id, 'restore', 'restored');
    await backups.jobs.wait(vm);
    assert.equal(backups.jobs.view(vm)?.status, 'done', backups.jobs.view(vm)?.error);
    assert.equal(imports, 1);
    assert.equal((await backupBlocks().inspect()).backups, 1);
  } finally {
    await backups.close();
  }
});
