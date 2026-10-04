import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Client } from 'ssh2';
import type { PluginContext } from '../server/plugin-api.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-plugin-lifecycle-'));
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { PluginManager } = await import('../server/plugin-manager.ts');
const { loaders } = await import('../server/plugins/registry.ts');
const { hostRuntime } = await import('../server/host-runtime/index.ts');
const machines = new Machines(await createRuntime());
const manager = new PluginManager(join(root, 'plugins.json'));
const original = loaders.metrics;
let context!: PluginContext;
loaders.metrics = async () => ({
  ...(await original()),
  activate: async (host) => {
    context = host;
    await (await original()).activate(host);
  },
});

async function eventually(check: () => boolean, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Expected lifecycle state was not reached');
    await new Promise((done) => setTimeout(done, 50));
  }
}
function exec(client: Client, command: string) {
  return new Promise<string>((done, reject) =>
    client.exec(command, (error, channel) => {
      if (error) return reject(error);
      let output = '';
      channel.on('data', (chunk: Buffer) => {
        output += chunk;
      });
      channel.on('error', reject);
      channel.on('close', (code: number) =>
        code === 0 ? done(output) : reject(new Error('SSH code ' + code)),
      );
    }),
  );
}
let vmId = '',
  core: Client | undefined,
  peer: Client | undefined;
let blocker: ReturnType<typeof hostRuntime.register> | undefined;
try {
  await machines.init();
  await writeFile(
    join(root, 'plugins.json'),
    JSON.stringify({ schemaVersion: 3, plugins: ['metrics', 'files'], packs: [] }),
  );
  await manager.init();
  const runtime = await manager.start(machines);
  assert.deepEqual(runtime.errors, {});
  vmId = (await machines.create({ name: 'plugin-lifecycle', memoryMiB: 512, diskGiB: 8 })).id;
  await machines.start(vmId);
  await eventually(() => machines.state(vmId) === 'running', 300_000);
  const sample = runtime.metrics!.sample;
  assert.ok((await sample(vmId)).memoryTotal > 0);
  core = await machines.connect(vmId);
  const files = manager.directory.get('official', 'files')!;
  // The independent plugin connection is admitted with its own original lifetime.
  const { pluginCapabilities } = await import('../server/plugin-capabilities.ts');
  peer = await pluginCapabilities('files', machines, files.scope, files).vm.connect(vmId);
  const transport = await context.vm.connect(vmId);
  const transportClosed = new Promise<void>((done) => transport.once('close', done));
  const cachedExec = context.vm.exec;
  const instance = manager.directory.get('official', 'metrics')!;
  const permissions = instance.view().permissions;
  instance.setPermissions(permissions.filter((permission) => permission !== 'execution'));
  assert.throws(() => cachedExec(vmId, 'touch /workspace/revoked-permission'), {
    code: 'PLUGIN_PERMISSION_DENIED',
  });
  assert.throws(() => transport.exec('touch /workspace/revoked-transport', () => {}), {
    code: 'PLUGIN_PERMISSION_DENIED',
  });
  instance.setPermissions(permissions);
  let finish!: () => void;
  const held = new Promise<void>((done) => {
    finish = done;
  });
  const active = context.execution.run({ vmId, projectId: 'lifecycle-check' }, async (scope) => {
    const resource = hostRuntime
      .snapshot()
      .resources.find(
        (row) => row.kind === 'execution' && row.identity.pluginGeneration === instance.generation,
      )!;
    assert.equal(resource.identity.pluginInstanceId, instance.identity);
    assert.equal(resource.identity.vmId, vmId);
    assert.equal(resource.identity.projectId, 'lifecycle-check');
    assert.equal(resource.identity.operationId, scope.identity.operationId);
    await held;
  });
  await eventually(() =>
    hostRuntime.snapshot().resources.some((row) => row.identity.projectId === 'lifecycle-check'),
  );
  finish();
  await active;
  console.log('PASS real VM resource identity and cached transport permission revocation');
  blocker = await hostRuntime.acquire({
    owner: 'smoke:hold-execution',
    kind: 'test',
    label: 'queue boundary',
    cost: { execution: 14 },
  });
  const queued = Promise.resolve().then(() => cachedExec(vmId, 'touch /workspace/queued-after-unload'));
  const cancelled = assert.rejects(queued, { name: 'AbortError' });
  await eventually(() =>
    hostRuntime
      .snapshot()
      .resources.some(
        (row) => row.state === 'queued' && row.identity.pluginGeneration === instance.generation,
      ),
  );
  await manager.unload('metrics');
  await cancelled;
  await transportClosed;
  blocker.release();
  blocker = undefined;
  assert.equal(instance.phase, 'inactive');
  assert.throws(() => sample(vmId), { code: 'PLUGIN_REVOKED' });
  assert.throws(() => transport.exec('touch /workspace/old-transport', () => {}));
  assert.ok((await runtime.files!.info(vmId, '/etc/alpine-release')).size > 0);
  assert.equal(await exec(core, 'printf core-alive'), 'core-alive');
  assert.equal(await exec(peer, 'printf files-alive'), 'files-alive');
  const absent = await machines.exec(
    vmId,
    'test ! -e /workspace/revoked-permission && test ! -e /workspace/revoked-transport && test ! -e /workspace/queued-after-unload && test ! -e /workspace/old-transport',
  );
  assert.equal(absent.code, 0, absent.stderr);
  assert.equal(
    hostRuntime.snapshot().resources.some((row) => row.identity.pluginGeneration === instance.generation),
    false,
  );
  console.log(
    'PASS queued work and old handles cannot start; revoked connection closes; core and other plugin stay live',
  );
} finally {
  blocker?.release();
  core?.end();
  peer?.end();
  loaders.metrics = original;
  try {
    await manager.close();
  } finally {
    if (vmId) {
      await machines.stop(vmId, true);
      await machines.delete(vmId);
    }
    await machines.close();
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('sakura-plugin-lifecycle-'));
    await rm(root, { recursive: true, force: true });
  }
}
