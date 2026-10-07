/**
 * 模块职责：回归验证模块，围绕 `resource-cache` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `resource-cache`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: observers of the same resource share a read; one unmount cannot cancel another observer; invalidation during a read discards stale completion and coalesces a burst into one fresh read.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { ResourceCache, type ResourceRequest, type ResourceSnapshot } from '../src/resource-cache.ts';
import { jobPresentation } from '../src/job-presentation.ts';
import type { JobView } from '../shared/contracts/jobs.ts';

/**
 * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
 * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `promise, resolve`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `promise, resolve`; the actual branch determines its shape.
 */
function gate<T>() { let resolve!: /**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: value: T。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
(value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), /**
 * 中文功能：完成夹具中预先保存的 Promise，使等待它的异步步骤取得传入值。
 * English: Settle the Promise retained by the fixture so waiting asynchronous steps receive the supplied value.
 * 输入 / Inputs: value: T。
 * 结果：返回分支计算值（`resolve(value)`）。
 * Result: Return the branch-computed value (`resolve(value)`).
 * 协作入口 / Collaborators: `resolve`.
 */
resolve: (value: T) => resolve(value) }; }
/**
 * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
 * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
 * 输入 / Inputs: check: () => boolean。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `Date.now`, `check`, `assert.ok`, `delay`.
 * 检查边界 / Checked boundaries: `assert.ok(Date.now() < deadline, 'Resource cache did not settle')`.
 */
async function until(check: /**
 * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
 * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) { assert.ok(Date.now() < deadline, 'Resource cache did not settle'); await delay(1); }
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: observers of the same resource share a read; one unmount cannot cancel another observer
 * 协作入口 / Collaborators: `gate`, `cache.watch`, `until`, `stopFirst`.
 * 检查边界 / Checked boundaries: `assert.equal(signal?.aborted, false)`; `assert.deepEqual(second?.data, { value: 'current' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('observers of the same resource share a read; one unmount cannot cancel another observer', async () => {
  const cache = new ResourceCache(), wait = gate<object>();
  let reads = 0, signal: AbortSignal | undefined;
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _path; _method; _body; value。
   * 结果：返回分支计算值（`wait.promise`），以 Promise 交付。
   * Result: Return the branch-computed value (`wait.promise`) through a Promise.
   * 验证场景 / Scenario: observers of the same resource share a read; one unmount cannot cancel another observer
   * 状态影响 / State effects: `signal`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  const request: ResourceRequest = (async (_path, _method, _body, value) => { reads++; signal = value; return wait.promise; }) as ResourceRequest;
  let first: ResourceSnapshot | undefined, second: ResourceSnapshot | undefined;
  const stopFirst = cache.watch(request, '/vms/one?project=one', value => { first = value; }, 0);
  const stopSecond = cache.watch(request, '/vms/one?project=one', value => { second = value; }, 0);
  try {
    await until(() => reads === 1); stopFirst();
    assert.equal(signal?.aborted, false);
    wait.resolve({ value: 'current' }); await until(() => second?.data !== null);
    assert.deepEqual(second?.data, { value: 'current' }); assert.equal(first?.data, null);
    assert.equal(reads, 1);
  } finally { stopFirst(); stopSecond(); cache.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: invalidation during a read discards stale completion and coalesces a burst into one fresh read
 * 协作入口 / Collaborators: `gate`, `cache.watch`, `until`, `cache.invalidate`.
 * 检查边界 / Checked boundaries: `assert.equal(reads, 2)`; `assert.equal(values.includes(1), false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('invalidation during a read discards stale completion and coalesces a burst into one fresh read', async () => {
  const cache = new ResourceCache(), wait = gate<number>(); let reads = 0;
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`++reads === 1 ? wait.promise : 2`），以 Promise 交付。
   * Result: Return the branch-computed value (`++reads === 1 ? wait.promise : 2`) through a Promise.
   * 验证场景 / Scenario: invalidation during a read discards stale completion and coalesces a burst into one fresh read
   */
  const request = (async () => ++reads === 1 ? wait.promise : 2) as ResourceRequest;
  const values: unknown[] = [];
  const stop = cache.watch(request, '/vms/one', value => { if (value.data !== null) values.push(value.data); }, 0);
  try {
    await until(() => reads === 1);
    for (let i = 0; i < 30; i++) cache.invalidate(request, '/vms/one');
    wait.resolve(1); await until(() => values.includes(2));
    assert.equal(reads, 2); assert.equal(values.includes(1), false);
  } finally { stop(); cache.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: query identity and request capabilities stay separate; last unsubscribe cancels its own read
 * 协作入口 / Collaborators: `gate`, `request.bind`, `cache.watch`, `until`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(signals.map(signal => signal.aborted), [true, false, false])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('query identity and request capabilities stay separate; last unsubscribe cancels its own read', async () => {
  const cache = new ResourceCache(); const signals: AbortSignal[] = [], paths: string[] = [];
  const wait = gate<object>();
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: path: string; _method: string; _body: unknown; signal: AbortSignal。
   * 结果：返回分支计算值（`wait.promise`），以 Promise 交付。
   * Result: Return the branch-computed value (`wait.promise`) through a Promise.
   * 验证场景 / Scenario: query identity and request capabilities stay separate; last unsubscribe cancels its own read
   * 协作入口 / Collaborators: `paths.push`, `signals.push`.
   */
  const request = (async (path: string, _method: string, _body: unknown, signal: AbortSignal) => {
    paths.push(path); signals.push(signal); return wait.promise;
  }) as ResourceRequest;
  const other = request.bind(null) as ResourceRequest;
  const stop = [cache.watch(request, '/vms/one?project=a', () => {}, 0),
    cache.watch(request, '/vms/one?project=b', () => {}, 0), cache.watch(other, '/vms/one?project=a', () => {}, 0)];
  try {
    await until(() => paths.length === 3); stop[0]();
    assert.deepEqual(signals.map(signal => signal.aborted), [true, false, false]);
  } finally { stop.forEach(close => close()); wait.resolve({}); cache.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: account reset drops cached private data and old requests cannot restore it
 * 状态影响 / State effects: `seen.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `gate`, `cache.watch`, `until`, `cache.invalidate`.
 * 检查边界 / Checked boundaries: `assert.equal(snapshot?.data, null)`; `assert.equal(seen.includes('stale-private-data'), false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('account reset drops cached private data and old requests cannot restore it', async () => {
  const cache = new ResourceCache(), wait = gate<string>(); let reads = 0;
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`++reads === 1 ? 'account-a' : reads === 2 ? wait.promise : 'account-b'`），以 Promise 交付。
   * Result: Return the branch-computed value (`++reads === 1 ? 'account-a' : reads === 2 ? wait.promise : 'account-b'`) through a Promise.
   * 验证场景 / Scenario: account reset drops cached private data and old requests cannot restore it
   */
  const request = (async () => ++reads === 1 ? 'account-a' : reads === 2 ? wait.promise : 'account-b') as ResourceRequest;
  let snapshot: ResourceSnapshot | undefined;
  const seen: unknown[] = [];
  const stop = cache.watch(request, '/private', value => { snapshot = value; seen.push(value.data); }, 0);
  try {
    await until(() => snapshot?.data === 'account-a');
    cache.invalidate(); await until(() => reads === 2);
    cache.reset(); assert.equal(snapshot?.data, null);
    seen.length = 0; wait.resolve('stale-private-data');
    await until(() => snapshot?.data === 'account-b');
    assert.equal(seen.includes('stale-private-data'), false);
  } finally { stop(); cache.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: hidden views pause polling and resume with a full reconciliation of observed keys
 * 协作入口 / Collaborators: `cache.setVisible`, `cache.watch`, `delay`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(reads, 0)`; `assert.equal(reads, previous)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('hidden views pause polling and resume with a full reconciliation of observed keys', async () => {
  const cache = new ResourceCache(); let reads = 0;
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`++reads`），以 Promise 交付。
   * Result: Return the branch-computed value (`++reads`) through a Promise.
   * 验证场景 / Scenario: hidden views pause polling and resume with a full reconciliation of observed keys
   */
  const request = (async () => ++reads) as ResourceRequest;
  cache.setVisible(false);
  const stop = cache.watch(request, '/jobs', () => {}, 5);
  try {
    await delay(15); assert.equal(reads, 0);
    cache.setVisible(true); await until(() => reads > 0);
    cache.setVisible(false); const previous = reads;
    await delay(20); assert.equal(reads, previous);
    cache.setVisible(true); await until(() => reads > previous);
  } finally { stop(); cache.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: mutation invalidation refreshes the affected VM and summary keys without refetching unrelated projects
 * 协作入口 / Collaborators: `paths.map`, `until`, `cache.mutation`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(counts.get('/vms/two/project?project=b'), 1)`; `assert.equal(counts.get('/vms/one/project?project=a'), 2)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('mutation invalidation refreshes the affected VM and summary keys without refetching unrelated projects', async () => {
  const cache = new ResourceCache(); const counts = new Map<string, number>();
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: path: string。
   * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
   * 验证场景 / Scenario: mutation invalidation refreshes the affected VM and summary keys without refetching unrelated projects
   * 协作入口 / Collaborators: `counts.set`, `counts.get`.
   */
  const request = (async (path: string) => { counts.set(path, (counts.get(path) || 0) + 1); return {}; }) as ResourceRequest;
  const paths = ['/vms', '/vms/one/project?project=a', '/vms/two/project?project=b', '/jobs', '/system'];
  const stop = paths.map(path => cache.watch(request, path, () => {}, 0));
  try {
    await until(() => counts.size === paths.length);
    cache.mutation('/vms/one/project');
    await until(() => counts.get('/jobs') === 2);
    assert.equal(counts.get('/vms/two/project?project=b'), 1);
    assert.equal(counts.get('/vms/one/project?project=a'), 2);
  } finally { stop.forEach(close => close()); cache.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: resource cache bounds retained entries and never evicts an active observer to admit more
 * 协作入口 / Collaborators: `cache.setVisible`, `cache.watch`, `assert.throws`, `stop`.
 * 检查边界 / Checked boundaries: `assert.throws(() => cache.watch(request, '/two', () => {}, 0), /上限/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('resource cache bounds retained entries and never evicts an active observer to admit more', () => {
  const cache = new ResourceCache(1), /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({})`），以 Promise 交付。
   * Result: Return the branch-computed value (`({})`) through a Promise.
   * 验证场景 / Scenario: resource cache bounds retained entries and never evicts an active observer to admit more
   */
  request = (async () => ({})) as ResourceRequest;
  cache.setVisible(false);
  const stop = cache.watch(request, '/one', () => {}, 0);
  try {
    assert.throws(() => cache.watch(request, '/two', () => {}, 0), /上限/);
    stop(); const second = cache.watch(request, '/two', () => {}, 0); second();
  } finally { stop(); cache.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unchanged reconciliation preserves form data identity while changed fields and hostile JSON keys remain correct
 * 协作入口 / Collaborators: `cache.watch`, `until`, `cache.mutation`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(current!.data, first)`; `assert.notEqual(current!.data, first)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('unchanged reconciliation preserves form data identity while changed fields and hostile JSON keys remain correct', async () => {
  const cache = new ResourceCache(); let reads = 0;
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`JSON.parse('{"policy":{"days":7},"count":' + (reads < 3 ? 1 : 2) + ',"__proto__"…`），以 Promise 交付。
   * Result: Return the branch-computed value (`JSON.parse('{"policy":{"days":7},"count":' + (reads < 3 ? 1 : 2) + ',"__proto__"…`) through a Promise.
   * 验证场景 / Scenario: unchanged reconciliation preserves form data identity while changed fields and hostile JSON keys remain correct
   * 协作入口 / Collaborators: `JSON.parse`.
   */
  const request = (async () => { reads++; return JSON.parse('{"policy":{"days":7},"count":' +
    (reads < 3 ? 1 : 2) + ',"__proto__":{"polluted":true}}'); }) as ResourceRequest;
  let current: ResourceSnapshot<any> | undefined;
  const stop = cache.watch(request, '/log-retention', value => { current = value; }, 0);
  try {
    await until(() => current?.data !== null);
    const first = current!.data;
    cache.mutation('/log-retention'); await until(() => reads === 2 && !current?.loading);
    assert.equal(current!.data, first);
    cache.invalidate(); await until(() => current?.data.count === 2);
    assert.notEqual(current!.data, first);
    assert.equal(current!.data.policy, first.policy);
    assert.equal(Object.getPrototypeOf(current!.data), Object.prototype);
    assert.equal(Object.hasOwn(current!.data, '__proto__'), true);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  } finally { stop(); cache.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: task presentation distinguishes queue, cancellation, cleanup and uncertain restart outcomes
 * 协作入口 / Collaborators: `new Date().toISOString`, `assert.equal`, `jobPresentation`.
 * 检查边界 / Checked boundaries: `assert.equal(jobPresentation({ ...base, admission: 'queued' }).label, '等待资源')`; `assert.equal(jobPresentation({ ...base, admission: 'cancelling' }).label, '正在取消')`.
 */
test('task presentation distinguishes queue, cancellation, cleanup and uncertain restart outcomes', () => {
  const base: JobView = { status: 'running', startedAt: new Date().toISOString(), log: '' };
  assert.equal(jobPresentation({ ...base, admission: 'queued' }).label, '等待资源');
  assert.equal(jobPresentation({ ...base, admission: 'cancelling' }).label, '正在取消');
  assert.equal(jobPresentation({ ...base, status: 'error', admission: 'cleanup-pending' }).retryable, false);
  assert.equal(jobPresentation({ ...base, status: 'error', admission: 'cleanup-pending', cleanupResolvedAt: 'confirmed' }).retryable, true);
  assert.equal(jobPresentation({ ...base, status: 'interrupted' }).label, '待核对');
});
