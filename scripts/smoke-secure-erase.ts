import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-secure-erase-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { ExtendedFeatures } = await import('../server/extended-features.ts');
type JobView = import('../server/jobs.ts').JobView;
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines);
const features = new ExtendedFeatures(machines, workspaces);
try {
  const vm = await machines.create({ name: 'erase-smoke', memoryMiB: 512, cpus: 2, diskGiB: 4 });
  await machines.start(vm.id);
  const deadline = Date.now() + 300000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(300);
  }
  const tool = await machines.exec(vm.id,
    'command -v python3 >/dev/null || apk add --no-cache python3', 180000);
  assert.equal(tool.code, 0, tool.stdout + tool.stderr);
  assert.equal((await machines.exec(vm.id,
    "printf 'private example' > /workspace/erase-me.txt && ln /workspace/erase-me.txt /workspace/hardlink.txt && ln -s erase-me.txt /workspace/symlink.txt")).code, 0);

  async function task(options: Record<string, unknown>) {
    const job = await features.action(vm.id,
      { action: 'run', featureId: 'secure-erase', options }) as JobView;
    await features.jobs.wait(job.key!);
    return features.jobs.get(job.id!)!;
  }

  const linked = await task({ mode: 'preview', path: 'hardlink.txt' });
  assert.equal(linked.status, 'error');
  const symbolic = await task({ mode: 'preview', path: 'symlink.txt' });
  assert.equal(symbolic.status, 'error');
  assert.equal((await machines.exec(vm.id, 'rm /workspace/hardlink.txt')).code, 0);
  const previewJob = await task({ mode: 'preview', path: 'erase-me.txt' });
  assert.equal(previewJob.status, 'done', previewJob.error);
  const preview = await features.jobs.result(previewJob.id!);
  assert.equal(preview.executed, false);
  assert.equal(preview.bytes, 15);
  assert.match(preview.previewToken, /^[a-f0-9]{64}$/);
  assert.equal((await machines.exec(vm.id, 'test -f /workspace/erase-me.txt')).code, 0);
  const stale = await task({ mode: 'erase', path: 'erase-me.txt',
    previewToken: '0'.repeat(64), confirmed: true });
  assert.equal(stale.status, 'error');
  assert.equal((await machines.exec(vm.id, 'test -f /workspace/erase-me.txt')).code, 0);
  assert.equal((await machines.exec(vm.id, "printf '!' >> /workspace/erase-me.txt")).code, 0);
  const changed = await task({ mode: 'erase', path: 'erase-me.txt',
    previewToken: preview.previewToken, confirmed: true });
  assert.equal(changed.status, 'error');
  const freshJob = await task({ mode: 'preview', path: 'erase-me.txt' });
  assert.equal(freshJob.status, 'done', freshJob.error);
  const fresh = await features.jobs.result(freshJob.id!);
  const erased = await task({ mode: 'erase', path: 'erase-me.txt',
    previewToken: fresh.previewToken, confirmed: true });
  assert.equal(erased.status, 'done', erased.error);
  const proof = await features.jobs.result(erased.id!);
  assert.equal(proof.logicalOnly, true);
  assert.equal(proof.passes, 3);
  assert.equal(proof.removed, true);
  assert.equal(proof.sha256After,
    createHash('sha256').update(Buffer.alloc(fresh.bytes)).digest('hex'));
  assert.equal((await machines.exec(vm.id, 'test ! -e /workspace/erase-me.txt')).code, 0);
  console.log('Real Alpine file was previewed, overwritten, verified, removed and recorded.');
} finally {
  await features.close();
  await workspaces.close();
  await machines.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-secure-erase-'));
  await rm(directory, { recursive: true, force: true });
}
