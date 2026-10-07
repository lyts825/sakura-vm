/**
 * 模块职责：回归验证模块，围绕 `feature-lifecycle` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `feature-lifecycle`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: sync accepts manual text through the authorized body callback with its larger limit; scoped feature endpoints hand the selected project through to views and jobs.
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
import { PLUGINS } from '../shared/plugins.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { FeatureDevTaskOptions } from '../server/feature-suite-dev-task.ts';
import { vmLiveView } from '../server/vm-reference.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-feature-lifecycle-'));
process.env.SAKURA_DATA_DIR = root;
const { Features } = await import('../server/features.ts');
const { MAX_TEXT_REQUEST_BYTES } = await import('../server/http.ts');
const { projectVersion } = await import('../server/workspaces.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-feature-lifecycle-'));
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `features, machines, req, res`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `features, machines, req, res`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `Object.assign`, `Features.create`, `PLUGINS.map`.
 */
async function fixture() {
  const machines = Object.assign(new EventEmitter(), {
    records: new Map(),
    live: new Map(),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ name: 'vm' })`）。
     * Result: Return the branch-computed value (`({ name: 'vm' })`).
     */
    get: () => ({ name: 'vm' }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     */
    state: () => 'running',
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _key: string; work: () => Promise<unknown>。
     * 结果：返回分支计算值（`work()`），以 Promise 交付。
     * Result: Return the branch-computed value (`work()`) through a Promise.
     * 协作入口 / Collaborators: `work`.
     */
    locked: async (_key: string, work: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => work(),
  }) as unknown as Machines;
  const features = await Features.create(
    machines,
    PLUGINS.map((item) => item.id),
  );
  const req = Object.assign(new EventEmitter(), { method: 'POST', headers: {} }) as IncomingMessage;
  const res = Object.assign(new EventEmitter(), {
    writableFinished: false,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    writeHead: () => {},
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `this.writableFinished`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    end() {
      this.writableFinished = true;
    },
  }) as unknown as ServerResponse;
  return { features, machines, req, res };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: sync accepts manual text through the authorized body callback with its larger limit
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `routeThroughGateway`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(routeThroughGateway(features, req, res, new URL('http://localhost/api/vms/22222222-2222-4222-8222-222222222222/sync…`; `assert.equal(limit, MAX_TEXT_REQUEST_BYTES)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('sync accepts manual text through the authorized body callback with its larger limit', async () => {
  const { features, req, res } = await fixture();
  let limit: number | undefined;
  let signal: AbortSignal | undefined;
  try {
    await assert.rejects(routeThroughGateway(features,
      req, res,
      new URL('http://localhost/api/vms/22222222-2222-4222-8222-222222222222/sync'),
      async (_request, requestSignal, requestLimit) => {
        signal = requestSignal;
        limit = requestLimit;
        return { direction: 'both' };
      },
    ), /请先保存同步目录/);
    assert.equal(limit, MAX_TEXT_REQUEST_BYTES);
    assert.ok(signal instanceof AbortSignal);
  } finally {
    await features.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: scoped feature endpoints hand the selected project through to views and jobs
 * 状态影响 / State effects: `machines.exec`, `request.method`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `join`, `mkdir`, `writeFile`, `JSON.stringify`.
 * 检查边界 / Checked boundaries: `assert.equal( await routeThroughGateway(features, request, viewResponse, new URL(`http://localhost/api/vms/${id}/advanced?project=…`; `assert.equal(viewResponse.status, 200)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('scoped feature endpoints hand the selected project through to views and jobs', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const projectId = '0123456789abcdef';
  const directory = join(root, 'machines', id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'projects.json'),
    JSON.stringify({
      active: 'default',
      projects: [
        { id: 'default', name: '默认项目' },
        { id: projectId, name: 'Selected project' },
      ],
    }),
  );
  await writeFile(
    join(directory, `project-${projectId}.json`),
    JSON.stringify({ directory: '/workspace/selected', template: 'none' }),
  );
  const { features, machines } = await fixture();
  const executedProjects: { projectId: string; directory: string }[] = [];
  let releases = 0;
  machines.live.set(id, {} as any);
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
   * 验证场景 / Scenario: scoped feature endpoints hand the selected project through to views and jobs
   */
  async () => {
    return { stdout: '', stderr: '', code: 0 };
  };
  const devTaskOptions: FeatureDevTaskOptions = {
    terminals: {
      /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: vmId; scope; session; readOnly; signal; _terminal; mode。
       * 结果：返回受控对象，公开字段包括 `command, projectId, networkIsolation, signal, terminalId, captured, release`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `command, projectId, networkIsolation, signal, terminalId, captured, release`; the actual branch determines its shape.
       * 验证场景 / Scenario: scoped feature endpoints hand the selected project through to views and jobs
       * 协作入口 / Collaborators: `assert.equal`, `assert.deepEqual`, `features.workspaces.config`, `projectVersion`.
       * 检查边界 / Checked boundaries: `assert.equal(vmId, id)`; `assert.equal(scope, projectId)`.
       */
      prepare: async (vmId, scope, session, readOnly, signal, _terminal, mode) => {
        assert.equal(vmId, id);
        assert.equal(scope, projectId);
        assert.equal(session, null);
        assert.equal(readOnly, false);
        assert.deepEqual(mode, { mode: 'task' });
        const project = await features.workspaces.config(id);
        return { command: 'unused', projectId: scope, networkIsolation: project.networkIsolation || 'host',
          signal: signal!, terminalId: undefined,
          captured: { project, configVersion: projectVersion(project), live: vmLiveView(machines.live.get(id)!) },
          /**
           * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
           * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
           * 输入 / Inputs: 无 / none。
           * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
           * Result: No explicit result value; callers observe completion, state changes or an exception.
           * 验证场景 / Scenario: scoped feature endpoints hand the selected project through to views and jobs
           */
          release: () => { ++releases; } };
      },
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _machines; vmId; project; execution; signal。
     * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
     * 验证场景 / Scenario: scoped feature endpoints hand the selected project through to views and jobs
     * 协作入口 / Collaborators: `assert.equal`, `features.workspaces.projects.current`, `assert.match`, `executedProjects.push`.
     * 检查边界 / Checked boundaries: `assert.equal(vmId, id)`; `assert.equal(features.workspaces.projects.current(id), projectId)`.
     */
    runTask: async (_machines, vmId, project, execution, signal) => {
      assert.equal(vmId, id);
      assert.equal(features.workspaces.projects.current(id), projectId);
      assert.equal(signal.aborted, false);
      assert.match(execution.command, /npm test/);
      executedProjects.push({ projectId: project._workspace!, directory: project.directory });
      return { stdout: '', stderr: '', code: 0 };
    },
  };
  Reflect.set(features.serviceValue<import('../server/feature-suite.ts').FeatureSuite>('suite')!, 'devTaskOptions', devTaskOptions);
  const request = Object.assign(new EventEmitter(), { method: 'GET', headers: {} }) as IncomingMessage;
  /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`Object.assign(new EventEmitter(), { writableFinished: false, status: 0, payload:…`）。
   * Result: Return the branch-computed value (`Object.assign(new EventEmitter(), { writableFinished: false, status: 0, payload:…`).
   * 验证场景 / Scenario: scoped feature endpoints hand the selected project through to views and jobs
   * 协作入口 / Collaborators: `Object.assign`.
   */
  const response = () =>
    Object.assign(new EventEmitter(), {
      writableFinished: false,
      status: 0,
      payload: undefined as unknown,
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: status: number。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: scoped feature endpoints hand the selected project through to views and jobs
       * 状态影响 / State effects: `this.status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       */
      writeHead(status: number) {
        this.status = status;
      },
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: value: string。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: scoped feature endpoints hand the selected project through to views and jobs
       * 状态影响 / State effects: `this.payload`, `this.writableFinished`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `JSON.parse`.
       */
      end(value: string) {
        this.payload = JSON.parse(value);
        this.writableFinished = true;
      },
    }) as unknown as ServerResponse & {
      status: number;
      payload: { projectId: string; key?: string; status?: string };
    };
  const viewResponse = response();
  try {
    assert.equal(
      await routeThroughGateway(features,
        request,
        viewResponse,
        new URL(`http://localhost/api/vms/${id}/advanced?project=${projectId}`),
        async () => undefined,
      ),
      true,
    );
    assert.equal(viewResponse.status, 200);
    assert.equal(viewResponse.payload.projectId, projectId);

    request.method = 'POST';
    const jobResponse = response();
    assert.equal(
      await routeThroughGateway(features,
        request,
        jobResponse,
        new URL(`http://localhost/api/vms/${id}/advanced?project=${projectId}`),
        async () => ({ action: 'dev', operation: 'test' }),
      ),
      true,
    );
    assert.equal(jobResponse.status, 202);
    assert.equal(jobResponse.payload.projectId, projectId);
    assert.equal(jobResponse.payload.key, `${id}:${projectId}:dev`);
    await features.suite.jobs.wait(jobResponse.payload.key);
    assert.equal(features.suite.jobs.view(jobResponse.payload.key)?.status, 'done', features.suite.jobs.view(jobResponse.payload.key)?.error);
    assert.deepEqual(executedProjects, [{ projectId, directory: '/workspace/selected' }]);
    assert.equal(releases, 1);
  } finally {
    await features.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: disconnect cancels an active import and permits a new import after cleanup
 * 状态影响 / State effects: `features.serviceValue<import('../server/bundles.ts').Bundles>('bundles…`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `features.serviceValue`, `routeThroughGateway`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, { name: 'AbortError' })`; `assert.equal(signal?.aborted, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('disconnect cancels an active import and permits a new import after cleanup', async () => {
  const { features, req, res } = await fixture();
  let signal: AbortSignal | undefined;
  let started!: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  features.serviceValue<import('../server/bundles.ts').Bundles>('bundles')!.importExternal = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: _name; _source; currentSignal。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: disconnect cancels an active import and permits a new import after cleanup
   * 状态影响 / State effects: `signal`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 失败 / Failure: `new Error('Expected cancellation')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `started`, `currentSignal?.throwIfAborted`.
   */
  async (_name, _source, currentSignal) => {
    signal = currentSignal;
    started();
    await new Promise<void>((resolve) => {
      currentSignal?.addEventListener('abort', () => resolve(), { once: true });
    });
    currentSignal?.throwIfAborted();
    throw new Error('Expected cancellation');
  };
  const pending = routeThroughGateway(features,
    req,
    res,
    new URL('http://localhost/api/import?name=example'),
    async () => ({}),
  );
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await began;
  res.emit('close');
  assert.equal(signal?.aborted, true);
  await rejected;
  assert.equal(res.listenerCount('close'), 0);
  features.serviceValue<import('../server/bundles.ts').Bundles>('bundles')!.importExternal = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id: 'new-vm', name: 'retry', memoryMiB: 512, cpus: 1, diskGiB: 8, accelerator…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ id: 'new-vm', name: 'retry', memoryMiB: 512, cpus: 1, diskGiB: 8, accelerator…`) through a Promise.
   * 验证场景 / Scenario: disconnect cancels an active import and permits a new import after cleanup
   * 协作入口 / Collaborators: `new Date(0).toISOString`.
   */
  async () => ({
    id: 'new-vm', name: 'retry', memoryMiB: 512, cpus: 1, diskGiB: 8,
    accelerator: 'tcg', forwards: [], createdAt: new Date(0).toISOString(), snapshots: [],
    status: 'stopped', poweredOn: false, diskBytes: 0,
  });
  assert.equal(
    await routeThroughGateway(features, req, res, new URL('http://localhost/api/import?name=retry'), async () => ({})),
    true,
  );
  await features.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: shutdown waits for request cleanup and rejects new feature operations
 * 状态影响 / State effects: `features.serviceValue<import('../server/bundles.ts').Bundles>('bundles…`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `features.serviceValue`, `routeThroughGateway`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, { name: 'AbortError' })`; `assert.equal(signal?.aborted, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('shutdown waits for request cleanup and rejects new feature operations', async () => {
  const { features, req, res } = await fixture();
  let release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  let started!: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  let signal: AbortSignal | undefined;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  features.serviceValue<import('../server/bundles.ts').Bundles>('bundles')!.clone = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: _id; _name; _snapshot; currentSignal。
   * 结果：返回分支计算值（`{} as any`），以 Promise 交付。
   * Result: Return the branch-computed value (`{} as any`) through a Promise.
   * 验证场景 / Scenario: shutdown waits for request cleanup and rejects new feature operations
   * 状态影响 / State effects: `signal`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `started`, `currentSignal?.throwIfAborted`.
   */
  async (_id, _name, _snapshot, currentSignal) => {
    signal = currentSignal;
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    currentSignal?.throwIfAborted();
    return {} as any;
  };
  const pending = routeThroughGateway(features, req, res, new URL('http://localhost/api/vms/vm/clone'), async () => ({
    name: 'copy',
  }));
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await began;
  let finished = false;
  const closing = features.close().then(() => {
    finished = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signal?.aborted, true);
  assert.equal(finished, false);
  const readRequest = Object.assign(new EventEmitter(), { method: 'GET', headers: {} }) as IncomingMessage;
  await assert.rejects(
    routeThroughGateway(features, readRequest, res, new URL('http://localhost/api/images'), async () => ({})),
    { status: 403 },
  );
  release();
  await rejected;
  await closing;
  assert.equal(finished, true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: shutdown also waits for in-flight read operations before releasing the runtime
 * 状态影响 / State effects: `req.method`, `features.serviceValue<import('../server/workspaces.ts').Workspaces>('w…`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `features.serviceValue`, `routeThroughGateway`, `features.close().then`.
 * 检查边界 / Checked boundaries: `assert.equal(finished, false)`; `assert.equal(res.listenerCount('close'), 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('shutdown also waits for in-flight read operations before releasing the runtime', async () => {
  const { features, req, res } = await fixture();
  req.method = 'GET';
  let started!: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  let release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  features.serviceValue<import('../server/workspaces.ts').Workspaces>('workspaces')!.runtime = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `status, log`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `status, log`; the actual branch determines its shape.
   * 验证场景 / Scenario: shutdown also waits for in-flight read operations before releasing the runtime
   * 协作入口 / Collaborators: `started`.
   */
  async () => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { status: 'running', log: '' };
  };
  const pending = routeThroughGateway(features,
    req,
    res,
    new URL('http://localhost/api/vms/vm/project-runtime'),
    async () => ({}),
  );
  await began;
  let finished = false;
  const closing = features.close().then(() => {
    finished = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  release();
  await pending;
  await closing;
  assert.equal(res.listenerCount('close'), 0);
});
