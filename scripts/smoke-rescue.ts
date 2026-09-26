import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-rescue-smoke-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { Rescue } = await import('../server/rescue.ts');
const { vmDir } = await import('../server/model.ts');
const { fileHash } = await import('../server/local-store.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const rescue = new Rescue(machines);
await rescue.init();
const lines: string[] = [];
const record = (line: string) => {
  lines.push(line);
  console.log(line);
};
try {
  const source = await machines.create({
    name: 'rescue-source',
    accelerator: process.env.SAKURA_TEST_ACCELERATOR === 'tcg' ? 'tcg' : 'auto',
  });
  await machines.start(source.id);
  const deadline = Date.now() + 270_000;
  while (machines.state(source.id) !== 'running') {
    assert.equal(machines.state(source.id), 'starting', machines.logs.get(source.id));
    assert.ok(Date.now() < deadline);
    await delay(100);
  }
  const written = await machines.exec(
    source.id,
    "printf 'recovered from source' > /workspace/recover-me.txt; sync",
    10000,
  );
  assert.equal(written.code, 0);
  await machines.stop(source.id);
  const before = await fileHash(join(vmDir(source.id), 'disk.qcow2'));
  const sourceKey = await fileHash(join(vmDir(source.id), 'id_rsa'));
  const job = rescue.run(source.id, {
    command: [
      'set -eu',
      'test "$(cat /mnt/source/workspace/recover-me.txt)" = "recovered from source"',
      'device=$(cat /run/sakura-source-device)',
      'if printf bad > /mnt/source/should-not-exist; then echo UNEXPECTED_WRITE; exit 1; fi',
      'if dd if=/dev/zero of="$device" bs=512 count=1 2>/dev/null; then echo RAW_WRITE_ALLOWED; exit 1; fi',
      'cp /mnt/source/workspace/recover-me.txt /workspace/recovered.txt',
      'echo RESCUE_READONLY_OK',
    ].join('\n'),
    timeoutSeconds: 30,
    artifacts: ['recovered.txt'],
  });
  await rescue.jobs.wait(source.id);
  record(job.log);
  for (const [id, log] of machines.logs) if (id !== source.id) record(log);
  assert.equal(job.status, 'done', job.error);
  assert.match(job.log, /RESCUE_READONLY_OK/);
  assert.equal(await fileHash(join(vmDir(source.id), 'disk.qcow2')), before);
  assert.equal(await fileHash(join(vmDir(source.id), 'id_rsa')), sourceKey);
  assert.equal(machines.records.size, 1);
  assert.equal(machines.live.size, 0);
  const artifact = await rescue.artifact(source.id, job.id!, job.execution!.artifacts[0].id);
  assert.equal(Buffer.from(artifact.base64, 'base64').toString(), 'recovered from source');
  record(
    'Real rescue: read-only mount and raw write denial, recovery artifact, unchanged disk/key, temporary cleanup passed.',
  );

  const cancelled = rescue.run(source.id, {
    partition: null,
    command: 'echo RESCUE_WAITING; sleep 3600',
    timeoutSeconds: 60,
  });
  const cancelDeadline = Date.now() + 270_000;
  while (!cancelled.log.includes('\nRESCUE_WAITING\n') && cancelled.status === 'running') {
    assert.ok(Date.now() < cancelDeadline);
    await delay(100);
  }
  assert.equal(cancelled.status, 'running', cancelled.error);
  await assert.rejects(machines.start(source.id), /另一项/);
  await assert.rejects(machines.delete(source.id), /另一项/);
  const transient = [...machines.records.values()].find((vm) => vm.rescueOf === source.id)!;
  assert.ok(transient);
  await assert.rejects(machines.start(transient.id), /只能由救援任务/);
  rescue.jobs.cancel(source.id);
  await rescue.jobs.wait(source.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(machines.isBusy(source.id), false);
  assert.equal(machines.live.size, 0);
  assert.equal(machines.records.size, 1);
  assert.equal(await fileHash(join(vmDir(source.id), 'disk.qcow2')), before);
  record(
    'Real rescue: source mutation and direct rescue restart blocked; cancellation terminates guest and releases lock.',
  );
  const timed = rescue.run(source.id, { partition: null, command: 'sleep 60', timeoutSeconds: 1 });
  await rescue.jobs.wait(source.id);
  assert.equal(timed.execution?.outcome, 'timeout', timed.error);
  assert.equal(machines.records.size, 1);
  assert.equal(machines.live.size, 0);
  assert.equal(await fileHash(join(vmDir(source.id), 'disk.qcow2')), before);
  record('Real rescue: timeout terminates guest and leaves source unchanged.');
  await machines.delete(source.id);
} finally {
  await rescue.close();
  await machines.close();
  await mkdir(resolve('artifacts'), { recursive: true });
  await writeFile(resolve('artifacts/rescue-smoke.log'), lines.join('\n'));
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-rescue-smoke-'));
  await rm(directory, { recursive: true, force: true });
}
