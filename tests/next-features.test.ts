import test from 'node:test';
import assert from 'node:assert/strict';
import { projectIndexSchema } from '../server/project-catalog.ts';
import { pipelineSchema } from '../server/pipelines.ts';
import {
  declarationVersion,
  matchesVersion,
  runtimeEnvironment,
  runtimesSchema,
} from '../server/runtime-versions.ts';
import { gitActionSchema } from '../server/git-workbench.ts';
import { syncDirection } from '../server/sync.ts';
import { projectSchema } from '../server/workspaces.ts';
import { nextFeatureCatalog } from '../server/next-features.ts';

test('project catalog keeps a default project and rejects duplicate identities', () => {
  assert.equal(
    projectIndexSchema.safeParse({ active: 'default', projects: [{ id: 'default', name: '默认项目' }] })
      .success,
    true,
  );
  assert.equal(
    projectIndexSchema.safeParse({ active: 'abc', projects: [{ id: 'default', name: '默认项目' }] }).success,
    false,
  );
  assert.equal(
    projectIndexSchema.safeParse({
      active: 'default',
      projects: [
        { id: 'default', name: '默认项目' },
        { id: 'default', name: '重复' },
      ],
    }).success,
    false,
  );
});

test('pipelines validate bounded steps and artifact paths', () => {
  const pipeline = pipelineSchema.parse({
    name: '检查',
    steps: [{ name: '测试', command: 'npm test' }],
    artifacts: ['dist', 'coverage'],
  });
  assert.equal(pipeline.steps[0].timeout, 300);
  assert.equal(
    pipelineSchema.safeParse({
      name: 'bad',
      steps: [{ name: 'x', command: 'true' }],
      artifacts: ['../outside'],
    }).success,
    false,
  );
  assert.equal(pipelineSchema.safeParse({ name: 'bad', steps: [] }).success, false);
});

test('runtime declarations and selected environments are deterministic', () => {
  assert.equal(declarationVersion('v22.12.0\n'), '22.12.0');
  assert.equal(declarationVersion('Python 3.12.1'), null);
  assert.equal(matchesVersion('22.12.1', '22.12'), true);
  assert.equal(matchesVersion('22.13.0', '22.12'), false);
  assert.deepEqual(runtimesSchema.parse({ node: '22.12.0' }), { node: '22.12.0' });
  assert.match(runtimeEnvironment({ node: '22.12.0' }).PATH, /node-22\.12\.0/);
});

test('remote Git actions stay HTTPS and shell-safe', () => {
  assert.equal(
    gitActionSchema.safeParse({ action: 'remote-add', name: 'origin', url: 'https://git.example/repo.git' })
      .success,
    true,
  );
  assert.equal(
    gitActionSchema.safeParse({ action: 'remote-add', name: 'origin', url: 'ssh://git@example/repo' })
      .success,
    false,
  );
  assert.equal(gitActionSchema.safeParse({ action: 'push', remote: 'origin', branch: 'main' }).success, true);
  assert.equal(gitActionSchema.safeParse({ action: 'push', remote: '--mirror' }).success, false);
});

test('sync baseline distinguishes safe deletion from a new file', () => {
  assert.equal(syncDirection(undefined, 'old', 'old'), 'pull');
  assert.equal(syncDirection('old', undefined, 'old'), 'push');
  assert.equal(syncDirection(undefined, 'new', 'old'), 'pull');
  assert.equal(projectSchema.safeParse({ runtimes: { node: '22.12.0' } }).success, true);
});

test('the third feature tranche has 100 unique entries with implementation states', () => {
  assert.equal(nextFeatureCatalog.length, 100);
  assert.equal(new Set(nextFeatureCatalog.map(([id]) => id)).size, 100);
  assert.equal(new Set(nextFeatureCatalog.map(([, , category]) => category)).size, 10);
  assert.ok(nextFeatureCatalog.every(([, , , priority]) => ['P0', 'P1', 'P2'].includes(priority)));
  assert.equal(nextFeatureCatalog.find(([id]) => id === 'incident-lockdown')?.[5], 'available');
  assert.equal(nextFeatureCatalog.find(([id]) => id === 'desktop-recording')?.[5], 'available');
  assert.ok(nextFeatureCatalog.every(([id]) => /^[a-z][a-z0-9-]+$/.test(id)));
});
