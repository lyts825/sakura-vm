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
  pluginSurfaceEnabled,
  PLUGIN_API_VERSION,
  developmentSections,
} from '../shared/plugins.ts';
import { resolvePlugins, validateCatalog } from '../shared/plugin-selection.ts';
import { pluginManifestSchema, pluginPackSchema } from '../shared/plugin-schema.ts';

const directory = await mkdtemp(join(tmpdir(), 'sakura-plugins-'));
process.env.SAKURA_DATA_DIR = directory;
const { PluginManager } = await import('../server/plugin-manager.ts');
const { Features } = await import('../server/features.ts');
const { loaders, routeContribution, socketOwner } = await import('../server/plugins/registry.ts');
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
        assert.ok(order.indexOf(dependency.id) < order.indexOf(id));
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
      resolvePlugins(
        { ...emptySelection(), plugins: ['files'] },
        PLUGINS.map((item) =>
          item.id === 'files' ? { ...files, requires: [{ id: 'files', version: files.version }] } : item,
        ),
      ),
    /循环/,
  );
  assert.throws(
    () =>
      resolvePlugins(
        { ...emptySelection(), plugins: ['files'] },
        PLUGINS.map((item) =>
          item.id === 'files' ? { ...files, apiVersion: PLUGIN_API_VERSION + 1 } : item,
        ),
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

test('file-lock route grants one lease and guards file mutations until release', async () => {
  const vm = machines(), host = await Features.create(vm, ['files']);
  const endpoint = 'http://localhost/api/vms/vm/file-lock?path=%2Fworkspace%2Fnotes.txt';
  const call = async (method: string, url: string, input?: unknown) => {
    const { req, res } = request(method);
    await host.route(req, res, new URL(url), async () => input);
    return res.payload;
  };
  try {
    const first = await call('POST', endpoint, { action: 'acquire' });
    assert.match(first.token, /^[0-9a-f-]{36}$/);
    assert.deepEqual(await call('GET', endpoint), {
      path: '/workspace/notes.txt', locked: true, expiresAt: first.expiresAt,
    });
    await assert.rejects(call('POST', endpoint, { action: 'acquire' }),
      (error: any) => error.status === 409);
    await assert.rejects(call('POST', 'http://localhost/api/vms/vm/file-operation', {
      action: 'delete', path: '/workspace/notes.txt', recursive: false,
    }), (error: any) => error.status === 409);
    await call('POST', endpoint, { action: 'release', token: first.token });
    assert.equal((await call('GET', endpoint)).locked, false);
  } finally {
    await host.close();
  }
});

test('snapshot and desktop routes use path segment lengths after extraction', async () => {
  const vm = machines(),
    host = await Features.create(vm, ['snapshots', 'desktop']);
  vm.snapshot = async (_id, name) => ({ name }) as any;
  vm.onlineSnapshot = async (_id, name) => ({ name, consistency: 'filesystem' }) as any;
  vm.memorySnapshot = async (_id, name) => ({ name, consistency: 'vmstate' }) as any;
  vm.restoreMemory = async (id, snapshotId, backup) => ({ id, snapshotId, backup }) as any;
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
    const online = request('POST');
    assert.equal(
      await host.route(online.req, online.res, new URL('http://localhost/api/vms/vm/snapshots'), async () => ({
        name: 'live', online: true,
      })),
      true,
    );
    assert.equal(online.res.payload.consistency, 'filesystem');
    const memory = request('POST');
    assert.equal(
      await host.route(memory.req, memory.res, new URL('http://localhost/api/vms/vm/snapshots'),
        async () => ({ name: 'process', online: true, memory: true })),
      true,
    );
    assert.equal(memory.res.payload.consistency, 'vmstate');
    const restore = request('POST');
    restore.req.headers['content-type'] = 'application/json';
    assert.equal(
      await host.route(restore.req, restore.res,
        new URL('http://localhost/api/vms/vm/snapshots/checkpoint/restore'),
        async () => ({ backup: true, memory: true })),
      true,
    );
    assert.deepEqual(restore.res.payload,
      { id: 'vm', snapshotId: 'checkpoint', backup: true });
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

test('split packages activate only the services needed for the selected capability', async () => {
  const cases = [
    ['transfers', ['transfers'], ['files', 'bundles', 'workspaces']],
    ['snapshots', ['transfers', 'snapshots'], ['files', 'history', 'workspaces']],
    ['metrics', ['metrics'], ['workspaces', 'health', 'suite']],
    ['recipes', ['projects', 'recipes'], ['ide', 'files', 'suite']],
    ['ide', ['projects', 'ide'], ['recipes', 'files', 'suite']],
    ['commands', ['projects', 'commands'], ['files', 'toolchains', 'pipelines', 'runtimes']],
    ['toolchains', ['projects', 'toolchains'], ['files', 'commands', 'pipelines', 'runtimes']],
    ['runtimes', ['projects', 'runtimes'], ['files', 'commands', 'pipelines', 'toolchains']],
    ['extensions', ['projects', 'extensions'], ['suite', 'next', 'health']],
    ['platform', ['projects', 'platform'], ['suite', 'extended', 'health']],
  ] as const;
  for (const [id, expected, absent] of cases) {
    const vm = machines();
    const host = await Features.create(vm, [id]);
    try {
      assert.deepEqual(host.errors, {}, id);
      assert.deepEqual([...host.enabled], expected, id);
      for (const service of absent) assert.equal(host[service], undefined, `${id} must not load ${service}`);
      if (id === 'metrics') {
        assert.equal(vm.listenerCount('change'), 0);
        assert.deepEqual(host.jobStores(), []);
        assert.equal(pluginSurfaceEnabled([...host.enabled], 'tabs', 'project'), false);
      }
      if (id === 'extensions' || id === 'platform') {
        const { req, res } = request();
        await assert.rejects(
          host.route(req, res, new URL('http://localhost/api/vms/vm/advanced'), async () => ({})),
          /automation/,
        );
      }
    } finally {
      await host.close();
    }
    assert.equal(vm.listenerCount('change'), 0, id);
  }
  assert.deepEqual(developmentSections(['commands']), ['commands']);
  assert.deepEqual(developmentSections(['network']), ['network']);
  assert.deepEqual(developmentSections(['metrics']), []);
});

test('standalone metrics invalidate a cached sample when the guest restarts without project listeners', async () => {
  const vm = machines();
  vm.state = () => 'running';
  vm.live.set('vm', { startedAt: 'first' } as any);
  const pending: Array<{ resolve: (value: any) => void; reject: (error: Error) => void }> = [];
  vm.exec = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const host = await Features.create(vm, ['metrics']);
  try {
    const first = host.metrics.sample('vm');
    const rejected = assert.rejects(first, /previous boot/);
    assert.equal(host.metrics.sample('vm'), first);
    vm.live.set('vm', { startedAt: 'second' } as any);
    const second = host.metrics.sample('vm');
    assert.notEqual(second, first);
    pending[0].reject(new Error('previous boot'));
    await rejected;
    assert.equal(host.metrics.sample('vm'), second);
    pending[1].resolve({
      code: 0,
      stderr: '',
      stdout:
        'CPU\ncpu 1 0 0 9 0 0 0 0\ncpu 2 0 0 18 0 0 0 0\nMEMORY\nMemTotal: 1000 kB\nMemAvailable: 500 kB\nDISK\n/dev/vda 1000 500 500 50% /\nPROCESSES\n1 init\nUPTIME\n1.0 0.5\n',
    });
    assert.equal((await second).cpuPercent, 10);
    assert.equal(vm.listenerCount('change'), 0);
  } finally {
    await host.close();
  }
});

test('nested packs preserve shared and explicit roots and reject cycles and incompatible pins', async () => {
  const developer = PLUGIN_PACKS.find((pack) => pack.id === 'developer')!;
  assert.ok(developer.members.some((item) => item.kind === 'pack' && item.id === 'development'));
  const manager = new PluginManager(join(directory, 'nested.json'));
  await manager.init();
  await manager.change({ kind: 'pack', id: 'developer', enabled: true });
  await manager.change({ kind: 'plugin', id: 'commands', enabled: true });
  assert.ok(manager.view().reasons.commands.some((root) => root.kind === 'pack' && root.id === 'developer'));
  await manager.change({ kind: 'pack', id: 'developer', enabled: false });
  assert.deepEqual(manager.view().planned, ['projects', 'commands']);
  assert.deepEqual(manager.view().reasons.commands, [{ kind: 'plugin', id: 'commands' }]);
  const cycle = PLUGIN_PACKS.map((pack) =>
    pack.id === 'development'
      ? { ...pack, members: [{ kind: 'pack' as const, id: pack.id, version: pack.version }] }
      : pack,
  );
  assert.throws(() => validateCatalog(PLUGINS, cycle), /整合包依赖循环/);
  const pins = PLUGIN_PACKS.map((pack) =>
    pack.id === 'developer'
      ? { ...pack, members: [{ kind: 'pack' as const, id: 'development', version: '9.0.0' }] }
      : pack,
  );
  assert.throws(() => validateCatalog(PLUGINS, pins), /版本不匹配/);
});

test('legacy aggregate selections migrate without rewriting data and old CLI IDs still work', async () => {
  const file = join(directory, 'legacy.json');
  const original = JSON.stringify({
    schemaVersion: 1,
    plugins: ['development', 'environment', 'monitoring', 'files'],
    packs: ['essentials'],
  });
  await writeFile(file, original);
  const manager = new PluginManager(file);
  await manager.init();
  assert.equal(await readFile(file, 'utf8'), original);
  assert.deepEqual(manager.view().selection, {
    schemaVersion: 3,
    plugins: ['files'],
    packs: ['development', 'environment', 'essentials', 'monitoring'],
  });
  assert.equal(manager.view().migrations.length, 3);
  for (const id of ['commands', 'recipes', 'ide', 'metrics', 'service-health'])
    assert.ok(manager.view().planned.includes(id));
  await manager.change({ kind: 'plugin', id: 'development', enabled: false });
  assert.ok(!manager.view().planned.includes('commands'));
  assert.ok(manager.view().planned.includes('files'));
  assert.equal(JSON.parse(await readFile(file, 'utf8')).schemaVersion, 3);
  const restored = new PluginManager(file);
  await restored.init();
  assert.deepEqual(restored.view().selection, manager.view().selection);
  await restored.change({ kind: 'plugin', id: 'development', enabled: true });
  assert.ok(restored.view().selection.packs.includes('development'));
  const unknown = join(directory, 'unknown-schema.json');
  await writeFile(unknown, '{"schemaVersion":99,"plugins":[],"packs":[]}');
  await assert.rejects(new PluginManager(unknown).init());
});

test('manifest schemas and catalog checks reject ambiguous or unsupported contracts', () => {
  const files = PLUGINS.find((item) => item.id === 'files')!;
  const change = (patch: Partial<typeof files>) =>
    PLUGINS.map((item) => (item.id === files.id ? { ...files, ...patch } : item));
  assert.throws(() => pluginManifestSchema.parse({ ...files, schemaVersion: 99 }));
  assert.throws(() => pluginManifestSchema.parse({ ...files, undocumented: true }));
  assert.throws(() => pluginManifestSchema.parse({ ...files, version: '^0.2.0' }));
  assert.throws(() => pluginPackSchema.parse({ ...PLUGIN_PACKS[0], kind: 'plugin' }));
  assert.throws(() => validateCatalog(change({ services: ['workspaces'] }), PLUGIN_PACKS), /服务归属冲突/);
  assert.throws(() => validateCatalog(change({ services: ['machines'] }), PLUGIN_PACKS), /服务归属冲突/);
  assert.throws(
    () => validateCatalog(change({ optional: [{ id: 'projects', version: '9.0.0' }] }), PLUGIN_PACKS),
    /依赖版本不匹配/,
  );
  assert.throws(
    () => validateCatalog(change({ requires: [{ id: 'missing', version: '0.2.0' }] }), PLUGIN_PACKS),
    /不存在/,
  );
  const withHttp = (path: string, projectScoped = false) =>
    change({ contributes: { ...files.contributes, http: [{ path, projectScoped, methods: ['GET'] }] } });
  assert.throws(() => validateCatalog(withHttp('/api/plugins'), PLUGIN_PACKS), /核心入口/);
  for (const path of ['/api/audit', '/api/monitor', '/api/openapi', '/api/sdk', '/api/log-retention', '/api/graphql', '/api/graphql-schema', '/api/vms/:vmId/lockdown'])
    assert.throws(() => validateCatalog(withHttp(path), PLUGIN_PACKS), /核心入口/);
  assert.throws(() => validateCatalog(withHttp('/api/vms/:vmId/stop'), PLUGIN_PACKS), /核心入口/);
  assert.throws(() => validateCatalog(withHttp('/api/images'), PLUGIN_PACKS), /路由归属冲突/);
  assert.throws(
    () =>
      validateCatalog(
        change({
          optional: [],
          contributes: {
            ...files.contributes,
            http: [{ path: '/api/vms/:vmId/file', methods: ['GET'], projectScoped: true }],
          },
        }),
        PLUGIN_PACKS,
      ),
    /项目作用域/,
  );
  assert.throws(
    () =>
      validateCatalog(change({ contributes: { ...files.contributes, sockets: ['desktop'] } }), PLUGIN_PACKS),
    /WebSocket 归属冲突/,
  );
});

test('HTTP ownership, methods, project scoping and socket gates come from declarations', async () => {
  assert.equal(routeContribution('/api/vms/vm/commands')?.owner, 'commands');
  assert.equal(routeContribution('/api/vms/vm/commands')?.projectScoped, true);
  assert.equal(routeContribution('/api/vms/vm/metrics')?.projectScoped, false);
  assert.equal(routeContribution('/api/vms/batch')?.owner, 'library');
  assert.equal(routeContribution('/api/vms/vm/start'), undefined);
  assert.equal(routeContribution('/api/vms/vm/commands-other'), undefined);
  assert.equal(routeContribution('/api/vms/vm/snapshots/checkpoint/restore')?.owner, 'snapshots');
  assert.equal(socketOwner('desktop'), 'desktop');
  assert.equal(socketOwner('terminal-session'), 'terminal-workspace');
  const host = await Features.create(machines(), ['commands']);
  try {
    assert.equal(host.socketEnabled('terminal-session'), false);
    const { req, res } = request('PATCH');
    await assert.rejects(
      host.route(req, res, new URL('http://localhost/api/vms/vm/commands'), async () => ({})),
      (error: any) => error.status === 405,
    );
  } finally {
    await host.close();
  }
});

test('module mismatches are rejected before activation and cannot clean up another plugin', async () => {
  const original = loaders.images;
  let activated = false,
    disposed = false;
  loaders.images = async () => ({
    ...(await original()),
    manifest: PLUGINS.find((item) => item.id === 'files')!,
    activate: async () => {
      activated = true;
    },
    deactivate: async () => {
      disposed = true;
    },
  });
  try {
    const host = await Features.create(machines(), ['images', 'files']);
    assert.match(host.errors.images, /入口与声明不一致/);
    assert.equal(activated, false);
    assert.equal(disposed, false);
    assert.ok(host.files);
    await host.close();
  } finally {
    loaders.images = original;
  }
});

test('service contracts reject undeclared reads and writes and await asynchronous cleanup', async () => {
  const original = loaders.images;
  const events: string[] = [];
  for (const violation of ['read', 'write', 'missing'] as const) {
    loaders.images = async () => ({
      ...(await original()),
      activate: async (host) => {
        if (violation === 'missing') return;
        host.images = {
          close: async () => {
            events.push('close');
          },
        } as any;
        if (violation === 'read') void host.workspaces;
        else host.files = {} as any;
      },
      deactivate: async () => {
        await Promise.resolve();
        events.push('deactivate');
      },
    });
    try {
      const host = await Features.create(machines(), ['images']);
      assert.match(
        host.errors.images,
        violation === 'read' ? /未声明服务读取/ : violation === 'write' ? /非自有服务/ : /未注册声明的服务/,
      );
      assert.equal(host.images, undefined);
      assert.equal(host.files, undefined);
      assert.equal(host.enabled.size, 0);
      await host.close();
    } finally {
      loaders.images = original;
    }
  }
  assert.deepEqual(events, ['deactivate', 'close', 'deactivate', 'close', 'deactivate']);
});
