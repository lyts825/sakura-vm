import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { JobView } from '../server/jobs.ts';
import type { Machines } from '../server/machines.ts';
import { SandboxArtifacts } from '../server/sandbox-artifacts.ts';
import type { SandboxArtifact } from '../shared/sandbox.ts';

test('binary artifacts survive VM destruction, verify checksums and expire with their execution record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-artifacts-test-'));
  const run = randomUUID(),
    data = Buffer.from([0, 1, 255, 128, 10, 0]);
  let live = true;
  const machines = {
    sftp: async (_id: string, work: (ftp: unknown) => Promise<unknown>) => {
      assert.equal(live, true);
      return work({
        realpath: (path: string, callback: Function) => callback(null, path),
        lstat: (_path: string, callback: Function) =>
          callback(null, { size: data.length, isFile: () => true }),
        createReadStream: () => Readable.from([data]),
      });
    },
  } as unknown as Machines;
  const store = new SandboxArtifacts(machines, directory),
    artifacts: SandboxArtifact[] = [];
  try {
    await store.collect(
      'guest',
      run,
      '/workspace',
      ['output.bin'],
      (item) => artifacts.push(item),
      new AbortController().signal,
    );
    const job = { id: run, status: 'done', execution: { artifacts } } as JobView;
    live = false;
    const result = await store.download(job, artifacts[0].id);
    assert.deepEqual(Buffer.from(result.base64, 'base64'), data);
    await assert.rejects(store.download(job, '../outside'));
    await assert.rejects(store.download(undefined, artifacts[0].id), /记录不存在/);
    const pending = join(directory, `${run}.${randomUUID()}.bin.part`);
    const orphan = join(directory, `${run}.${randomUUID()}.bin`);
    await writeFile(pending, 'interrupted write');
    await writeFile(orphan, 'uncommitted artifact');
    await store.prune([{ ...job, status: 'running' }]);
    assert.equal((await readdir(directory)).length, 3);
    await store.prune([job]);
    assert.equal((await readdir(directory)).length, 1);
    await writeFile(join(directory, `${run}.${artifacts[0].id}.bin`), 'tampered');
    await assert.rejects(store.download(job, artifacts[0].id), /校验失败/);
    await store.prune([]);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('sakura-artifacts-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('artifact capture rejects symlink escapes and oversize files before reading or publishing', async () => {
  for (const scenario of ['escape', 'size']) {
    let reads = 0;
    const directory = await mkdtemp(join(tmpdir(), 'sakura-artifacts-test-'));
    const machines = {
      sftp: async (_id: string, work: (ftp: unknown) => Promise<unknown>) =>
        work({
          realpath: (path: string, callback: Function) =>
            callback(null, path === '/workspace' || scenario === 'size' ? path : '/etc/shadow'),
          lstat: (_path: string, callback: Function) =>
            callback(null, { size: 9 * 1024 * 1024, isFile: () => true }),
          createReadStream: () => {
            reads++;
            return Readable.from([]);
          },
        }),
    } as unknown as Machines;
    try {
      await assert.rejects(
        new SandboxArtifacts(machines, directory).collect(
          'vm',
          randomUUID(),
          '/workspace',
          ['output'],
          () => assert.fail('must not publish'),
          new AbortController().signal,
        ),
        scenario === 'escape' ? /工作目录之外/ : /8 MiB/,
      );
      assert.equal(reads, 0);
      assert.deepEqual(await readdir(directory), []);
    } finally {
      assert.equal(dirname(directory), resolve(tmpdir()));
      assert.ok(basename(directory).startsWith('sakura-artifacts-test-'));
      await rm(directory, { recursive: true, force: true });
    }
  }
});
