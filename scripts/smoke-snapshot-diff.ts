import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-snapshot-diff-smoke-'));
assert.equal(dirname(directory), resolve(tmpdir()));
assert.ok(basename(directory).startsWith('sakura-snapshot-diff-smoke-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { SnapshotDiff } = await import('../server/snapshot-diff.ts');
const { vmDir } = await import('../server/model.ts');
const { fileHash } = await import('../server/local-store.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const diff = new SnapshotDiff(machines);
const lines: string[] = [];
const record = (line: string) => {
  console.log(line);
  lines.push(line);
};
async function boot(id: string) {
  await machines.start(id);
  const deadline = Date.now() + 270_000;
  while (machines.state(id) !== 'running') {
    assert.equal(machines.state(id), 'starting', machines.logs.get(id));
    assert.ok(Date.now() < deadline, machines.logs.get(id));
    await delay(100);
  }
}
try {
  const source = await machines.create({ name: 'snapshot-diff-source', accelerator: 'auto' });
  await boot(source.id);
  const initial = await machines.exec(
    source.id,
    'printf before > /workspace/modified.txt; printf removed > /workspace/removed.txt; ln -s modified.txt /workspace/link; sync',
  );
  assert.equal(initial.code, 0, initial.stderr);
  await machines.stop(source.id);
  const snapshot = await machines.snapshot(source.id, 'before-edits');
  await boot(source.id);
  const edits = await machines.exec(
    source.id,
    'printf after > /workspace/modified.txt; rm /workspace/removed.txt; printf added > /workspace/added.txt; ln -sf added.txt /workspace/link; sync',
  );
  assert.equal(edits.code, 0, edits.stderr);
  await machines.stop(source.id);
  const disk = join(vmDir(source.id), 'disk.qcow2');
  const before = await fileHash(disk);
  const job = diff.run(source.id, { from: snapshot.id, to: 'current', path: '/workspace', partition: 0 });
  await diff.jobs.wait(source.id);
  record(job.log);
  if (job.status !== 'done') record(job.error || 'comparison failed');
  assert.equal(job.status, 'done', job.error);
  const result = await diff.jobs.result(job.id!);
  assert.equal(result.diskChanged, true);
  assert.ok(result.added.some((file: { path: string }) => file.path === '/workspace/added.txt'));
  assert.ok(result.removed.some((file: { path: string }) => file.path === '/workspace/removed.txt'));
  assert.ok(result.modified.some((file: { path: string }) => file.path === '/workspace/modified.txt'));
  assert.ok(result.modified.some((file: { path: string }) => file.path === '/workspace/link'));
  assert.equal(await fileHash(disk), before);
  assert.equal(machines.records.size, 1);
  assert.equal(machines.live.size, 0);
  record(
    'Real QEMU: snapshot/current sector comparison and added, removed, modified file and symlink changes passed.',
  );
  const later = await machines.snapshot(source.id, 'after-edits');
  const historical = diff.run(source.id, { from: snapshot.id, to: later.id, path: '/workspace' });
  await diff.jobs.wait(source.id);
  assert.equal(historical.status, 'done', historical.error);
  const historicalResult = await diff.jobs.result(historical.id!);
  assert.equal(historicalResult.diskChanged, true);
  assert.deepEqual(historicalResult.counts, result.counts);
  record('Real QEMU: two historical snapshots produce the same file and sector differences.');
  const unchanged = diff.run(source.id, { from: later.id, to: 'current', path: '/workspace' });
  await diff.jobs.wait(source.id);
  assert.equal(unchanged.status, 'done', unchanged.error);
  const unchangedResult = await diff.jobs.result(unchanged.id!);
  assert.equal(unchangedResult.diskChanged, false);
  assert.equal(
    unchangedResult.counts.added + unchangedResult.counts.removed + unchangedResult.counts.modified,
    0,
  );
  record('Real QEMU: unchanged snapshot/current states compare equal.');
} finally {
  await diff.close();
  await machines.close();
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/snapshot-diff-smoke.log'), lines.join('\n') + '\n');
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  assert.ok(basename(directory).startsWith('sakura-snapshot-diff-smoke-'));
  await rm(directory, { recursive: true, force: true });
}
