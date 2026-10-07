/** 烟雾验收：验证插件独立连接寿命、真实 VM 资源身份和缓存传输授权撤销。
 * Smoke acceptance for independent plugin connection lifetime, actual VM-resource identity and transfer-authorization revocation. */
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
loaders.metrics = /** 沿用正式插件 loader 和描述符，只包装 activate 捕获真实 host context 后执行原激活，供生命周期用例观测注册/撤销行为。
 * Preserve the formal plugin loader/descriptor, wrapping activate only to capture the real host context before original activation for lifecycle registration/removal observations. */ async () => ({
  ...(await original()),
  /** 保存传入真实插件上下文并委托原入口激活，供之后停用观测同一依赖对象。
   * Retain the real plugin context and delegate original activation so later deactivation observes the same dependency object. */
  activate: async (host) => {
    context = host;
    await (await original()).activate(host);
  },
});

/** 按短间隔等待同步状态条件，默认十五秒总期限，届满断言失败而不无限等待生命周期。
 * Poll a synchronous lifecycle predicate at short intervals under a default fifteen-second deadline, failing instead of waiting indefinitely. */
async function eventually(check: () => boolean, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Expected lifecycle state was not reached');
    await new Promise((done) => setTimeout(done, 50));
  }
}
/** 在已连接 SSH client 打开 exec，收集 stdout 并仅接受零退出；通道和建连错误拒绝。
 * Open exec on the connected SSH client, collect stdout and accept only zero exit; channel/open errors reject. */
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
  /** 保存由生命周期观测回调触发的无参数完成信号，调用者据此解除等待。
   * Represent a no-argument completion signal invoked by lifecycle observation to release the caller’s wait. */
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
