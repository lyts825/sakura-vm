/**
 * 模块职责：回归验证模块，围绕 `code-intelligence` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `code-intelligence`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: editor and CLI paths execute the same finite UID check and reject paths outside the original project; all existing checker commands, including the TypeScript fallback, stay inside the UID body.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { CodeIntelligence, type CodeIntelligenceOptions } from '../server/code-intelligence.ts';
import type { Machines } from '../server/machines.ts';
import { projectSchema, projectVersion, type Project, type Workspaces } from '../server/workspaces.ts';
import { AppError } from '../server/model.ts';
import { ProjectIdentities, projectIdentityPayload, type ProjectIdentity, type ProjectIdentityRun } from '../server/project-identity.ts';
import { ProjectTerminals } from '../server/project-terminals.ts';

const id = '11111111-1111-4111-8111-111111111111', projectId = '0123456789abcdef';
type Output = { code: number; stdout: string; stderr: string };
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: value: Project; scope = value._workspace。
 * 结果：返回分支计算值（`Object.defineProperty(structuredClone(value), '_workspace', { value: scope, enum…`）。
 * Result: Return the branch-computed value (`Object.defineProperty(structuredClone(value), '_workspace', { value: scope, enum…`).
 * 协作入口 / Collaborators: `Object.defineProperty`, `structuredClone`.
 */
function copyProject(value: Project, scope = value._workspace) {
  return Object.defineProperty(structuredClone(value), '_workspace', { value: scope, enumerable: false });
}
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: networkIsolation: 'host' | 'private' = 'private'。
 * 结果：返回受控对象，公开字段包括 `run, options, checks, manager, machines, workspaces, config, live, abort`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `run, options, checks, manager, machines, workspaces, config, live, abort`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `copyProject`, `projectSchema.parse`.
 */
function fixture(networkIsolation: 'host' | 'private' = 'private') {
  const context = new AsyncLocalStorage<string>();
  let forcedScope: string | undefined, outsideScope = projectId;
  let status = 'running', leaseOpen = false, releases = 0, closes = 0, created = 0;
  const live = {}, abort = new AbortController();
  const config = copyProject(projectSchema.parse({ directory: '/workspace/app', networkIsolation,
    environment: { MODE: 'original' }, secrets: { TOKEN: 'diagnostics-secret' } }), projectId);
  const launches: Parameters<NonNullable<CodeIntelligenceOptions['runProjectTask']>>[] = [];
  const events: string[] = [], rootCommands: string[] = [];
  const machines = {
    live: new Map([[id, live]]), /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`status`）。
     * Result: Return the branch-computed value (`status`).
     */
    state: () => status, /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ distro: 'debian' })`）。
     * Result: Return the branch-computed value (`({ distro: 'debian' })`).
     */
    get: () => ({ distro: 'debian' }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; action: () => unknown。
     * 结果：返回分支计算值（`action()`），以 Promise 交付。
     * Result: Return the branch-computed value (`action()`) through a Promise.
     * 协作入口 / Collaborators: `action`.
     */
    locked: async (_id: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => unknown) => action(),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('Unexpected direct root command')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `rootCommands.push`.
     */
    exec: async (_id: string, command: string) => {
      rootCommands.push(command); throw new Error('Unexpected direct root command');
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('Unexpected direct root input execution')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    execInput: async () => { throw new Error('Unexpected direct root input execution'); },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('Unexpected root file publication')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    writeGuestFile: async () => { throw new Error('Unexpected root file publication'); },
  } as unknown as Machines;
  const workspaces = {
    projects: {
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`forcedScope || context.getStore() || outsideScope`）。
       * Result: Return the branch-computed value (`forcedScope || context.getStore() || outsideScope`).
       * 协作入口 / Collaborators: `context.getStore`.
       */
      current: () => forcedScope || context.getStore() || outsideScope,
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
      () => unknown) => context.run(scope, action),
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: _id: string; scope: string; action: () => unknown。
       * 结果：返回分支计算值（`context.run(scope, action)`），以 Promise 交付。
       * Result: Return the branch-computed value (`context.run(scope, action)`) through a Promise.
       * 协作入口 / Collaborators: `context.run`.
       */
      with: async (_id: string, scope: string, action: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      () => unknown) => context.run(scope, action),
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`copyProject(config)`），以 Promise 交付。
     * Result: Return the branch-computed value (`copyProject(config)`) through a Promise.
     * 协作入口 / Collaborators: `copyProject`.
     */
    config: async () => copyProject(config),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('Selected config reread is forbidden')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    resolvedConfig: async () => { throw new Error('Selected config reread is forbidden'); },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; captured: Project。
     * 结果：返回受控对象，公开字段包括 `_workspace, environment`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `_workspace, environment`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `assert.equal`, `projectVersion`.
     * 检查边界 / Checked boundaries: `assert.equal(captured._workspace, projectId)`; `assert.equal(projectVersion(captured), projectVersion(config))`.
     */
    resolveProject: async (_id: string, captured: Project) => {
      assert.equal(captured._workspace, projectId);
      assert.equal(projectVersion(captured), projectVersion(config));
      return { ...captured, _workspace: captured._workspace,
        environment: { ...captured.environment, TOKEN: 'private-diagnostic-token' } };
    },
  } as unknown as Workspaces;
  const manager: Pick<ProjectTerminals, 'prepare' | 'close'> = {
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: _id; scope; session; readOnly; signal; _terminalId; mode。
     * 结果：返回受控对象，公开字段包括 `command, projectId, networkIsolation, terminalId, signal, captured, release`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `command, projectId, networkIsolation, terminalId, signal, captured, release`; the actual branch determines its shape.
     * 状态影响 / State effects: `leaseOpen`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `assert.equal`, `assert.deepEqual`, `signal?.throwIfAborted`, `events.push`.
     * 检查边界 / Checked boundaries: `assert.equal(scope, projectId)`; `assert.equal(session, null)`.
     */
    prepare: async (_id, scope, session, readOnly, signal, _terminalId, mode) => {
      assert.equal(scope, projectId); assert.equal(session, null); assert.equal(readOnly, false);
      assert.deepEqual(mode, { mode: 'task' }); signal?.throwIfAborted(); leaseOpen = true;
      events.push('prepare');
      return { command: 'unused terminal command', projectId, networkIsolation, terminalId: undefined,
        signal: signal!, captured: { project: copyProject(config), configVersion: projectVersion(config), live: live as any },
        /**
         * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
         * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 状态影响 / State effects: `leaseOpen`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
         * 协作入口 / Collaborators: `events.push`.
         */
        release: () => { leaseOpen = false; ++releases; events.push('release'); } };
    },
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `events.push`, `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(leaseOpen, false)`.
     */
    close: async () => { ++closes; events.push('close'); assert.equal(leaseOpen, false); },
  };
  const options: CodeIntelligenceOptions = {
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`manager`）。
     * Result: Return the branch-computed value (`manager`).
     */
    createPreparation: () => { ++created; return manager; },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `assert.equal`, `assert.ok`, `projectVersion`, `projectIdentityPayload`.
     * 检查边界 / Checked boundaries: `assert.equal(transport, machines)`; `assert.equal(vmId, id)`.
     */
    runProjectTask: async (...args) => {
      const [transport, vmId, project, execution, signal, log, timeout, agentPath, afterCleanup, pins] = args;
      assert.equal(transport, machines); assert.equal(vmId, id); assert.equal(project._workspace, projectId);
      assert.ok(leaseOpen); assert.equal(projectVersion(project), projectVersion(config));
      assert.equal(signal.aborted, false); assert.equal(timeout, 30000); assert.equal(pins?.expectedLive, live);
      assert.equal(log, undefined); assert.equal(agentPath, undefined); assert.equal(afterCleanup, undefined);
      projectIdentityPayload(execution); launches.push(args); events.push('uid-start');
      events.push('full-domain-stopped'); events.push('native-ticket-closed');
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  const checks = new CodeIntelligence(machines, workspaces, options);
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: path = 'src/a.js'; signal = abort.signal。
   * 结果：返回分支计算值（`checks.diagnose(id, path, signal)`）。
   * Result: Return the branch-computed value (`checks.diagnose(id, path, signal)`).
   * 协作入口 / Collaborators: `checks.diagnose`.
   */
  const run = (path = 'src/a.js', signal = abort.signal) => checks.diagnose(id, path, signal);
  return { run, options, checks, manager, machines, workspaces, config, live, abort, launches, events, rootCommands,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`leaseOpen`）。
     * Result: Return the branch-computed value (`leaseOpen`).
     */
    leaseOpen: () => leaseOpen, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`releases`）。
     * Result: Return the branch-computed value (`releases`).
     */
    releases: () => releases, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`closes`）。
     * Result: Return the branch-computed value (`closes`).
     */
    closes: () => closes, /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`created`）。
     * Result: Return the branch-computed value (`created`).
     */
    created: () => created,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setStatus: (value: string) => { status = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `outsideScope`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    switchOutside: () => { outsideScope = 'fedcba9876543210'; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `forcedScope`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    forceScope: () => { forcedScope = 'fedcba9876543210'; } };
}
/**
 * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
 * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
 * 输入 / Inputs: f: ReturnType<typeof fixture>; output: Output。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 状态影响 / State effects: `f.options.runProjectTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 */
function returning(f: ReturnType<typeof fixture>, output: Output) {
  const launch = f.options.runProjectTask!;
  f.options.runProjectTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`output`），以 Promise 交付。
   * Result: Return the branch-computed value (`output`) through a Promise.
   * 协作入口 / Collaborators: `launch`.
   */
  async (...args) => { await launch(...args); return output; };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: editor and CLI paths execute the same finite UID check and reject paths outside the original project
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.deepEqual`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(result, { path: 'src/a.js', diagnostics: [], supported: true })`; `assert.equal(f.launches.length, 2)`.
 */
test('editor and CLI paths execute the same finite UID check and reject paths outside the original project', async () => {
  const f = fixture();
  for (const input of ['/workspace/app/src/a.js', 'src/a.js']) {
    const result = await f.run(input);
    assert.deepEqual(result, { path: 'src/a.js', diagnostics: [], supported: true });
  }
  assert.equal(f.launches.length, 2);
  for (const [, , project, execution] of f.launches) {
    assert.equal(project._workspace, projectId);
    assert.equal(execution.command, "node --check '/workspace/app/src/a.js'");
  }
  for (const path of ['/workspace/app-other/a.js', '/etc/a.js', '../a.js', '/workspace/app/../a.js', '/workspace/app'])
    await assert.rejects(f.run(path));
  assert.equal(f.launches.length, 2); assert.equal(f.created(), 2); assert.deepEqual(f.rootCommands, []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: all existing checker commands, including the TypeScript fallback, stay inside the UID body
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.equal`, `f.launches.map`.
 * 检查边界 / Checked boundaries: `assert.equal(f.launches.length, 8)`; `assert.match(value, /^node --check /)`.
 */
test('all existing checker commands, including the TypeScript fallback, stay inside the UID body', async () => {
  const f = fixture();
  for (const ext of ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'json']) await f.run(`src/a.${ext}`);
  assert.equal(f.launches.length, 8);
  const commands = f.launches.map((args) => args[3].command);
  for (const value of commands.slice(0, 4)) assert.match(value, /^node --check /);
  for (const value of commands.slice(4, 6))
    assert.match(value, /^if command -v tsc >\/dev\/null; then tsc --noEmit --pretty false .*; else node --check .*; fi$/);
  assert.equal(commands[6], "python3 -m py_compile '/workspace/app/src/a.py'");
  assert.equal(commands[7], "python3 -m json.tool '/workspace/app/src/a.json' >/dev/null");
  assert.equal(f.releases(), 8); assert.equal(f.closes(), 8); assert.deepEqual(f.rootCommands, []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unsupported extensions and canceled requests never prepare a task or select a root fallback
 * 协作入口 / Collaborators: `fixture`, `f.setStatus`, `f.machines.live.delete`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(await f.run('src/a.rs'), { path: 'src/a.rs', diagnostics: [], supported: false })`; `assert.rejects(f.run('src/a.js'), (error: any) => error.name === 'AbortError')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('unsupported extensions and canceled requests never prepare a task or select a root fallback', async () => {
  const f = fixture(); f.setStatus('stopped'); f.machines.live.delete(id);
  assert.deepEqual(await f.run('src/a.rs'), { path: 'src/a.rs', diagnostics: [], supported: false });
  f.abort.abort();
  await assert.rejects(f.run('src/a.js'), (error: any) => error.name === 'AbortError');
  await assert.rejects(f.run('src/a.unknown'), (error: any) => error.name === 'AbortError');
  assert.equal(f.created(), 0); assert.equal(f.launches.length, 0); assert.deepEqual(f.rootCommands, []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: non-enumerable named project identity survives captured config and a concurrent selection change
 * 状态影响 / State effects: `f.workspaces.config`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.equal`, `Object.getOwnPropertyDescriptor`.
 * 检查边界 / Checked boundaries: `assert.equal(project._workspace, projectId)`; `assert.equal(Object.getOwnPropertyDescriptor(project, '_workspace')?.enumerable, false)`.
 */
test('non-enumerable named project identity survives captured config and a concurrent selection change', async () => {
  const f = fixture(), read = f.workspaces.config;
  f.workspaces.config = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`read(...args)`），以 Promise 交付。
   * Result: Return the branch-computed value (`read(...args)`) through a Promise.
   * 验证场景 / Scenario: non-enumerable named project identity survives captured config and a concurrent selection change
   * 协作入口 / Collaborators: `Promise.resolve`, `f.switchOutside`, `read`.
   */
  async (...args) => { await Promise.resolve(); f.switchOutside(); return read(...args); };
  await f.run();
  const project = f.launches[0][2];
  assert.equal(project._workspace, projectId);
  assert.equal(Object.getOwnPropertyDescriptor(project, '_workspace')?.enumerable, false);
  assert.equal(projectVersion(project), projectVersion(f.config));
  assert.equal(f.workspaces.projects.current(id), 'fedcba9876543210');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: host and private checks use captured isolation and resolved secrets without root argv or UID HOME overrides
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.equal`, `identityId.replaceAll('-', '').slice`.
 * 检查边界 / Checked boundaries: `assert.equal(project.networkIsolation, mode)`; `assert.equal(execution.environment?.TOKEN, 'private-diagnostic-token')`.
 */
test('host and private checks use captured isolation and resolved secrets without root argv or UID HOME overrides', async () => {
  for (const mode of ['host', 'private'] as const) {
    const f = fixture(mode); await f.run("src/a' $TOKEN.js");
    const [, , project, execution] = f.launches[0];
    assert.equal(project.networkIsolation, mode);
    assert.equal(execution.environment?.TOKEN, 'private-diagnostic-token');
    assert.equal('HOME' in execution.environment!, false);
    const identityId = '22222222-2222-4222-8222-222222222222', runId = '33333333-3333-4333-8333-333333333333';
    const identity: ProjectIdentity = { version: 1, phase: 'active', registryId: '44444444-4444-4444-8444-444444444444',
      projectId, identityId, revision: 1, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid: 22000, gid: 22000,
      home: '/var/lib/sakura-project-homes/' + identityId, directory: project.directory, networkIsolation: mode,
      homeDevice: '1', homeInode: '2', directoryDevice: '1', directoryInode: '3' };
    const run: ProjectIdentityRun = { version: 1, phase: 'active', mode: 'inherit-current', registryId: identity.registryId,
      identityId, projectId, runId, revision: 1, bootId: '55555555-5555-4555-8555-555555555555', build: 'a'.repeat(64),
      networkDevice: '1', networkInode: '4', cgroupDevice: '1', cgroupInode: '5', cgroupName: 'sakura-task-' + runId,
      namespace: mode === 'private' ? 'sk-' + projectId : '' };
    const payload = new ProjectIdentities(f.machines).input(identity, run, execution);
    assert.equal(payload.command.includes(execution.command), false);
    assert.equal(payload.command.includes('private-diagnostic-token'), false);
    assert.equal(payload.command.includes('$TOKEN'), false);
    assert.ok(payload.input.includes(Buffer.from(execution.command)));
    assert.ok(payload.input.includes(Buffer.from('private-diagnostic-token')));
    assert.equal(payload.input.readUInt32LE(12), 0);
    assert.equal(payload.input.readUInt32LE(24), Buffer.byteLength(execution.command));
    assert.deepEqual(f.rootCommands, []);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: reported diagnostics retain positions, first 100 lines and message limits, while hiding resolved secrets
 * 协作入口 / Collaborators: `fixture`, `returning`, `'x'.repeat`, `Array.from({ length: 110 }, (_, i) => `extra ${i}`).join`.
 * 检查边界 / Checked boundaries: `assert.equal(result.supported, true)`; `assert.equal(result.diagnostics.length, 100)`.
 */
test('reported diagnostics retain positions, first 100 lines and message limits, while hiding resolved secrets', async () => {
  const f = fixture();
  returning(f, { code: 2, stdout: '/workspace/app/src/a.ts(7,12): error TS1000: private-diagnostic-token\r\n',
    stderr: 'src/a.ts:9:4: second\n' + 'x'.repeat(600) + '\n' + Array.from({ length: 110 }, (_, i) => `extra ${i}`).join('\n') });
  const result = await f.run('src/a.ts');
  assert.equal(result.supported, true); assert.equal(result.diagnostics.length, 100);
  // Keep the existing parser's leading colon after a TypeScript (line,column).
  assert.deepEqual(result.diagnostics[0], { severity: 'error', line: 7, column: 12, message: ': error TS1000: [私密配置已隐藏]' });
  assert.deepEqual(result.diagnostics[1], { severity: 'error', line: 9, column: 4, message: 'second' });
  assert.equal(result.diagnostics[2].message, 'x'.repeat(500));
  assert.equal(JSON.stringify(result).includes('private-diagnostic-token'), false);
  assert.deepEqual(f.events, ['prepare', 'uid-start', 'full-domain-stopped', 'native-ticket-closed', 'release', 'close']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: captured config is independent of the object returned by the first asynchronous read
 * 状态影响 / State effects: `f.workspaces.config`, `f.manager.prepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(f.launches[0][2].directory, '/workspace/app')`; `assert.match(f.launches[0][3].command, /\/workspace\/app\/src\/a\.js/)`.
 */
test('captured config is independent of the object returned by the first asynchronous read', async () => {
  const f = fixture(); let first = true, returned: Project | undefined;
  const read = f.workspaces.config;
  f.workspaces.config = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`value`），以 Promise 交付。
   * Result: Return the branch-computed value (`value`) through a Promise.
   * 验证场景 / Scenario: captured config is independent of the object returned by the first asynchronous read
   * 状态影响 / State effects: `first`, `returned`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `read`.
   */
  async (...args) => {
    const value = await read(...args);
    if (first) { first = false; returned = value; }
    return value;
  };
  const prepare = f.manager.prepare;
  f.manager.prepare = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`prepare(...args)`），以 Promise 交付。
   * Result: Return the branch-computed value (`prepare(...args)`) through a Promise.
   * 验证场景 / Scenario: captured config is independent of the object returned by the first asynchronous read
   * 状态影响 / State effects: `returned!.directory`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `prepare`.
   */
  async (...args) => { returned!.directory = '/workspace/other'; return prepare(...args); };
  await f.run();
  assert.equal(f.launches[0][2].directory, '/workspace/app');
  assert.match(f.launches[0][3].command, /\/workspace\/app\/src\/a\.js/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a changed captured lease version, scope or live fails before execution and always closes the manager
 * 状态影响 / State effects: `f.manager.prepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.launches.length, 0)`.
 */
test('a changed captured lease version, scope or live fails before execution and always closes the manager', async () => {
  for (const corrupt of [
    (lease: any) => { lease.captured.configVersion = '0'.repeat(64); },
    (lease: any) => { lease.projectId = 'fedcba9876543210'; },
    (lease: any) => { lease.captured.live = {}; },
    (lease: any) => { lease.captured.project = copyProject(lease.captured.project, 'fedcba9876543210'); },
    (lease: any) => { lease.captured.project.environment = { MODE: 'changed' }; },
  ]) {
    const f = fixture(), prepare = f.manager.prepare;
    f.manager.prepare = /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`lease`），以 Promise 交付。
     * Result: Return the branch-computed value (`lease`) through a Promise.
     * 验证场景 / Scenario: a changed captured lease version, scope or live fails before execution and always closes the manager
     * 协作入口 / Collaborators: `prepare`, `corrupt`.
     */
    async (...args) => { const lease = await prepare(...args); corrupt(lease); return lease; };
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: live replacement or config edits during preparation and resolution prevent the UID launch
 * 状态影响 / State effects: `f.manager.prepare`, `f.workspaces.resolveProject`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.launches.length, 0)`.
 */
test('live replacement or config edits during preparation and resolution prevent the UID launch', async () => {
  for (const phase of ['prepare', 'resolve'] as const) for (const change of ['live', 'config'] as const) {
    const f = fixture();
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: live replacement or config edits during preparation and resolution prevent the UID launch
     * 状态影响 / State effects: `f.config.environment`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `f.machines.live.set`.
     */
    const mutate = () => { if (change === 'live') f.machines.live.set(id, {} as any); else f.config.environment = { MODE: 'changed' }; };
    if (phase === 'prepare') {
      const prepare = f.manager.prepare;
      f.manager.prepare = /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: args。
       * 结果：返回分支计算值（`lease`），以 Promise 交付。
       * Result: Return the branch-computed value (`lease`) through a Promise.
       * 验证场景 / Scenario: live replacement or config edits during preparation and resolution prevent the UID launch
       * 协作入口 / Collaborators: `prepare`, `mutate`.
       */
      async (...args) => { const lease = await prepare(...args); mutate(); return lease; };
    } else {
      const resolve = f.workspaces.resolveProject;
      f.workspaces.resolveProject = /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: args。
       * 结果：返回分支计算值（`value`），以 Promise 交付。
       * Result: Return the branch-computed value (`value`) through a Promise.
       * 验证场景 / Scenario: live replacement or config edits during preparation and resolution prevent the UID launch
       * 协作入口 / Collaborators: `resolve`, `mutate`.
       */
      async (...args) => { const value = await resolve(...args); mutate(); return value; };
    }
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: changed execution boundaries or unsafe resolved native environments are rejected before the UID launch
 * 状态影响 / State effects: `f.workspaces.resolveProject`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run())`; `assert.equal(f.launches.length, 0)`.
 */
test('changed execution boundaries or unsafe resolved native environments are rejected before the UID launch', async () => {
  for (const mutate of [
    (resolved: Project) => { resolved._workspace = 'fedcba9876543210'; },
    (resolved: Project) => { resolved.directory = '/workspace/other'; },
    (resolved: Project) => { resolved.networkIsolation = 'host'; },
    (resolved: Project) => { resolved.environment = { HOME: '/root' }; },
    (resolved: Project) => { resolved.environment = { TOKEN: 'x'.repeat(8193) }; },
    (resolved: Project) => { resolved.environment = { TOKEN: 'bad\0value' }; },
  ]) {
    const f = fixture(), resolve = f.workspaces.resolveProject;
    f.workspaces.resolveProject = /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`value`），以 Promise 交付。
     * Result: Return the branch-computed value (`value`) through a Promise.
     * 验证场景 / Scenario: changed execution boundaries or unsafe resolved native environments are rejected before the UID launch
     * 协作入口 / Collaborators: `resolve`, `mutate`.
     */
    async (...args) => { const value = await resolve(...args); mutate(value); return value; };
    await assert.rejects(f.run());
    assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
    assert.deepEqual(f.rootCommands, []);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: late config, scope and live changes suppress results after full native cleanup
 * 状态影响 / State effects: `f.options.runProjectTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.launches.length, 1)`.
 */
test('late config, scope and live changes suppress results after full native cleanup', async () => {
  for (const change of ['config', 'scope', 'live', 'paused'] as const) {
    const f = fixture(), launch = f.options.runProjectTask!;
    f.options.runProjectTask = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`result`），以 Promise 交付。
     * Result: Return the branch-computed value (`result`) through a Promise.
     * 验证场景 / Scenario: late config, scope and live changes suppress results after full native cleanup
     * 状态影响 / State effects: `f.config.environment`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `launch`, `f.forceScope`, `f.machines.live.set`, `f.setStatus`.
     */
    async (...args) => {
      const result = await launch(...args);
      if (change === 'config') f.config.environment = { MODE: 'changed' };
      if (change === 'scope') f.forceScope();
      if (change === 'live') f.machines.live.set(id, {} as any);
      if (change === 'paused') f.setStatus('paused');
      return result;
    };
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.launches.length, 1); assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
    assert.deepEqual(f.events.slice(-4), ['full-domain-stopped', 'native-ticket-closed', 'release', 'close']);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancellation during preparation or secret resolution releases the lease without launching any code
 * 状态影响 / State effects: `f.manager.prepare`, `f.workspaces.resolveProject`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.name === 'AbortError')`; `assert.equal(f.launches.length, 0)`.
 */
test('cancellation during preparation or secret resolution releases the lease without launching any code', async () => {
  for (const phase of ['prepare', 'resolve'] as const) {
    const f = fixture();
    if (phase === 'prepare') {
      const prepare = f.manager.prepare;
      f.manager.prepare = /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: args。
       * 结果：返回分支计算值（`value`），以 Promise 交付。
       * Result: Return the branch-computed value (`value`) through a Promise.
       * 验证场景 / Scenario: cancellation during preparation or secret resolution releases the lease without launching any code
       * 协作入口 / Collaborators: `prepare`, `f.abort.abort`.
       */
      async (...args) => { const value = await prepare(...args); f.abort.abort(); return value; };
    } else {
      const resolve = f.workspaces.resolveProject;
      f.workspaces.resolveProject = /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: args。
       * 结果：返回分支计算值（`value`），以 Promise 交付。
       * Result: Return the branch-computed value (`value`) through a Promise.
       * 验证场景 / Scenario: cancellation during preparation or secret resolution releases the lease without launching any code
       * 协作入口 / Collaborators: `resolve`, `f.abort.abort`.
       */
      async (...args) => { const value = await resolve(...args); f.abort.abort(); return value; };
    }
    await assert.rejects(f.run(), (error: any) => error.name === 'AbortError');
    assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: task cancellation, transport errors and uncertain native cleanup propagate instead of becoming diagnostics
 * 状态影响 / State effects: `f.options.runProjectTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error) => error === failure)`; `assert.equal(f.releases(), 1)`.
 */
test('task cancellation, transport errors and uncertain native cleanup propagate instead of becoming diagnostics', async () => {
  for (const failure of [new DOMException('canceled', 'AbortError'), new Error('SSH transport disconnected'),
    new AppError('original cgroup still populated', 503, 'GUEST_TASK_CLEANUP_FAILED'),
    new AppError('original native receipt retained', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')]) {
    const f = fixture(); f.options.runProjectTask = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: task cancellation, transport errors and uncertain native cleanup propagate instead of becoming diagnostics
     * 失败 / Failure: `failure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `assert.ok`, `f.leaseOpen`.
     * 检查边界 / Checked boundaries: `assert.ok(f.leaseOpen())`.
     */
    async () => { assert.ok(f.leaseOpen()); throw failure; };
    await assert.rejects(f.run(), (error) => error === failure);
    assert.equal(f.releases(), 1); assert.equal(f.closes(), 1); assert.deepEqual(f.rootCommands, []);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the preparation lease stays held while a UID task performs its full domain and ticket cleanup
 * 状态影响 / State effects: `f.options.runProjectTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.ok`, `f.leaseOpen`.
 * 检查边界 / Checked boundaries: `assert.ok(f.leaseOpen())`; `assert.equal(f.releases(), 0)`.
 */
test('the preparation lease stays held while a UID task performs its full domain and ticket cleanup', async () => {
  const f = fixture(); let started!: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, finish!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const running = new Promise<void>((resolve) => { started = resolve; });
  const cleanup = new Promise<void>((resolve) => { finish = resolve; });
  f.options.runProjectTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: the preparation lease stays held while a UID task performs its full domain and ticket cleanup
   * 协作入口 / Collaborators: `started`, `assert.ok`, `f.leaseOpen`, `f.events.push`.
   * 检查边界 / Checked boundaries: `assert.ok(f.leaseOpen())`.
   */
  async () => {
    started(); await cleanup; assert.ok(f.leaseOpen()); f.events.push('native-cleanup-confirmed');
    return { code: 0, stdout: '', stderr: '' };
  };
  const operation = f.run(); await running;
  assert.ok(f.leaseOpen()); assert.equal(f.releases(), 0); assert.equal(f.closes(), 0);
  finish(); await operation;
  assert.deepEqual(f.events, ['prepare', 'native-cleanup-confirmed', 'release', 'close']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed preparation closes its per-call manager and never creates or migrates the project directory
 * 状态影响 / State effects: `f.manager.prepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error) => error === failure)`; `assert.equal(f.created(), 1)`.
 */
test('failed preparation closes its per-call manager and never creates or migrates the project directory', async () => {
  for (const failure of [new AppError('directory absent', 409, 'PROJECT_IDENTITY_DIRECTORY_MISSING'),
    new AppError('explicit migration required', 409, 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED')]) {
    const f = fixture(); f.manager.prepare = /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: failed preparation closes its per-call manager and never creates or migrates the project directory
     * 失败 / Failure: `failure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    async () => { throw failure; };
    await assert.rejects(f.run(), (error) => error === failure);
    assert.equal(f.created(), 1); assert.equal(f.releases(), 0); assert.equal(f.closes(), 1);
    assert.equal(f.launches.length, 0); assert.deepEqual(f.rootCommands, []);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: preparation cleanup failure is never hidden by successful diagnostic output, and close still runs
 * 状态影响 / State effects: `f.manager.prepare`, `f.manager.close`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error) => error === failure)`; `assert.equal(f.releases(), 1)`.
 */
test('preparation cleanup failure is never hidden by successful diagnostic output, and close still runs', async () => {
  for (const phase of ['release', 'close'] as const) {
    const f = fixture(), failure = new Error(phase + ' failed');
    if (phase === 'release') {
      const prepare = f.manager.prepare;
      f.manager.prepare = /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: args。
       * 结果：返回分支计算值（`lease`），以 Promise 交付。
       * Result: Return the branch-computed value (`lease`) through a Promise.
       * 验证场景 / Scenario: preparation cleanup failure is never hidden by successful diagnostic output, and close still runs
       * 状态影响 / State effects: `lease.release`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `prepare`.
       */
      async (...args) => {
        const lease = await prepare(...args), release = lease.release;
        lease.release = /**
         * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
         * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 验证场景 / Scenario: preparation cleanup failure is never hidden by successful diagnostic output, and close still runs
         * 失败 / Failure: `failure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         * 协作入口 / Collaborators: `release`.
         */
        () => { release(); throw failure; }; return lease;
      };
    } else f.manager.close = /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: preparation cleanup failure is never hidden by successful diagnostic output, and close still runs
     * 失败 / Failure: `failure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `f.events.push`.
     */
    async () => { f.events.push('close-attempted'); throw failure; };
    await assert.rejects(f.run(), (error) => error === failure);
    assert.equal(f.releases(), 1);
    assert.ok(f.events.includes(phase === 'close' ? 'close-attempted' : 'close'));
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: simultaneous task and preparation cleanup failures preserve all causes and the native 503 code
 * 状态影响 / State effects: `f.manager.prepare`, `f.manager.close`, `f.options.runProjectTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => { assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [aborted, rel…`; `assert.ok(f.events.includes('close-attempted'))`.
 */
test('simultaneous task and preparation cleanup failures preserve all causes and the native 503 code', async () => {
  const f = fixture(), aborted = new DOMException('canceled', 'AbortError');
  const critical = new AppError('native original run retained', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  const releaseFailure = new Error('lease release failed'), prepare = f.manager.prepare;
  f.manager.prepare = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`lease`），以 Promise 交付。
   * Result: Return the branch-computed value (`lease`) through a Promise.
   * 验证场景 / Scenario: simultaneous task and preparation cleanup failures preserve all causes and the native 503 code
   * 状态影响 / State effects: `lease.release`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `prepare`.
   */
  async (...args) => {
    const lease = await prepare(...args), release = lease.release;
    lease.release = /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: simultaneous task and preparation cleanup failures preserve all causes and the native 503 code
     * 失败 / Failure: `releaseFailure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `release`.
     */
    () => { release(); throw releaseFailure; }; return lease;
  };
  f.manager.close = /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: simultaneous task and preparation cleanup failures preserve all causes and the native 503 code
   * 失败 / Failure: `critical`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `f.events.push`.
   */
  async () => { f.events.push('close-attempted'); throw critical; };
  f.options.runProjectTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: simultaneous task and preparation cleanup failures preserve all causes and the native 503 code
   * 失败 / Failure: `aborted`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw aborted; };
  await assert.rejects(f.run(), (error: any) => {
    assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [aborted, releaseFailure, critical]);
    assert.equal(error.cause, critical); assert.equal((error as any).status, 503); assert.equal((error as any).code, critical.code); return true;
  });
  assert.ok(f.events.includes('close-attempted'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: real task preparation protects directory edits through UID cleanup and performs no project mkdir or terminal install
 * 状态影响 / State effects: `f.workspaces.beforeConfigChange`, `f.machines.exec`, `f.options.createPreparation`, `f.options.runProjectTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.equal`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.equal(guards.size, 0)`; `assert.equal(admissions, 1)`.
 */
test('real task preparation protects directory edits through UID cleanup and performs no project mkdir or terminal install', async () => {
  const f = fixture(), guards = new Set</**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: id: string; previous: Project; next: Project。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (id: string, previous: Project, next: Project) => Promise<void>>();
  f.workspaces.beforeConfigChange = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: guard: any。
   * 结果：返回分支计算值（`() => guards.delete(guard)`）。
   * Result: Return the branch-computed value (`() => guards.delete(guard)`).
   * 验证场景 / Scenario: real task preparation protects directory edits through UID cleanup and performs no project mkdir or terminal install
   * 协作入口 / Collaborators: `guards.add`.
   */
  (guard: any) => { guards.add(guard); return () => guards.delete(guard); };
  const commands: string[] = [];
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: real task preparation protects directory edits through UID cleanup and performs no project mkdir or terminal install
   * 协作入口 / Collaborators: `commands.push`, `command.includes`, `assert.match`.
   * 检查边界 / Checked boundaries: `assert.match(command, /SAKURA_TASK_DIRECTORY_MISSING/)`.
   */
  async (_id, command) => {
    commands.push(command);
    if (command.includes('project-directory-migrations')) return { code: 0, stdout: 'null\n', stderr: '' };
    assert.match(command, /SAKURA_TASK_DIRECTORY_MISSING/);
    return { code: 0, stdout: '', stderr: '' };
  };
  let admissions = 0;
  f.options.createPreparation = /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`new ProjectTerminals(f.machines, f.workspaces, undefined, { scopes: { assertAdmi…`）。
   * Result: Return the branch-computed value (`new ProjectTerminals(f.machines, f.workspaces, undefined, { scopes: { assertAdmi…`).
   * 验证场景 / Scenario: real task preparation protects directory edits through UID cleanup and performs no project mkdir or terminal install
   */
  () => new ProjectTerminals(f.machines, f.workspaces, undefined, { scopes: {
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: _id: string; scope: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: real task preparation protects directory edits through UID cleanup and performs no project mkdir or terminal install
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(scope, projectId)`.
     */
    assertAdmission: async (_id: string, scope: string) => { assert.equal(scope, projectId); ++admissions; },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: real task preparation protects directory edits through UID cleanup and performs no project mkdir or terminal install
     * 失败 / Failure: `new Error('Task must not use terminal ownership')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    terminalRuns: async () => { throw new Error('Task must not use terminal ownership'); },
  } as any });
  const changed = { ...f.config, directory: '/workspace/other', _workspace: projectId };
  f.options.runProjectTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _machines; _id; captured; execution; signal; _log; timeout; _agent; _cleanup; pins。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: real task preparation protects directory edits through UID cleanup and performs no project mkdir or terminal install
   * 协作入口 / Collaborators: `assert.equal`, `projectIdentityPayload`, `assert.rejects`, `guard`.
   * 检查边界 / Checked boundaries: `assert.equal(captured._workspace, projectId)`; `assert.equal(pins?.expectedLive, f.live)`.
   */
  async (_machines, _id, captured, execution, signal, _log, timeout, _agent, _cleanup, pins) => {
    assert.equal(captured._workspace, projectId); assert.equal(pins?.expectedLive, f.live);
    assert.equal(timeout, 30000); assert.equal(signal.aborted, false); projectIdentityPayload(execution);
    assert.equal(guards.size, 1);
    for (const guard of guards) await assert.rejects(guard(id, f.config, changed), /请先结束/);
    return { code: 0, stdout: '', stderr: '' };
  };
  await f.run(); assert.equal(guards.size, 0); assert.equal(admissions, 1);
  assert.equal(commands.length, 2);
  assert.ok(commands.every((value) => !value.includes("mkdir -p '/workspace/app'")));
  assert.ok(commands.every((value) => !value.includes('install -y tmux') && !value.includes('apk add --no-cache --timeout 30 tmux') && !value.includes('node --check')));
  assert.ok(commands.every((value) => !value.includes('private-diagnostic-token')));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the real missing-directory preparation code rejects before any UID task and removes its temporary guard
 * 状态影响 / State effects: `f.workspaces.beforeConfigChange`, `f.machines.exec`, `f.options.createPreparation`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_DIRECTORY_MISSING')`; `assert.equal(guards, 0)`.
 */
test('the real missing-directory preparation code rejects before any UID task and removes its temporary guard', async () => {
  const f = fixture('host'); let guards = 0;
  f.workspaces.beforeConfigChange = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`() => { --guards; return true; }`）。
   * Result: Return the branch-computed value (`() => { --guards; return true; }`).
   * 验证场景 / Scenario: the real missing-directory preparation code rejects before any UID task and removes its temporary guard
   */
  () => { ++guards; return () => { --guards; return true; }; };
  const commands: string[] = [];
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command。
   * 结果：返回分支计算值（`command.includes('project-directory-migrations') ? { code: 0, stdout: 'null\n', …`），以 Promise 交付。
   * Result: Return the branch-computed value (`command.includes('project-directory-migrations') ? { code: 0, stdout: 'null\n', …`) through a Promise.
   * 验证场景 / Scenario: the real missing-directory preparation code rejects before any UID task and removes its temporary guard
   * 协作入口 / Collaborators: `commands.push`, `command.includes`.
   */
  async (_id, command) => {
    commands.push(command);
    return command.includes('project-directory-migrations') ? { code: 0, stdout: 'null\n', stderr: '' }
      : { code: 74, stdout: '', stderr: 'SAKURA_TASK_DIRECTORY_MISSING: missing original directory' };
  };
  f.options.createPreparation = /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`new ProjectTerminals(f.machines, f.workspaces, undefined, { scopes: { assertAdmi…`）。
   * Result: Return the branch-computed value (`new ProjectTerminals(f.machines, f.workspaces, undefined, { scopes: { assertAdmi…`).
   * 验证场景 / Scenario: the real missing-directory preparation code rejects before any UID task and removes its temporary guard
   */
  () => new ProjectTerminals(f.machines, f.workspaces, undefined,
    { scopes: { /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: the real missing-directory preparation code rejects before any UID task and removes its temporary guard
     */
    assertAdmission: async () => {} } as any });
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_DIRECTORY_MISSING');
  assert.equal(guards, 0); assert.equal(f.launches.length, 0);
  assert.ok(commands.every((value) => !value.includes("mkdir -p '/workspace/app'")));
});
