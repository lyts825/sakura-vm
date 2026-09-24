import { PLUGINS } from '../shared/plugins.ts';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Jobs } from '../server/jobs';

const root = await mkdtemp(join(tmpdir(), 'sakura-development-vm-'));
const source = join(root, 'source'),
  target = join(root, 'migrated');
await mkdir(join(source, 'images'), { recursive: true });
await copyFile(resolve('.data/images/alpine-3.23.qcow2'), join(source, 'images/alpine-3.23.qcow2'));
process.env.SAKURA_DATA_DIR = source;
process.env.SAKURA_IMAGE_PATH = join(source, 'images/alpine-3.23.qcow2');
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Features } = await import('../server/features.ts');
const { dataDirectory } = await import('../server/data-directory.ts');
const { textVersion } = await import('../server/files.ts');
const engine = await createRuntime(),
  machines = new Machines(engine);
await machines.init();
const features = await Features.create(
  machines,
  PLUGINS.map((item) => item.id),
);
async function boot(id: string) {
  await machines.start(id);
  const until = Date.now() + 300000;
  while (machines.state(id) !== 'running') {
    if (['error', 'stopped'].includes(machines.state(id)) || Date.now() > until)
      throw new Error(machines.logs.get(id));
    await delay(250);
  }
}
async function done(jobs: Jobs, id: string) {
  await jobs.wait(id);
  const job = jobs.view(id)!;
  assert.equal(job.status, 'done', job.error + '\n' + job.log);
  return job;
}
async function command(id: string, script: string) {
  const result = await machines.exec(id, script, 30000);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}
try {
  const vm = await machines.create({ name: 'development-smoke', memoryMiB: 1024, diskGiB: 4 }),
    id = vm.id;
  console.log('Booting isolated Alpine development VM');
  await boot(id);
  await command(id, 'mkdir -p /workspace/app');
  await machines.writeGuestFile(id, '/workspace/app/index.ts', 'export const sakura = "flower";\n', false);
  await machines.writeGuestFile(id, '/workspace/app/package.json', '{"name":"smoke"}\n', false);
  await features.workspaces.save(id, { directory: '/workspace/app' });
  await features.toolchains.install(id, { tools: ['git'] });
  await done(features.toolchains.jobs, id);
  const tools = await features.toolchains.view(id);
  assert.equal(tools.tools.find((tool) => tool.id === 'git')?.installed, true);
  assert.equal(tools.tools.find((tool) => tool.id === 'node')?.required, true);
  const files = await features.projectFiles.scan(id);
  assert.ok(files.files.some((file) => file.path === 'index.ts'));
  const search = await features.projectFiles.scan(id, 'flower', true);
  assert.equal(search.matches[0].line, 1);
  await features.git.run(id, { action: 'init' });
  await done(features.git.jobs, id);
  assert.match((await features.git.diff(id, 'index.ts', false)).diff, /flower/);
  await features.git.run(id, { action: 'stage', paths: ['index.ts', 'package.json'] });
  await done(features.git.jobs, id);
  await features.git.run(id, {
    action: 'commit',
    message: 'First commit',
    author: 'Sakura Test',
    email: 'test@example.invalid',
  });
  await done(features.git.jobs, id);
  assert.equal((await features.git.view(id)).changes.length, 0);
  await features.git.run(id, { action: 'branch', branch: 'smoke/feature' });
  await done(features.git.jobs, id);
  assert.equal((await features.git.view(id)).branch, 'smoke/feature');
  const original = await machines.readGuestFile(id, '/workspace/app/index.ts');
  await machines.writeGuestFile(
    id,
    '/workspace/app/index.ts',
    'export const sakura = "new flower";\n',
    true,
    textVersion(original),
  );
  assert.match((await features.git.diff(id, 'index.ts', false)).diff, /\+export const sakura/);
  console.log('Tool detection/install, project tree/search, Git init/stage/commit/branch/diff passed');

  await features.secrets.save(id, { name: 'api-token', value: 'smoke-private-value-1234' });
  await features.workspaces.save(id, { directory: '/workspace/app', secrets: { TOKEN: 'api-token' } });
  const presets = await features.commands.save(id, {
    name: 'Test parameter quoting',
    command: 'printf "%s" "$TARGET" > parameter.txt; printf "%s" "$TOKEN"',
    parameters: [{ name: 'TARGET', value: 'default' }],
  });
  const parameter = "hello'; touch /tmp/parameter-injection; '";
  await features.commands.run(id, presets[0].id, { TARGET: parameter });
  const task = await done(features.commands.jobs, id);
  assert.equal(await machines.readGuestFile(id, '/workspace/app/parameter.txt'), parameter);
  assert.equal((await machines.exec(id, 'test -e /tmp/parameter-injection')).code, 1);
  assert.ok(!task.log.includes('smoke-private-value-1234'));
  assert.match(task.log, /私密配置已隐藏/);
  const network = await features.network.preview(id, { npmRegistry: 'https://registry.npmjs.org' });
  await features.network.apply(id, network.config, network.token);
  assert.equal(
    (await features.workspaces.resolvedConfig(id)).environment?.NPM_CONFIG_REGISTRY,
    'https://registry.npmjs.org',
  );
  await features.network.restore(id);
  assert.deepEqual(await features.network.environment(id), {});
  console.log(
    'DPAPI private configuration, parameter quoting, redacted task logs and network preview/apply/restore passed',
  );

  await command(id, 'touch /tmp/health-ok');
  await features.workspaces.save(id, {
    directory: '/workspace/app',
    secrets: { TOKEN: 'api-token' },
    services: [
      {
        name: 'api',
        command: 'echo "$TOKEN"; exec sleep 600',
        health: {
          command: 'test -f /tmp/health-ok',
          interval: 3600,
          failures: 1,
          restart: true,
          maxRestarts: 1,
          backoff: 5,
        },
      },
    ],
  });
  await features.workspaces.run(id, 'start');
  await done(features.workspaces.jobs, id);
  await features.health.tick(Date.now() + 3600001);
  assert.equal((await features.health.view(id)).services[0].status, 'healthy');
  assert.ok(!(await features.workspaces.runtime(id)).services![0].log.includes('smoke-private-value-1234'));
  await command(id, 'rm /tmp/health-ok');
  await features.health.tick(Date.now() + 7200002);
  await done(features.health.jobs, id);
  assert.equal((await features.health.view(id)).services[0].restarts, 1);
  await features.health.tick(Date.now() + 10800003);
  assert.equal((await features.health.view(id)).services[0].status, 'exhausted');
  await features.workspaces.run(id, 'stop');
  await done(features.workspaces.jobs, id);
  await features.health.tick(Date.now() + 14400004);
  assert.equal((await features.health.view(id)).services[0].desired, false);
  console.log('Continuous health checks, bounded restart and manual-stop behaviour passed');

  await machines.stop(id);
  await features.backups.policy(id, { directory: join(source, 'external'), keep: 2 });
  await features.backups.run(id, 'smoke-backup-password');
  await done(features.backups.jobs, id);
  const backup = (await features.backups.view(id)).items[0];
  assert.equal(backup.encrypted, true);
  await features.backups.operate(id, backup.id, 'verify', undefined, 'smoke-backup-password');
  await done(features.backups.jobs, id);
  await features.backups.operate(id, backup.id, 'restore', 'encrypted-restored', 'smoke-backup-password');
  await done(features.backups.jobs, id);
  const restored = [...machines.records.values()].find((value) => value.name === 'encrypted-restored')!;
  await boot(restored.id);
  assert.match(await machines.readGuestFile(restored.id, '/workspace/app/index.ts'), /new flower/);
  await machines.stop(restored.id);
  console.log('Encrypted external backup, verification and actual restored boot passed');

  if (!process.argv.includes('--skip-containers')) {
    for (const distro of ['debian', 'ubuntu'] as const) {
      const guest = await machines.create({
        name: `container-${distro}`,
        distro,
        memoryMiB: 2048,
        diskGiB: 8,
      });
      console.log(`Booting ${distro} for Docker / Compose verification`);
      await boot(guest.id);
      await features.containers.run(guest.id, { action: 'install' });
      await done(features.containers.jobs, guest.id);
      const info = await features.containers.view(guest.id);
      assert.equal(info.available, true);
      assert.ok(info.compose);
      await command(guest.id, 'mkdir -p /workspace');
      // Build a tiny local image so integration tests do not depend on Docker Hub access.
      const fixture = await machines.exec(
        guest.id,
        'export DEBIAN_FRONTEND=noninteractive; apt-get install -y busybox-static && mkdir -p /tmp/sakura-image/bin && cp /bin/busybox /tmp/sakura-image/bin/busybox && tar -C /tmp/sakura-image -cf - . | docker import - sakura-smoke:local',
        180000,
      );
      assert.equal(fixture.code, 0, fixture.stderr);
      await machines.writeGuestFile(
        guest.id,
        '/workspace/compose.yaml',
        'services:\n  app:\n    image: sakura-smoke:local\n    command: ["/bin/busybox", "sh", "-c", "echo compose-ready; exec /bin/busybox sleep 600"]\n',
        false,
      );
      await features.containers.run(guest.id, { action: 'compose-up', file: 'compose.yaml' });
      await done(features.containers.jobs, guest.id);
      const containers = await features.containers.view(guest.id),
        container = containers.containers[0];
      assert.ok(container?.ID);
      assert.match((await features.containers.logs(guest.id, container.ID)).log, /compose-ready/);
      for (const action of ['stop', 'start', 'restart'] as const) {
        await features.containers.run(guest.id, { action, id: container.ID });
        await done(features.containers.jobs, guest.id);
      }
      await features.containers.run(guest.id, { action: 'compose-down', file: 'compose.yaml' });
      await done(features.containers.jobs, guest.id);
      assert.equal((await features.containers.view(guest.id)).containers.length, 0);
      await machines.stop(guest.id);
      await machines.delete(guest.id);
      console.log(`${distro} Docker installation, Compose up/down, logs and container controls passed`);
    }
  }

  await machines.snapshot(id, 'migration-snapshot');
  await features.ide.update();
  const plan = await features.migration.plan(target);
  await features.migration.start(target, plan.token);
  await done(features.migration.jobs, 'data');
  assert.equal(dataDirectory(source), target);
  const disk = join(target, 'machines', id, 'disk.qcow2');
  const info = JSON.parse(await engine.run('sakura-img', ['info', '--output=json', disk]));
  assert.equal(info['full-backing-filename'], join(target, 'images/alpine-3.23.qcow2'));
  assert.match(
    await engine.run('sakura-img', ['snapshot', '-l', disk]),
    new RegExp(machines.get(id).snapshots[0].id),
  );
  const index = JSON.parse(await readFile(join(target, 'backups', id, 'index.json'), 'utf8'));
  assert.equal(index.items[0].directory, join(target, 'external'));
  assert.ok(await readFile(join(source, 'machines.json')));
  await features.migration.cancelActivation();
  console.log(
    'Data migration, SHA-256 verification, QCOW2 backing repair, disk comparison and activation rollback passed',
  );
  console.log('Development integration tests passed');
} finally {
  await features.close();
  machines.maintenance = false;
  await machines.close();
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(root, /sakura-development-vm-/);
  await rm(root, { recursive: true, force: true });
}
