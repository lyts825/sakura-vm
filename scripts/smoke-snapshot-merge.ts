import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-snapshot-merge-smoke-'));
assert.equal(dirname(directory), resolve(tmpdir()));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { Bundles } = await import('../server/bundles.ts');
const { SnapshotMerge } = await import('../server/snapshot-merge.ts');
const { vmDir } = await import('../server/model.ts');
const { fileHash } = await import('../server/local-store.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const bundles = new Bundles(machines);
const merge = new SnapshotMerge(machines, bundles);
const lines: string[] = [];
const record = (line: string) => { console.log(line); lines.push(line); };
async function boot(id: string) {
  await machines.start(id);
  const deadline = Date.now() + 270_000;
  while (machines.state(id) !== 'running') {
    assert.equal(machines.state(id), 'starting', machines.logs.get(id));
    assert.ok(Date.now() < deadline, machines.logs.get(id));
    await delay(100);
  }
}
async function command(id: string, text: string) {
  const result = await machines.exec(id, text);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}
try {
  const source = await machines.create({ name: 'merge-source', accelerator: 'auto' });
  await boot(source.id);
  await command(source.id,
    'printf base > /workspace/conflict.txt; printf remove > /workspace/delete.txt; sync');
  await machines.stop(source.id);
  const snapshot = await machines.snapshot(source.id, 'branch-point');
  const branch = await bundles.clone(source.id, 'merge-branch', snapshot.id);
  assert.equal(branch.branchOrigin?.sourceVmId, source.id);
  assert.equal(branch.branchOrigin?.snapshotId, snapshot.id);
  assert.equal(await fileHash(join(vmDir(branch.id), 'disk.qcow2')),
    await fileHash(join(vmDir(branch.id), 'branch-base.qcow2')));
  await boot(source.id);
  await command(source.id,
    'printf target > /workspace/conflict.txt; printf original > /workspace/target.txt; sync');
  await machines.stop(source.id);
  await boot(branch.id);
  await command(branch.id,
    'printf branch > /workspace/conflict.txt; printf merged > /workspace/branch.txt; rm /workspace/delete.txt; ln -s branch.txt /workspace/branch-link; sync');
  await machines.stop(branch.id);
  const sourceHash = await fileHash(join(vmDir(source.id), 'disk.qcow2'));
  const branchHash = await fileHash(join(vmDir(branch.id), 'disk.qcow2'));
  const preview = merge.run(branch.id, { mode: 'preview', path: '/workspace', partition: 0 });
  await merge.jobs.wait(branch.id);
  assert.equal(preview.status, 'done', preview.error + '\n' + preview.log);
  const previewResult = await merge.jobs.result(preview.id!);
  assert.deepEqual(previewResult.conflicts, ['/workspace/conflict.txt']);
  assert.ok(previewResult.applied.includes('/workspace/branch.txt'));
  assert.equal(machines.records.size, 2);
  assert.equal(await fileHash(join(vmDir(source.id), 'disk.qcow2')), sourceHash);
  assert.equal(await fileHash(join(vmDir(branch.id), 'disk.qcow2')), branchHash);
  record('Real QEMU: three-way preview finds conflict without mutating source or branch.');
  const refused = merge.run(branch.id,
    { mode: 'apply', name: 'merge-conflicted', path: '/workspace', partition: 0 });
  await merge.jobs.wait(branch.id);
  assert.equal(refused.status, 'done', refused.error + '\n' + refused.log);
  const refusedResult = await merge.jobs.result(refused.id!);
  assert.deepEqual(refusedResult.conflicts, ['/workspace/conflict.txt']);
  assert.equal(refusedResult.mergedVmId, undefined);
  assert.equal(machines.records.size, 2);
  assert.equal(await fileHash(join(vmDir(source.id), 'disk.qcow2')), sourceHash);
  record('Real QEMU: conflicting apply removes its temporary derivative and preserves the target.');
  await boot(source.id);
  await command(source.id, 'printf base > /workspace/conflict.txt; sync');
  await machines.stop(source.id);
  const apply = merge.run(branch.id,
    { mode: 'apply', name: 'merge-result', path: '/workspace', partition: 0 });
  await merge.jobs.wait(branch.id);
  assert.equal(apply.status, 'done', apply.error + '\n' + apply.log);
  const applied = await merge.jobs.result(apply.id!);
  assert.deepEqual(applied.conflicts, []);
  assert.ok(applied.mergedVmId);
  assert.equal(machines.get(applied.mergedVmId).mergeOrigin?.branchVmId, branch.id);
  await boot(applied.mergedVmId);
  assert.equal(await command(applied.mergedVmId,
    'cat /workspace/branch.txt; cat /workspace/target.txt; cat /workspace/conflict.txt; readlink /workspace/branch-link; test ! -e /workspace/delete.txt'),
    'mergedoriginalbranchbranch.txt\n');
  await machines.stop(applied.mergedVmId);
  assert.equal(await fileHash(join(vmDir(branch.id), 'disk.qcow2')), branchHash);
  record('Real QEMU: clean merge creates a bootable new instance, applies files, and preserves both inputs.');
} finally {
  await merge.close();
  await machines.close();
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/snapshot-merge-smoke.log'), lines.join('\n') + '\n');
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  assert.ok(basename(directory).startsWith('sakura-snapshot-merge-smoke-'));
  await rm(directory, { recursive: true, force: true });
}
