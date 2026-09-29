import test from 'node:test';
import assert from 'node:assert/strict';
import {
  featureCatalogView,
  implementedFeatureCatalogView,
  resourcePresets,
  FeatureSuite,
} from '../server/feature-suite.ts';
import { Jobs } from '../server/jobs.ts';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';

test('feature suite exposes the complete six-category roadmap', () => {
  const features = featureCatalogView();
  assert.equal(features.length, 50);
  assert.equal(new Set(features.map((feature) => feature.id)).size, 50);
  assert.equal(new Set(features.map((feature) => feature.category)).size, 6);
  assert.ok(features.every((feature) => ['P0', 'P1', 'P2'].includes(feature.priority)));
  assert.ok(features.some((feature) => feature.id === 'metrics-history' && feature.state === 'available'));
  assert.ok(features.some((feature) => feature.id === 'dynamic-memory' && feature.state === 'available'));
  assert.ok(features.some((feature) => feature.id === 'test-explorer' && feature.state === 'available'));
  assert.ok(features.some((feature) => feature.id === 'gpu-acceleration' && feature.state === 'available'));
  assert.deepEqual(implementedFeatureCatalogView(), features);
  assert.ok(features.some((feature) => feature.id === 'single-app-windows' &&
    feature.implemented && feature.state === 'available'));
});

test('resource presets stay within the VM configuration limits', () => {
  assert.deepEqual(Object.keys(resourcePresets), ['light', 'development', 'build', 'desktop']);
  assert.ok(
    Object.values(resourcePresets).every((preset) => preset.memoryMiB >= 256 && preset.memoryMiB <= 8192),
  );
  assert.ok(Object.values(resourcePresets).every((preset) => preset.cpus >= 1 && preset.cpus <= 8));
});

test('private project developer tasks use the namespace and reject shared-network containers', async () => {
  const commands: string[] = [];
  const project = { directory: '/workspace/app', networkIsolation: 'private' as const,
    environment: {} };
  const machines = {
    get: () => ({ distro: 'alpine' }),
    live: new Map(),
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stdout: '', stderr: '' };
    },
  } as unknown as Machines;
  const workspaces = { projects: { key: () => 'vm', current: () => 'default' },
    resolvedConfig: async () => project } as unknown as Workspaces;
  const suite = new FeatureSuite(machines, workspaces);
  suite.jobs = new Jobs();
  try {
    suite.dev('vm', { operation: 'test-discover' });
    await suite.jobs.wait('vm:dev');
    assert.equal(suite.jobs.view('vm:dev')?.status, 'done');
    assert.match(commands[0], /ip netns exec sk-default sh -lc/);
    assert.match(commands[0], /sakura_ipv4=.*ip -n sk-default/);
    suite.dev('vm', { operation: 'install-cached-dependencies', manager: 'npm' });
    await suite.jobs.wait('vm:dev');
    assert.equal(suite.jobs.view('vm:dev')?.status, 'done');
    assert.match(commands[1], /ip netns exec sk-default sh -lc/);
    suite.dev('vm', { operation: 'install-locked' });
    await suite.jobs.wait('vm:dev');
    assert.equal(suite.jobs.view('vm:dev')?.status, 'done');
    assert.match(commands[2], /ip netns exec sk-default sh -lc/);
    suite.dev('vm', { operation: 'database', database: 'redis',
      password: 'very-long-password' });
    await suite.jobs.wait('vm:dev');
    assert.equal(suite.jobs.view('vm:dev')?.status, 'error');
    assert.match(suite.jobs.view('vm:dev')?.error || '', /私有网络项目不能启动/);
    assert.equal(commands.length, 3);
  } finally { await suite.close(); }
});
