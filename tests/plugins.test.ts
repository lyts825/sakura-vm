import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Machines } from '../server/machines.ts';
import {
  PLUGINS,
  PLUGIN_PACKS,
  emptySelection,
  resolvePlugins,
  pluginSurfaceEnabled,
} from '../shared/plugins.ts';

const directory = await mkdtemp(join(tmpdir(), 'sakura-plugins-'));
process.env.SAKURA_DATA_DIR = directory;
const { PluginManager } = await import('../server/plugin-manager.ts');
const { Features } = await import('../server/features.ts');
const { loaders } = await import('../server/plugins/registry.ts');
after(async () => {
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-plugins-'));
  await rm(directory, { recursive: true, force: true });
});
const machines = () =>
  Object.assign(new EventEmitter(), {
    records: new Map(),
    live: new Map(),
    get: () => ({ name: 'example' }),
    state: () => 'stopped',
  }) as unknown as Machines;
function request(method = 'GET') {
  const req = Object.assign(new EventEmitter(), { method, headers: {} }) as IncomingMessage;
  const res = Object.assign(new EventEmitter(), {
    writableFinished: false,
    status: 0,
    payload: undefined as any,
    writeHead(status: number) {
      this.status = status;
    },
    end(data: string) {
      this.payload = JSON.parse(data);
      this.writableFinished = true;
    },
  });
  return { req, res: res as typeof res & ServerResponse };
}

test('a fresh install has no optional plugins, listeners, job stores or optional UI surfaces', async () => {
  const manager = new PluginManager(join(directory, 'fresh.json'));
  assert.deepEqual(await manager.init(), []);
  const vm = machines(),
    host = await Features.create(vm);
  try {
    manager.activated(host.enabled, host.errors);
    assert.equal(manager.view().restartRequired, false);
    assert.deepEqual([...host.enabled], []);
    assert.deepEqual(host.jobStores(), []);
    assert.deepEqual(vm.eventNames(), []);
    assert.equal(host.workspaces, undefined);
    assert.equal(host.desktops, undefined);
    assert.equal(host.backups, undefined);
    assert.equal(host.migration, undefined);
    for (const page of ['workspace', 'plugins', 'settings'])
      assert.equal(pluginSurfaceEnabled([], 'pages', page), true);
    for (const page of ['images', 'library', 'features', 'tasks'])
      assert.equal(pluginSurfaceEnabled([], 'pages', page), false);
    assert.equal(pluginSurfaceEnabled([], 'tabs', 'terminal'), true);
    assert.equal(pluginSurfaceEnabled([], 'tabs', 'config'), true);
    assert.equal(pluginSurfaceEnabled([], 'tabs', 'files'), false);
  } finally {
    await host.close();
  }
});

test('every pack resolves version pins and dependencies before consumers without duplicates', () => {
  for (const pack of PLUGIN_PACKS) {
    const order = resolvePlugins({ ...emptySelection(), packs: [pack.id] });
    assert.equal(new Set(order).size, order.length);
    for (const id of order) {
      assert.ok(loaders[id], `Missing loader: ${id}`);
      for (const dependency of PLUGINS.find((item) => item.id === id)!.requires)
        assert.ok(order.indexOf(dependency) < order.indexOf(id));
    }
  }
  assert.equal(resolvePlugins({ ...emptySelection(), packs: ['complete'] }).length, PLUGINS.length);
});

test('invalid dependencies, cycles, incompatible APIs and pack pins fail before activation', () => {
  assert.throws(() => resolvePlugins({ ...emptySelection(), plugins: ['unknown'] }), /不存在/);
  assert.throws(() => resolvePlugins({ ...emptySelection(), packs: ['unknown'] }), /不存在/);
  const files = PLUGINS.find((item) => item.id === 'files')!;
  assert.throws(
    () =>
      resolvePlugins({ ...emptySelection(), plugins: ['files'] }, [{ ...files, requires: ['files'] }], []),
    /循环/,
  );
  assert.throws(
    () =>
      resolvePlugins(
        { ...emptySelection(), plugins: ['files'] },
        [{ ...files, requires: [], apiVersion: 2 }],
        [],
      ),
    /不兼容/,
  );
  assert.throws(
    () =>
      resolvePlugins(
        { ...emptySelection(), packs: ['essentials'] },
        PLUGINS.map((item) => (item.id === 'files' ? { ...item, version: '9.0.0' } : item)),
      ),
    /版本不匹配/,
  );
});

test('selection updates are serialized, dependency-safe and survive a restart', async () => {
  const file = join(directory, 'selection.json'),
    manager = new PluginManager(file);
  await manager.init();
  await Promise.all([
    manager.change({ kind: 'plugin', id: 'files', enabled: true }),
    manager.change({ kind: 'pack', id: 'developer', enabled: true }),
    manager.change({ kind: 'pack', id: 'operations', enabled: true }),
  ]);
  assert.deepEqual(manager.view().active, []);
  assert.equal(manager.view().restartRequired, true);
  await assert.rejects(manager.change({ kind: 'plugin', id: 'transfers', enabled: false }), /仍被依赖/);
  await manager.change({ kind: 'pack', id: 'developer', enabled: false });
  assert.ok(manager.view().planned.includes('files')); // Explicit root remains.
  assert.ok(manager.view().planned.includes('projects')); // Shared operations dependency remains.
  assert.ok(!manager.view().planned.includes('git'));
  const restored = new PluginManager(file);
  const order = await restored.init();
  restored.activated(order);
  assert.equal(restored.view().restartRequired, false);
  assert.deepEqual(restored.view().selection, manager.view().selection);
  await restored.change({ kind: 'pack', id: 'operations', enabled: false });
  assert.deepEqual(restored.view().planned, ['transfers', 'files']);
  await restored.change({ kind: 'plugin', id: 'files', enabled: false });
  assert.deepEqual(restored.view().planned, []);
});

test('failed persistence and malformed input leave the saved selection intact', async () => {
  const parent = join(directory, 'blocked'),
    manager = new PluginManager(join(parent, 'plugins.json'));
  await manager.init();
  await writeFile(parent, 'preserve');
  await assert.rejects(manager.change({ kind: 'plugin', id: 'files', enabled: true }));
  assert.deepEqual(manager.view().selection, emptySelection());
  assert.equal(await readFile(parent, 'utf8'), 'preserve');
  assert.throws(() => manager.change({ kind: 'plugin', id: 'files', enabled: 'true' }));
  const broken = join(directory, 'broken.json');
  await writeFile(broken, '{');
  await assert.rejects(new PluginManager(broken).init());
  assert.equal(await readFile(broken, 'utf8'), '{');
});

test('disabled plugins reject API calls and creation options before touching the VM', async () => {
  const vm = machines();
  vm.get = () => {
    throw new Error('Must not access VM');
  };
  const host = await Features.create(vm);
  const { req, res } = request();
  try {
    for (const path of [
      '/api/images',
      '/api/import',
      '/api/migration',
      '/api/vms/batch',
      '/api/vms/vm/file',
      '/api/vms/vm/desktop',
      '/api/vms/vm/snapshots',
      '/api/vms/vm/advanced',
      '/api/vms/vm/suspend',
    ]) {
      await assert.rejects(
        host.route(req, res, new URL('http://localhost' + path), async () => ({})),
        (error: any) => error.status === 403,
        path,
      );
    }
    assert.equal(await host.route(req, res, new URL('http://localhost/api/vms'), async () => ({})), false);
    assert.throws(() => host.validateConfig({ template: 'node' }), /projects/);
    assert.throws(() => host.validateConfig({ distro: 'ubuntu' }), /images/);
    assert.throws(() => host.validateConfig({ forwards: [{ host: 8080, guest: 80 }] }), /network/);
    const previous = {
      name: 'old',
      distro: 'ubuntu',
      template: 'node',
      forwards: [{ host: 8080, guest: 80 }],
    } as any;
    assert.doesNotThrow(() => host.validateConfig({ ...previous, memoryMiB: 2048 }, previous));
  } finally {
    await host.close();
  }
});

test('files activate only their declared services and cannot export through download tickets', async () => {
  const vm = machines(),
    host = await Features.create(vm, ['files']);
  try {
    assert.deepEqual([...host.enabled], ['transfers', 'files']);
    assert.equal(host.workspaces, undefined);
    assert.equal(host.backups, undefined);
    assert.equal(vm.listenerCount('change'), 0);
    assert.equal(typeof vm.fileBeforeReplace, 'function');
    const { req, res } = request('POST');
    await assert.rejects(
      host.route(req, res, new URL('http://localhost/api/vms/vm/download'), async () => ({ type: 'export' })),
      /snapshots/,
    );
    assert.deepEqual(Object.keys(host.errors), []);
  } finally {
    await host.close();
  }
  assert.equal(vm.fileBeforeReplace, undefined);
});

test('snapshot and desktop routes use path segment lengths after extraction', async () => {
  const vm = machines(),
    host = await Features.create(vm, ['snapshots', 'desktop']);
  vm.snapshot = async (_id, name) => ({ name }) as any;
  host.desktops.view = async () => ({ status: 'not-installed', log: '' });
  try {
    const first = request('POST');
    assert.equal(
      await host.route(first.req, first.res, new URL('http://localhost/api/vms/vm/snapshots'), async () => ({
        name: 'checkpoint',
      })),
      true,
    );
    assert.equal(first.res.status, 201);
    assert.equal(first.res.payload.name, 'checkpoint');
    const second = request();
    assert.equal(
      await host.route(
        second.req,
        second.res,
        new URL('http://localhost/api/vms/vm/desktop'),
        async () => ({}),
      ),
      true,
    );
    assert.equal(second.res.payload.status, 'not-installed');
  } finally {
    await host.close();
  }
  assert.equal(vm.listenerCount('change'), 0);
});

test('plugin activation failure is isolated and prevents dependent activation', async () => {
  const original = loaders.transfers;
  loaders.transfers = async () => {
    throw new Error('adapter unavailable');
  };
  try {
    const host = await Features.create(machines(), ['files', 'terminal-workspace']);
    assert.deepEqual([...host.enabled], ['terminal-workspace']);
    assert.match(host.errors.transfers, /adapter unavailable/);
    assert.match(host.errors.files, /依赖/);
    await host.close();
  } finally {
    loaders.transfers = original;
  }
});

test('the complete pack activates all adapters and releases every lifecycle listener', async () => {
  const vm = machines();
  const host = await Features.create(vm, resolvePlugins({ ...emptySelection(), packs: ['complete'] }));
  try {
    assert.deepEqual(host.errors, {});
    assert.equal(host.enabled.size, PLUGINS.length);
    assert.ok(vm.listenerCount('change') > 0);
    assert.ok(host.jobStores().length > 10);
  } finally {
    await host.close();
  }
  assert.equal(vm.listenerCount('change'), 0);
  assert.equal(vm.fileBeforeReplace, undefined);
});

test('disabling a plugin preserves instance and plugin data on disk', async () => {
  const folder = join(directory, 'retained-data');
  await mkdir(folder);
  const sentinel = join(folder, 'history.json');
  await writeFile(sentinel, 'keep all existing history');
  const manager = new PluginManager(join(folder, 'plugins.json'));
  await manager.init();
  await manager.change({ kind: 'plugin', id: 'files', enabled: true });
  await manager.change({ kind: 'plugin', id: 'files', enabled: false });
  assert.equal(await readFile(sentinel, 'utf8'), 'keep all existing history');
});
