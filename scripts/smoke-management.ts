import { PLUGINS } from '../shared/plugins.ts';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { JobView } from '../server/jobs.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-management-vm-'));
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Features } = await import('../server/features.ts');
const { textVersion } = await import('../server/files.ts');
const { Ide } = await import('../server/ide.ts');
const { guestTask } = await import('../server/guest-task.ts');
const engine = await createRuntime(),
  machines = new Machines(engine);
await machines.init();
const features = await Features.create(
  machines,
  PLUGINS.map((item) => item.id),
);
const ids: string[] = [];
async function boot(id: string) {
  await machines.start(id);
  const until = Date.now() + 300000;
  while (machines.state(id) !== 'running') {
    if (['error', 'stopped'].includes(machines.state(id)) || Date.now() > until)
      throw new Error(machines.logs.get(id));
    await delay(300);
  }
}
async function done(jobs: { view(key: string): JobView | null }, id: string) {
  const until = Date.now() + 1200000;
  while (jobs.view(id)?.status === 'running') {
    if (Date.now() > until) throw new Error('Task timed out');
    await delay(300);
  }
  const job = jobs.view(id)!;
  assert.equal(job.status, 'done', job.error + '\n' + job.log);
  return job;
}
async function command(id: string, text: string) {
  const result = await machines.exec(id, text, 30000);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}
try {
  const vm = await machines.create({ name: 'management-test', memoryMiB: 2048, diskGiB: 4 });
  ids.push(vm.id);
  const id = vm.id;
  console.log('Booting isolated Alpine');
  await boot(id);
  assert.equal(
    (await guestTask(machines, id, 'echo failed >&2; exit 17', new AbortController().signal)).code,
    17,
  );
  await command(id, 'mkdir -p /workspace/app; printf original > /workspace/app/notes.txt');
  await assert.rejects(
    machines.writeGuestFile(id, '/workspace/app/notes.txt', 'wrong', true, textVersion('stale')),
    /修改/,
  );
  await machines.writeGuestFile(id, '/workspace/app/notes.txt', 'saved', true, textVersion('original'));
  assert.equal(await machines.readGuestFile(id, '/workspace/app/notes.txt'), 'saved');
  console.log('Optimistic editing passed');
  const host = join(root, 'host');
  await mkdir(host);
  await writeFile(join(host, 'notes.txt'), 'Windows version');
  await writeFile(join(host, 'ignore.log'), 'ignored');
  await features.sync.save(id, { host, guest: '/workspace/app', ignore: ['*.log'] });
  const preview = await features.sync.preview(id);
  assert.equal(preview.changes.find((v) => v.path === 'notes.txt')?.action, 'conflict');
  assert.ok(!preview.changes.some((v) => v.path.endsWith('.log')));
  await features.sync.run(id, 'both', preview.token, { 'notes.txt': 'both' });
  await done(features.sync.jobs, id);
  assert.equal(await machines.readGuestFile(id, '/workspace/app/notes.txt'), 'Windows version');
  assert.match(await command(id, 'cat /workspace/app/notes.txt.linux-conflict-*'), /saved/);
  console.log('Read-only preview, ignores and conflict copies passed');
  await features.workspaces.save(id, {
    directory: '/workspace/app',
    environment: { GREETING: 'hello sakura' },
    services: [
      {
        name: 'backend',
        command: 'echo "$GREETING"; touch /tmp/sakura-api-ready; exec sleep 600',
        ready: 'test -f /tmp/sakura-api-ready',
      },
      { name: 'frontend', command: 'echo frontend-ready; exec sleep 600', dependsOn: ['backend'] },
    ],
  });
  console.log('Checking portable team template capture and independent instance creation');
  const team = features.next!;
  const templatePreview: any = await team.action(id, { action: 'check', featureId: 'team-templates',
    options: { mode: 'capture', name: 'Management starter' } });
  assert.ok(templatePreview.fingerprint);
  assert.equal(templatePreview.content.project.directory, '/workspace');
  assert.equal(templatePreview.content.project.environment, undefined);
  const templateCapture: any = await team.action(id, { action: 'run', featureId: 'team-templates',
    options: { mode: 'capture', name: 'Management starter', fingerprint: templatePreview.fingerprint } });
  await team.jobs.wait(templateCapture.key);
  assert.equal(team.jobs.view(templateCapture.key)?.status, 'done');
  const templateResult: any = await team.jobs.result(templateCapture.id);
  const templateId = templateResult.template.id;
  const templateCreate: any = await team.action(id, { action: 'run', featureId: 'team-templates',
    options: { mode: 'create', templateId, fingerprint: templateResult.template.fingerprint,
      targetName: 'management-template-copy' } });
  await team.jobs.wait(templateCreate.key);
  assert.equal(team.jobs.view(templateCreate.key)?.status, 'done',
    team.jobs.view(templateCreate.key)?.error);
  const createdTemplate: any = await team.jobs.result(templateCreate.id);
  ids.push(createdTemplate.vmId);
  const copiedProject = await features.workspaces.config(createdTemplate.vmId);
  assert.equal(copiedProject.directory, '/workspace');
  assert.equal(copiedProject.environment, undefined);
  assert.equal(copiedProject.services, undefined);
  await features.workspaces.run(id, 'start');
  await done(features.workspaces.jobs, id);
  const running = await features.workspaces.runtime(id);
  assert.equal(running.status, 'running');
  assert.match(running.services![0].log, /hello sakura/);
  await features.workspaces.run(id, 'stop', 'backend');
  while (features.workspaces.jobs.view(id)?.status === 'running') await delay(100);
  assert.equal(features.workspaces.jobs.view(id)?.status, 'error');
  await features.workspaces.run(id, 'stop');
  await done(features.workspaces.jobs, id);
  assert.equal((await features.workspaces.runtime(id)).status, 'stopped');
  console.log('Service dependency startup, environment, logs and stop protection passed');
  await features.recipes.write(id);
  const recipe = await features.recipes.read(id);
  assert.equal(recipe.project.services?.length, 2);
  const fromRecipe = await features.recipes.create('recipe-test', recipe);
  ids.push(fromRecipe.id);
  assert.equal((await features.workspaces.config(fromRecipe.id)).services?.length, 2);
  await machines.organize(id, { group: 'web', tags: ['dev', 'dev'], favorite: true });
  assert.deepEqual(machines.get(id).organization?.tags, ['dev']);
  console.log('Recipe import/export and organization passed');
  await features.workspaces.save(id, {
    directory: '/workspace/app',
    setup: 'sleep 120; touch /tmp/should-not-exist',
  });
  await features.workspaces.run(id, 'setup');
  await delay(3000);
  features.workspaces.jobs.cancel(id);
  while (features.workspaces.jobs.view(id)?.status === 'running') await delay(200);
  assert.equal(features.workspaces.jobs.view(id)?.status, 'cancelled');
  assert.equal((await machines.exec(id, 'pgrep -f "^sleep 120$"')).code, 1);
  console.log('Cancelled guest process tree terminated');
  features.maintenance.diagnose(id);
  await done(features.maintenance.jobs, id);
  assert.ok(features.maintenance.report(id)!.checks.some((c) => c.name === 'SSH' && c.status === 'ok'));
  console.log('Diagnostics passed');
  await machines.stop(id);
  features.maintenance.resize(id, 8);
  await done(features.maintenance.jobs, id);
  assert.equal(machines.get(id).diskGiB, 8);
  const pendingResize = await machines.snapshot(id, 'filesystem-growth-pending');
  await boot(id);
  const resizeJob = await done(features.maintenance.jobs, id);
  assert.equal(machines.get(id).pendingResize, false);
  const capacity = Number((await command(id, "df -Pk / | awk 'NR==2 { print $2 }'")).trim());
  assert.ok(
    capacity > 6 * 1024 ** 2,
    `Expanded root filesystem: ${capacity} KiB\n${resizeJob.log}\n${await command(id, 'cat /proc/partitions; mount | head -n 8; fdisk -l /dev/vda')}`,
  );
  console.log('Real QCOW2, partition and filesystem growth passed');
  await machines.stop(id);
  const resizeClone = await features.bundles.clone(id, 'pending-resize-clone', pendingResize.id);
  ids.push(resizeClone.id);
  assert.equal(resizeClone.pendingResize, true);
  await boot(resizeClone.id);
  await done(features.maintenance.jobs, resizeClone.id);
  assert.equal(machines.get(resizeClone.id).pendingResize, false);
  assert.ok(
    Number((await command(resizeClone.id, "df -Pk / | awk 'NR==2 { print $2 }'")).trim()) > 6 * 1024 ** 2,
  );
  await machines.stop(resizeClone.id);
  await machines.restore(id, pendingResize.id);
  assert.equal(machines.get(id).pendingResize, true);
  console.log('Pending filesystem growth survives snapshot restore and clone boot');
  await features.backups.policy(id, { enabled: true, intervalHours: 1, keep: 1, maxGiB: 4 });
  await features.backups.tick();
  await done(features.backups.jobs, id);
  let backup = await features.backups.view(id);
  assert.equal(backup.items.length, 1);
  await features.backups.run(id);
  await done(features.backups.jobs, id);
  backup = await features.backups.view(id);
  assert.equal(backup.items.length, 1);
  await features.backups.operate(id, backup.items[0].id, 'verify');
  await done(features.backups.jobs, id);
  await features.backups.operate(id, backup.items[0].id, 'restore', 'backup-restored');
  await done(features.backups.jobs, id);
  const restored = [...machines.records.values()].find((v) => v.name === 'backup-restored')!;
  ids.push(restored.id);
  assert.equal(restored.pendingResize, true);
  await boot(restored.id);
  await done(features.maintenance.jobs, restored.id);
  assert.equal(machines.get(restored.id).pendingResize, false);
  assert.ok(
    Number((await command(restored.id, "df -Pk / | awk 'NR==2 { print $2 }'")).trim()) > 6 * 1024 ** 2,
  );
  assert.equal(await machines.readGuestFile(restored.id, '/workspace/app/notes.txt'), 'Windows version');
  await machines.stop(restored.id);
  console.log('Scheduled backups, retention, integrity and real restore boot passed');
  const before = machines.get(id).snapshots.find((s) => s.name === '扩容前自动备份')!;
  await machines.restore(id, before.id);
  const diskInfo = JSON.parse(
    await engine.run('sakura-img', ['info', '--output=json', join(root, 'machines', id, 'disk.qcow2')]),
  );
  assert.equal(diskInfo['virtual-size'], 4 * 1024 ** 3);
  assert.equal(machines.get(id).diskGiB, 4);
  for (const distro of ['debian', 'ubuntu'] as const) {
    const extra = await machines.create({
      name: `integration-${distro}`,
      distro,
      memoryMiB: 2048,
      diskGiB: 8,
    });
    ids.push(extra.id);
    await boot(extra.id);
    const ide = new Ide(machines, features.workspaces, join(root, 'ssh-user'));
    const connection = await ide.install(extra.id);
    assert.ok(connection.url.startsWith('vscode://'));
    const config = await readFile(join(root, 'ssh/config'), 'utf8');
    assert.match(config, new RegExp(`Host sakura-integration-${distro}`));
    await ide.close();
    await features.workspaces.save(extra.id, { command: 'echo ready; exec sleep 60' });
    await features.workspaces.run(extra.id, 'start');
    await done(features.workspaces.jobs, extra.id);
    assert.equal((await features.workspaces.runtime(extra.id)).status, 'running');
    await machines.stop(extra.id);
    console.log(`${distro} SSH integration and guest task runner passed`);
  }
  console.log('Management integration tests passed');
} finally {
  await features.close();
  for (const id of ids.reverse()) {
    if (machines.live.has(id)) await machines.stop(id, true);
    await machines.delete(id);
  }
  await machines.close();
  // The uniquely generated root is checked before recursive test cleanup.
  assert.ok(root.startsWith(join(tmpdir(), 'sakura-management-vm-')));
  await rm(root, { recursive: true, force: true });
}
