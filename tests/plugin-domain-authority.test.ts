/**
 * 模块职责：回归验证模块，围绕 `plugin-domain-authority` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `plugin-domain-authority`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: VM ports expose immutable records and opaque live identities, and cached calls revoke; domain hooks unregister the exact generation while unrelated hooks remain.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PluginDirectory } from '../server/plugin-directory.ts';
import { withPluginAuthority } from '../server/plugin-authority.ts';
import { pluginCapabilities } from '../server/plugin-capabilities.ts';
import { ManagedHooks } from '../server/managed-hooks.ts';
import { TerminalBackend } from '../server/terminal-backend.ts';
import { SystemServices } from '../server/system-services.ts';
import { withPluginCleanup } from '../server/plugin-authority.ts';
import type { Machines } from '../server/machines.ts';

/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`Object.assign(new EventEmitter(), { records: new Map([['vm', { id: 'vm', name: '…`）。
 * Result: Return the branch-computed value (`Object.assign(new EventEmitter(), { records: new Map([['vm', { id: 'vm', name: '…`).
 * 协作入口 / Collaborators: `Object.assign`.
 */
const host = () =>
  Object.assign(new EventEmitter(), {
    records: new Map([['vm', { id: 'vm', name: 'original' }]]),
    live: new Map([
      [
        'vm',
        {
          status: 'running',
          startedAt: 'boot',
          abort: new AbortController(),
          clients: new Set(),
        },
      ],
    ]),
    logs: new Map(),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`this.records.get(id)`）。
     * Result: Return the branch-computed value (`this.records.get(id)`).
     * 协作入口 / Collaborators: `this.records.get`.
     */
    get(id: string) {
      return this.records.get(id);
    },
  }) as unknown as Machines;

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: VM ports expose immutable records and opaque live identities, and cached calls revoke
 * 状态影响 / State effects: `state.name`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `directory.begin`, `directory.publish`, `host`, `pluginCapabilities`.
 * 检查边界 / Checked boundaries: `assert.equal(machines.get('vm').name, 'original')`; `assert.equal(Object.hasOwn(live, 'clients'), false)`.
 */
test('VM ports expose immutable records and opaque live identities, and cached calls revoke', async () => {
  const directory = new PluginDirectory(),
    instance = directory.begin('official', 'test', '1', 'artifact');
  directory.publish(instance);
  const machines = host();
  const cap = pluginCapabilities('test', machines, instance.scope, instance);
  const vm = cap.vm,
    state = vm.get('vm');
  state.name = 'changed';
  assert.equal(machines.get('vm').name, 'original');
  const live = vm.live.get('vm')!;
  assert.equal(Object.hasOwn(live, 'clients'), false);
  assert.equal(Object.hasOwn(live.abort, 'abort'), false);
  assert.equal(Object.hasOwn(vm, 'maintenance'), false);
  assert.equal(Object.hasOwn(vm.records, 'set'), false);
  const get = vm.get;
  instance.revoke();
  assert.throws(() => get('vm'));
  await instance.scope.dispose();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: domain hooks unregister the exact generation while unrelated hooks remain
 * 协作入口 / Collaborators: `directory.begin`, `directory.publish`, `withPluginAuthority`, `hooks.dispatch`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(calls, ['a1', 'b1', 'b2'])`; `assert.equal(hooks.size, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('domain hooks unregister the exact generation while unrelated hooks remain', async () => {
  const directory = new PluginDirectory(),
    a = directory.begin('official', 'a', '1', 'a'),
    b = directory.begin('official', 'b', '1', 'b');
  directory.publish(a);
  directory.publish(b);
  const hooks = new ManagedHooks<[number]>(),
    calls: string[] = [];
  withPluginAuthority(a, () =>
    hooks.register(async (n) => {
      calls.push('a' + n);
    }),
  );
  withPluginAuthority(b, () =>
    hooks.register(async (n) => {
      calls.push('b' + n);
    }),
  );
  await hooks.dispatch(1);
  a.revoke();
  await hooks.dispatch(2);
  assert.deepEqual(calls, ['a1', 'b1', 'b2']);
  assert.equal(hooks.size, 1);
  await a.scope.dispose();
  await b.scope.dispose();
  assert.equal(hooks.size, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: terminal children release only their own leases on plugin exit
 * 状态影响 / State effects: `root.prepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `directory.begin`, `directory.publish`, `host`, `backend.handle`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(releases, ['a'])`; `assert.rejects(async () => first.prepare('vm', 'late'))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('terminal children release only their own leases on plugin exit', async () => {
  const directory = new PluginDirectory(),
    system = directory.begin('system', 'terminal-backend', '1', 'backend');
  const a = directory.begin('official', 'a', '1', 'a'),
    b = directory.begin('official', 'b', '1', 'b');
  directory.publish(system);
  directory.publish(a);
  directory.publish(b);
  const backend = new TerminalBackend(host(), system);
  const root = (backend as unknown as { root: { prepare: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: args: unknown[]。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (...args: unknown[]) => Promise<any> } }).root;
  const releases: string[] = [];
  root.prepare = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: _id; projectId。
   * 结果：返回分支计算值（`({ projectId, command: '', networkIsolation: 'host', release: async () => { rele…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ projectId, command: '', networkIsolation: 'host', release: async () => { rele…`) through a Promise.
   * 验证场景 / Scenario: terminal children release only their own leases on plugin exit
   */
  async (_id, projectId) => ({
    projectId,
    command: '',
    networkIsolation: 'host',
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: terminal children release only their own leases on plugin exit
     * 协作入口 / Collaborators: `releases.push`.
     */
    release: async () => {
      releases.push(projectId as string);
    },
  });
  const first = backend.handle(a),
    second = backend.handle(b),
    base = backend.handle();
  await first.prepare('vm', 'a');
  await second.prepare('vm', 'b');
  await base.prepare('vm', 'base');
  a.revoke();
  await a.scope.dispose();
  assert.deepEqual(releases, ['a']);
  await assert.rejects(async () => first.prepare('vm', 'late'));
  await second.close();
  assert.deepEqual(releases, ['a', 'b']);
  await base.close();
  assert.deepEqual(releases, ['a', 'b', 'base']);
  await b.scope.dispose();
  system.revoke();
  await system.scope.dispose();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: system composition preserves brokered terminal preparation and its original revocation checks
 * 协作入口 / Collaborators: `directory.begin`, `host`, `directory.publish`, `services.start`.
 * 检查边界 / Checked boundaries: `assert.equal(typeof prepareTask, 'function')`; `assert.equal(typeof terminals.preparation.workspaces.projects.with, 'function')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('system composition preserves brokered terminal preparation and its original revocation checks', async () => {
  const directory = new PluginDirectory(),
    services = new SystemServices(directory);
  const provider = directory.begin('system', 'terminal-backend', '1', 'backend');
  const backend = new TerminalBackend(host(), provider, undefined, services.broker, services.caller);
  directory.publish(provider);
  const terminals = await services.start({ id: 'projectTerminals', requires: [],
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`backend.handle()`）。
     * Result: Return the branch-computed value (`backend.handle()`).
     * 验证场景 / Scenario: system composition preserves brokered terminal preparation and its original revocation checks
     * 协作入口 / Collaborators: `backend.handle`.
     */
    create: () => backend.handle(), /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: system composition preserves brokered terminal preparation and its original revocation checks
     */
    initialize: () => {}, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: value。
     * 结果：返回分支计算值（`value?.close()`）。
     * Result: Return the branch-computed value (`value?.close()`).
     * 验证场景 / Scenario: system composition preserves brokered terminal preparation and its original revocation checks
     * 协作入口 / Collaborators: `value?.close`.
     */
    dispose: value => value?.close() });
  const prepareTask = terminals.preparation.prepareTask;
  assert.equal(typeof prepareTask, 'function');
  assert.equal(typeof terminals.preparation.workspaces.projects.with, 'function');
  assert.equal(terminals.preparation.workspaces.projects.current('vm'), 'default');
  assert.throws(() => Reflect.get(terminals.preparation, 'machines'), { code: 'PLUGIN_SERVICE_PRIVATE' });
  await services.retire('projectTerminals');
  assert.throws(() => prepareTask('vm', 'default'), { code: 'PLUGIN_REVOKED' });
  await services.close();
  provider.revoke();
  await provider.scope.dispose(async (dispose) => {
    await withPluginCleanup(provider, dispose);
  });
});
