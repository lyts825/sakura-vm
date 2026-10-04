import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PluginDirectory } from '../server/plugin-directory.ts';
import { withPluginAuthority } from '../server/plugin-authority.ts';
import { pluginCapabilities } from '../server/plugin-capabilities.ts';
import { ManagedHooks } from '../server/managed-hooks.ts';
import { TerminalBackend } from '../server/terminal-backend.ts';
import { SystemServices } from '../server/system-services.ts';
import { withPluginCleanup } from '../server/plugin-authority.ts';
import type { Machines } from '../server/machines.ts';

const host = () =>
  Object.assign(new EventEmitter(), {
    records: new Map([['vm', { id: 'vm', name: 'original' }]]),
    live: new Map([
      [
        'vm',
        {
          status: 'running',
          startedAt: 'boot',
          abort: new AbortController(),
          clients: new Set(),
        },
      ],
    ]),
    logs: new Map(),
    get(id: string) {
      return this.records.get(id);
    },
  }) as unknown as Machines;

test('VM ports expose immutable records and opaque live identities, and cached calls revoke', async () => {
  const directory = new PluginDirectory(),
    instance = directory.begin('official', 'test', '1', 'artifact');
  directory.publish(instance);
  const machines = host();
  const cap = pluginCapabilities('test', machines, instance.scope, instance);
  const vm = cap.vm,
    state = vm.get('vm');
  state.name = 'changed';
  assert.equal(machines.get('vm').name, 'original');
  const live = vm.live.get('vm')!;
  assert.equal(Object.hasOwn(live, 'clients'), false);
  assert.equal(Object.hasOwn(live.abort, 'abort'), false);
  assert.equal(Object.hasOwn(vm, 'maintenance'), false);
  assert.equal(Object.hasOwn(vm.records, 'set'), false);
  const get = vm.get;
  instance.revoke();
  assert.throws(() => get('vm'));
  await instance.scope.dispose();
});

test('domain hooks unregister the exact generation while unrelated hooks remain', async () => {
  const directory = new PluginDirectory(),
    a = directory.begin('official', 'a', '1', 'a'),
    b = directory.begin('official', 'b', '1', 'b');
  directory.publish(a);
  directory.publish(b);
  const hooks = new ManagedHooks<[number]>(),
    calls: string[] = [];
  withPluginAuthority(a, () =>
    hooks.register(async (n) => {
      calls.push('a' + n);
    }),
  );
  withPluginAuthority(b, () =>
    hooks.register(async (n) => {
      calls.push('b' + n);
    }),
  );
  await hooks.dispatch(1);
  a.revoke();
  await hooks.dispatch(2);
  assert.deepEqual(calls, ['a1', 'b1', 'b2']);
  assert.equal(hooks.size, 1);
  await a.scope.dispose();
  await b.scope.dispose();
  assert.equal(hooks.size, 0);
});

test('terminal children release only their own leases on plugin exit', async () => {
  const directory = new PluginDirectory(),
    system = directory.begin('system', 'terminal-backend', '1', 'backend');
  const a = directory.begin('official', 'a', '1', 'a'),
    b = directory.begin('official', 'b', '1', 'b');
  directory.publish(system);
  directory.publish(a);
  directory.publish(b);
  const backend = new TerminalBackend(host(), system);
  const root = (backend as unknown as { root: { prepare: (...args: unknown[]) => Promise<any> } }).root;
  const releases: string[] = [];
  root.prepare = async (_id, projectId) => ({
    projectId,
    command: '',
    networkIsolation: 'host',
    release: async () => {
      releases.push(projectId as string);
    },
  });
  const first = backend.handle(a),
    second = backend.handle(b),
    base = backend.handle();
  await first.prepare('vm', 'a');
  await second.prepare('vm', 'b');
  await base.prepare('vm', 'base');
  a.revoke();
  await a.scope.dispose();
  assert.deepEqual(releases, ['a']);
  await assert.rejects(async () => first.prepare('vm', 'late'));
  await second.close();
  assert.deepEqual(releases, ['a', 'b']);
  await base.close();
  assert.deepEqual(releases, ['a', 'b', 'base']);
  await b.scope.dispose();
  system.revoke();
  await system.scope.dispose();
});

test('system composition preserves brokered terminal preparation and its original revocation checks', async () => {
  const directory = new PluginDirectory(),
    services = new SystemServices(directory);
  const provider = directory.begin('system', 'terminal-backend', '1', 'backend');
  const backend = new TerminalBackend(host(), provider, undefined, services.broker, services.caller);
  directory.publish(provider);
  const terminals = await services.start({ id: 'projectTerminals', requires: [],
    create: () => backend.handle(), initialize: () => {}, dispose: value => value?.close() });
  const prepareTask = terminals.preparation.prepareTask;
  assert.equal(typeof prepareTask, 'function');
  assert.equal(typeof terminals.preparation.workspaces.projects.with, 'function');
  assert.equal(terminals.preparation.workspaces.projects.current('vm'), 'default');
  assert.throws(() => Reflect.get(terminals.preparation, 'machines'), { code: 'PLUGIN_SERVICE_PRIVATE' });
  await services.retire('projectTerminals');
  assert.throws(() => prepareTask('vm', 'default'), { code: 'PLUGIN_REVOKED' });
  await services.close();
  provider.revoke();
  await provider.scope.dispose(async (dispose) => {
    await withPluginCleanup(provider, dispose);
  });
});
