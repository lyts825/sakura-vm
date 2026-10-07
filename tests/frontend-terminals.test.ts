/**
 * 模块职责：回归验证模块，围绕 `frontend-terminals` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `frontend-terminals`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: saved layouts restore names, ordering and selection without losing active sessions; a terminal closed after all views unmount stays removed when restored from storage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalStores } from '../src/terminal-store.ts';
import { applyTerminalLayout, restoreLayouts } from '../src/terminal-layouts.ts';
import { terminalStoreKey } from '../shared/terminal-scope.ts';

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `promise, resolve, reject`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `promise, resolve, reject`; the actual branch determines its shape.
 */
function deferred() {
  let resolve!: /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  let reject!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: error: Error。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `getStore, store, storage, saved`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `getStore, store, storage, saved`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `createTerminalStores`, `getStore`, `store.dispatch`.
 */
function fixture() {
  const saved = new Map<string, string>();
  const storage = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: key: string。
     * 结果：返回分支计算值（`saved.get(key) ?? null`）。
     * Result: Return the branch-computed value (`saved.get(key) ?? null`).
     * 协作入口 / Collaborators: `saved.get`.
     */
    getItem: (key: string) => saved.get(key) ?? null,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: key: string; value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `saved.set`.
     */
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
  };
  const getStore = createTerminalStores(() => storage);
  const store = getStore('first-vm');
  store.dispatch({ type: 'add', id: 'build' });
  store.dispatch({ type: 'add', id: 'logs' });
  return { getStore, store, storage, saved };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: saved layouts restore names, ordering and selection without losing active sessions
 * 协作入口 / Collaborators: `fixture`, `assert.equal`, `restoreLayouts`, `store.applyLayout`.
 * 检查边界 / Checked boundaries: `assert.equal(restoreLayouts([layout]).length, 1)`; `assert.deepEqual( store.getSnapshot().tabs.map((tab) => tab.id), ['main', 'build', 'logs'], )`.
 */
test('saved layouts restore names, ordering and selection without losing active sessions', () => {
  const { store, storage } = fixture();
  const layout = {
    id: 'dev-layout',
    name: 'Development',
    tabs: [
      { id: 'main', name: 'Shell' },
      { id: 'build', name: 'Build' },
    ],
    active: 'build',
    split: true,
    secondary: 'main',
  };
  assert.equal(restoreLayouts([layout]).length, 1);
  store.applyLayout(layout);
  assert.deepEqual(
    store.getSnapshot().tabs.map((tab) => tab.id),
    ['main', 'build', 'logs'],
  );
  assert.equal(store.getSnapshot().active, 'build');
  assert.equal(createTerminalStores(() => storage)('first-vm').getSnapshot().tabs[0].name, 'Shell');
  assert.deepEqual(restoreLayouts([{ ...layout, active: 'missing' }]), []);
  assert.throws(
    () =>
      applyTerminalLayout(
        {
          tabs: Array.from({ length: 8 }, (_, index) => ({ id: 'existing-' + index, name: 'Existing' })),
          active: 'existing-0',
        },
        layout,
      ),
    /8/,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a terminal closed after all views unmount stays removed when restored from storage
 * 协作入口 / Collaborators: `fixture`, `store.subscribe`, `deferred`, `store.close`.
 * 检查边界 / Checked boundaries: `assert.equal(notifications, count, 'the unmounted view receives no updates')`; `assert.deepEqual( JSON.parse(saved.get('sakura-terminals-first-vm')!).map((tab: { id: string }) => tab.id), ['main', 'build'], )`.
 */
test('a terminal closed after all views unmount stays removed when restored from storage', async () => {
  const { store, storage, saved } = fixture();
  let notifications = 0;
  const unmount = store.subscribe(() => {
    notifications++;
  });
  const response = deferred();
  const pending = store.close('logs', () => response.promise);
  unmount();
  const count = notifications;
  response.resolve();
  await pending;
  assert.equal(notifications, count, 'the unmounted view receives no updates');
  assert.deepEqual(
    JSON.parse(saved.get('sakura-terminals-first-vm')!).map((tab: { id: string }) => tab.id),
    ['main', 'build'],
  );
  // A fresh store registry models reopening the page from persistent storage.
  const restored = createTerminalStores(() => storage)('first-vm');
  assert.deepEqual(
    restored.getSnapshot().tabs.map((tab) => tab.id),
    ['main', 'build'],
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a late close preserves additions, renames and selection made by a remounted view
 * 协作入口 / Collaborators: `fixture`, `deferred`, `store.close`, `store.subscribe`.
 * 检查边界 / Checked boundaries: `assert.equal(remounted, store)`; `assert.deepEqual( current.tabs.map((tab) => tab.id), ['build', 'logs', 'new-shell'], )`.
 */
test('a late close preserves additions, renames and selection made by a remounted view', async () => {
  const { getStore, store, saved } = fixture();
  const response = deferred();
  const pending = store.close('main', () => response.promise);
  const unmount = store.subscribe(() => {});
  unmount();

  // Switching to a different VM changes an entirely separate store.
  const other = getStore('second-vm');
  other.dispatch({ type: 'add', id: 'other-shell' });
  const otherSaved = saved.get('sakura-terminals-second-vm');
  const remounted = getStore('first-vm');
  assert.equal(remounted, store);
  remounted.dispatch({ type: 'add', id: 'new-shell' });
  remounted.dispatch({ type: 'rename', id: 'build', name: 'Build renamed after remount' });
  remounted.dispatch({ type: 'select', id: 'new-shell' });
  let current = remounted.getSnapshot();
  const unsubscribe = remounted.subscribe(() => {
    current = remounted.getSnapshot();
  });
  response.resolve();
  await pending;
  unsubscribe();

  assert.deepEqual(
    current.tabs.map((tab) => tab.id),
    ['build', 'logs', 'new-shell'],
  );
  assert.equal(current.tabs[0].name, 'Build renamed after remount');
  assert.equal(current.active, 'new-shell');
  assert.equal(current.closing, null);
  assert.deepEqual(JSON.parse(saved.get('sakura-terminals-first-vm')!), current.tabs);
  assert.equal(saved.get('sakura-terminals-second-vm'), otherSaved);
  assert.equal(other.getSnapshot().active, 'other-shell');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: closing remains serialized after remount and never sends a request for the final session
 * 协作入口 / Collaborators: `fixture`, `deferred`, `store.close`, `getStore`.
 * 检查边界 / Checked boundaries: `assert.equal(remounted.getSnapshot().closing, 'logs')`; `assert.equal(requests, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('closing remains serialized after remount and never sends a request for the final session', async () => {
  const { getStore, store } = fixture();
  const response = deferred();
  let requests = 0;
  const pending = store.close('logs', () => {
    requests++;
    return response.promise;
  });
  const remounted = getStore('first-vm');
  assert.equal(remounted.getSnapshot().closing, 'logs');
  await remounted.close('build', async () => {
    requests++;
  });
  assert.equal(requests, 1);
  response.resolve();
  await pending;
  await remounted.close('build', async () => {
    requests++;
  });
  await remounted.close('main', async () => {
    requests++;
  });
  assert.equal(requests, 2);
  assert.deepEqual(
    remounted.getSnapshot().tabs.map((tab) => tab.id),
    ['main'],
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a failed close retains the latest tabs and exposes a retryable error to the remounted view
 * 协作入口 / Collaborators: `fixture`, `deferred`, `store.close`, `getStore`.
 * 检查边界 / Checked boundaries: `assert.equal(remounted.getSnapshot().error, 'SSH disconnected')`; `assert.equal(remounted.getSnapshot().closing, null)`.
 */
test('a failed close retains the latest tabs and exposes a retryable error to the remounted view', async () => {
  const { getStore, store, saved } = fixture();
  const response = deferred();
  const pending = store.close('logs', () => response.promise);
  const remounted = getStore('first-vm');
  remounted.dispatch({ type: 'rename', id: 'logs', name: 'Keep this session' });
  response.reject(new Error('SSH disconnected'));
  await pending;
  assert.equal(remounted.getSnapshot().error, 'SSH disconnected');
  assert.equal(remounted.getSnapshot().closing, null);
  assert.equal(remounted.getSnapshot().tabs.find((tab) => tab.id === 'logs')?.name, 'Keep this session');
  assert.deepEqual(JSON.parse(saved.get('sakura-terminals-first-vm')!), remounted.getSnapshot().tabs);
  await remounted.close('logs', async () => {});
  assert.equal(remounted.getSnapshot().error, '');
  assert.ok(!remounted.getSnapshot().tabs.some((tab) => tab.id === 'logs'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unavailable storage does not break closing or in-page recovery after remount
 * 协作入口 / Collaborators: `createTerminalStores`, `getStore`, `store.dispatch`, `deferred`.
 * 检查边界 / Checked boundaries: `assert.deepEqual( remounted.tabs.map((tab) => tab.id), ['second'], )`; `assert.equal(remounted.active, 'second')`.
 */
test('unavailable storage does not break closing or in-page recovery after remount', async () => {
  const getStore = createTerminalStores(() => {
    throw new Error('Storage is disabled');
  });
  const store = getStore('private-vm');
  store.dispatch({ type: 'add', id: 'second' });
  const response = deferred();
  const pending = store.close('main', () => response.promise);
  response.resolve();
  await pending;
  const remounted = getStore('private-vm').getSnapshot();
  assert.deepEqual(
    remounted.tabs.map((tab) => tab.id),
    ['second'],
  );
  assert.equal(remounted.active, 'second');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: stopping a project suspends sockets before cleanup and preserves layouts across reload and failure
 * 协作入口 / Collaborators: `fixture`, `getStore`, `terminalStoreKey`, `project.dispatch`.
 * 检查边界 / Checked boundaries: `assert.equal(project.getSnapshot().suspended, true, 'cannot reopen while killing sessions')`; `assert.equal(project.getSnapshot().error, '恢复实例后再停止')`.
 */
test('stopping a project suspends sockets before cleanup and preserves layouts across reload and failure', async () => {
  const { getStore, storage, saved } = fixture();
  const project = getStore(terminalStoreKey('first-vm', '0123456789abcdef'));
  const other = getStore(terminalStoreKey('first-vm', 'default'));
  project.dispatch({ type: 'add', id: 'private-build' });
  other.dispatch({ type: 'rename', id: 'main', name: 'Other project' });
  const response = deferred();
  const stopping = project.stopAll(() => {
    assert.equal(project.getSnapshot().suspended, true);
    assert.equal(project.getSnapshot().closing, '*');
    assert.equal(saved.get('sakura-terminals-first-vm:0123456789abcdef-suspended'), 'true');
    return response.promise;
  });
  project.resume();
  assert.equal(project.getSnapshot().suspended, true, 'cannot reopen while killing sessions');
  response.reject(new Error('恢复实例后再停止'));
  await stopping;
  assert.equal(project.getSnapshot().error, '恢复实例后再停止');
  assert.equal(project.getSnapshot().suspended, true);
  const restored = createTerminalStores(() => storage)(terminalStoreKey('first-vm', '0123456789abcdef'));
  assert.equal(restored.getSnapshot().suspended, true);
  assert.deepEqual(restored.getSnapshot().tabs.map((tab) => tab.id), ['main', 'private-build']);
  await restored.stopAll(async () => {});
  restored.resume();
  assert.equal(restored.getSnapshot().suspended, false);
  assert.equal(other.getSnapshot().suspended, false);
  assert.equal(other.getSnapshot().tabs[0].name, 'Other project');
  assert.equal(createTerminalStores(() => storage)(terminalStoreKey('first-vm', '0123456789abcdef'))
    .getSnapshot().suspended, false);
});
