import test from 'node:test';
import assert from 'node:assert/strict';
import {
  featureCatalogView,
  implementedFeatureCatalogView,
  resourcePresets,
  FeatureSuite,
} from '../server/feature-suite.ts';
import { projectSchema, projectVersion } from '../server/workspaces.ts';
import { projectIdentityPayload } from '../server/project-identity.ts';
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

test('private finite developer tasks use captured UID contracts and reject shared-network containers', async () => {
  const commands: string[] = [];
  const project = projectSchema.parse({ directory: '/workspace/app', networkIsolation: 'private', environment: {} });
  const live = { startedAt: 'fixture' }, uidCommands: string[] = [];
  const machines = {
    get: () => ({ distro: 'alpine' }),
    live: new Map([['vm', live]]), state: () => 'running',
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stdout: '', stderr: '' };
    },
  } as unknown as Machines;
  const workspaces = { projects: { key: () => 'vm', current: () => 'default',
    inScope: (_id: string, _scope: string, action: () => unknown) => action() },
    config: async () => project, resolveProject: async () => project,
    resolvedConfig: async () => project } as unknown as Workspaces;
  const suite = new FeatureSuite(machines, workspaces, {}, {
    terminals: { prepare: async (_id, scope, _session, _readOnly, signal) => ({
      command: 'unused', projectId: scope!, networkIsolation: 'private', terminalId: undefined, signal: signal!,
      captured: { project, configVersion: projectVersion(project), live: live as any }, release: () => {},
    }) }, runTask: async (_machines, _id, captured, execution, _signal, _log, _timeout, _agent, _cleanup, pins) => {
      assert.equal(captured.networkIsolation, 'private'); assert.equal(pins?.expectedLive, live);
      projectIdentityPayload(execution); uidCommands.push(execution.command);
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  suite.jobs = new Jobs();
  try {
    suite.dev('vm', { operation: 'test-discover' });
    await suite.jobs.wait('vm:dev');
    assert.equal(suite.jobs.view('vm:dev')?.status, 'done');
    assert.match(uidCommands[0], /find \. -type d/);
    assert.equal(commands.length, 0);
    suite.dev('vm', { operation: 'install-cached-dependencies', manager: 'npm' });
    await suite.jobs.wait('vm:dev');
    assert.equal(suite.jobs.view('vm:dev')?.status, 'done');
    assert.match(commands[0], /ip netns exec sk-default sh -lc/);
    suite.dev('vm', { operation: 'install-locked' });
    await suite.jobs.wait('vm:dev');
    assert.equal(suite.jobs.view('vm:dev')?.status, 'done');
    assert.match(uidCommands[1], /npm ci/);
    suite.dev('vm', { operation: 'database', database: 'redis',
      password: 'very-long-password' });
    await suite.jobs.wait('vm:dev');
    assert.equal(suite.jobs.view('vm:dev')?.status, 'error');
    assert.match(suite.jobs.view('vm:dev')?.error || '', /私有数据库需要启用容器插件/);
    assert.equal(commands.filter(command => command.includes('# SAKURA_GUEST_TASK_RUN')).length, 1);
    assert.equal(uidCommands.length, 2);
  } finally { await suite.close(); }
});
