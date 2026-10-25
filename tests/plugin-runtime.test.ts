/**
 * 模块职责：回归验证模块，围绕 `plugin-runtime` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `plugin-runtime`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: plugin activation timeout aborts registration and cleanup is bounded; declared operations validate responses before writing to the client.
 */
import { services as sandboxesContract } from '../plugins/sandbox/services.ts';
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
 * 状态影响 / State effects: `fixture`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
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
  return await fixture.gateway.dispatch(req, res, url) as boolean;
}
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import test from 'node:test';
import { z } from 'zod';
import { Features } from '../server/features.ts';
import { readJsonBody } from '../server/http.ts';
import type { Machines } from '../server/machines.ts';
import { PluginScope, withinDeadline } from '../server/plugin-scope.ts';
import { loaders } from '../server/plugins/registry.ts';
import { migratePlugins } from '../shared/plugin-selection.ts';
import { featureReadiness } from '../src/feature-readiness.ts';
import { parseMetrics } from '../server/metrics.ts';
import { pluginRouteResponses } from '../shared/contracts/plugin-route-responses.ts';
import type { PluginOperation } from '../server/plugin-api.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { OperationResults } from '../server/operation-results.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: plugin activation timeout aborts registration and cleanup is bounded
 * 协作入口 / Collaborators: `scope.add`, `assert.rejects`, `withinDeadline`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects( withinDeadline(new Promise<void>(() => {}), 20, 'test', () => scope.abort()), /超过/, )`; `assert.equal(scope.signal.aborted, true)`.
 */
test('plugin activation timeout aborts registration and cleanup is bounded', async () => {
  const scope = new PluginScope();
  const order: string[] = [];
  scope.add(() => {
    order.push('first');
  });
  scope.add(() => {
    order.push('second');
  });
  await assert.rejects(
    withinDeadline(new Promise<void>(() => {}), 20, 'test', () => scope.abort()),
    /超过/,
  );
  assert.equal(scope.signal.aborted, true);
  assert.throws(() => scope.add(() => {}));
  await scope.dispose((dispose) => Promise.resolve(dispose()));
  assert.deepEqual(order, ['second', 'first']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: declared operations validate responses before writing to the client
 * 状态影响 / State effects: `loaders.metrics`, `failure`, `operation.response`, `operation.execute`, `valid`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `parseMetrics`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(host.errors, {})`; `assert.equal((failure as any).code, 'INVALID_PLUGIN_RESPONSE')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('declared operations validate responses before writing to the client', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-plugin-receipt-'));
  const original = loaders.metrics;
  const sample = parseMetrics('CPU\ncpu 10 0 10 100 0 0 0 0\ncpu 30 0 20 150 20 0 0 0\nMEMORY\nMemTotal: 1024 kB\nMemAvailable: 512 kB\nDISK\n/dev/vda1 1000 400 600 40% /\nNETWORK\n eth0: 10 0 0 0 0 0 0 0 20 0 0 0 0 0 0 0\nPROCESSES\n123 python3\nUPTIME\n120.5 10.0\n');
  let valid = false;
  let operation!: PluginOperation;
  const written: unknown[] = [];
  loaders.metrics = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `activate, operations`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `activate, operations`; the actual branch determines its shape.
   * 验证场景 / Scenario: declared operations validate responses before writing to the client
   * 状态影响 / State effects: `operation`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `original`, `assert.equal`.
   * 检查边界 / Checked boundaries: `assert.equal(operation.response, pluginRouteResponses['metrics.sample'].schema)`.
   */
  async () => {
    const module = await original();
    operation = {
      response: module.operations!.sample.response,
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`valid ? sample : { ...sample, cpuPercent: 'broken' }`）。
       * Result: Return the branch-computed value (`valid ? sample : { ...sample, cpuPercent: 'broken' }`).
       * 验证场景 / Scenario: declared operations validate responses before writing to the client
       */
      execute: () => valid ? sample : { ...sample, cpuPercent: 'broken' },
    };
    assert.equal(operation.response, pluginRouteResponses['metrics.sample'].schema);
    return {
      ...module,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: host。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: declared operations validate responses before writing to the client
       * 协作入口 / Collaborators: `host.provide`.
       */
      activate: module.activate,
      operations: {
        sample: operation,
      },
    };
  };
  const machines = Object.assign(new EventEmitter(), {
    records: new Map(),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({})`）。
     * Result: Return the branch-computed value (`({})`).
     * 验证场景 / Scenario: declared operations validate responses before writing to the client
     */
    get: () => ({}),
  }) as unknown as Machines;
  try {
    const host = await Features.create(machines, ['metrics']);
    assert.deepEqual(host.errors, {});
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`res`），以 Promise 交付。
     * Result: Return the branch-computed value (`res`) through a Promise.
     * 验证场景 / Scenario: declared operations validate responses before writing to the client
     * 协作入口 / Collaborators: `Object.assign`, `routeThroughGateway`.
     */
    const invoke = async () => {
      const req = Object.assign(new EventEmitter(), { method: 'GET', headers: {} }) as IncomingMessage;
      const res = Object.assign(new EventEmitter(), {
        writableFinished: false,
        status: 0,
        payload: '',
        /**
         * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
         * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
         * 输入 / Inputs: status: number。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 验证场景 / Scenario: declared operations validate responses before writing to the client
         * 状态影响 / State effects: `this.status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
         * 协作入口 / Collaborators: `written.push`.
         */
        writeHead(status: number) {
          written.push(status);
          this.status = status;
        },
        /**
         * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
         * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
         * 输入 / Inputs: data: string。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 验证场景 / Scenario: declared operations validate responses before writing to the client
         * 状态影响 / State effects: `this.payload`, `this.writableFinished`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
         * 协作入口 / Collaborators: `written.push`.
         */
        end(data: string) {
          written.push(data);
          this.payload = data;
          this.writableFinished = true;
        },
      }) as ServerResponse & { status: number; payload: string };
      await routeThroughGateway(host, req, res, new URL('http://127.0.0.1/api/vms/example/metrics'), async () => undefined);
      return res;
    };
    try {
      const results = new OperationResults(directory), receipt = await results.start(randomUUID(), 'metrics.sample', 'local-owner');
      let failure: unknown;
      try { await results.run(receipt, async () => { await results.begin(receipt); await invoke(); }); }
      catch (error) { failure = error; }
      assert.equal((failure as any).code, 'INVALID_PLUGIN_RESPONSE');
      await results.finish(receipt, failure, false);
      assert.equal((await new OperationResults(directory).get(receipt.correlationId, 'local-owner')).outcome, 'succeeded');
      assert.deepEqual(written, []);
      // A handler's local validator cannot replace the independently published response contract.
      operation.response = z.object({ sample: z.number() }).strict();
      operation.execute = /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`({ sample: 1 })`）。
       * Result: Return the branch-computed value (`({ sample: 1 })`).
       * 验证场景 / Scenario: declared operations validate responses before writing to the client
       */
      () => ({ sample: 1 });
      await assert.rejects(invoke(), (error: any) => error.code === 'INVALID_OPERATION_RESPONSE');
      assert.deepEqual(written, []);
      operation.response = pluginRouteResponses['metrics.sample'].schema;
      operation.execute = /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`valid ? sample : { ...sample, cpuPercent: 'broken' }`）。
       * Result: Return the branch-computed value (`valid ? sample : { ...sample, cpuPercent: 'broken' }`).
       * 验证场景 / Scenario: declared operations validate responses before writing to the client
       */
      () => valid ? sample : { ...sample, cpuPercent: 'broken' };
      valid = true;
      const res = await invoke();
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(res.payload), sample);
    } finally {
      await host.close();
    }
  } finally {
    loaders.metrics = original;
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: older automation selection preserves its scheduled worker and readiness distinguishes records
 * 协作入口 / Collaborators: `migratePlugins`, `assert.deepEqual`, `assert.equal`, `featureReadiness`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(migrated.selection.plugins, ['automation', 'automation-scheduler'])`; `assert.equal(featureReadiness(undefined, 'x').label, '待检查')`.
 */
test('older automation selection preserves its scheduled worker and readiness distinguishes records', () => {
  const migrated = migratePlugins({ schemaVersion: 2, plugins: ['automation'], packs: [] });
  assert.deepEqual(migrated.selection.plugins, ['automation', 'automation-scheduler']);
  assert.equal(featureReadiness(undefined, 'x').label, '待检查');
  assert.equal(featureReadiness([{ featureId: 'x', ready: false, executed: true }], 'x').label, '仅本地记录');
  assert.equal(featureReadiness([{ featureId: 'x', ready: false, executed: false }], 'x').label, '不可用');
  assert.equal(featureReadiness([{ featureId: 'x', ready: true, executed: true }], 'x').label, '可用');
  assert.equal(
    featureReadiness([{ featureId: 'x', ready: false, executed: true, result: { code: 7 } }], 'x').label,
    '执行失败',
  );
  assert.equal(
    featureReadiness([{ featureId: 'x', ready: true, executed: false }], 'x').label,
    '前置条件通过',
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: bodyless declared DELETE works without a JSON header while write schemas remain enforced
 * 状态影响 / State effects: `loaders.sandbox`, `host`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Object.assign`, `createServer`, `Features.create`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(host.errors, {})`; `assert.equal(deleted.status, 200)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('bodyless declared DELETE works without a JSON header while write schemas remain enforced', async () => {
  const original = loaders.sandbox;
  let destroyed = 0;
  loaders.sandbox = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `activate, operations`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `activate, operations`; the actual branch determines its shape.
   * 验证场景 / Scenario: bodyless declared DELETE works without a JSON header while write schemas remain enforced
   * 协作入口 / Collaborators: `original`, `z.object`, `z.literal`.
   */
  async () => {
    const module = await original();
    return {
      ...module,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: host。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: bodyless declared DELETE works without a JSON header while write schemas remain enforced
       * 协作入口 / Collaborators: `host.provide`, `Object.fromEntries`, `sandboxesContract.sandboxes.contract!.members.map`.
       */
      activate: async (host) => {
        host.provide(sandboxesContract.sandboxes, {
          ...Object.fromEntries(sandboxesContract.sandboxes.contract!.members.map((key) => [key, () => undefined])),
          jobs: { /**
           * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
           * English: Read or resolve observable fixture state for business calls or subsequent assertions.
           * 输入 / Inputs: 无 / none。
           * 结果：返回列表形式的受控数据，供调用者遍历或比较。
           * Result: Return controlled data as a list for iteration or comparison.
           * 验证场景 / Scenario: bodyless declared DELETE works without a JSON header while write schemas remain enforced
           */
          list: () => [], /**
           * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
           * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
           * 输入 / Inputs: 无 / none。
           * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
           * Result: No explicit result value; callers observe completion, state changes or an exception.
           * 验证场景 / Scenario: bodyless declared DELETE works without a JSON header while write schemas remain enforced
           */
          close: async () => {} },
          /**
           * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
           * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
           * 输入 / Inputs: 无 / none。
           * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
           * Result: No explicit result value; callers observe completion, state changes or an exception.
           * 验证场景 / Scenario: bodyless declared DELETE works without a JSON header while write schemas remain enforced
           */
          close: async () => {},
        } as any);
      },
      operations: {
        ...module.operations,
        destroy: {
          response: z.object({ ok: z.literal(true) }),
          /**
           * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
           * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
           * 输入 / Inputs: _url; input。
           * 结果：返回受控对象，公开字段包括 `ok`；各分支以实际返回对象为准。
           * Result: Return a controlled object exposing fields such as `ok`; the actual branch determines its shape.
           * 验证场景 / Scenario: bodyless declared DELETE works without a JSON header while write schemas remain enforced
           * 协作入口 / Collaborators: `assert.equal`.
           * 检查边界 / Checked boundaries: `assert.equal(input, undefined)`.
           */
          execute(_url, input) {
            assert.equal(input, undefined);
            destroyed++;
            return { ok: true };
          },
        },
      },
    };
  };
  const machines = Object.assign(new EventEmitter(), { records: new Map() }) as unknown as Machines;
  let host: Features | undefined;
  const server = createServer((req, res) => {
    void routeThroughGateway(host!, req, res, new URL(req.url!, 'http://127.0.0.1'), (request, signal) =>
        readJsonBody(request, undefined, signal),
      )
      .catch((error) => {
        res.writeHead(error.status || 400);
        res.end();
      });
  });
  try {
    host = await Features.create(machines, ['sandbox']);
    assert.deepEqual(host.errors, {});
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const deleted = await fetch(origin + '/api/vms/example/sandbox', { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { ok: true });
    assert.equal(destroyed, 1);
    assert.equal((await fetch(origin + '/api/sandboxes', { method: 'POST' })).status, 415);
    assert.equal(
      (
        await fetch(origin + '/api/sandboxes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"name":0}',
        })
      ).status,
      400,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await host?.close();
    loaders.sandbox = original;
  }
});
