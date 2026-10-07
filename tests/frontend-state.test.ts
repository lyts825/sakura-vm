/**
 * 模块职责：回归验证模块，围绕 `frontend-state` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `frontend-state`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: closing a terminal keeps the session selected while its close request was pending; closing an inactive terminal selected during the request selects a surviving session.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreTerminals, terminalReducer } from '../src/terminal-state.ts';
import { completeFileSave } from '../src/file-editor-state.ts';

/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`restoreTerminals([ { id: 'main', name: 'Main' }, { id: 'build', name: 'Build' },…`）。
 * Result: Return the branch-computed value (`restoreTerminals([ { id: 'main', name: 'Main' }, { id: 'build', name: 'Build' },…`).
 * 协作入口 / Collaborators: `restoreTerminals`.
 */
const threeTerminals = () =>
  restoreTerminals([
    { id: 'main', name: 'Main' },
    { id: 'build', name: 'Build' },
    { id: 'logs', name: 'Logs' },
  ]);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: closing a terminal keeps the session selected while its close request was pending
 * 协作入口 / Collaborators: `threeTerminals`, `terminalReducer`, `assert.equal`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.equal(closed.active, 'logs')`; `assert.deepEqual( closed.tabs.map((tab) => tab.id), ['build', 'logs'], )`.
 */
test('closing a terminal keeps the session selected while its close request was pending', () => {
  const before = threeTerminals();
  // The close of main starts here. The user selects logs before it completes.
  const selected = terminalReducer(before, { type: 'select', id: 'logs' });
  const closed = terminalReducer(selected, { type: 'close', id: 'main' });
  assert.equal(closed.active, 'logs');
  assert.deepEqual(
    closed.tabs.map((tab) => tab.id),
    ['build', 'logs'],
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: closing an inactive terminal selected during the request selects a surviving session
 * 协作入口 / Collaborators: `threeTerminals`, `terminalReducer`, `assert.equal`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.equal(closed.active, 'main')`; `assert.ok(closed.tabs.some((tab) => tab.id === closed.active))`.
 */
test('closing an inactive terminal selected during the request selects a surviving session', () => {
  const before = threeTerminals();
  // Close logs while main is active, then select logs before the response.
  const selected = terminalReducer(before, { type: 'select', id: 'logs' });
  const closed = terminalReducer(selected, { type: 'close', id: 'logs' });
  assert.equal(closed.active, 'main');
  assert.ok(closed.tabs.some((tab) => tab.id === closed.active));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: delayed close responses preserve newly created terminals and never remove the last pane
 * 状态影响 / State effects: `state`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `threeTerminals`, `terminalReducer`, `assert.equal`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.equal(state.active, 'new')`; `assert.deepEqual( state.tabs.map((tab) => tab.id), ['new'], )`.
 */
test('delayed close responses preserve newly created terminals and never remove the last pane', () => {
  let state = threeTerminals();
  state = terminalReducer(state, { type: 'add', id: 'new' });
  for (const id of ['logs', 'main', 'build']) state = terminalReducer(state, { type: 'close', id });
  assert.equal(state.active, 'new');
  assert.deepEqual(
    state.tabs.map((tab) => tab.id),
    ['new'],
  );
  assert.equal(terminalReducer(state, { type: 'close', id: 'new' }), state);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: rapid additions stop at eight tabs without selecting a nonexistent session
 * 状态影响 / State effects: `state`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `threeTerminals`, `terminalReducer`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(state.tabs.length, 8)`; `assert.equal(state.active, 'extra-4')`.
 */
test('rapid additions stop at eight tabs without selecting a nonexistent session', () => {
  let state = threeTerminals();
  for (let i = 0; i < 10; i++) state = terminalReducer(state, { type: 'add', id: `extra-${i}` });
  assert.equal(state.tabs.length, 8);
  assert.equal(state.active, 'extra-4');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: invalid or duplicate persisted sessions recover to a usable main terminal
 * 协作入口 / Collaborators: `assert.deepEqual`, `restoreTerminals`, `assert.equal`, `threeTerminals`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(restoreTerminals(saved), { tabs: [{ id: 'main', name: '终端 1' }], active: 'main', })`; `assert.equal(threeTerminals().tabs.length, 3)`.
 */
test('invalid or duplicate persisted sessions recover to a usable main terminal', () => {
  for (const saved of [
    null,
    [],
    [null],
    [{ id: 123, name: 'Invalid id type' }],
    [{ id: 'bad/session', name: 'Invalid' }],
    [
      { id: 'main', name: 'Main' },
      { id: 'main', name: 'Duplicate' },
    ],
  ]) {
    assert.deepEqual(restoreTerminals(saved), {
      tabs: [{ id: 'main', name: '终端 1' }],
      active: 'main',
    });
  }
  assert.equal(threeTerminals().tabs.length, 3);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: saving a new file preserves text typed before the response and permits the next save
 * 协作入口 / Collaborators: `completeFileSave`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(current?.content, typed.content)`; `assert.equal(current?.fresh, false, 'the file now exists, so a later save can overwrite it')`.
 */
test('saving a new file preserves text typed before the response and permits the next save', () => {
  const submitted = { path: '/workspace/notes.txt', content: 'first draft', fresh: true };
  const typed = { ...submitted, content: 'first draft\nnew unsaved text' };
  const current = completeFileSave(typed, submitted);
  assert.equal(current?.content, typed.content);
  assert.equal(current?.fresh, false, 'the file now exists, so a later save can overwrite it');
  assert.equal(completeFileSave(submitted, submitted), null, 'an unchanged saved editor can close');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a completed file save cannot dismiss a different draft or reopen a closed editor
 * 协作入口 / Collaborators: `assert.equal`, `completeFileSave`.
 * 检查边界 / Checked boundaries: `assert.equal(completeFileSave(next, submitted), next)`; `assert.equal(completeFileSave(null, submitted), null)`.
 */
test('a completed file save cannot dismiss a different draft or reopen a closed editor', () => {
  const submitted = { path: '/workspace/first.txt', content: 'first', fresh: true };
  const next = { path: '/workspace/second.txt', content: 'second', fresh: true };
  assert.equal(completeFileSave(next, submitted), next);
  assert.equal(completeFileSave(null, submitted), null);
});
