import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = await mkdtemp(join(tmpdir(), 'sakura-drill-smoke-'));
assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
process.env.SAKURA_DATA_DIR = join(root, 'data');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Bundles } = await import('../server/bundles.ts');
const { Backups } = await import('../server/backups.ts');
const { DisasterRecoveryDrill } = await import('../server/disaster-recovery-drill.ts');
const machines = new Machines(await createRuntime());
const bundles = new Bundles(machines);
const backups = new Backups(machines, bundles);
const drill = new DisasterRecoveryDrill(machines, backups, bundles);

async function boot(id: string) {
  await machines.start(id);
  const deadline = Date.now() + 300_000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > deadline || ['stopped', 'error'].includes(machines.state(id)))
      throw new Error(machines.logs.get(id) || '客户机启动超时');
    await delay(300);
  }
}

try {
  await machines.init();
  const vm = await machines.create({ name: 'drill-source' });
  await boot(vm.id);
  const content = 'sakura-disaster-recovery-proof';
  await machines.writeGuestFile(vm.id, '/workspace/drill-proof.txt', content, false);
  await machines.stop(vm.id, false);
  await backups.run(vm.id);
  await backups.jobs.wait(vm.id);
  const job = backups.jobs.view(vm.id)!;
  assert.equal(job.status, 'done', job.error || job.log);
  const backup = (await backups.view(vm.id)).items[0];
  const result = await drill.run(vm.id, { mode: 'run', backupId: backup.id,
    probePath: '/workspace/drill-proof.txt',
    expectedSha256: createHash('sha256').update(content).digest('hex') }, 'run');
  assert.ok('temporaryVmRemoved' in result);
  assert.equal(result.ready, true, JSON.stringify(result));
  assert.equal(result.temporaryVmRemoved, true);
  assert.equal(result.bootMs !== null && result.bootMs > 0, true);
  assert.deepEqual([...machines.records.keys()], [vm.id]);
  await backups.operate(vm.id, backup.id, 'delete');
  await machines.delete(vm.id);
  console.log('Verified backup restored, booted, checked and cleaned on real Alpine/QEMU.');
} finally {
  await backups.close();
  await machines.close();
  await rm(root, { recursive: true, force: true });
}
