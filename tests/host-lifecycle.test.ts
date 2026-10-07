/**
 * 模块职责：回归验证模块，围绕 `host-lifecycle` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `host-lifecycle`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: failed initialization cleans partial resources in dependency order and continues after failure; transferring runtime ownership avoids double disposal, equal-priority resources close in reverse order.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { listenHttpServer } from '../server/http-listener.ts';
import { ResourceScope } from '../server/resource-scope.ts';
import { OperationTracker, requestScope } from '../server/operation-scope.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed initialization cleans partial resources in dependency order and continues after failure
 * 协作入口 / Collaborators: `scope.own`, `assert.rejects`, `partial.init`, `scope.close`.
 * 检查边界 / Checked boundaries: `assert.rejects(partial.init(), /start/)`; `assert.equal(scope.close(), closing)`.
 */
test('failed initialization cleans partial resources in dependency order and continues after failure', async () => {
  const scope = new ResourceScope(),
    events: string[] = [];
  scope.own(
    'runtime',
    {
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: failed initialization cleans partial resources in dependency order and continues after failure
       * 协作入口 / Collaborators: `events.push`.
       */
      close() {
        events.push('runtime');
      },
    },
    30,
  );
  scope.own(
    'plugins',
    {
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: failed initialization cleans partial resources in dependency order and continues after failure
       * 失败 / Failure: `new Error('cleanup')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       * 协作入口 / Collaborators: `events.push`.
       */
      close() {
        events.push('plugins');
        throw new Error('cleanup');
      },
    },
    20,
  );
  const partial = scope.own(
    'listener',
    {
      /**
       * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
       * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: failed initialization cleans partial resources in dependency order and continues after failure
       * 失败 / Failure: `new Error('start')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       * 协作入口 / Collaborators: `events.push`.
       */
      async init() {
        events.push('partial-init');
        throw new Error('start');
      },
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: failed initialization cleans partial resources in dependency order and continues after failure
       * 协作入口 / Collaborators: `events.push`.
       */
      close() {
        events.push('listener');
      },
    },
    10,
  );
  await assert.rejects(partial.init(), /start/);
  const closing = scope.close();
  assert.equal(scope.close(), closing);
  await assert.rejects(closing, (error: AggregateError) => {
    assert.equal(error.errors.length, 1);
    assert.match(error.errors[0].message, /plugins/);
    assert.match(error.errors[0].cause.message, /cleanup/);
    return true;
  });
  assert.deepEqual(events, ['partial-init', 'listener', 'plugins', 'runtime']);
  assert.throws(() => scope.defer('late', () => {}), /closing/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: transferring runtime ownership avoids double disposal, equal-priority resources close in reverse order
 * 协作入口 / Collaborators: `scope.defer`, `disown`, `scope.close`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(events, ['transport', 'machines'])`.
 */
test('transferring runtime ownership avoids double disposal, equal-priority resources close in reverse order', async () => {
  const scope = new ResourceScope(),
    events: string[] = [];
  const disown = scope.defer('runtime', () => events.push('old-owner'));
  scope.defer('machines', () => events.push('machines'));
  disown();
  scope.defer('transport', () => events.push('transport'));
  await scope.close();
  await scope.close();
  assert.deepEqual(events, ['transport', 'machines']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: operation accounting survives failure, nested work and repeated release
 * 协作入口 / Collaborators: `tracker.enter`, `assert.rejects`, `tracker.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects( tracker.run(async () => { assert.equal(tracker.active, 2); throw new Error('operation failed'); }), /operation fai…`; `assert.equal(tracker.active, 1)`.
 */
test('operation accounting survives failure, nested work and repeated release', async () => {
  const tracker = new OperationTracker(),
    release = tracker.enter();
  await assert.rejects(
    tracker.run(async () => {
      assert.equal(tracker.active, 2);
      throw new Error('operation failed');
    }),
    /operation failed/,
  );
  assert.equal(tracker.active, 1);
  release();
  release();
  assert.equal(tracker.active, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: request disconnect cancels work and releasing the scope removes both listeners
 * 协作入口 / Collaborators: `Object.assign`, `requestScope`, `res.emit`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(scope.signal.aborted, true)`; `assert.equal(req.listenerCount('aborted'), 0)`.
 */
test('request disconnect cancels work and releasing the scope removes both listeners', () => {
  const req = Object.assign(new EventEmitter(), { aborted: false }) as unknown as IncomingMessage;
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableFinished: false,
  }) as unknown as ServerResponse;
  const scope = requestScope(req, res);
  res.emit('close');
  assert.equal(scope.signal.aborted, true);
  scope.dispose();
  scope.dispose();
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a failed HTTP bind rejects startup and releases temporary event listeners
 * 协作入口 / Collaborators: `createServer`, `candidate.listeners`, `listenHttpServer`, `occupied.address`.
 * 检查边界 / Checked boundaries: `assert.rejects(listenHttpServer(candidate, port, '127.0.0.1'), { code: 'EADDRINUSE' })`; `assert.equal(candidate.listenerCount('error'), 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a failed HTTP bind rejects startup and releases temporary event listeners', async () => {
  const occupied = createServer(),
    candidate = createServer();
  const initialListening = candidate.listeners('listening');
  try {
    await listenHttpServer(occupied, 0, '127.0.0.1');
    const port = (occupied.address() as { port: number }).port;
    await assert.rejects(listenHttpServer(candidate, port, '127.0.0.1'), { code: 'EADDRINUSE' });
    assert.equal(candidate.listenerCount('error'), 0);
    assert.deepEqual(candidate.listeners('listening'), initialListening);
    assert.equal(candidate.listening, false);
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    candidate.close();
  }
});
