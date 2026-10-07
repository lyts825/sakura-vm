/** 烟雾验收：验证备份恢复预览、文件选择及实际恢复内容。
 * Smoke acceptance for backup recovery previews, file selection and actual restored content. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { BackupRecovery } from '../server/backup-recovery.ts';

const directory = await mkdtemp(join(tmpdir(), 'sakura-recovery-smoke-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { Features } = await import('../server/features.ts');
const { vmDir } = await import('../server/model.ts');
const { fileHash } = await import('../server/local-store.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const features = await Features.create(machines, ['backups']);
const recovery = features.serviceValue('backupRecovery') as BackupRecovery;
assert.ok(recovery);
const lines: string[] = [];
/** 同时输出并保存本次验收结论，供最终报告按原顺序汇总；记录本身不替代此前的断言。
 * Print and retain this verification result for ordered final reporting; recording does not replace the preceding assertions. */
const record = (line: string) => {
  console.log(line);
  lines.push(line);
};
/** 启动给定实例，然后轮询正式状态至 running；只在源码限定的启动期限内等待，超时将抛错并附启动日志。
 * Start the specified VM, then poll production state until running within the source-defined startup deadline; timeout fails with boot logs. */
async function boot(id: string) {
  await machines.start(id);
  const deadline = Date.now() + 270000;
  while (machines.state(id) !== 'running') {
    assert.equal(machines.state(id), 'starting', machines.logs.get(id));
    assert.ok(Date.now() < deadline);
    await delay(100);
  }
}
try {
  const source = await machines.create({
    name: 'file-recovery-source',
    accelerator: process.env.SAKURA_TEST_ACCELERATOR === 'tcg' ? 'tcg' : 'auto',
    diskGiB: 4,
  });
  await boot(source.id);
  assert.equal(
    (await machines.exec(source.id, "printf 'from verified backup' > /workspace/recover.txt; sync", 10000))
      .code,
    0,
  );
  await machines.stop(source.id);
  record('Created source file for backup recovery.');
  const versions: { kind: string; id: string; password?: string }[] = [];
  for (const kind of ['plain', 'blocks', 'encrypted']) {
    await features.backups.policy(source.id, { enabled: false, deduplicate: kind === 'blocks' });
    const password = kind === 'encrypted' ? 'recovery-smoke-password-2026' : undefined;
    await features.backups.run(source.id, password);
    await features.backups.jobs.wait(source.id);
    assert.equal(
      features.backups.jobs.view(source.id)?.status,
      'done',
      features.backups.jobs.view(source.id)?.error,
    );
    versions.push({ kind, id: (await features.backups.view(source.id)).items[0].id, password });
    record('Created and verified ' + kind + ' backup.');
  }
  await boot(source.id);
  assert.equal(
    (await machines.exec(source.id, "printf 'current disk differs' > /workspace/recover.txt; sync", 10000))
      .code,
    0,
  );
  await machines.stop(source.id);
  const sourceHash = await fileHash(join(vmDir(source.id), 'disk.qcow2'));
  for (const version of versions) {
    const job = recovery.run(source.id, {
      backupId: version.id,
      password: version.password,
      paths: ['workspace/recover.txt'],
    });
    await recovery.jobs.wait(source.id);
    assert.equal(job.status, 'done', job.error + '\n' + job.log);
    const saved = await recovery.artifact(source.id, job.id!, job.execution!.artifacts[0].id);
    assert.equal(Buffer.from(saved.base64, 'base64').toString(), 'from verified backup');
    assert.equal(await fileHash(join(vmDir(source.id), 'disk.qcow2')), sourceHash);
    assert.equal(machines.live.size, 0);
    assert.equal(machines.records.size, 1);
    const report = await recovery.jobs.result(job.id!);
    assert.equal(report.backupId, version.id);
    assert.equal(report.files[0].path, 'workspace/recover.txt');
    record(
      'Real ' +
        version.kind +
        ' recovery: restored original backup bytes, current source unchanged, temporary disk/guest cleaned.',
    );
  }
  await machines.delete(source.id);
} finally {
  await features.close();
  await machines.close();
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/backup-recovery-smoke.log'), lines.join('\n'));
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-recovery-smoke-'));
  await rm(directory, { recursive: true, force: true });
}
