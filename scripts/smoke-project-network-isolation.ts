import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-project-netns-'));
await mkdir(join(directory, 'images'), { recursive: true });
await copyFile(resolve('.data/images/alpine-3.23.qcow2'),
  join(directory, 'images/alpine-3.23.qcow2'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = join(directory, 'images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Features } = await import('../server/features.ts');
const { CommandPresets } = await import('../server/command-presets.ts');
const { Pipelines } = await import('../server/pipelines.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const features = await Features.create(machines, ['projects', 'service-health']);
const commands = new CommandPresets(machines, features.workspaces);
const pipelines = new Pipelines(machines, features.workspaces, features.files);
async function command(id: string, script: string, timeout = 10_000) {
  const result = await machines.exec(id, script, timeout);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
async function job(id: string, projectId = 'default') {
  const key = projectId === 'default' ? id : `${id}:${projectId}`;
  await features.workspaces.jobs.wait(key);
  const result = features.workspaces.jobs.view(key);
  assert.equal(result?.status, 'done', result?.error + '\n' + result?.log);
}
try {
  const vm = await machines.create({ name: 'project-netns-smoke',
    memoryMiB: 512, cpus: 2, diskGiB: 4 });
  await machines.start(vm.id);
  const deadline = Date.now() + 300_000;
  while (machines.state(vm.id) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(vm.id)))
      throw new Error(machines.logs.get(vm.id));
    await delay(250);
  }
  const hostNamespace = await command(vm.id, 'readlink /proc/self/ns/net');
  await features.workspaces.save(vm.id, { directory: '/workspace/first',
    networkIsolation: 'private',
    setup: 'readlink /proc/self/ns/net > /workspace/first-setup.ns',
    command: 'readlink /proc/self/ns/net > /workspace/first.ns; exec sleep 600' });
  await features.workspaces.run(vm.id, 'start');
  await job(vm.id);
  const firstNamespace = await command(vm.id, 'cat /workspace/first.ns');
  assert.equal(await command(vm.id, 'cat /workspace/first-setup.ns'), firstNamespace);
  assert.notEqual(firstNamespace, hostNamespace);
  assert.equal(await command(vm.id, 'ip netns exec sk-default ip -4 route show'), '');
  const presets = await commands.save(vm.id, { name: 'namespace',
    command: 'readlink /proc/self/ns/net > /workspace/first-preset.ns' });
  await commands.run(vm.id, presets[0].id, {});
  await commands.jobs.wait(vm.id);
  assert.equal(commands.jobs.view(vm.id)?.status, 'done');
  assert.equal(await command(vm.id, 'cat /workspace/first-preset.ns'), firstNamespace);
  const pipeline = await pipelines.save(vm.id, { name: 'namespace', steps: [{ name: 'record',
    command: 'readlink /proc/self/ns/net > /workspace/first-pipeline.ns' }] });
  await pipelines.run(vm.id, pipeline.id);
  await pipelines.jobs.wait(vm.id);
  assert.equal(pipelines.jobs.view(vm.id)?.status, 'done');
  assert.equal(await command(vm.id, 'cat /workspace/first-pipeline.ns'), firstNamespace);
  await assert.rejects(features.workspaces.save(vm.id, { directory: '/workspace/first',
    networkIsolation: 'host',
    command: 'exec sleep 600' }), /请先停止运行中的项目/);
  const index = await features.workspaces.projects.create(vm.id, 'Second project',
    async () => { await features.workspaces.save(vm.id, { directory: '/workspace/second',
      networkIsolation: 'private', services: [{ name: 'api',
        command: 'readlink /proc/self/ns/net > /workspace/second.ns; exec sleep 600',
        ready: 'test "$(readlink /proc/self/ns/net)" = "$(cat /workspace/second.ns)"' }] }); });
  const secondId = index.active;
  await features.workspaces.projects.with(vm.id, secondId, async () => {
    await features.workspaces.run(vm.id, 'start');
    await job(vm.id, secondId);
  });
  const secondNamespace = await command(vm.id, 'cat /workspace/second.ns');
  assert.notEqual(secondNamespace, hostNamespace);
  assert.notEqual(secondNamespace, firstNamespace);
  assert.equal(await command(vm.id, `ip netns exec sk-${secondId} ip -4 route show`), '');
  await features.workspaces.projects.with(vm.id, secondId, async () => {
    await features.workspaces.run(vm.id, 'stop');
    await job(vm.id, secondId);
  });
  await features.workspaces.projects.with(vm.id, 'default', async () => {
    await features.workspaces.run(vm.id, 'stop');
    await job(vm.id);
  });
  assert.equal(await command(vm.id, 'ip netns list'), '');
  console.log('Real Alpine project namespaces, setup, services, presets, pipelines and cleanup passed');
} finally {
  await commands.close();
  await pipelines.close();
  await features.close();
  await machines.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-project-netns-'));
  await rm(directory, { recursive: true, force: true });
}
