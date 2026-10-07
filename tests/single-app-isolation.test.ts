/**
 * 模块职责：回归验证模块，围绕 `single-app-isolation` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `single-app-isolation`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: single-app transport retains its original native project/run instead of a caller-selected port or project; active independent native runs guard their own project config and stop preserves account data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { singleAppFixture } from './single-app-fixture.ts';
import { appIdentity, appCleanupScript } from '../server/single-app-sandbox.ts';
import { projectSchema } from '../server/workspaces.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: single-app transport retains its original native project/run instead of a caller-selected port or project
 * 协作入口 / Collaborators: `singleAppFixture`, `f.apps.start`, `f.workspaces.projects.inScope`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(first.networkIsolation, 'private')`; `assert.equal(other.networkIsolation, 'host')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('single-app transport retains its original native project/run instead of a caller-selected port or project', async () => {
  const f = await singleAppFixture();
  try {
    const first = await f.apps.start(f.id, { program: 'xterm', args: ['literal $(echo bad)'] });
    const other = await f.workspaces.projects.inScope(f.id, '1234567890abcdef', () => f.apps.start(f.id, { program: 'xterm' }));
    assert.equal(first.networkIsolation, 'private'); assert.equal(other.networkIsolation, 'host');
    assert.equal(other.projectId, '1234567890abcdef');
    const command = await f.apps.connectionCommand(f.id, first.id, first.port);
    assert.match(command, new RegExp('controller.py stream ' + first.id + ' [a-f0-9]{64}$'));
    assert.ok(!command.includes(first.password)); assert.ok(!command.includes('$(echo bad)'));
    assert.doesNotMatch(command, /\bnc\b|\bsu\b|tmux/);
    await assert.rejects(f.apps.connectionCommand(f.id, first.id, other.port), /端口不匹配/);
    assert.ok(first.applicationOwner!.uid < 20000); assert.ok(first.projectOwner!.uid >= 20000);
    assert.notEqual(first.applicationOwner!.uid, first.projectOwner!.uid);
    assert.ok(!('identity' in first) && !('run' in first));
    const launch = f.actions.find(action => action.action === 'start')!;
    assert.deepEqual(launch.environment, { LITERAL: '$(never-run)' });
    assert.deepEqual(launch.origin!.args, ['literal $(echo bad)']);
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: active independent native runs guard their own project config and stop preserves account data
 * 协作入口 / Collaborators: `singleAppFixture`, `f.apps.start`, `f.workspaces.projects.inScope`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.workspaces.save(f.id, { networkIsolation: 'host' }), /单应用/)`; `assert.equal(stopped.origin!.run.runId, session.id)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('active independent native runs guard their own project config and stop preserves account data', async () => {
  const f = await singleAppFixture();
  try {
    const session = await f.apps.start(f.id, { program: 'xterm' });
    await f.workspaces.projects.inScope(f.id, '1234567890abcdef', () => f.workspaces.save(f.id, { directory: '/other', networkIsolation: 'private' }));
    await assert.rejects(f.workspaces.save(f.id, { networkIsolation: 'host' }), /单应用/);
    await f.apps.stop(f.id, session.id);
    await f.workspaces.save(f.id, { networkIsolation: 'host' });
    const stopped = f.actions.find(action => action.action === 'stop')!;
    assert.equal(stopped.origin!.run.runId, session.id); assert.equal(stopped.origin!.run.mode, 'independent');
    assert.equal((await f.apps.list(f.id))[0].status, 'stopped'); assert.equal(f.releaseCount(), 1);
    assert.ok(f.commands.every(command => !command.includes('mkdir -p /private') && !command.includes('rm -rf')));
    await f.apps.close(); await f.workspaces.save(f.id, { networkIsolation: 'host' });
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: pause and clipboard tightening close bridges, keep original receipts and deny reconnection
 * 状态影响 / State effects: `f.live.status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `f.apps.start`, `f.apps.onSessionInvalidated`, `f.machines.emit`.
 * 检查边界 / Checked boundaries: `assert.equal(disconnected, 1)`; `assert.rejects(f.apps.port(f.id, session.id))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('pause and clipboard tightening close bridges, keep original receipts and deny reconnection', async () => {
  const f = await singleAppFixture();
  try {
    const session = await f.apps.start(f.id, { program: 'xterm' }); let disconnected = 0;
    f.apps.onSessionInvalidated(f.id, session.id, () => disconnected++);
    f.live.status = 'paused'; f.machines.emit('change'); assert.equal(disconnected, 1);
    await assert.rejects(f.apps.port(f.id, session.id)); await assert.rejects(f.apps.stop(f.id, session.id), /先恢复实例/);
    await assert.rejects(f.workspaces.save(f.id, { networkIsolation: 'host' }), /单应用/);
    f.live.status = 'running'; f.machines.emit('change'); assert.equal(await f.apps.port(f.id, session.id), session.port);
    f.apps.onSessionInvalidated(f.id, session.id, () => disconnected++);
    await f.apps.saveClipboardPolicy(f.id, 'xterm', { copy: false, paste: true }); assert.equal(disconnected, 2);
    await assert.rejects(f.apps.connectionCommand(f.id, session.id, session.port), /规则已收紧/);
    assert.equal((await f.apps.list(f.id))[0].status, 'relaunch-required');
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: missing migrated directory never creates a native run or Root project directory
 * 状态影响 / State effects: `f.faults.missingDirectory`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `assert.rejects`, `f.apps.start`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.apps.start(f.id, { program: 'xterm' }), /显式准备/)`; `assert.deepEqual(f.actions, [])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('missing migrated directory never creates a native run or Root project directory', async () => {
  const f = await singleAppFixture();
  try {
    f.faults.missingDirectory = true;
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }), /显式准备/);
    assert.deepEqual(f.actions, []); assert.equal((await f.apps.list(f.id)).length, 0);
    assert.ok(f.commands.every(command => !command.includes('mkdir')));
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy UID helper remains portable for explicit desktop compatibility, never accepts Root
 * 协作入口 / Collaborators: `assert.ok`, `appIdentity`, `randomUUID`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.ok(appIdentity(randomUUID()).user.length <= 32)`; `assert.throws(() => appCleanupScript(randomUUID(), uid))`.
 */
test('legacy UID helper remains portable for explicit desktop compatibility, never accepts Root', () => {
  assert.ok(appIdentity(randomUUID()).user.length <= 32);
  for (const uid of [0, -1, NaN]) assert.throws(() => appCleanupScript(randomUUID(), uid));
  assert.equal(projectSchema.parse({}).directory, '/workspace');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: shutdown serializes each VM and accurately stops every original native run once
 * 协作入口 / Collaborators: `singleAppFixture`, `f.apps.start`, `f.apps.close`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(f.actions.filter(action => action.action === 'stop').map(action => action.id), [first.id, second.id])`; `assert.equal(f.releaseCount(), 2)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('shutdown serializes each VM and accurately stops every original native run once', async () => {
  const f = await singleAppFixture();
  try {
    const first = await f.apps.start(f.id, { program: 'xterm' }), second = await f.apps.start(f.id, { program: 'xterm' });
    await f.apps.close();
    assert.deepEqual(f.actions.filter(action => action.action === 'stop').map(action => action.id), [first.id, second.id]);
    assert.equal(f.releaseCount(), 2);
  } finally { await f.close(); }
});
