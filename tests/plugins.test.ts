/**
 * 模块职责：回归验证模块，围绕 `plugins` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `plugins`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: a fresh install has no optional plugins, listeners, job stores or optional UI surfaces; every pack resolves version pins and dependencies before consumers without duplicates.
 */
type GatewayFixtureHost = import('../server/features.ts').Features;
type GatewayFixtureBody = Parameters<GatewayFixtureHost['route']>[3];
const admittedRouteFixtures = new WeakMap<GatewayFixtureHost, {
  gateway: import('../server/operation-gateway.ts').OperationGateway;
  bodies: WeakMap<import('node:http').IncomingMessage, GatewayFixtureBody>;
}>();
/** Preserve the fixture's data-directory setup before loading the real operation admission modules. */
/**
 * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
 * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
 * 输入 / Inputs: host: GatewayFixtureHost; req: import('node:http').IncomingMessage; res: import('node:http').ServerResponse; url: URL; body: GatewayFixtureBody。
 * 结果：返回分支计算值（`await fixture.gateway.dispatch(req, res, url) as boolean`），以 Promise 交付。
 * Result: Return the branch-computed value (`await fixture.gateway.dispatch(req, res, url) as boolean`) through a Promise.
 * 状态影响 / State effects: `fixture`, `req.headers['content-type']`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `admittedRouteFixtures.get`, `Promise.all`, `import`, `gateway.register`.
 */
async function routeThroughGateway(host: GatewayFixtureHost, req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse, url: URL, body: GatewayFixtureBody) {
  let fixture = admittedRouteFixtures.get(host);
  if (!fixture) {
    const [{ OperationGateway }, { operationEntries }] = await Promise.all([
      import('../server/operation-gateway.ts'), import('../server/operation-catalog.ts'),
    ]);
    const bodies = new WeakMap<import('node:http').IncomingMessage, GatewayFixtureBody>();
    const gateway = new OperationGateway({
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`host.enabled`）。
       * Result: Return the branch-computed value (`host.enabled`).
       */
      enabled: () => host.enabled,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: owner。
       * 结果：返回分支计算值（`owner === 'core' ? undefined : host.directory.get('official', owner)`）。
       * Result: Return the branch-computed value (`owner === 'core' ? undefined : host.directory.get('official', owner)`).
       * 协作入口 / Collaborators: `host.directory.get`.
       */
      instance: owner => owner === 'core' ? undefined : host.directory.get('official', owner),
      /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: _request; _url; _entry; _parameters; requireEnabled。
       * 结果：返回受控对象，公开字段包括 `check`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `check`; the actual branch determines its shape.
       * 协作入口 / Collaborators: `requireEnabled`.
       */
      bind: async (_request, _url, _entry, _parameters, requireEnabled) => {
        requireEnabled();
        return { /**
         * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
         * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`'owner'`），以 Promise 交付。
         * Result: Return the branch-computed value (`'owner'`) through a Promise.
         */
        check: async () => 'owner' };
      },
    });
    for (const entry of operationEntries)
      if (entry.declaration.method !== 'UPGRADE')
        gateway.register(entry, (request, response, target) => host.route(request, response, target, bodies.get(request)!));
    gateway.seal();
    fixture = { gateway, bodies };
    admittedRouteFixtures.set(host, fixture);
  }
  fixture.bodies.set(req, body);
  const input = fixture.gateway.resolve(req.method || 'GET', url.pathname).entry.requestContract!;
  if (input.kind !== 'none') req.headers['content-type'] ||= input.media;
  return await fixture.gateway.dispatch(req, res, url) as boolean;
}
import { services as imagesContract } from '../plugins/images/services.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Machines } from '../server/machines.ts';
import {
  PLUGINS,
  PLUGIN_PACKS,
  emptySelection,
  pluginSurfaceEnabled,
  PLUGIN_API_VERSION,
  developmentSections,
} from '../shared/plugins.ts';
import { resolvePlugins, validateCatalog } from '../shared/plugin-selection.ts';
import { pluginManifestSchema, pluginPackSchema } from '../shared/plugin-schema.ts';

const directory = await mkdtemp(join(tmpdir(), 'sakura-plugins-'));
process.env.SAKURA_DATA_DIR = directory;
const { PluginManager } = await import('../server/plugin-manager.ts');
const { Features } = await import('../server/features.ts');
const { loaders, routeContribution, socketOwner } = await import('../server/plugins/registry.ts');
after(async () => {
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-plugins-'));
  await rm(directory, { recursive: true, force: true });
});
/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`Object.assign(new EventEmitter(), { records: new Map(), live: new Map(), get: ()…`）。
 * Result: Return the branch-computed value (`Object.assign(new EventEmitter(), { records: new Map(), live: new Map(), get: ()…`).
 * 协作入口 / Collaborators: `Object.assign`.
 */
const machines = () =>
  Object.assign(new EventEmitter(), {
    records: new Map(),
    live: new Map(),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ name: 'example' })`）。
     * Result: Return the branch-computed value (`({ name: 'example' })`).
     */
    get: () => ({ name: 'example' }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'stopped'`）。
     * Result: Return the branch-computed value (`'stopped'`).
     */
    state: () => 'stopped',
  }) as unknown as Machines;
/**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: method = 'GET'。
 * 结果：返回受控对象，公开字段包括 `req, res`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `req, res`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `Object.assign`.
 */
function request(method = 'GET') {
  const req = Object.assign(new EventEmitter(), { method, headers: {} }) as IncomingMessage;
  const res = Object.assign(new EventEmitter(), {
    writableFinished: false,
    status: 0,
    payload: undefined as any,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: status: number。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `this.status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    writeHead(status: number) {
      this.status = status;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: data: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `this.payload`, `this.writableFinished`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `JSON.parse`.
     */
    end(data: string) {
      this.payload = JSON.parse(data);
      this.writableFinished = true;
    },
  });
  return { req, res: res as typeof res & ServerResponse };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a fresh install has no optional plugins, listeners, job stores or optional UI surfaces
 * 协作入口 / Collaborators: `join`, `assert.deepEqual`, `manager.init`, `machines`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(await manager.init(), [])`; `assert.equal(manager.view().restartRequired, false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a fresh install has no optional plugins, listeners, job stores or optional UI surfaces', async () => {
  const manager = new PluginManager(join(directory, 'fresh.json'));
  assert.deepEqual(await manager.init(), []);
  const vm = machines(),
    host = await manager.start(vm);
  try {
    assert.equal(manager.view().restartRequired, false);
    assert.deepEqual([...host.enabled], []);
    assert.deepEqual(host.jobStores(), []);
    assert.deepEqual(vm.eventNames(), []);
    assert.equal(host.workspaces, undefined);
    assert.equal(host.desktops, undefined);
    assert.equal(host.backups, undefined);
    assert.equal(host.migration, undefined);
    for (const page of ['workspace', 'plugins', 'settings'])
      assert.equal(pluginSurfaceEnabled([], 'pages', page), true);
    for (const page of ['images', 'library', 'features', 'tasks'])
      assert.equal(pluginSurfaceEnabled([], 'pages', page), false);
    assert.equal(pluginSurfaceEnabled([], 'tabs', 'terminal'), true);
    assert.equal(pluginSurfaceEnabled([], 'tabs', 'config'), true);
    assert.equal(pluginSurfaceEnabled([], 'tabs', 'files'), false);
  } finally {
    await host.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: every pack resolves version pins and dependencies before consumers without duplicates
 * 协作入口 / Collaborators: `resolvePlugins`, `emptySelection`, `assert.equal`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.equal(new Set(order).size, order.length)`; `assert.ok(loaders[id], `Missing loader: ${id}`)`.
 */
test('every pack resolves version pins and dependencies before consumers without duplicates', () => {
  for (const pack of PLUGIN_PACKS) {
    const order = resolvePlugins({ ...emptySelection(), packs: [pack.id] });
    assert.equal(new Set(order).size, order.length);
    for (const id of order) {
      assert.ok(loaders[id], `Missing loader: ${id}`);
      for (const dependency of PLUGINS.find((item) => item.id === id)!.requires)
        assert.ok(order.indexOf(dependency.id) < order.indexOf(id));
    }
  }
  assert.equal(resolvePlugins({ ...emptySelection(), packs: ['complete'] }).length, PLUGINS.length);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: invalid dependencies, cycles, incompatible APIs and pack pins fail before activation
 * 协作入口 / Collaborators: `assert.throws`, `PLUGINS.find`.
 * 检查边界 / Checked boundaries: `assert.throws(() => resolvePlugins({ ...emptySelection(), plugins: ['unknown'] }), /不存在/)`; `assert.throws(() => resolvePlugins({ ...emptySelection(), packs: ['unknown'] }), /不存在/)`.
 */
test('invalid dependencies, cycles, incompatible APIs and pack pins fail before activation', () => {
  assert.throws(() => resolvePlugins({ ...emptySelection(), plugins: ['unknown'] }), /不存在/);
  assert.throws(() => resolvePlugins({ ...emptySelection(), packs: ['unknown'] }), /不存在/);
  const files = PLUGINS.find((item) => item.id === 'files')!;
  assert.throws(
    () =>
      resolvePlugins(
        { ...emptySelection(), plugins: ['files'] },
        PLUGINS.map((item) =>
          item.id === 'files' ? { ...files, requires: [{ id: 'files', version: files.version }] } : item,
        ),
      ),
    /循环/,
  );
  assert.throws(
    () =>
      resolvePlugins(
        { ...emptySelection(), plugins: ['files'] },
        PLUGINS.map((item) =>
          item.id === 'files' ? { ...files, apiVersion: PLUGIN_API_VERSION + 1 } : item,
        ),
      ),
    /不兼容/,
  );
  assert.throws(
    () =>
      resolvePlugins(
        { ...emptySelection(), packs: ['essentials'] },
        PLUGINS.map((item) => (item.id === 'files' ? { ...item, version: '9.0.0' } : item)),
      ),
    /版本不匹配/,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: selection updates are serialized, dependency-safe and survive a restart
 * 协作入口 / Collaborators: `join`, `manager.init`, `Promise.all`, `manager.change`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(manager.view().active, [])`; `assert.equal(manager.view().restartRequired, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('selection updates are serialized, dependency-safe and survive a restart', async () => {
  const file = join(directory, 'selection.json'),
    manager = new PluginManager(file);
  await manager.init();
  await Promise.all([
    manager.change({ kind: 'plugin', id: 'files', enabled: true }),
    manager.change({ kind: 'pack', id: 'developer', enabled: true }),
    manager.change({ kind: 'pack', id: 'operations', enabled: true }),
  ]);
  assert.deepEqual(manager.view().active, []);
  assert.equal(manager.view().restartRequired, true);
  await assert.rejects(manager.change({ kind: 'plugin', id: 'transfers', enabled: false }), /仍被依赖/);
  await manager.change({ kind: 'pack', id: 'developer', enabled: false });
  assert.ok(manager.view().planned.includes('files')); // Explicit root remains.
  assert.ok(manager.view().planned.includes('projects')); // Shared operations dependency remains.
  assert.ok(!manager.view().planned.includes('git'));
  const restored = new PluginManager(file);
  const order = await restored.init();
  assert.equal(restored.view().restartRequired, false);
  assert.deepEqual(restored.view().selection, manager.view().selection);
  await restored.change({ kind: 'pack', id: 'operations', enabled: false });
  assert.deepEqual(restored.view().planned, ['transfers', 'files']);
  await restored.change({ kind: 'plugin', id: 'files', enabled: false });
  assert.deepEqual(restored.view().planned, []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed persistence and malformed input leave the saved selection intact
 * 协作入口 / Collaborators: `join`, `manager.init`, `writeFile`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(manager.change({ kind: 'plugin', id: 'files', enabled: true }))`; `assert.deepEqual(manager.view().selection, emptySelection())`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('failed persistence and malformed input leave the saved selection intact', async () => {
  const parent = join(directory, 'blocked'),
    manager = new PluginManager(join(parent, 'plugins.json'));
  await manager.init();
  await writeFile(parent, 'preserve');
  await assert.rejects(manager.change({ kind: 'plugin', id: 'files', enabled: true }));
  assert.deepEqual(manager.view().selection, emptySelection());
  assert.equal(await readFile(parent, 'utf8'), 'preserve');
  assert.throws(() => manager.change({ kind: 'plugin', id: 'files', enabled: 'true' }));
  const broken = join(directory, 'broken.json');
  await writeFile(broken, '{');
  await assert.rejects(new PluginManager(broken).init());
  assert.equal(await readFile(broken, 'utf8'), '{');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: disabled plugins reject API calls and creation options before touching the VM
 * 状态影响 / State effects: `vm.get`, `req.method`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `machines`, `Features.create`, `request`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects( routeThroughGateway(host, req, res, new URL('http://localhost' + path), async () => ({})), (error: any) => error.s…`; `assert.equal(await routeThroughGateway(host, req, res, new URL('http://localhost/api/vms'), async () => ({})), false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('disabled plugins reject API calls and creation options before touching the VM', async () => {
  const vm = machines();
  vm.get = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: disabled plugins reject API calls and creation options before touching the VM
   * 失败 / Failure: `new Error('Must not access VM')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  () => {
    throw new Error('Must not access VM');
  };
  const host = await Features.create(vm);
  const { req, res } = request();
  try {
    for (const [method, path] of [
      ['GET', '/api/images'],
      ['POST', '/api/import'],
      ['GET', '/api/migration'],
      ['POST', '/api/vms/batch'],
      ['GET', '/api/vms/vm/file'],
      ['GET', '/api/vms/vm/desktop'],
      ['POST', '/api/vms/vm/snapshots'],
      ['GET', '/api/vms/vm/advanced'],
      ['POST', '/api/vms/vm/suspend'],
    ]) {
      req.method = method;
      await assert.rejects(
        routeThroughGateway(host, req, res, new URL('http://localhost' + path), async () => ({})),
        (error: any) => error.status === 403,
        path,
      );
    }
    req.method = 'GET';
    assert.equal(await routeThroughGateway(host, req, res, new URL('http://localhost/api/vms'), async () => ({})), false);
    assert.throws(() => host.validateConfig({ template: 'node' }), /projects/);
    assert.throws(() => host.validateConfig({ distro: 'ubuntu' }), /images/);
    assert.throws(() => host.validateConfig({ forwards: [{ host: 8080, guest: 80 }] }), /network/);
    const previous = {
      name: 'old',
      distro: 'ubuntu',
      template: 'node',
      forwards: [{ host: 8080, guest: 80 }],
    } as any;
    assert.doesNotThrow(() => host.validateConfig({ ...previous, memoryMiB: 2048 }, previous));
  } finally {
    await host.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: batch instance failures keep safe public messages and correlation IDs without internal exception details
 * 状态影响 / State effects: `vm.start`, `res.getHeader`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `machines`, `randomUUID`, `Features.create`, `request`.
 * 检查边界 / Checked boundaries: `assert.equal(res.status, 200)`; `assert.equal(res.payload.results[0].id, id)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('batch instance failures keep safe public messages and correlation IDs without internal exception details', async () => {
  const vm = machines(), id = randomUUID(), correlationId = randomUUID();
  vm.start = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: batch instance failures keep safe public messages and correlation IDs without internal exception details
   * 失败 / Failure: `new AppError('PRIVATE_SECRET C:\\private\\sensitive.key', 409, 'BUSINESS_CONFLICT')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw new AppError('PRIVATE_SECRET C:\\private\\sensitive.key', 409, 'BUSINESS_CONFLICT'); };
  const host = await Features.create(vm, ['library']);
  const { req, res } = request('POST');
  res.getHeader = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`correlationId`）。
   * Result: Return the branch-computed value (`correlationId`).
   * 验证场景 / Scenario: batch instance failures keep safe public messages and correlation IDs without internal exception details
   */
  () => correlationId;
  try {
    await routeThroughGateway(host, req, res, new URL('http://localhost/api/vms/batch'), async () => ({ ids: [id], action: 'start' }));
    assert.equal(res.status, 200); assert.equal(res.payload.results[0].id, id);
    assert.equal(res.payload.results[0].ok, false);
    assert.match(res.payload.results[0].error, new RegExp(correlationId));
    assert.doesNotMatch(JSON.stringify(res.payload), /PRIVATE_SECRET|private|sensitive.key/);
  } finally { await host.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: files activate only their declared services and cannot export through download tickets
 * 协作入口 / Collaborators: `machines`, `Features.create`, `assert.deepEqual`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.deepEqual([...host.enabled], ['transfers', 'files'])`; `assert.equal(host.workspaces, undefined)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('files activate only their declared services and cannot export through download tickets', async () => {
  const vm = machines(),
    host = await Features.create(vm, ['files']);
  try {
    assert.deepEqual([...host.enabled], ['transfers', 'files']);
    assert.equal(host.workspaces, undefined);
    assert.equal(host.backups, undefined);
    assert.equal(vm.listenerCount('change'), 0);
    assert.equal(Object.hasOwn(vm, 'fileBeforeReplace'), false);
    const { req, res } = request('POST');
    await assert.rejects(
      routeThroughGateway(host, req, res, new URL('http://localhost/api/vms/vm/download'), async () => ({ type: 'export' })),
      /snapshots/,
    );
    assert.deepEqual(Object.keys(host.errors), []);
  } finally {
    await host.close();
  }
  assert.equal(Object.hasOwn(vm, 'fileBeforeReplace'), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: file-lock route grants one lease and guards file mutations until release
 * 协作入口 / Collaborators: `machines`, `Features.create`, `call`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.match(first.token, /^[0-9a-f-]{36}$/)`; `assert.deepEqual(await call('GET', endpoint), { path: '/workspace/notes.txt', locked: true, expiresAt: first.expiresAt, })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('file-lock route grants one lease and guards file mutations until release', async () => {
  const vm = machines(), host = await Features.create(vm, ['files']);
  const endpoint = 'http://localhost/api/vms/vm/file-lock?path=%2Fworkspace%2Fnotes.txt';
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: method: string; url: string; input: unknown。
   * 结果：返回分支计算值（`res.payload`），以 Promise 交付。
   * Result: Return the branch-computed value (`res.payload`) through a Promise.
   * 验证场景 / Scenario: file-lock route grants one lease and guards file mutations until release
   * 协作入口 / Collaborators: `request`, `routeThroughGateway`.
   */
  const call = async (method: string, url: string, input?: unknown) => {
    const { req, res } = request(method);
    await routeThroughGateway(host, req, res, new URL(url), async () => input);
    return res.payload;
  };
  try {
    const first = await call('POST', endpoint, { action: 'acquire' });
    assert.match(first.token, /^[0-9a-f-]{36}$/);
    assert.deepEqual(await call('GET', endpoint), {
      path: '/workspace/notes.txt', locked: true, expiresAt: first.expiresAt,
    });
    await assert.rejects(call('POST', endpoint, { action: 'acquire' }),
      (error: any) => error.status === 409);
    await assert.rejects(call('POST', 'http://localhost/api/vms/vm/file-operation', {
      action: 'delete', path: '/workspace/notes.txt', recursive: false,
    }), (error: any) => error.status === 409);
    await call('POST', endpoint, { action: 'release', token: first.token });
    assert.equal((await call('GET', endpoint)).locked, false);
  } finally {
    await host.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: snapshot and desktop routes use path segment lengths after extraction
 * 状态影响 / State effects: `vm.snapshot`, `vm.onlineSnapshot`, `vm.memorySnapshot`, `vm.restoreMemory`, `(host.serviceValue('desktops') as import('../server/desktop.ts').Deskt…`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `machines`, `Features.create`, `new Date(0).toISOString`, `host.serviceValue`.
 * 检查边界 / Checked boundaries: `assert.equal( await routeThroughGateway(host, first.req, first.res, new URL('http://localhost/api/vms/vm/snapshots'), async () => …`; `assert.equal(first.res.status, 201)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('snapshot and desktop routes use path segment lengths after extraction', async () => {
  const vm = machines(),
    host = await Features.create(vm, ['snapshots', 'desktop']);
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: name: string; consistency: 'offline' | 'filesystem' | 'vmstate'。
   * 结果：返回分支计算值（`({ id: '11111111-1111-4111-8111-111111111111' as const, name, createdAt: new Dat…`）。
   * Result: Return the branch-computed value (`({ id: '11111111-1111-4111-8111-111111111111' as const, name, createdAt: new Dat…`).
   * 验证场景 / Scenario: snapshot and desktop routes use path segment lengths after extraction
   * 协作入口 / Collaborators: `new Date(0).toISOString`.
   */
  const snapshot = (name: string, consistency: 'offline' | 'filesystem' | 'vmstate') => ({
    id: '11111111-1111-4111-8111-111111111111' as const, name, createdAt: new Date(0).toISOString(),
    diskGiB: 8, pendingResize: false, consistency,
  });
  vm.snapshot = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: _id; name。
   * 结果：返回分支计算值（`snapshot(name, 'offline')`），以 Promise 交付。
   * Result: Return the branch-computed value (`snapshot(name, 'offline')`) through a Promise.
   * 验证场景 / Scenario: snapshot and desktop routes use path segment lengths after extraction
   * 协作入口 / Collaborators: `snapshot`.
   */
  async (_id, name) => snapshot(name, 'offline');
  vm.onlineSnapshot = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: _id; name。
   * 结果：返回分支计算值（`snapshot(name, 'filesystem')`），以 Promise 交付。
   * Result: Return the branch-computed value (`snapshot(name, 'filesystem')`) through a Promise.
   * 验证场景 / Scenario: snapshot and desktop routes use path segment lengths after extraction
   * 协作入口 / Collaborators: `snapshot`.
   */
  async (_id, name) => snapshot(name, 'filesystem');
  vm.memorySnapshot = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: _id; name。
   * 结果：返回分支计算值（`snapshot(name, 'vmstate')`），以 Promise 交付。
   * Result: Return the branch-computed value (`snapshot(name, 'vmstate')`) through a Promise.
   * 验证场景 / Scenario: snapshot and desktop routes use path segment lengths after extraction
   * 协作入口 / Collaborators: `snapshot`.
   */
  async (_id, name) => snapshot(name, 'vmstate');
  const restoredVm: import('../shared/contracts/vm.ts').VMView = {
    id: 'vm', name: 'example', memoryMiB: 512, cpus: 1, diskGiB: 8,
    accelerator: 'tcg', forwards: [], createdAt: new Date(0).toISOString(), snapshots: [],
    status: 'stopped', poweredOn: false, diskBytes: 0,
  };
  let restoreArguments: { id: string; snapshotId: string; backup: boolean | undefined } | undefined;
  vm.restoreMemory = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: id; snapshotId; backup。
   * 结果：返回分支计算值（`restoredVm`），以 Promise 交付。
   * Result: Return the branch-computed value (`restoredVm`) through a Promise.
   * 验证场景 / Scenario: snapshot and desktop routes use path segment lengths after extraction
   * 状态影响 / State effects: `restoreArguments`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  async (id, snapshotId, backup) => {
    restoreArguments = { id, snapshotId, backup };
    return restoredVm;
  };
  (host.serviceValue('desktops') as import('../server/desktop.ts').Desktops).view = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ status: 'not-installed', log: '' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ status: 'not-installed', log: '' })`) through a Promise.
   * 验证场景 / Scenario: snapshot and desktop routes use path segment lengths after extraction
   */
  async () => ({ status: 'not-installed', log: '' });
  try {
    const first = request('POST');
    assert.equal(
      await routeThroughGateway(host, first.req, first.res, new URL('http://localhost/api/vms/vm/snapshots'), async () => ({
        name: 'checkpoint',
      })),
      true,
    );
    assert.equal(first.res.status, 201);
    assert.equal(first.res.payload.name, 'checkpoint');
    const online = request('POST');
    assert.equal(
      await routeThroughGateway(host, online.req, online.res, new URL('http://localhost/api/vms/vm/snapshots'), async () => ({
        name: 'live', online: true,
      })),
      true,
    );
    assert.equal(online.res.payload.consistency, 'filesystem');
    const memory = request('POST');
    assert.equal(
      await routeThroughGateway(host, memory.req, memory.res, new URL('http://localhost/api/vms/vm/snapshots'),
        async () => ({ name: 'process', online: true, memory: true })),
      true,
    );
    assert.equal(memory.res.payload.consistency, 'vmstate');
    const restore = request('POST');
    const restoreBody = { backup: true, memory: true };
    restore.req.headers['content-type'] = 'application/json';
    restore.req.headers['content-length'] = String(Buffer.byteLength(JSON.stringify(restoreBody)));
    assert.equal(
      await routeThroughGateway(host, restore.req, restore.res,
        new URL('http://localhost/api/vms/vm/snapshots/checkpoint/restore'),
        async () => restoreBody),
      true,
    );
    assert.deepEqual(restoreArguments,
      { id: 'vm', snapshotId: 'checkpoint', backup: true });
    assert.deepEqual(restore.res.payload, restoredVm);
    const second = request();
    assert.equal(
      await routeThroughGateway(host,
        second.req,
        second.res,
        new URL('http://localhost/api/vms/vm/desktop'),
        async () => ({}),
      ),
      true,
    );
    assert.equal(second.res.payload.status, 'not-installed');
  } finally {
    await host.close();
  }
  assert.equal(vm.listenerCount('change'), 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: plugin activation failure is isolated and prevents dependent activation
 * 状态影响 / State effects: `loaders.transfers`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Features.create`, `machines`, `assert.deepEqual`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.deepEqual([...host.enabled], ['terminal-workspace'])`; `assert.match(host.errors.transfers, /adapter unavailable/)`.
 */
test('plugin activation failure is isolated and prevents dependent activation', async () => {
  const original = loaders.transfers;
  loaders.transfers = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: plugin activation failure is isolated and prevents dependent activation
   * 失败 / Failure: `new Error('adapter unavailable')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => {
    throw new Error('adapter unavailable');
  };
  try {
    const host = await Features.create(machines(), ['files', 'terminal-workspace']);
    assert.deepEqual([...host.enabled], ['terminal-workspace']);
    assert.match(host.errors.transfers, /adapter unavailable/);
    assert.match(host.errors.files, /依赖/);
    await host.close();
  } finally {
    loaders.transfers = original;
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the complete pack activates all adapters and releases every lifecycle listener
 * 协作入口 / Collaborators: `machines`, `Features.create`, `resolvePlugins`, `emptySelection`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(host.errors, {})`; `assert.equal(host.enabled.size, PLUGINS.length)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('the complete pack activates all adapters and releases every lifecycle listener', async () => {
  const vm = machines();
  const host = await Features.create(vm, resolvePlugins({ ...emptySelection(), packs: ['complete'] }));
  try {
    assert.deepEqual(host.errors, {});
    assert.equal(host.enabled.size, PLUGINS.length);
    assert.ok(vm.listenerCount('change') > 0);
    assert.ok(host.jobStores().length > 10);
  } finally {
    await host.close();
  }
  assert.equal(vm.listenerCount('change'), 0);
  assert.equal(Object.hasOwn(vm, 'fileBeforeReplace'), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: disabling a plugin preserves instance and plugin data on disk
 * 协作入口 / Collaborators: `join`, `mkdir`, `writeFile`, `manager.init`.
 * 检查边界 / Checked boundaries: `assert.equal(await readFile(sentinel, 'utf8'), 'keep all existing history')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('disabling a plugin preserves instance and plugin data on disk', async () => {
  const folder = join(directory, 'retained-data');
  await mkdir(folder);
  const sentinel = join(folder, 'history.json');
  await writeFile(sentinel, 'keep all existing history');
  const manager = new PluginManager(join(folder, 'plugins.json'));
  await manager.init();
  await manager.change({ kind: 'plugin', id: 'files', enabled: true });
  await manager.change({ kind: 'plugin', id: 'files', enabled: false });
  assert.equal(await readFile(sentinel, 'utf8'), 'keep all existing history');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: split packages activate only the services needed for the selected capability
 * 协作入口 / Collaborators: `machines`, `Features.create`, `assert.deepEqual`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(host.errors, {}, id)`; `assert.deepEqual([...host.enabled], expected, id)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('split packages activate only the services needed for the selected capability', async () => {
  const cases = [
    ['transfers', ['transfers'], ['files', 'bundles', 'workspaces']],
    ['snapshots', ['transfers', 'snapshots'], ['files', 'history', 'workspaces']],
    ['metrics', ['metrics'], ['workspaces', 'health', 'suite']],
    ['recipes', ['projects', 'recipes'], ['ide', 'files', 'suite']],
    ['ide', ['projects', 'ide'], ['recipes', 'files', 'suite']],
    ['commands', ['projects', 'commands'], ['files', 'toolchains', 'pipelines', 'runtimes']],
    ['toolchains', ['projects', 'toolchains'], ['files', 'commands', 'pipelines', 'runtimes']],
    ['runtimes', ['projects', 'runtimes'], ['files', 'commands', 'pipelines', 'toolchains']],
    ['extensions', ['projects', 'extensions'], ['suite', 'next', 'health']],
    ['platform', ['projects', 'platform'], ['suite', 'extended', 'health']],
  ] as const;
  for (const [id, expected, absent] of cases) {
    const vm = machines();
    const host = await Features.create(vm, [id]);
    try {
      assert.deepEqual(host.errors, {}, id);
      assert.deepEqual([...host.enabled], expected, id);
      for (const service of absent) assert.equal(host[service], undefined, `${id} must not load ${service}`);
      if (id === 'metrics') {
        assert.equal(vm.listenerCount('change'), 0);
        assert.deepEqual(host.jobStores(), []);
        assert.equal(pluginSurfaceEnabled([...host.enabled], 'tabs', 'project'), false);
      }
      if (id === 'extensions' || id === 'platform') {
        const { req, res } = request();
        await assert.rejects(
          routeThroughGateway(host, req, res, new URL('http://localhost/api/vms/vm/advanced'), async () => ({})),
          /automation/,
        );
      }
    } finally {
      await host.close();
    }
    assert.equal(vm.listenerCount('change'), 0, id);
  }
  assert.deepEqual(developmentSections(['commands']), ['commands']);
  assert.deepEqual(developmentSections(['network']), ['network']);
  assert.deepEqual(developmentSections(['metrics']), []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: standalone metrics invalidate a cached sample when the guest restarts without project listeners
 * 状态影响 / State effects: `vm.state`, `vm.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `machines`, `vm.live.set`, `Features.create`, `host.metrics.sample`.
 * 检查边界 / Checked boundaries: `assert.rejects(first, /previous boot/)`; `assert.equal(host.metrics.sample('vm'), first)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('standalone metrics invalidate a cached sample when the guest restarts without project listeners', async () => {
  const vm = machines();
  vm.state = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'running'`）。
   * Result: Return the branch-computed value (`'running'`).
   * 验证场景 / Scenario: standalone metrics invalidate a cached sample when the guest restarts without project listeners
   */
  () => 'running';
  vm.live.set('vm', { startedAt: 'first' } as any);
  const pending: Array<{ resolve: /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: value: any。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (value: any) => void; reject: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: error: Error。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (error: Error) => void }> = [];
  vm.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`new Promise((resolve, reject) => pending.push({ resolve, reject }))`）。
   * Result: Return the branch-computed value (`new Promise((resolve, reject) => pending.push({ resolve, reject }))`).
   * 验证场景 / Scenario: standalone metrics invalidate a cached sample when the guest restarts without project listeners
   */
  () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const host = await Features.create(vm, ['metrics']);
  try {
    const first = host.metrics.sample('vm');
    const rejected = assert.rejects(first, /previous boot/);
    assert.equal(host.metrics.sample('vm'), first);
    await new Promise<void>(done => setImmediate(done));
    vm.live.set('vm', { startedAt: 'second' } as any);
    const second = host.metrics.sample('vm');
    assert.notEqual(second, first);
    await new Promise<void>(done => setImmediate(done));
    pending[0].reject(new Error('previous boot'));
    await rejected;
    assert.equal(host.metrics.sample('vm'), second);
    pending[1].resolve({
      code: 0,
      stderr: '',
      stdout:
        'CPU\ncpu 1 0 0 9 0 0 0 0\ncpu 2 0 0 18 0 0 0 0\nMEMORY\nMemTotal: 1000 kB\nMemAvailable: 500 kB\nDISK\n/dev/vda 1000 500 500 50% /\nPROCESSES\n1 init\nUPTIME\n1.0 0.5\n',
    });
    assert.equal((await second).cpuPercent, 10);
    assert.equal(vm.listenerCount('change'), 0);
  } finally {
    await host.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: nested packs preserve shared and explicit roots and reject cycles and incompatible pins
 * 协作入口 / Collaborators: `PLUGIN_PACKS.find`, `assert.ok`, `developer.members.some`, `join`.
 * 检查边界 / Checked boundaries: `assert.ok(developer.members.some((item) => item.kind === 'pack' && item.id === 'development'))`; `assert.ok(manager.view().reasons.commands.some((root) => root.kind === 'pack' && root.id === 'developer'))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('nested packs preserve shared and explicit roots and reject cycles and incompatible pins', async () => {
  const developer = PLUGIN_PACKS.find((pack) => pack.id === 'developer')!;
  assert.ok(developer.members.some((item) => item.kind === 'pack' && item.id === 'development'));
  const manager = new PluginManager(join(directory, 'nested.json'));
  await manager.init();
  await manager.change({ kind: 'pack', id: 'developer', enabled: true });
  await manager.change({ kind: 'plugin', id: 'commands', enabled: true });
  assert.ok(manager.view().reasons.commands.some((root) => root.kind === 'pack' && root.id === 'developer'));
  await manager.change({ kind: 'pack', id: 'developer', enabled: false });
  assert.deepEqual(manager.view().planned, ['projects', 'commands']);
  assert.deepEqual(manager.view().reasons.commands, [{ kind: 'plugin', id: 'commands' }]);
  const cycle = PLUGIN_PACKS.map((pack) =>
    pack.id === 'development'
      ? { ...pack, members: [{ kind: 'pack' as const, id: pack.id, version: pack.version }] }
      : pack,
  );
  assert.throws(() => validateCatalog(PLUGINS, cycle), /整合包依赖循环/);
  const pins = PLUGIN_PACKS.map((pack) =>
    pack.id === 'developer'
      ? { ...pack, members: [{ kind: 'pack' as const, id: 'development', version: '9.0.0' }] }
      : pack,
  );
  assert.throws(() => validateCatalog(PLUGINS, pins), /版本不匹配/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy aggregate selections migrate without rewriting data and old CLI IDs still work
 * 协作入口 / Collaborators: `join`, `JSON.stringify`, `writeFile`, `manager.init`.
 * 检查边界 / Checked boundaries: `assert.equal(await readFile(file, 'utf8'), original)`; `assert.deepEqual(manager.view().selection, { schemaVersion: 3, plugins: ['files'], packs: ['development', 'environment', 'essentia…`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('legacy aggregate selections migrate without rewriting data and old CLI IDs still work', async () => {
  const file = join(directory, 'legacy.json');
  const original = JSON.stringify({
    schemaVersion: 1,
    plugins: ['development', 'environment', 'monitoring', 'files'],
    packs: ['essentials'],
  });
  await writeFile(file, original);
  const manager = new PluginManager(file);
  await manager.init();
  assert.equal(await readFile(file, 'utf8'), original);
  assert.deepEqual(manager.view().selection, {
    schemaVersion: 3,
    plugins: ['files'],
    packs: ['development', 'environment', 'essentials', 'monitoring'],
  });
  assert.equal(manager.view().migrations.length, 3);
  for (const id of ['commands', 'recipes', 'ide', 'metrics', 'service-health'])
    assert.ok(manager.view().planned.includes(id));
  await manager.change({ kind: 'plugin', id: 'development', enabled: false });
  assert.ok(!manager.view().planned.includes('commands'));
  assert.ok(manager.view().planned.includes('files'));
  assert.equal(JSON.parse(await readFile(file, 'utf8')).schemaVersion, 3);
  const restored = new PluginManager(file);
  await restored.init();
  assert.deepEqual(restored.view().selection, manager.view().selection);
  await restored.change({ kind: 'plugin', id: 'development', enabled: true });
  assert.ok(restored.view().selection.packs.includes('development'));
  const unknown = join(directory, 'unknown-schema.json');
  await writeFile(unknown, '{"schemaVersion":99,"plugins":[],"packs":[]}');
  await assert.rejects(new PluginManager(unknown).init());
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: manifest schemas and catalog checks reject ambiguous or unsupported contracts
 * 协作入口 / Collaborators: `PLUGINS.find`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.throws(() => pluginManifestSchema.parse({ ...files, schemaVersion: 99 }))`; `assert.throws(() => pluginManifestSchema.parse({ ...files, undocumented: true }))`.
 */
test('manifest schemas and catalog checks reject ambiguous or unsupported contracts', () => {
  const files = PLUGINS.find((item) => item.id === 'files')!;
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: patch: Partial<typeof files>。
   * 结果：返回分支计算值（`PLUGINS.map((item) => (item.id === files.id ? { ...files, ...patch } : item))`）。
   * Result: Return the branch-computed value (`PLUGINS.map((item) => (item.id === files.id ? { ...files, ...patch } : item))`).
   * 验证场景 / Scenario: manifest schemas and catalog checks reject ambiguous or unsupported contracts
   * 协作入口 / Collaborators: `PLUGINS.map`.
   */
  const change = (patch: Partial<typeof files>) =>
    PLUGINS.map((item) => (item.id === files.id ? { ...files, ...patch } : item));
  assert.throws(() => pluginManifestSchema.parse({ ...files, schemaVersion: 99 }));
  assert.throws(() => pluginManifestSchema.parse({ ...files, undocumented: true }));
  assert.throws(() => pluginManifestSchema.parse({ ...files, version: '^0.2.0' }));
  assert.throws(() => pluginPackSchema.parse({ ...PLUGIN_PACKS[0], kind: 'plugin' }));
  assert.throws(() => validateCatalog(change({ services: ['workspaces'] }), PLUGIN_PACKS), /服务归属冲突/);
  assert.throws(() => validateCatalog(change({ services: ['machines'] }), PLUGIN_PACKS), /服务归属冲突/);
  assert.throws(
    () => validateCatalog(change({ optional: [{ id: 'projects', version: '9.0.0' }] }), PLUGIN_PACKS),
    /依赖版本不匹配/,
  );
  assert.throws(
    () => validateCatalog(change({ requires: [{ id: 'missing', version: '0.2.0' }] }), PLUGIN_PACKS),
    /不存在/,
  );
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: path: string; projectScoped = false。
   * 结果：返回分支计算值（`change({ contributes: { ...files.contributes, http: [{ path, projectScoped, meth…`）。
   * Result: Return the branch-computed value (`change({ contributes: { ...files.contributes, http: [{ path, projectScoped, meth…`).
   * 验证场景 / Scenario: manifest schemas and catalog checks reject ambiguous or unsupported contracts
   * 协作入口 / Collaborators: `change`, `path.replace`.
   */
  const withHttp = (path: string, projectScoped = false) =>
    change({ contributes: { ...files.contributes,
      http: [{ path, projectScoped, methods: ['GET'] }],
      routes: [{ ...files.contributes.routes[0], path: path.replace(':vmId', '{vmId}') }],
    } });
  assert.throws(() => validateCatalog(withHttp('/api/plugins'), PLUGIN_PACKS), /核心入口/);
  for (const path of ['/api/audit', '/api/monitor', '/api/openapi', '/api/sdk', '/api/log-retention', '/api/graphql', '/api/graphql-schema', '/api/vms/:vmId/lockdown'])
    assert.throws(() => validateCatalog(withHttp(path), PLUGIN_PACKS), /核心入口/);
  assert.throws(() => validateCatalog(withHttp('/api/vms/:vmId/stop'), PLUGIN_PACKS), /核心入口/);
  assert.throws(() => validateCatalog(withHttp('/api/images'), PLUGIN_PACKS), /路由归属冲突/);
  assert.throws(
    () =>
      validateCatalog(
        change({
          optional: [],
          contributes: {
            ...files.contributes,
            http: [{ path: '/api/vms/:vmId/file', methods: ['GET'], projectScoped: true }],
          },
        }),
        PLUGIN_PACKS,
      ),
    /项目作用域/,
  );
  assert.throws(
    () =>
      validateCatalog(change({ contributes: { ...files.contributes, sockets: ['desktop'] } }), PLUGIN_PACKS),
    /WebSocket 归属冲突/,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: HTTP ownership, methods, project scoping and socket gates come from declarations
 * 协作入口 / Collaborators: `assert.equal`, `routeContribution`, `socketOwner`, `Features.create`.
 * 检查边界 / Checked boundaries: `assert.equal(routeContribution('/api/vms/vm/commands')?.owner, 'commands')`; `assert.equal(routeContribution('/api/vms/vm/commands')?.projectScoped, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('HTTP ownership, methods, project scoping and socket gates come from declarations', async () => {
  assert.equal(routeContribution('/api/vms/vm/commands')?.owner, 'commands');
  assert.equal(routeContribution('/api/vms/vm/commands')?.projectScoped, true);
  assert.equal(routeContribution('/api/vms/vm/metrics')?.projectScoped, false);
  assert.equal(routeContribution('/api/vms/batch')?.owner, 'library');
  assert.equal(routeContribution('/api/vms/vm/start'), undefined);
  assert.equal(routeContribution('/api/vms/vm/commands-other'), undefined);
  assert.equal(routeContribution('/api/vms/vm/snapshots/checkpoint/restore')?.owner, 'snapshots');
  assert.equal(socketOwner('desktop'), 'desktop');
  assert.equal(socketOwner('terminal-session'), 'terminal-workspace');
  const host = await Features.create(machines(), ['commands']);
  try {
    assert.equal(host.socketEnabled('terminal-session'), false);
    const { req, res } = request('PATCH');
    await assert.rejects(
      routeThroughGateway(host, req, res, new URL('http://localhost/api/vms/vm/commands'), async () => ({})),
      (error: any) => error.status === 405,
    );
  } finally {
    await host.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: module mismatches are rejected before activation and cannot clean up another plugin
 * 状态影响 / State effects: `loaders.images`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Features.create`, `machines`, `assert.match`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.match(host.errors.images, /入口与声明不一致/)`; `assert.equal(activated, false)`.
 */
test('module mismatches are rejected before activation and cannot clean up another plugin', async () => {
  const original = loaders.images;
  let activated = false,
    disposed = false;
  loaders.images = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ...(await original()), manifest: PLUGINS.find((item) => item.id === 'files')!…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ...(await original()), manifest: PLUGINS.find((item) => item.id === 'files')!…`) through a Promise.
   * 验证场景 / Scenario: module mismatches are rejected before activation and cannot clean up another plugin
   * 协作入口 / Collaborators: `original`, `PLUGINS.find`.
   */
  async () => ({
    ...(await original()),
    manifest: PLUGINS.find((item) => item.id === 'files')!,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: module mismatches are rejected before activation and cannot clean up another plugin
     * 状态影响 / State effects: `activated`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    activate: async () => {
      activated = true;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: module mismatches are rejected before activation and cannot clean up another plugin
     * 状态影响 / State effects: `disposed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    deactivate: async () => {
      disposed = true;
    },
  });
  try {
    const host = await Features.create(machines(), ['images', 'files']);
    assert.match(host.errors.images, /入口与声明不一致/);
    assert.equal(activated, false);
    assert.equal(disposed, false);
    assert.ok(host.files);
    await host.close();
  } finally {
    loaders.images = original;
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: service contracts reject undeclared reads and writes and await asynchronous cleanup
 * 状态影响 / State effects: `loaders.images`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Features.create`, `machines`, `assert.match`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.match( host.errors.images, violation === 'read' ? /未声明服务读取/ : violation === 'write' ? /getter|read only|不可写/ : /未注册声明的服务/, …`; `assert.equal(host.images, undefined)`.
 */
test('service contracts reject undeclared reads and writes and await asynchronous cleanup', async () => {
  const original = loaders.images;
  const events: string[] = [];
  for (const violation of ['read', 'write', 'missing'] as const) {
    loaders.images = /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ ...(await original()), activate: async (host) => { if (violation === 'missing…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ ...(await original()), activate: async (host) => { if (violation === 'missing…`) through a Promise.
     * 验证场景 / Scenario: service contracts reject undeclared reads and writes and await asynchronous cleanup
     * 协作入口 / Collaborators: `original`.
     */
    async () => ({
      ...(await original()),
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: host。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: service contracts reject undeclared reads and writes and await asynchronous cleanup
       * 状态影响 / State effects: `host.files`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `host.provide`, `Object.fromEntries`, `imagesContract.images.contract!.members.map`.
       */
      activate: async (host) => {
        if (violation === 'missing') return;
        host.provide(imagesContract.images, {
          ...Object.fromEntries(imagesContract.images.contract!.members.map((key) => [key, () => undefined])),
          jobs: { /**
           * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
           * English: Read or resolve observable fixture state for business calls or subsequent assertions.
           * 输入 / Inputs: 无 / none。
           * 结果：返回列表形式的受控数据，供调用者遍历或比较。
           * Result: Return controlled data as a list for iteration or comparison.
           * 验证场景 / Scenario: service contracts reject undeclared reads and writes and await asynchronous cleanup
           */
          list: () => [] },
          /**
           * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
           * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
           * 输入 / Inputs: 无 / none。
           * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
           * Result: No explicit result value; callers observe completion, state changes or an exception.
           * 验证场景 / Scenario: service contracts reject undeclared reads and writes and await asynchronous cleanup
           * 协作入口 / Collaborators: `events.push`.
           */
          close: async () => {
            events.push('close');
          },
        } as any);
        if (violation === 'read') void host.workspaces;
        // @ts-expect-error public service slots are immutable
        else host.files = {} as any;
      },
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: service contracts reject undeclared reads and writes and await asynchronous cleanup
       * 协作入口 / Collaborators: `Promise.resolve`, `events.push`.
       */
      deactivate: async () => {
        await Promise.resolve();
        events.push('deactivate');
      },
    });
    try {
      const host = await Features.create(machines(), ['images']);
      assert.match(
        host.errors.images,
        violation === 'read' ? /未声明服务读取/ : violation === 'write' ? /getter|read only|不可写/ : /未注册声明的服务/,
      );
      assert.equal(host.images, undefined);
      assert.equal(host.files, undefined);
      assert.equal(host.enabled.size, 0);
      await host.close();
    } finally {
      loaders.images = original;
    }
  }
  assert.deepEqual(events, ['deactivate', 'close', 'deactivate', 'close', 'deactivate']);
});
