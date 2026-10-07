/**
 * 回归范围（完整情景见下方用例与断言）：
 * - namespaces and generations retain ownership until cleanup is confirmed
 * - manager reads live unload and cleanup state without an activation snapshot
 * - activation publishes once while live contribution and permission changes advance the directory
 */
import { services as metricsContract } from '../plugins/metrics/services.ts';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PluginDirectory } from '../server/plugin-directory.ts';
import { PluginManager } from '../server/plugin-manager.ts';
import type { Machines } from '../server/machines.ts';
import { loaders } from '../server/plugins/registry.ts';

test('namespaces and generations retain ownership until cleanup is confirmed', async () => {
  const directory = new PluginDirectory();
  directory.setDesired('official', ['metrics']);
  const first = directory.begin('official', 'metrics', '1.0.0', 'a'.repeat(64));
  const community = directory.begin('community', 'metrics', '1.0.0', 'b'.repeat(64), ['compute']);
  directory.publish(first);
  directory.publish(community);
  assert.notEqual(first.identity, community.identity);
  first.revoke();
  first.phase = 'cleanup-pending';
  assert.throws(() => directory.begin('official', 'metrics', '2.0.0', 'c'.repeat(64)), {
    code: 'PLUGIN_CLEANUP_PENDING',
  });
  assert.throws(() => first.check(), { code: 'PLUGIN_REVOKED' });
  community.check('compute');
  assert.throws(() => community.check('vm'), { code: 'PLUGIN_PERMISSION_DENIED' });
  await first.scope.dispose();
  first.phase = 'inactive';
  const second = directory.begin('official', 'metrics', '2.0.0', 'c'.repeat(64));
  directory.publish(second);
  assert.notEqual(first.generation, second.generation);
  assert.throws(() => first.check(), { code: 'PLUGIN_REVOKED' });
  assert.equal(directory.view().instances.find((item) => item.identity === first.identity)?.desired, true);
  await second.scope.dispose();
  await community.scope.dispose();
});

test('manager reads live unload and cleanup state without an activation snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-plugin-manager-'));
  const file = join(root, 'plugins.json'),
    original = loaders.metrics;
  let attempt = 0;
  loaders.metrics = async () => ({
    ...(await original()),
    activate: async (host) => {
      host.provide(metricsContract.metrics, {
        sample: async () => ({}), forget: () => {},
        close: async () => {
          if (++attempt === 1) throw new Error('cleanup receipt');
        },
      } as any);
    },
  });
  const manager = new PluginManager(file);
  try {
    await writeFile(file, JSON.stringify({ schemaVersion: 3, plugins: ['metrics'], packs: [] }));
    await manager.init();
    await manager.start(Object.assign(new EventEmitter(), { records: new Map() }) as Machines);
    assert.deepEqual(manager.view().active, ['metrics']);
    await assert.rejects(manager.unload('metrics'), AggregateError);
    assert.deepEqual(manager.view().active, []);
    assert.equal(
      manager.view().runtime?.instances.find((item) => item.identity === 'official:metrics')?.phase,
      'cleanup-pending',
    );
    await manager.unload('metrics');
    assert.equal(
      manager.view().runtime?.instances.find((item) => item.identity === 'official:metrics')?.phase,
      'inactive',
    );
  } finally {
    await manager.close();
    loaders.metrics = original;
    await rm(root, { recursive: true, force: true });
  }
});

test('activation publishes once while live contribution and permission changes advance the directory', async () => {
  const directory = new PluginDirectory();
  const instance = directory.begin('official', 'metrics', '1.0.0', 'a'.repeat(64));
  const activating = directory.view().version;
  instance.contribute('operation', 'sample');
  instance.contribute('event', 'vm:change');
  assert.equal(directory.view().version, activating);
  directory.publish(instance);
  const published = directory.view().version;
  const unregister = instance.contribute('event', 'vm:started');
  assert.equal(directory.view().version, published + 1);
  unregister();
  assert.equal(directory.view().version, published + 2);
  unregister();
  assert.equal(directory.view().version, published + 2);
  instance.setPermissions(['vm']);
  assert.equal(directory.view().version, published + 3);
  await instance.scope.dispose();
});
