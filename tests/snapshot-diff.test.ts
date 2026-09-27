import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { Machines } from '../server/machines.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-snapshot-diff-test-'));
process.env.SAKURA_DATA_DIR = root;
const { SnapshotDiff, parseSnapshotManifest, compareSnapshotManifests, snapshotManifestCommand } =
  await import('../server/snapshot-diff.ts');
const { snapshotDiffInputSchema } = await import('../shared/snapshot-diff.ts');
const { vmDir } = await import('../server/model.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-snapshot-diff-test-'));
  await rm(root, { recursive: true, force: true });
});

const line = (type: 'F' | 'L', mount: string, path: string, value: string, bytes?: number) =>
  [
    type,
    Buffer.from(mount + path).toString('base64'),
    ...(bytes === undefined ? [Buffer.from(value).toString('base64')] : [String(bytes), value]),
  ].join('\t') + '\n';

test('snapshot diff validates states and paths, and parses newline-safe filenames', () => {
  const from = randomUUID();
  assert.equal(snapshotDiffInputSchema.parse({ from }).path, '/workspace');
  for (const path of ['relative', '/../etc', '/a/../b', '/a//b', '/a/', '/a\\b', '/a\nb'])
    assert.equal(snapshotDiffInputSchema.safeParse({ from, path }).success, false, path);
  assert.equal(snapshotDiffInputSchema.safeParse({ from, to: from }).success, false);
  const hash = 'a'.repeat(64);
  const before = parseSnapshotManifest(
    line('F', '/mnt/source', '/workspace/new\nline.txt', hash, 12) +
      line('L', '/mnt/source', '/workspace/link', '../target'),
    '/mnt/source',
  );
  const after = parseSnapshotManifest(
    line('F', '/mnt/compare', '/workspace/new\nline.txt', 'b'.repeat(64), 12) +
      line('F', '/mnt/compare', '/workspace/added', hash, 4),
    '/mnt/compare',
  );
  const result = compareSnapshotManifests(before, after, snapshotDiffInputSchema.parse({ from }), true);
  assert.deepEqual(result.counts, { before: 2, after: 2, added: 1, removed: 1, modified: 1 });
  assert.equal(result.modified[0].path, '/workspace/new\nline.txt');
  assert.equal(result.diskChanged, true);
  assert.equal(parseSnapshotManifest('MISSING\n', '/mnt/source').size, 0);
  assert.throws(
    () => parseSnapshotManifest(line('F', '/mnt/compare', '/escape', hash, 1), '/mnt/source'),
    /越过/,
  );
  assert.match(snapshotManifestCommand('/mnt/source', '/workspace'), /sha256sum < "\$file"/);
});

test('snapshot comparison converts the selected state, scans both read-only disks, compares sectors and persists results', async () => {
  const id = randomUUID(),
    from = randomUUID(),
    to = randomUUID();
  const calls: Array<{ tool: string; args: string[] }> = [];
  const attachments: string[][] = [];
  const hash = 'f'.repeat(64);
  const machines = {
    on: () => {},
    off: () => {},
    get: () => ({ id, name: 'source', snapshots: [{ id: from }, { id: to }] }),
    requireUnlocked: () => {},
    requireStopped: () => {},
    isBusy: () => false,
    locked: async (_id: string, work: () => Promise<unknown>) => work(),
    engine: {
      run: async (tool: string, args: string[]) => {
        calls.push({ tool, args });
        await writeFile(args.at(-1)!, 'temp disk');
        return '';
      },
      runStatus: async (tool: string, args: string[]) => {
        calls.push({ tool, args });
        return { code: 1, stdout: '', stderr: '' };
      },
    },
    withRescue: async (
      _id: string,
      signal: AbortSignal,
      _phase: unknown,
      work: (id: string, signal: AbortSignal) => Promise<unknown>,
      _diagnostic: unknown,
      ...disks: string[]
    ) => {
      attachments.push(disks);
      return work('rescue', signal);
    },
    exec: async (_id: string, command: string) => ({
      code: 0,
      stderr: '',
      stdout: command.includes('find "$root"')
        ? command.includes('/mnt/source')
          ? line('F', '/mnt/source', '/workspace/a.txt', hash, 1)
          : line('F', '/mnt/compare', '/workspace/a.txt', 'e'.repeat(64), 1)
        : '',
    }),
  } as unknown as Machines;
  const service = new SnapshotDiff(machines);
  try {
    const job = service.run(id, { from, to, path: '/workspace' });
    await service.jobs.wait(id);
    assert.equal(job.status, 'done', job.error);
    assert.equal(calls.filter((call) => call.args[0] === 'convert').length, 2);
    assert.deepEqual(calls.find((call) => call.args[0] === 'compare')?.args.slice(0, 3), [
      'compare',
      '-q',
      '-f',
    ]);
    assert.equal(attachments.length, 1);
    assert.ok(attachments[0][0].endsWith('before.qcow2'));
    assert.ok(attachments[0][1].endsWith('after.qcow2'));
    const result = await service.jobs.result(job.id!);
    assert.equal(result.counts.modified, 1);
    assert.equal(result.diskChanged, true);
    await assert.rejects(readFile(attachments[0][0]), /ENOENT/);
    await assert.rejects(readFile(attachments[0][1]), /ENOENT/);
    assert.equal(service.view(id).runs[0].id, job.id);
    assert.equal(service.view(randomUUID()).runs.length, 0);
    assert.equal(join(vmDir(id), 'disk.qcow2').includes(id), true);
  } finally {
    await service.close();
  }
});
