/**
 * 模块职责：回归验证模块，围绕 `feature-suite` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `feature-suite`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: feature suite exposes the complete six-category roadmap; resource presets stay within the VM configuration limits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  featureCatalogView,
  implementedFeatureCatalogView,
  resourcePresets,
  FeatureSuite,
} from '../server/feature-suite.ts';
import { projectSchema, projectVersion } from '../server/workspaces.ts';
import { projectIdentityPayload } from '../server/project-identity.ts';
import { Jobs } from '../server/jobs.ts';
import type { Machines } from '../server/machines.ts';
import type { Workspaces, Project } from '../server/workspaces.ts';
import type { ProjectTerminals } from '../server/project-terminals.ts';
import { AppError, setVmStorageRoot } from '../server/model.ts';
import { scopeIdentityFixture } from './project-scope-identity-fixture.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: feature suite exposes the complete six-category roadmap
 * 协作入口 / Collaborators: `featureCatalogView`, `assert.equal`, `features.map`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.equal(features.length, 50)`; `assert.equal(new Set(features.map((feature) => feature.id)).size, 50)`.
 */
test('feature suite exposes the complete six-category roadmap', () => {
  const features = featureCatalogView();
  assert.equal(features.length, 50);
  assert.equal(new Set(features.map((feature) => feature.id)).size, 50);
  assert.equal(new Set(features.map((feature) => feature.category)).size, 6);
  assert.ok(features.every((feature) => ['P0', 'P1', 'P2'].includes(feature.priority)));
  assert.ok(features.some((feature) => feature.id === 'metrics-history' && feature.state === 'available'));
  assert.ok(features.some((feature) => feature.id === 'dynamic-memory' && feature.state === 'available'));
  assert.ok(features.some((feature) => feature.id === 'test-explorer' && feature.state === 'available'));
  assert.ok(features.some((feature) => feature.id === 'gpu-acceleration' && feature.state === 'available'));
  assert.deepEqual(implementedFeatureCatalogView(), features);
  assert.ok(features.some((feature) => feature.id === 'single-app-windows' &&
    feature.implemented && feature.state === 'available'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: resource presets stay within the VM configuration limits
 * 协作入口 / Collaborators: `assert.deepEqual`, `Object.keys`, `assert.ok`, `Object.values(resourcePresets).every`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(Object.keys(resourcePresets), ['light', 'development', 'build', 'desktop'])`; `assert.ok( Object.values(resourcePresets).every((preset) => preset.memoryMiB >= 256 && preset.memoryMiB <= 8192), )`.
 */
test('resource presets stay within the VM configuration limits', () => {
  assert.deepEqual(Object.keys(resourcePresets), ['light', 'development', 'build', 'desktop']);
  assert.ok(
    Object.values(resourcePresets).every((preset) => preset.memoryMiB >= 256 && preset.memoryMiB <= 8192),
  );
  assert.ok(Object.values(resourcePresets).every((preset) => preset.cpus >= 1 && preset.cpus <= 8));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private finite developer tasks use captured UID contracts and reject shared-network containers
 * 状态影响 / State effects: `suite.jobs`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `projectSchema.parse`, `suite.dev`, `suite.jobs.wait`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(suite.jobs.view('vm:dev')?.status, 'done')`; `assert.match(uidCommands[0], /find \. -type d/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('private finite developer tasks use captured UID contracts and reject shared-network containers', async () => {
  const commands: string[] = [];
  const project = projectSchema.parse({ directory: '/workspace/app', networkIsolation: 'private', environment: {} });
  const live = { startedAt: 'fixture' }, uidCommands: string[] = [];
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ distro: 'alpine' })`）。
     * Result: Return the branch-computed value (`({ distro: 'alpine' })`).
     * 验证场景 / Scenario: private finite developer tasks use captured UID contracts and reject shared-network containers
     */
    get: () => ({ distro: 'alpine' }),
    live: new Map([['vm', live]]), /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: private finite developer tasks use captured UID contracts and reject shared-network containers
     */
    state: () => 'running',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: private finite developer tasks use captured UID contracts and reject shared-network containers
     * 协作入口 / Collaborators: `commands.push`.
     */
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stdout: '', stderr: '' };
    },
  } as unknown as Machines;
  const workspaces = { projects: { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'vm'`）。
   * Result: Return the branch-computed value (`'vm'`).
   * 验证场景 / Scenario: private finite developer tasks use captured UID contracts and reject shared-network containers
   */
  key: () => 'vm', /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'default'`）。
   * Result: Return the branch-computed value (`'default'`).
   * 验证场景 / Scenario: private finite developer tasks use captured UID contracts and reject shared-network containers
   */
  current: () => 'default',
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; _scope: string; action: () => unknown。
     * 结果：返回分支计算值（`action()`）。
     * Result: Return the branch-computed value (`action()`).
     * 验证场景 / Scenario: private finite developer tasks use captured UID contracts and reject shared-network containers
     * 协作入口 / Collaborators: `action`.
     */
    inScope: (_id: string, _scope: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => unknown) => action() },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`project`），以 Promise 交付。
     * Result: Return the branch-computed value (`project`) through a Promise.
     * 验证场景 / Scenario: private finite developer tasks use captured UID contracts and reject shared-network containers
     */
    config: async () => project, /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`project`），以 Promise 交付。
     * Result: Return the branch-computed value (`project`) through a Promise.
     * 验证场景 / Scenario: private finite developer tasks use captured UID contracts and reject shared-network containers
     */
    resolveProject: async () => project,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`project`），以 Promise 交付。
     * Result: Return the branch-computed value (`project`) through a Promise.
     * 验证场景 / Scenario: private finite developer tasks use captured UID contracts and reject shared-network containers
     */
    resolvedConfig: async () => project } as unknown as Workspaces;
  const suite = new FeatureSuite(machines, workspaces, {}, {
    cacheTransfers: { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ stageId: '11111111-1111-4111-8111-111111111111', directory: '/run/sakura-proj…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ stageId: '11111111-1111-4111-8111-111111111111', directory: '/run/sakura-proj…`) through a Promise.
     * 验证场景 / Scenario: private finite developer tasks use captured UID contracts and reject shared-network containers
     * 协作入口 / Collaborators: `'a'.repeat`.
     */
    allocate: async () => ({ stageId: '11111111-1111-4111-8111-111111111111',
      directory: '/run/sakura-project-cache-transfers/11111111-1111-4111-8111-111111111111/data',
      resource: { descriptor: { stageId: '11111111-1111-4111-8111-111111111111', manager: 'npm', build: 'a'.repeat(64) },
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 验证场景 / Scenario: private finite developer tasks use captured UID contracts and reject shared-network containers
         */
        prepare: async () => {}, /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 验证场景 / Scenario: private finite developer tasks use captured UID contracts and reject shared-network containers
         */
        retire: async () => {} } }) },
    terminals: { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id; scope; _session; _readOnly; signal。
     * 结果：返回分支计算值（`({ command: 'unused', projectId: scope!, networkIsolation: 'private', terminalId…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ command: 'unused', projectId: scope!, networkIsolation: 'private', terminalId…`) through a Promise.
     * 验证场景 / Scenario: private finite developer tasks use captured UID contracts and reject shared-network containers
     * 协作入口 / Collaborators: `projectVersion`.
     */
    prepare: async (_id, scope, _session, _readOnly, signal) => ({
      command: 'unused', projectId: scope!, networkIsolation: 'private', terminalId: undefined, signal: signal!,
      captured: { project, configVersion: projectVersion(project), live: live as any }, /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: private finite developer tasks use captured UID contracts and reject shared-network containers
       */
      release: () => {},
    }) }, /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _machines; _id; captured; execution; _signal; _log; _timeout; _agent; _cleanup; pins。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: private finite developer tasks use captured UID contracts and reject shared-network containers
     * 协作入口 / Collaborators: `assert.equal`, `projectIdentityPayload`, `uidCommands.push`.
     * 检查边界 / Checked boundaries: `assert.equal(captured.networkIsolation, 'private')`; `assert.equal(pins?.expectedLive, live)`.
     */
    runTask: async (_machines, _id, captured, execution, _signal, _log, _timeout, _agent, _cleanup, pins) => {
      assert.equal(captured.networkIsolation, 'private'); assert.equal(pins?.expectedLive, live);
      projectIdentityPayload(execution); uidCommands.push(execution.command);
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  suite.jobs = new Jobs();
  try {
    suite.dev('vm', { operation: 'test-discover' });
    await suite.jobs.wait('vm:dev');
    assert.equal(suite.jobs.view('vm:dev')?.status, 'done');
    assert.match(uidCommands[0], /find \. -type d/);
    assert.equal(commands.length, 0);
    suite.dev('vm', { operation: 'install-cached-dependencies', manager: 'npm' });
    await suite.jobs.wait('vm:dev');
    assert.equal(suite.jobs.view('vm:dev')?.status, 'done');
    assert.match(uidCommands[1], /npm ci --offline --ignore-scripts/);
    assert.equal(commands.length, 0);
    suite.dev('vm', { operation: 'install-locked' });
    await suite.jobs.wait('vm:dev');
    assert.equal(suite.jobs.view('vm:dev')?.status, 'done');
    assert.match(uidCommands[2], /npm ci/);
    suite.dev('vm', { operation: 'database', database: 'redis',
      password: 'very-long-password' });
    await suite.jobs.wait('vm:dev');
    assert.equal(suite.jobs.view('vm:dev')?.status, 'error');
    assert.match(suite.jobs.view('vm:dev')?.error || '', /私有数据库需要启用容器插件/);
    assert.equal(commands.length, 0);
    assert.equal(uidCommands.length, 3);
  } finally { await suite.close(); }
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `suite, machines, workspaces, project, id, projectId, live, native, state`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `suite, machines, workspaces, project, id, projectId, live, native, state`; the actual branch determines its shape.
 * 状态影响 / State effects: `machines.execInput`, `machines.locked`, `suite.jobs`, `suite.jobs.start`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `randomUUID`.
 */
async function dispatchFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sakura-feature-dispatch-')), id = randomUUID(), bootId = randomUUID();
  const projectId = '0123456789abcdef', otherId = 'fedcba9876543210', live = { status: 'running' };
  let selected = projectId, override: string | undefined, held = false, releases = 0;
  const context = new AsyncLocalStorage<string>(), commands: string[] = [], events: string[] = [], failures: any[] = [];
  const project = Object.defineProperty(projectSchema.parse({ directory: '/srv/named-project', template: 'none',
    networkIsolation: 'private', environment: { PATH: '/project/hook/bin', MODE: 'named' }, secrets: { TOKEN: 'project-private-token' } }),
    '_workspace', { value: projectId, enumerable: false }) as Project;
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`override || context.getStore() || selected`）。
   * Result: Return the branch-computed value (`override || context.getStore() || selected`).
   * 协作入口 / Collaborators: `context.getStore`.
   */
  const current = () => override || context.getStore() || selected;
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`Object.defineProperty(structuredClone(project), '_workspace', { value: current()…`）。
   * Result: Return the branch-computed value (`Object.defineProperty(structuredClone(project), '_workspace', { value: current()…`).
   * 协作入口 / Collaborators: `Object.defineProperty`, `structuredClone`, `current`.
   */
  const clone = () => Object.defineProperty(structuredClone(project), '_workspace', { value: current(), enumerable: false });
  const machines = { live: new Map([[id, live]]), /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'running'`）。
   * Result: Return the branch-computed value (`'running'`).
   */
  state: () => 'running', /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ distro: 'alpine', forwards: [] })`）。
   * Result: Return the branch-computed value (`({ distro: 'alpine', forwards: [] })`).
   */
  get: () => ({ distro: 'alpine', forwards: [] }),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    requireUnlocked: () => {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _key: string; action: () => unknown。
     * 结果：返回分支计算值（`action()`），以 Promise 交付。
     * Result: Return the branch-computed value (`action()`) through a Promise.
     * 协作入口 / Collaborators: `action`.
     */
    locked: async (_key: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => unknown) => action(),
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`assert.fail('No root helper publication')`），以 Promise 交付。
     * Result: Return the branch-computed value (`assert.fail('No root helper publication')`) through a Promise.
     * 协作入口 / Collaborators: `assert.fail`.
     * 检查边界 / Checked boundaries: `assert.fail('No root helper publication')`.
     */
    writeGuestFile: async () => assert.fail('No root helper publication'),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `commands.push`.
     */
    exec: async (_id: string, command: string) => { commands.push(command); return { code: 0, stdout: '', stderr: '' }; },
  } as unknown as Machines;
  const workspaces = { projects: { current, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`id + ':' + current()`）。
   * Result: Return the branch-computed value (`id + ':' + current()`).
   * 协作入口 / Collaborators: `current`.
   */
  key: () => id + ':' + current(),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; scope: string; action: () => unknown。
     * 结果：返回分支计算值（`context.run(scope, action)`）。
     * Result: Return the branch-computed value (`context.run(scope, action)`).
     * 协作入口 / Collaborators: `context.run`.
     */
    inScope: (_id: string, scope: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => unknown) => context.run(scope, action) },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`clone()`），以 Promise 交付。
     * Result: Return the branch-computed value (`clone()`) through a Promise.
     * 协作入口 / Collaborators: `clone`.
     */
    config: async () => clone(), /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`assert.fail('No selected resolved-config reread')`），以 Promise 交付。
     * Result: Return the branch-computed value (`assert.fail('No selected resolved-config reread')`) through a Promise.
     * 协作入口 / Collaborators: `assert.fail`.
     * 检查边界 / Checked boundaries: `assert.fail('No selected resolved-config reread')`.
     */
    resolvedConfig: async () => assert.fail('No selected resolved-config reread'),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; captured: typeof project。
     * 结果：返回受控对象，公开字段包括 `environment`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `environment`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `assert.equal`, `Object.getOwnPropertyDescriptor`.
     * 检查边界 / Checked boundaries: `assert.equal(captured._workspace, projectId)`; `assert.equal(Object.getOwnPropertyDescriptor(captured, '_workspace')?.enumerable, false)`.
     */
    resolveProject: async (_id: string, captured: typeof project) => {
      assert.equal(captured._workspace, projectId); assert.equal(Object.getOwnPropertyDescriptor(captured, '_workspace')?.enumerable, false);
      return { ...captured, environment: { ...captured.environment, TOKEN: 'project-private-token' } };
    },
  } as unknown as Workspaces;
  setVmStorageRoot(id, root);
  const native = scopeIdentityFixture(machines, project, () => bootId, () => null), execInput = machines.execInput.bind(machines);
  const state = { code: 0, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   */
  afterExecute: () => {}, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   */
  afterLock: () => {}, /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   */
  save: () => {} };
  machines.execInput = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args: Parameters<Machines['execInput']>。
   * 结果：返回受控对象，公开字段包括 `code, stdout`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout`; the actual branch determines its shape.
   * 协作入口 / Collaborators: `assert.ok`, `events.push`, `execInput`, `state.afterExecute`.
   * 检查边界 / Checked boundaries: `assert.ok(held)`.
   */
  async (...args: Parameters<Machines['execInput']>) => {
    assert.ok(held); events.push('uid-task');
    const result = await execInput(...args); state.afterExecute();
    return { ...result, code: state.code, stdout: JSON.stringify({ code: state.code, operation: 'format-lint', stdout: 'project-private-token' }) };
  };
  machines.locked = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: _key; action。
   * 结果：返回分支计算值（`action()`），以 Promise 交付。
   * Result: Return the branch-computed value (`action()`) through a Promise.
   * 协作入口 / Collaborators: `state.afterLock`, `action`.
   */
  async (_key, action) => { state.afterLock(); return action(); };
  const terminals = { /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: _id: string; scope: string; session: null; readOnly: boolean; signal: AbortSignal; _terminalId: unknown; mode: unknown。
   * 结果：返回受控对象，公开字段包括 `command, projectId, networkIsolation, terminalId, signal, captured, release`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `command, projectId, networkIsolation, terminalId, signal, captured, release`; the actual branch determines its shape.
   * 状态影响 / State effects: `held`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `assert.equal`, `current`, `assert.deepEqual`, `clone`.
   * 检查边界 / Checked boundaries: `assert.equal(scope, projectId)`; `assert.equal(current(), projectId)`.
   */
  prepare: async (_id: string, scope: string, session: null, readOnly: boolean, signal: AbortSignal,
    _terminalId: unknown, mode: unknown) => {
    assert.equal(scope, projectId); assert.equal(current(), projectId); assert.equal(session, null); assert.equal(readOnly, false);
    assert.deepEqual(mode, { mode: 'task' }); held = true;
    return { command: 'unused', projectId, networkIsolation: 'private', terminalId: undefined, signal,
      captured: { project: clone(), configVersion: projectVersion(project), live },
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 状态影响 / State effects: `held`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `events.push`.
       */
      release: () => { events.push('release'); held = false; ++releases; } };
  } } as unknown as ProjectTerminals;
  const suite = new FeatureSuite(machines, workspaces, {}, {}, { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: id。
   * 结果：返回分支计算值（`(id === 'projectTerminals' ? terminals : undefined) as never`）。
   * Result: Return the branch-computed value (`(id === 'projectTerminals' ? terminals : undefined) as never`).
   */
  optional: id => (id === 'projectTerminals' ? terminals : undefined) as never }); suite.jobs = new Jobs();
  const start = suite.jobs.start.bind(suite.jobs);
  suite.jobs.start = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: key; work; meta。
   * 结果：返回分支计算值（`start(key, async (log, signal, update, save) => { try { await work(log, signal, …`）。
   * Result: Return the branch-computed value (`start(key, async (log, signal, update, save) => { try { await work(log, signal, …`).
   * 协作入口 / Collaborators: `start`.
   */
  (key, work, meta) => start(key, async (log, signal, update, save) => {
    try { await work(log, signal, update, async value => {
      assert.ok(held, 'Engineering result must be saved before lease release'); assert.equal(current(), projectId);
      events.push('save'); await save(value); state.save();
    }); } catch (error) { failures.push(error); throw error; }
  }, meta);
  return { suite, machines, workspaces, project, id, projectId, live, native, state, commands, events, failures,
    key: id + ':' + projectId + ':dev', /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `selected`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    selectOther: () => { selected = otherId; }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `override`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    forceOther: () => { override = otherId; },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`held`）。
     * Result: Return the branch-computed value (`held`).
     */
    held: () => held, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`releases`）。
     * Result: Return the branch-computed value (`releases`).
     */
    releases: () => releases, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`JSON.parse(await readFile(join(root, id, 'project-identities', projectId + '.jso…`），以 Promise 交付。
     * Result: Return the branch-computed value (`JSON.parse(await readFile(join(root, id, 'project-identities', projectId + '.jso…`) through a Promise.
     * 协作入口 / Collaborators: `JSON.parse`, `readFile`, `join`.
     */
    journal: async () => JSON.parse(await readFile(join(root, id, 'project-identities', projectId + '.json'), 'utf8')),
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `suite.close`, `setVmStorageRoot`, `rm`.
     */
    dispose: async () => { await suite.close(); setVmStorageRoot(id); await rm(root, { recursive: true, force: true }); } };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lint and format preserve the submitted named scope and save public results while the engineering lease is held
 * 协作入口 / Collaborators: `dispatchFixture`, `f.suite.dev`, `f.selectOther`, `f.suite.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'done', job.error)`; `assert.equal(job.projectId, f.projectId)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('lint and format preserve the submitted named scope and save public results while the engineering lease is held', async () => {
  for (const operation of ['lint', 'format'] as const) {
    const f = await dispatchFixture();
    try {
      const job = f.suite.dev(f.id, { operation }); f.selectOther(); await f.suite.jobs.wait(f.key);
      assert.equal(job.status, 'done', job.error); assert.equal(job.projectId, f.projectId);
      assert.deepEqual(f.events, ['uid-task', 'save', 'release']); assert.equal(f.releases(), 1);
      const result: any = await f.suite.jobs.result(job.id!);
      assert.deepEqual(result, { code: 0, operation: 'format-lint', stdout: '[私密配置已隐藏]', ready: true, executed: true });
      const journal = await f.journal(); assert.equal(journal.runs[0].projectId, f.projectId);
      assert.equal(journal.runs[0].run.cgroupInode, '23456'); assert.equal(journal.runs[0].phase, 'closed');
      assert.ok(f.commands.every(command => !command.includes('project-private-token') && !command.includes('/project/hook/bin')));
      assert.equal(f.native.inputs.length, 1); assert.equal(f.held(), false);
    } finally { await f.dispose(); }
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a queued lint job rejects a changed original live before preparation or protected execution
 * 状态影响 / State effects: `f.state.afterLock`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `dispatchFixture`, `f.suite.dev`, `f.suite.jobs.wait`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal(job.errorCode, 'PROJECT_IDENTITY_HOST_CHANGED')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a queued lint job rejects a changed original live before preparation or protected execution', async () => {
  const f = await dispatchFixture();
  try {
    f.state.afterLock = /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a queued lint job rejects a changed original live before preparation or protected execution
     * 协作入口 / Collaborators: `f.machines.live.set`.
     */
    () => { f.machines.live.set(f.id, {} as any); };
    const job = f.suite.dev(f.id, { operation: 'lint' }); await f.suite.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.native.inputs.length, 0); assert.equal(f.releases(), 0); assert.deepEqual(f.events, []);
  } finally { await f.dispose(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: format cancellation and scope changes after UID execution refuse result publication while closing the original native task
 * 状态影响 / State effects: `f.state.afterExecute`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `dispatchFixture`, `f.suite.dev`, `f.suite.jobs.wait`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal(job.result, undefined)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('format cancellation and scope changes after UID execution refuse result publication while closing the original native task', async () => {
  for (const failure of ['cancel', 'scope-switch'] as const) {
    const f = await dispatchFixture(), abort = new AbortController();
    try {
      f.state.afterExecute = /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: format cancellation and scope changes after UID execution refuse result publication while closing the original native task
       * 协作入口 / Collaborators: `abort.abort`, `f.forceOther`.
       */
      () => { if (failure === 'cancel') abort.abort(); else f.forceOther(); };
      const job = f.suite.dev(f.id, { operation: 'format' }, abort.signal); await f.suite.jobs.wait(f.key);
      assert.equal(job.status, 'error'); assert.equal(job.result, undefined);
      assert.equal(f.releases(), 1); assert.equal(f.events.includes('save'), false);
      assert.equal((await f.journal()).runs[0].phase, 'closed');
      if (failure === 'scope-switch') assert.equal(job.errorCode, 'PROJECT_IDENTITY_HOST_CHANGED');
    } finally { await f.dispose(); }
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: engineering cleanup 503 survives the lint dispatcher without JSON parsing or successful-result replacement
 * 状态影响 / State effects: `f.native.state.stopFailures`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `dispatchFixture`, `f.suite.dev`, `f.suite.jobs.wait`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal(job.errorCode, 'PROJECT_IDENTITY_CLEANUP_FAILED')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('engineering cleanup 503 survives the lint dispatcher without JSON parsing or successful-result replacement', async () => {
  const f = await dispatchFixture();
  try {
    f.native.state.stopFailures = 100;
    const job = f.suite.dev(f.id, { operation: 'lint' }); await f.suite.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    assert.equal(f.failures[0].status, 503); assert.equal(job.result, undefined); assert.equal(f.releases(), 1);
    assert.equal((await f.journal()).runs[0].phase, 'active');
  } finally { await f.dispose(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: actual engineering nonzero exits remain in the stored lint result after lease-bound saving
 * 状态影响 / State effects: `f.state.code`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `dispatchFixture`, `f.suite.dev`, `f.suite.jobs.wait`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal((await f.suite.jobs.result(job.id!) as any).code, 7)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('actual engineering nonzero exits remain in the stored lint result after lease-bound saving', async () => {
  const f = await dispatchFixture();
  try {
    f.state.code = 7;
    const job = f.suite.dev(f.id, { operation: 'lint' }); await f.suite.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.equal((await f.suite.jobs.result(job.id!) as any).code, 7);
    assert.deepEqual(f.events, ['uid-task', 'save', 'release']); assert.equal(f.failures[0].status, 409);
    assert.equal(job.log.includes('project-private-token'), false);
  } finally { await f.dispose(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: explicit database management stays in the original project with a fixed root environment and rejects unknown database names
 * 状态影响 / State effects: `suite.jobs`, `f.project.networkIsolation`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `dispatchFixture`, `assert.throws`, `suite.dev`, `f.selectOther`.
 * 检查边界 / Checked boundaries: `assert.throws(() => f.suite.dev(f.id, { operation: 'database', database: 'unknown' as any, password: 'safe-long-password' }))`; `assert.deepEqual(managed, [f.projectId])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('explicit database management stays in the original project with a fixed root environment and rejects unknown database names', async () => {
  const f = await dispatchFixture();
  try {
    assert.throws(() => f.suite.dev(f.id, { operation: 'database', database: 'unknown' as any, password: 'safe-long-password' }));
    const managed: string[] = [], failure = new AppError('management cleanup pending', 503, 'GUEST_TASK_CLEANUP_FAILED');
    const suite = new FeatureSuite(f.machines, f.workspaces, { /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: explicit database management stays in the original project with a fixed root environment and rejects unknown database names
     * 失败 / Failure: `failure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `managed.push`, `f.workspaces.projects.current`.
     */
    privateDatabase: async () => {
      managed.push(f.workspaces.projects.current(f.id)); throw failure;
    } }); suite.jobs = new Jobs();
    try {
      const job = suite.dev(f.id, { operation: 'database', database: 'redis', password: 'safe-long-password' });
      f.selectOther(); await suite.jobs.wait(f.key);
      assert.deepEqual(managed, [f.projectId]); assert.equal(job.errorCode, failure.code);
      assert.equal(f.native.inputs.length, 0);
    } finally { await suite.close(); }
    f.project.networkIsolation = 'host';
    const job = f.workspaces.projects.inScope(f.id, f.projectId, () =>
      f.suite.dev(f.id, { operation: 'database', database: 'redis', password: 'safe-long-password' }));
    f.selectOther(); await f.suite.jobs.wait(f.key);
    assert.equal(job.status, 'done', job.error); assert.equal(job.projectId, f.projectId);
    const administrative = f.commands.find(command => command.includes('docker run -d'));
    assert.ok(administrative); assert.match(administrative, /\/usr\/bin\/env -i HOME=\/ USER=root LOGNAME=root PATH=\/usr\/sbin:/);
    assert.equal(administrative.includes('/project/hook/bin'), false); assert.equal(administrative.includes('project-private-token'), false);
    assert.equal(administrative.includes('cd /srv/named-project'), false); assert.equal(f.native.inputs.length, 0);
  } finally { await f.dispose(); }
});
