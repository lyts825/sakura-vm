/**
 * 模块职责：回归验证模块，围绕 `next-features` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `next-features`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: project catalog keeps a default project and rejects duplicate identities; pipelines validate bounded steps and artifact paths.
 */
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
import { capabilityParameters } from '../server/capability-definitions.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: project catalog keeps a default project and rejects duplicate identities
 * 协作入口 / Collaborators: `assert.equal`, `projectIndexSchema.safeParse`.
 * 检查边界 / Checked boundaries: `assert.equal( projectIndexSchema.safeParse({ active: 'default', projects: [{ id: 'default', name: '默认项目' }] }) .success, true, )`; `assert.equal( projectIndexSchema.safeParse({ active: 'abc', projects: [{ id: 'default', name: '默认项目' }] }).success, false, )`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pipelines validate bounded steps and artifact paths
 * 协作入口 / Collaborators: `pipelineSchema.parse`, `assert.equal`, `pipelineSchema.safeParse`.
 * 检查边界 / Checked boundaries: `assert.equal(pipeline.steps[0].timeout, 300)`; `assert.equal( pipelineSchema.safeParse({ name: 'bad', steps: [{ name: 'x', command: 'true' }], artifacts: ['../outside'], }).succe…`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: runtime declarations and selected environments are deterministic
 * 协作入口 / Collaborators: `assert.equal`, `declarationVersion`, `matchesVersion`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.equal(declarationVersion('v22.12.0\n'), '22.12.0')`; `assert.equal(declarationVersion('Python 3.12.1'), null)`.
 */
test('runtime declarations and selected environments are deterministic', () => {
  assert.equal(declarationVersion('v22.12.0\n'), '22.12.0');
  assert.equal(declarationVersion('Python 3.12.1'), null);
  assert.equal(matchesVersion('22.12.1', '22.12'), true);
  assert.equal(matchesVersion('22.13.0', '22.12'), false);
  assert.deepEqual(runtimesSchema.parse({ node: '22.12.0' }), { node: '22.12.0' });
  assert.match(runtimeEnvironment({ node: '22.12.0' }).PATH, /node-22\.12\.0/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: remote Git actions stay HTTPS and shell-safe
 * 协作入口 / Collaborators: `assert.equal`, `gitActionSchema.safeParse`.
 * 检查边界 / Checked boundaries: `assert.equal( gitActionSchema.safeParse({ action: 'remote-add', name: 'origin', url: 'https://git.example/repo.git' }) .success, t…`; `assert.equal( gitActionSchema.safeParse({ action: 'remote-add', name: 'origin', url: 'ssh://git@example/repo' }) .success, false, …`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: sync baseline distinguishes safe deletion from a new file
 * 协作入口 / Collaborators: `assert.equal`, `syncDirection`, `projectSchema.safeParse`.
 * 检查边界 / Checked boundaries: `assert.equal(syncDirection(undefined, 'old', 'old'), 'pull')`; `assert.equal(syncDirection('old', undefined, 'old'), 'push')`.
 */
test('sync baseline distinguishes safe deletion from a new file', () => {
  assert.equal(syncDirection(undefined, 'old', 'old'), 'pull');
  assert.equal(syncDirection('old', undefined, 'old'), 'push');
  assert.equal(syncDirection(undefined, 'new', 'old'), 'pull');
  assert.equal(projectSchema.safeParse({ runtimes: { node: '22.12.0' } }).success, true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the third feature tranche has 100 unique entries with implementation states
 * 协作入口 / Collaborators: `assert.equal`, `nextFeatureCatalog.map`, `assert.ok`, `nextFeatureCatalog.every`.
 * 检查边界 / Checked boundaries: `assert.equal(nextFeatureCatalog.length, 100)`; `assert.equal(new Set(nextFeatureCatalog.map(([id]) => id)).size, 100)`.
 */
test('the third feature tranche has 100 unique entries with implementation states', () => {
  assert.equal(nextFeatureCatalog.length, 100);
  assert.equal(new Set(nextFeatureCatalog.map(([id]) => id)).size, 100);
  assert.equal(new Set(nextFeatureCatalog.map(([, , category]) => category)).size, 10);
  assert.ok(nextFeatureCatalog.every(([, , , priority]) => ['P0', 'P1', 'P2'].includes(priority)));
  assert.equal(nextFeatureCatalog.find(([id]) => id === 'incident-lockdown')?.[5], 'available');
  assert.equal(nextFeatureCatalog.find(([id]) => id === 'desktop-recording')?.[5], 'available');
  assert.equal(nextFeatureCatalog.find(([id]) => id === 'network-emulation')?.[5], 'available');
  assert.equal(nextFeatureCatalog.find(([id]) => id === 'dependency-bot')?.[5], 'available');
  assert.equal(nextFeatureCatalog.find(([id]) => id === 'team-templates')?.[5], 'available');
  assert.ok(nextFeatureCatalog.every(([id]) => /^[a-z][a-z0-9-]+$/.test(id)));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: dependency upgrade requires bounded operation parameters
 * 协作入口 / Collaborators: `assert.deepEqual`, `capabilityParameters`, `assert.equal`, `'a'.repeat`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(capabilityParameters('dependency-bot', { mode: 'scan' }), { mode: 'scan', allowMajor: false, timeout: 60, })`; `assert.equal(capabilityParameters('dependency-bot', { mode: 'apply', planId: 'a'.repeat(64) }).planId, 'a'.repeat(64))`.
 */
test('dependency upgrade requires bounded operation parameters', () => {
  assert.deepEqual(capabilityParameters('dependency-bot', { mode: 'scan' }), {
    mode: 'scan', allowMajor: false, timeout: 60,
  });
  assert.equal(capabilityParameters('dependency-bot', { mode: 'apply', planId: 'a'.repeat(64) }).planId,
    'a'.repeat(64));
  assert.throws(() => capabilityParameters('dependency-bot', { mode: 'apply', planId: '../../evil' }));
  assert.throws(() => capabilityParameters('dependency-bot', { mode: 'scan', timeout: 1000 }));
});
