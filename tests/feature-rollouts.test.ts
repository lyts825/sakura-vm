import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FeatureRollouts } from '../server/feature-rollouts.ts';
import { Features } from '../server/features.ts';
import { PluginManager } from '../server/plugin-manager.ts';
import type { Machines } from '../server/machines.ts';

test('versioned host rollout survives restart and gates selected plugin activation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-rollout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'rollouts.json');
  let blocked = false;
  const rollouts = new FeatureRollouts(file, () => blocked);
  await rollouts.init();
  const hostId = rollouts.view().hostId;
  assert.equal(rollouts.decision('metrics').allowed, true);
  const disabled = { pluginId: 'metrics', enabled: false, percentage: 100, cohortVersion: 'v1' };
  await rollouts.configure({ operation: 'save', policy: disabled });
  assert.equal(rollouts.decision('metrics').allowed, false);
  assert.equal(rollouts.decision('metrics', { ...disabled, enabled: true }).allowed, true);
  await assert.rejects(rollouts.configure({ operation: 'save', policy: disabled }), /已变化/);
  blocked = true;
  await assert.rejects(rollouts.configure({ operation: 'remove', pluginId: 'metrics',
    revision: 1 }), /维护中/);
  blocked = false;
  await rollouts.close();

  const restarted = new FeatureRollouts(file);
  await restarted.init();
  assert.equal(restarted.view().hostId, hostId);
  assert.equal(restarted.decision('metrics').allowed, false);
  const managerFile = join(root, 'plugins.json');
  const manager = new PluginManager(managerFile);
  await manager.init();
  await manager.change({ kind: 'plugin', id: 'metrics', enabled: true });
  const installed = new PluginManager(managerFile);
  const selected = await installed.init();
  const machines = Object.assign(new EventEmitter(), {
    records: new Map(), get: () => ({}),
  }) as unknown as Machines;
  const skipped = await Features.create(machines, selected,
    (id) => restarted.decision(id).allowed);
  try {
    installed.activated(skipped.enabled, skipped.errors, skipped.lifecycle);
    assert.equal(skipped.enabled.has('metrics'), false);
    assert.equal(skipped.lifecycle.metrics.phase, 'skipped');
    assert.match(skipped.errors.metrics, /灰度/);
    assert.equal(installed.view().restartRequired, false);
  } finally {
    await skipped.close();
  }
  await restarted.configure({ operation: 'save', revision: 1,
    policy: { ...disabled, enabled: true, percentage: 100 } });
  const active = await Features.create(machines, selected,
    (id) => restarted.decision(id).allowed);
  try {
    assert.equal(active.enabled.has('metrics'), true);
  } finally {
    await active.close();
  }
  await restarted.close();
});

test('rollout percentage uses a stable versioned cohort and cannot bypass a disabled flag', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-rollout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'rollouts.json');
  const service = new FeatureRollouts(file);
  await service.init();
  const base = { pluginId: 'metrics', enabled: true, percentage: 25, cohortVersion: 'canary-1' };
  const preview = await service.configure({ operation: 'preview', policy: base });
  assert.ok('bucket' in preview);
  await service.configure({ operation: 'save', policy: base });
  assert.equal(service.decision('metrics').bucket, preview.bucket);
  assert.equal(service.decision('metrics').allowed, preview.allowed);
  await service.close();
  const resumed = new FeatureRollouts(file);
  await resumed.init();
  assert.deepEqual(resumed.decision('metrics'), service.decision('metrics'));
  assert.equal(resumed.decision('metrics', { ...base, percentage: 0 }).allowed, false);
  assert.equal(resumed.decision('metrics', { ...base, percentage: 100 }).allowed, true);
  assert.equal(resumed.decision('metrics', { ...base, enabled: false }).allowed, false);
  await resumed.configure({ operation: 'remove', pluginId: 'metrics', revision: 1 });
  assert.equal(resumed.decision('metrics').allowed, true);
  await resumed.close();
});
