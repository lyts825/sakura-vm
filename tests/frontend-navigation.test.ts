/**
 * 模块职责：回归验证模块，围绕 `frontend-navigation` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `frontend-navigation`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: command palette selection wraps and supports Home/End without a DOM; workspace commands expose create, manage, switch, and running workspace actions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSelection } from '../src/keyboard-navigation.ts';
import { workspaceCommandDefinitions } from '../src/workspace-navigation.ts';

const vms = [
  { id: 'alpha-id', name: 'alpha', status: 'running' as const },
  { id: 'beta-id', name: 'beta', status: 'stopped' as const },
  { id: 'paused-id', name: 'paused', status: 'paused' as const },
];

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: command palette selection wraps and supports Home/End without a DOM
 * 协作入口 / Collaborators: `assert.equal`, `nextSelection`.
 * 检查边界 / Checked boundaries: `assert.equal(nextSelection(0, 3, 'ArrowUp'), 2)`; `assert.equal(nextSelection(2, 3, 'ArrowDown'), 0)`.
 */
test('command palette selection wraps and supports Home/End without a DOM', () => {
  assert.equal(nextSelection(0, 3, 'ArrowUp'), 2);
  assert.equal(nextSelection(2, 3, 'ArrowDown'), 0);
  assert.equal(nextSelection(1, 3, 'Home'), 0);
  assert.equal(nextSelection(1, 3, 'End'), 2);
  assert.equal(nextSelection(1, 3, 'PageDown'), null);
  assert.equal(nextSelection(0, 0, 'ArrowDown'), null);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: workspace commands expose create, manage, switch, and running workspace actions
 * 协作入口 / Collaborators: `workspaceCommandDefinitions`, `commands.map`, `assert.equal`, `byKey.get`.
 * 检查边界 / Checked boundaries: `assert.equal(byKey.get('workspace:create')?.action, 'create')`; `assert.deepEqual(byKey.get('workspace:manage')?.target, { page: 'library' })`.
 */
test('workspace commands expose create, manage, switch, and running workspace actions', () => {
  const commands = workspaceCommandDefinitions({ vms, currentId: 'alpha-id' });
  const byKey = new Map(commands.map((command) => [command.key, command]));

  assert.equal(byKey.get('workspace:create')?.action, 'create');
  assert.deepEqual(byKey.get('workspace:manage')?.target, { page: 'library' });
  assert.equal(byKey.get('workspace:alpha-id:suspend')?.action, 'suspend');
  assert.equal(byKey.get('workspace:alpha-id:stop')?.action, 'stop');
  assert.equal(byKey.get('workspace:alpha-id:config')?.target?.tab, 'config');
  assert.equal(byKey.get('workspace:alpha-id:delete')?.disabled, true);
  assert.deepEqual(byKey.get('workspace:beta-id:switch')?.target, {
    id: 'beta-id',
    page: 'workspace',
  });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: workspace commands follow lifecycle state and retain a discoverable disabled create command
 * 协作入口 / Collaborators: `workspaceCommandDefinitions`, `commands.map`, `assert.equal`, `byKey.get`.
 * 检查边界 / Checked boundaries: `assert.equal(byKey.get('workspace:create')?.disabled, true)`; `assert.equal(byKey.get('workspace:beta-id:start')?.action, 'start')`.
 */
test('workspace commands follow lifecycle state and retain a discoverable disabled create command', () => {
  const commands = workspaceCommandDefinitions({
    vms,
    currentId: 'beta-id',
    canCreate: false,
    busy: true,
  });
  const byKey = new Map(commands.map((command) => [command.key, command]));

  assert.equal(byKey.get('workspace:create')?.disabled, true);
  assert.equal(byKey.get('workspace:beta-id:start')?.action, 'start');
  assert.equal(byKey.get('workspace:beta-id:start')?.disabled, true);
  assert.equal(byKey.has('workspace:beta-id:stop'), false);
  assert.equal(byKey.get('workspace:beta-id:delete')?.disabled, true);
  assert.equal(
    workspaceCommandDefinitions({ vms, currentId: 'paused-id' }).find(
      (command) => command.key === 'workspace:paused-id:delete',
    )?.disabled,
    true,
  );
  assert.equal(byKey.get('workspace:paused-id:switch')?.title, '切换到 paused');
});
