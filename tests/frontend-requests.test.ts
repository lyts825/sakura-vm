/**
 * 模块职责：回归验证模块，围绕 `frontend-requests` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `frontend-requests`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: slow polling applies completed responses while the next interval is already pending; out-of-order success and error responses cannot replace a newer result.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ResponseOrder } from '../src/request-order.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: slow polling applies completed responses while the next interval is already pending
 * 状态影响 / State effects: `previous`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `order.start`, `assert.equal`, `order.accept`.
 * 检查边界 / Checked boundaries: `assert.equal(order.accept(previous), true, 'a newer pending poll must not starve the UI')`; `assert.equal(order.accept(previous), true)`.
 */
test('slow polling applies completed responses while the next interval is already pending', () => {
  const order = new ResponseOrder();
  let previous = order.start();
  for (let interval = 0; interval < 10; interval++) {
    const pending = order.start();
    assert.equal(order.accept(previous), true, 'a newer pending poll must not starve the UI');
    previous = pending;
  }
  assert.equal(order.accept(previous), true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: out-of-order success and error responses cannot replace a newer result
 * 协作入口 / Collaborators: `order.start`, `assert.equal`, `order.accept`.
 * 检查边界 / Checked boundaries: `assert.equal(order.accept(newerSuccess), true)`; `assert.equal(order.accept(olderError), false, 'an obsolete failure cannot mark a recovered app offline')`.
 */
test('out-of-order success and error responses cannot replace a newer result', () => {
  const order = new ResponseOrder();
  const olderSuccess = order.start();
  const olderError = order.start();
  const newerSuccess = order.start();
  assert.equal(order.accept(newerSuccess), true);
  assert.equal(order.accept(olderError), false, 'an obsolete failure cannot mark a recovered app offline');
  assert.equal(order.accept(olderSuccess), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: disposing a request owner invalidates all in-flight responses and permits a fresh lifecycle
 * 协作入口 / Collaborators: `order.start`, `order.invalidate`, `assert.equal`, `order.accept`.
 * 检查边界 / Checked boundaries: `assert.equal(order.accept(old), false)`; `assert.equal(order.accept(pending), false)`.
 */
test('disposing a request owner invalidates all in-flight responses and permits a fresh lifecycle', () => {
  const order = new ResponseOrder();
  const old = order.start();
  const pending = order.start();
  order.invalidate();
  assert.equal(order.accept(old), false);
  assert.equal(order.accept(pending), false);
  assert.equal(order.accept(order.start()), true);
});
