/**
 * 模块职责：回归验证模块，围绕 `toolchains-identity` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `toolchains-identity`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: tool catalog and public view shape remain compatible while one lease owns the entire probe; all catalog versions and relative markers use the captured descriptor cwd without root wrappers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Toolchains, toolCatalog, type ToolchainsOptions } from '../server/toolchains.ts';
import type { Machines } from '../server/machines.ts';
import { projectSchema, projectVersion, type Project, type Workspaces } from '../server/workspaces.ts';
import { AppError } from '../server/model.ts';
import { Jobs } from '../server/jobs.ts';
import { ProjectIdentities, projectIdentityPayload, type ProjectIdentity, type ProjectIdentityRun } from '../server/project-identity.ts';
import type { ProjectTerminals } from '../server/project-terminals.ts';

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
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `Object.keys(toolCatalog).map(key => `\nSAKURA_TOOL_${key}\n${key === 'php' …`, `Object.keys(toolCatalog).map`, `Object.keys`.
 */
function output(): Output {
  return { code: 0, stderr: '', stdout: Object.keys(toolCatalog).map(key =>
    `\nSAKURA_TOOL_${key}\n${key === 'php' ? '' : key + ' 1.2.3'}\nSAKURA_REQUIRED_${key}\n${['node', 'rust'].includes(key) ? 'yesyes' : ''}\n`).join('') };
}
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: networkIsolation: 'host' | 'private' = 'private'; scope = projectId。
 * 结果：返回受控对象，公开字段包括 `tools, run, options, manager, machines, workspaces, config, live, abort`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `tools, run, options, manager, machines, workspaces, config, live, abort`; the actual branch determines its shape.
 * 状态影响 / State effects: `tools.jobs`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `copyProject`, `projectSchema.parse`.
 */
function fixture(networkIsolation: 'host' | 'private' = 'private', scope = projectId) {
  const context = new AsyncLocalStorage<string>();
  let forcedScope: string | undefined, outsideScope = scope;
  let status = 'running', distro = 'debian', leaseOpen = false, releases = 0, closes = 0, created = 0, resolutions = 0;
  const live = {}, abort = new AbortController(), preparedAbort = new AbortController();
  const config = copyProject(projectSchema.parse({ directory: '/workspace/app', networkIsolation,
    environment: { MODE: 'original', PATH: '/project/runtime/bin:/usr/bin:/bin' }, secrets: { TOKEN: 'toolchain-token' } }),
  scope === 'default' ? undefined : scope);
  const launches: Parameters<NonNullable<ToolchainsOptions['runTask']>>[] = [];
  const installs: Parameters<NonNullable<ToolchainsOptions['runInstallTask']>>[] = [];
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
     * 结果：返回分支计算值（`({ distro })`）。
     * Result: Return the branch-computed value (`({ distro })`).
     */
    get: () => ({ distro }),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('Unexpected direct root command')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `rootCommands.push`.
     */
    exec: async (_id: string, command: string) => { rootCommands.push(command); throw new Error('Unexpected direct root command'); },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('Unexpected direct root input')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    execInput: async () => { throw new Error('Unexpected direct root input'); },
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
       * 输入 / Inputs: _id: string; selected: string; action: () => unknown。
       * 结果：返回分支计算值（`context.run(selected, action)`）。
       * Result: Return the branch-computed value (`context.run(selected, action)`).
       * 协作入口 / Collaborators: `context.run`.
       */
      inScope: (_id: string, selected: string, action: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      () => unknown) => context.run(selected, action),
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
     * 失败 / Failure: `new Error('Selected project reread is forbidden')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    resolvedConfig: async () => { throw new Error('Selected project reread is forbidden'); },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; captured: Project。
     * 结果：返回受控对象，公开字段包括 `_workspace, environment`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `_workspace, environment`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `assert.equal`, `projectVersion`.
     * 检查边界 / Checked boundaries: `assert.equal(captured._workspace || 'default', scope)`; `assert.equal(projectVersion(captured), projectVersion(config))`.
     */
    resolveProject: async (_id: string, captured: Project) => {
      ++resolutions; assert.equal(captured._workspace || 'default', scope);
      assert.equal(projectVersion(captured), projectVersion(config));
      return { ...captured, _workspace: captured._workspace,
        environment: { ...captured.environment, TOKEN: 'private-toolchain-token' } };
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ HTTPS_PROXY: 'http://admin-proxy:3128', https_proxy: 'http://admin-proxy:3128…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ HTTPS_PROXY: 'http://admin-proxy:3128', https_proxy: 'http://admin-proxy:3128…`) through a Promise.
     */
    networkEnvironment: async () => ({ HTTPS_PROXY: 'http://admin-proxy:3128', https_proxy: 'http://admin-proxy:3128' }),
  } as unknown as Workspaces;
  const manager: Pick<ProjectTerminals, 'prepare' | 'close'> = {
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: _id; selected; session; readOnly; signal; _terminalId; mode。
     * 结果：返回受控对象，公开字段包括 `command, projectId, networkIsolation, terminalId, signal, captured, release`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `command, projectId, networkIsolation, terminalId, signal, captured, release`; the actual branch determines its shape.
     * 状态影响 / State effects: `leaseOpen`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `assert.equal`, `assert.deepEqual`, `signal?.throwIfAborted`, `events.push`.
     * 检查边界 / Checked boundaries: `assert.equal(selected, scope)`; `assert.equal(session, null)`.
     */
    prepare: async (_id, selected, session, readOnly, signal, _terminalId, mode) => {
      assert.equal(selected, scope); assert.equal(session, null); assert.equal(readOnly, false);
      assert.deepEqual(mode, { mode: 'task' }); signal?.throwIfAborted(); leaseOpen = true; events.push('prepare');
      return { command: 'unused root terminal command', projectId: scope, networkIsolation, terminalId: undefined,
        signal: AbortSignal.any([signal!, preparedAbort.signal]),
        captured: { project: copyProject(config), configVersion: projectVersion(config), live: live as any },
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
  const options: ToolchainsOptions = {
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
     * 结果：返回分支计算值（`output()`），以 Promise 交付。
     * Result: Return the branch-computed value (`output()`) through a Promise.
     * 协作入口 / Collaborators: `assert.equal`, `assert.ok`, `projectIdentityPayload`, `launches.push`.
     * 检查边界 / Checked boundaries: `assert.equal(transport, machines)`; `assert.equal(vmId, id)`.
     */
    runTask: async (...args) => {
      const [transport, vmId, project, execution, signal, log, timeout, agentPath, afterCleanup, pins] = args;
      assert.equal(transport, machines); assert.equal(vmId, id); assert.equal(project._workspace || 'default', scope);
      assert.ok(leaseOpen); assert.equal(signal.aborted, false); assert.equal(timeout, 20000);
      assert.equal(pins?.expectedLive, live); assert.equal(log, undefined); assert.equal(agentPath, undefined);
      assert.equal(afterCleanup, undefined); projectIdentityPayload(execution); launches.push(args); events.push('uid-start');
      events.push('full-domain-stopped'); events.push('native-ticket-closed'); return output();
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `installs.push`, `args[3].throwIfAborted`, `assert.equal`, `events.push`.
     * 检查边界 / Checked boundaries: `assert.equal(leaseOpen, false)`.
     */
    runInstallTask: async (...args) => {
      installs.push(args); args[3].throwIfAborted(); assert.equal(leaseOpen, false);
      events.push('admin-start'); events.push('admin-full-domain-stopped'); return { code: 0, stdout: '', stderr: '' };
    },
  };
  const tools = new Toolchains(machines, workspaces, options); tools.jobs = new Jobs();
  return { tools, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: signal = abort.signal。
   * 结果：返回分支计算值（`tools.view(id, signal)`）。
   * Result: Return the branch-computed value (`tools.view(id, signal)`).
   * 协作入口 / Collaborators: `tools.view`.
   */
  run: (signal = abort.signal) => tools.view(id, signal), options, manager, machines, workspaces,
    config, live, abort, preparedAbort, launches, installs, events, rootCommands,
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
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`resolutions`）。
     * Result: Return the branch-computed value (`resolutions`).
     */
    resolutions: () => resolutions, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setStatus: (value: string) => { status = value; }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `distro`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setDistro: (value: string) => { distro = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `outsideScope`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    switchOutside: () => { outsideScope = 'fedcba9876543210'; }, /**
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
 * 输入 / Inputs: f: ReturnType<typeof fixture>; value: Output。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 状态影响 / State effects: `f.options.runTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 */
function returning(f: ReturnType<typeof fixture>, value: Output) {
  const launch = f.options.runTask!;
  f.options.runTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`value`），以 Promise 交付。
   * Result: Return the branch-computed value (`value`) through a Promise.
   * 协作入口 / Collaborators: `launch`.
   */
  async (...args) => { await launch(...args); return value; };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: tool catalog and public view shape remain compatible while one lease owns the entire probe
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.deepEqual`, `Object.keys`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(Object.keys(result), ['tools', 'job'])`; `assert.equal(result.job, null)`.
 */
test('tool catalog and public view shape remain compatible while one lease owns the entire probe', async () => {
  const f = fixture(); const result = await f.run();
  assert.deepEqual(Object.keys(result), ['tools', 'job']); assert.equal(result.job, null);
  assert.deepEqual(result.tools.map(tool => tool.id), ['git', 'node', 'python', 'rust', 'go', 'java', 'php']);
  assert.deepEqual(result.tools[1], { id: 'node', name: 'Node.js / npm', installed: true, version: 'node 1.2.3', required: true });
  assert.deepEqual(result.tools.at(-1), { id: 'php', name: 'PHP', installed: false, version: '', required: false });
  assert.equal(f.created(), 1); assert.equal(f.resolutions(), 1); assert.equal(f.launches.length, 1);
  assert.deepEqual(f.events, ['prepare', 'uid-start', 'full-domain-stopped', 'native-ticket-closed', 'release', 'close']);
  assert.equal(f.releases(), 1); assert.equal(f.closes(), 1); assert.deepEqual(f.rootCommands, []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: all catalog versions and relative markers use the captured descriptor cwd without root wrappers
 * 协作入口 / Collaborators: `fixture`, `f.run`, `Object.entries`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(command.includes(`SAKURA_TOOL_${key}`))`; `assert.ok(command.includes(tool.version))`.
 */
test('all catalog versions and relative markers use the captured descriptor cwd without root wrappers', async () => {
  const f = fixture(); await f.run(); const command = f.launches[0][3].command;
  for (const [key, tool] of Object.entries(toolCatalog)) {
    assert.ok(command.includes(`SAKURA_TOOL_${key}`)); assert.ok(command.includes(tool.version));
    for (const marker of tool.markers) assert.ok(command.includes(`test ! -e '${marker}' || printf yes`));
  }
  assert.doesNotMatch(command, /\/workspace\/app|\bcd\b|ip netns exec|sh -lc|mkdir|chown/);
  assert.equal(f.launches[0][3].environment?.PATH, '/project/runtime/bin:/usr/bin:/bin');
  assert.equal('HOME' in f.launches[0][3].environment!, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: named scope survives non-enumerable config capture and concurrent outside project selection
 * 状态影响 / State effects: `f.workspaces.config`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.equal`, `Object.getOwnPropertyDescriptor`.
 * 检查边界 / Checked boundaries: `assert.equal(captured._workspace, projectId)`; `assert.equal(Object.getOwnPropertyDescriptor(captured, '_workspace')?.enumerable, false)`.
 */
test('named scope survives non-enumerable config capture and concurrent outside project selection', async () => {
  const f = fixture(), read = f.workspaces.config;
  f.workspaces.config = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`read(...args)`），以 Promise 交付。
   * Result: Return the branch-computed value (`read(...args)`) through a Promise.
   * 验证场景 / Scenario: named scope survives non-enumerable config capture and concurrent outside project selection
   * 协作入口 / Collaborators: `Promise.resolve`, `f.switchOutside`, `read`.
   */
  async (...args) => { await Promise.resolve(); f.switchOutside(); return read(...args); };
  await f.run(); const captured = f.launches[0][2];
  assert.equal(captured._workspace, projectId);
  assert.equal(Object.getOwnPropertyDescriptor(captured, '_workspace')?.enumerable, false);
  assert.equal(f.workspaces.projects.current(id), 'fedcba9876543210');
  assert.equal(projectVersion(captured), projectVersion(f.config));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: host/private/default tasks preserve identity binding and keep body/secrets out of root argv
 * 协作入口 / Collaborators: `fixture`, `f.run`, `identityId.replaceAll('-', '').slice`, `identityId.replaceAll`.
 * 检查边界 / Checked boundaries: `assert.equal(project.networkIsolation, mode)`; `assert.equal(project._workspace || 'default', scope)`.
 */
test('host/private/default tasks preserve identity binding and keep body/secrets out of root argv', async () => {
  for (const mode of ['host', 'private'] as const) for (const scope of [projectId, 'default']) {
    const f = fixture(mode, scope); await f.run(); const [, , project, execution] = f.launches[0];
    const identityId = '22222222-2222-4222-8222-222222222222', runId = '33333333-3333-4333-8333-333333333333';
    const identity: ProjectIdentity = { version: 1, phase: 'active', registryId: '44444444-4444-4444-8444-444444444444',
      projectId: scope, identityId, revision: 1, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid: 22000, gid: 22000,
      home: '/var/lib/sakura-project-homes/' + identityId, directory: project.directory, networkIsolation: mode,
      homeDevice: '1', homeInode: '2', directoryDevice: '1', directoryInode: '3' };
    const run: ProjectIdentityRun = { version: 1, phase: 'active', mode: 'inherit-current', registryId: identity.registryId,
      identityId, projectId: scope, runId, revision: 1, bootId: '55555555-5555-4555-8555-555555555555', build: 'a'.repeat(64),
      networkDevice: '1', networkInode: '4', cgroupDevice: '1', cgroupInode: '5', cgroupName: 'sakura-task-' + runId,
      namespace: mode === 'private' ? 'sk-' + scope : '' };
    const frame = new ProjectIdentities(f.machines).input(identity, run, execution);
    assert.equal(project.networkIsolation, mode); assert.equal(project._workspace || 'default', scope);
    assert.ok(!frame.command.includes(execution.command)); assert.ok(!frame.command.includes('private-toolchain-token'));
    assert.ok(frame.input.includes(Buffer.from(execution.command))); assert.ok(frame.input.includes(Buffer.from('private-toolchain-token')));
    assert.equal(frame.input.readUInt32LE(12), 0); assert.equal(frame.input.readUInt32LE(24), Buffer.byteLength(execution.command));
    assert.deepEqual(f.rootCommands, []);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: capture is detached from the first config object before preparation starts
 * 状态影响 / State effects: `f.workspaces.config`, `f.manager.prepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(f.launches[0][2].directory, '/workspace/app')`.
 */
test('capture is detached from the first config object before preparation starts', async () => {
  const f = fixture(), read = f.workspaces.config; let original: Project | undefined;
  f.workspaces.config = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`value`），以 Promise 交付。
   * Result: Return the branch-computed value (`value`) through a Promise.
   * 验证场景 / Scenario: capture is detached from the first config object before preparation starts
   * 状态影响 / State effects: `original`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `read`.
   */
  async (...args) => { const value = await read(...args); original ||= value; return value; };
  const prepare = f.manager.prepare;
  f.manager.prepare = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`prepare(...args)`），以 Promise 交付。
   * Result: Return the branch-computed value (`prepare(...args)`) through a Promise.
   * 验证场景 / Scenario: capture is detached from the first config object before preparation starts
   * 状态影响 / State effects: `original!.directory`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `prepare`.
   */
  async (...args) => { original!.directory = '/workspace/foreign'; return prepare(...args); };
  await f.run(); assert.equal(f.launches[0][2].directory, '/workspace/app');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: wrong preparation project/config/live proof prevents any UID command
 * 状态影响 / State effects: `f.manager.prepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.launches.length, 0)`.
 */
test('wrong preparation project/config/live proof prevents any UID command', async () => {
  for (const field of ['scope', 'config', 'live', 'missing'] as const) {
    const f = fixture(), prepare = f.manager.prepare;
    f.manager.prepare = /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`lease`），以 Promise 交付。
     * Result: Return the branch-computed value (`lease`) through a Promise.
     * 验证场景 / Scenario: wrong preparation project/config/live proof prevents any UID command
     * 状态影响 / State effects: `lease.projectId`, `lease.captured!.configVersion`, `lease.captured!.live`, `lease.captured`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `prepare`.
     */
    async (...args) => {
      const lease = await prepare(...args);
      if (field === 'scope') lease.projectId = 'fedcba9876543210';
      if (field === 'config') lease.captured!.configVersion = 'different';
      if (field === 'live') lease.captured!.live = {} as any;
      if (field === 'missing') lease.captured = undefined;
      return lease;
    };
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
 * 验证场景 / Scenario: original live and config changes during environment resolution never chase a replacement
 * 状态影响 / State effects: `f.workspaces.resolveProject`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.launches.length, 0)`.
 */
test('original live and config changes during environment resolution never chase a replacement', async () => {
  for (const field of ['live', 'directory', 'scope', 'mode'] as const) {
    const f = fixture(), resolve = f.workspaces.resolveProject;
    f.workspaces.resolveProject = /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`resolved`），以 Promise 交付。
     * Result: Return the branch-computed value (`resolved`) through a Promise.
     * 验证场景 / Scenario: original live and config changes during environment resolution never chase a replacement
     * 状态影响 / State effects: `f.config.directory`, `resolved.networkIsolation`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `resolve`, `f.machines.live.set`, `f.forceScope`.
     */
    async (...args) => {
      const resolved = await resolve(...args);
      if (field === 'live') f.machines.live.set(id, {} as any);
      if (field === 'directory') f.config.directory = '/workspace/new';
      if (field === 'scope') f.forceScope();
      if (field === 'mode') resolved.networkIsolation = 'host';
      return resolved;
    };
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.launches.length, 0); assert.equal(f.resolutions(), 1); assert.equal(f.releases(), 1);
    assert.deepEqual(f.rootCommands, []);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a completed task cannot publish output for changed original config/live or an aborted request
 * 状态影响 / State effects: `f.options.runTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED' || error.name === 'AbortError')`; `assert.equal(f.releases(), 1)`.
 */
test('a completed task cannot publish output for changed original config/live or an aborted request', async () => {
  for (const field of ['live', 'config', 'abort'] as const) {
    const f = fixture(), launch = f.options.runTask!;
    f.options.runTask = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`result`），以 Promise 交付。
     * Result: Return the branch-computed value (`result`) through a Promise.
     * 验证场景 / Scenario: a completed task cannot publish output for changed original config/live or an aborted request
     * 状态影响 / State effects: `f.config.environment!.MODE`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `launch`, `f.machines.live.set`, `f.abort.abort`.
     */
    async (...args) => {
      const result = await launch(...args);
      if (field === 'live') f.machines.live.set(id, {} as any);
      if (field === 'config') f.config.environment!.MODE = 'changed';
      if (field === 'abort') f.abort.abort();
      return result;
    };
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED' || error.name === 'AbortError');
    assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: stopped, missing, cancelled and unknown tasks do not get a root fallback or implicit directory migration
 * 状态影响 / State effects: `f.manager.prepare`, `f.options.runTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.setStatus`, `f.machines.live.delete`, `f.abort.abort`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run())`; `assert.deepEqual(f.rootCommands, [])`.
 */
test('stopped, missing, cancelled and unknown tasks do not get a root fallback or implicit directory migration', async () => {
  for (const field of ['stopped', 'live', 'cancelled', 'missing-directory', 'unknown'] as const) {
    const f = fixture();
    if (field === 'stopped') f.setStatus('stopped');
    if (field === 'live') f.machines.live.delete(id);
    if (field === 'cancelled') f.abort.abort();
    if (field === 'missing-directory') f.manager.prepare = /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: stopped, missing, cancelled and unknown tasks do not get a root fallback or implicit directory migration
     * 失败 / Failure: `new AppError('explicit migration required', 409, 'PROJECT_IDENTITY_DIRECTORY_MISSING')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    async () => {
      throw new AppError('explicit migration required', 409, 'PROJECT_IDENTITY_DIRECTORY_MISSING');
    };
    if (field === 'unknown') f.options.runTask = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: stopped, missing, cancelled and unknown tasks do not get a root fallback or implicit directory migration
     * 失败 / Failure: `new Error('native outcome unknown')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    async () => { throw new Error('native outcome unknown'); };
    await assert.rejects(f.run()); assert.deepEqual(f.rootCommands, []); assert.equal(f.installs.length, 0);
    if (field === 'missing-directory') { assert.equal(f.resolutions(), 0); assert.equal(f.closes(), 1); }
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: prepared cancellation propagates to the UID transport and still releases the original lease
 * 状态影响 / State effects: `f.options.runTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), error => error === f.preparedAbort.signal.reason)`; `assert.equal(f.releases(), 1)`.
 */
test('prepared cancellation propagates to the UID transport and still releases the original lease', async () => {
  const f = fixture();
  f.options.runTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`output()`），以 Promise 交付。
   * Result: Return the branch-computed value (`output()`) through a Promise.
   * 验证场景 / Scenario: prepared cancellation propagates to the UID transport and still releases the original lease
   * 协作入口 / Collaborators: `f.preparedAbort.abort`, `args[4].throwIfAborted`, `output`.
   */
  async (...args) => { f.preparedAbort.abort(); args[4].throwIfAborted(); return output(); };
  await assert.rejects(f.run(), error => error === f.preparedAbort.signal.reason);
  assert.equal(f.releases(), 1); assert.equal(f.closes(), 1); assert.deepEqual(f.rootCommands, []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: display versions and errors hide resolved project secrets while raw parsing retains marker semantics
 * 状态影响 / State effects: `unknown.options.runTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `returning`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.tools[0].version, '[私密配置已隐藏] version')`; `assert.equal(result.tools[0].installed, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('display versions and errors hide resolved project secrets while raw parsing retains marker semantics', async () => {
  const f = fixture(); returning(f, { code: 0, stderr: '', stdout:
    '\nSAKURA_TOOL_git\nprivate-toolchain-token version\nSAKURA_REQUIRED_git\nyes\n' });
  const result = await f.run(); assert.equal(result.tools[0].version, '[私密配置已隐藏] version');
  assert.equal(result.tools[0].installed, true); assert.equal(result.tools[0].required, true);
  assert.ok(!JSON.stringify(result).includes('private-toolchain-token'));
  const bad = fixture(); returning(bad, { code: 7, stderr: 'failure private-toolchain-token', stdout: '' });
  await assert.rejects(bad.run(), (error: any) => error.message === 'failure [私密配置已隐藏]');
  const unknown = fixture(); unknown.options.runTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: display versions and errors hide resolved project secrets while raw parsing retains marker semantics
   * 失败 / Failure: `new Error('transport private-toolchain-token')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw new Error('transport private-toolchain-token'); };
  await assert.rejects(unknown.run(), (error: any) => error.message === 'transport [私密配置已隐藏]');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: input/output bounds and invalid task replies fail explicitly without partial parsing or root execution
 * 状态影响 / State effects: `oversized.config.environment!.LARGE`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `'x'.repeat`, `assert.rejects`, `oversized.run`.
 * 检查边界 / Checked boundaries: `assert.rejects(oversized.run(), (error: any) => error.status === 413 && error.code === 'PROJECT_IDENTITY_PAYLOAD_INVALID')`; `assert.equal(oversized.launches.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('input/output bounds and invalid task replies fail explicitly without partial parsing or root execution', async () => {
  const oversized = fixture();
  oversized.config.environment!.LARGE = 'x'.repeat(8193);
  await assert.rejects(oversized.run(), (error: any) => error.status === 413 && error.code === 'PROJECT_IDENTITY_PAYLOAD_INVALID');
  assert.equal(oversized.launches.length, 0); assert.equal(oversized.releases(), 1);
  const bytes = fixture(); returning(bytes, { code: 0, stdout: '界'.repeat(400000), stderr: '' });
  await assert.rejects(bytes.run(), (error: any) => error.status === 413 && error.code === 'TOOLCHAIN_OUTPUT_TOO_LARGE');
  const invalid = fixture(); returning(invalid, { code: NaN, stdout: '', stderr: '' });
  await assert.rejects(invalid.run(), (error: any) => error.status === 502 && error.code === 'TOOLCHAIN_TASK_RESULT_INVALID');
  assert.deepEqual(oversized.rootCommands, []); assert.deepEqual(bytes.rootCommands, []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: frozen errors with resolved secrets retain status/code and the original cause without exposing their message
 * 状态影响 / State effects: `f.options.runTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `Object.freeze`, `assert.rejects`, `f.run`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => { assert.ok(error instanceof AppError); assert.equal(error.status, 503); assert.equal(erro…`; `assert.equal(f.releases(), 1)`.
 */
test('frozen errors with resolved secrets retain status/code and the original cause without exposing their message', async () => {
  const f = fixture(), original = Object.freeze(new AppError('failure private-toolchain-token', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'));
  f.options.runTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: frozen errors with resolved secrets retain status/code and the original cause without exposing their message
   * 失败 / Failure: `original`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw original; };
  await assert.rejects(f.run(), (error: any) => {
    assert.ok(error instanceof AppError); assert.equal(error.status, 503); assert.equal(error.code, original.code);
    assert.equal(error.message, 'failure [私密配置已隐藏]'); assert.equal(error.cause, original); return true;
  });
  assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: native cleanup 503 stays the original error and simultaneous preparation failures retain every cause
 * 状态影响 / State effects: `single.options.runTask`, `all.options.runTask`, `all.manager.prepare`, `all.manager.close`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `single.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(single.run(), error => error === cleanup)`; `assert.equal(single.releases(), 1)`.
 */
test('native cleanup 503 stays the original error and simultaneous preparation failures retain every cause', async () => {
  const single = fixture(), cleanup = new AppError('native full domain unconfirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  single.options.runTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: native cleanup 503 stays the original error and simultaneous preparation failures retain every cause
   * 失败 / Failure: `cleanup`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw cleanup; };
  await assert.rejects(single.run(), error => error === cleanup);
  assert.equal(single.releases(), 1); assert.equal(single.closes(), 1);
  const all = fixture(), release = new Error('lease release failed'), closing = new Error('manager close failed');
  all.options.runTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: native cleanup 503 stays the original error and simultaneous preparation failures retain every cause
   * 失败 / Failure: `cleanup`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw cleanup; };
  const prepare = all.manager.prepare;
  all.manager.prepare = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`prepared`），以 Promise 交付。
   * Result: Return the branch-computed value (`prepared`) through a Promise.
   * 验证场景 / Scenario: native cleanup 503 stays the original error and simultaneous preparation failures retain every cause
   * 状态影响 / State effects: `prepared.release`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `prepare`.
   */
  async (...args) => {
    const prepared = await prepare(...args);
    prepared.release = /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: native cleanup 503 stays the original error and simultaneous preparation failures retain every cause
     * 失败 / Failure: `release`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `all.events.push`.
     */
    () => { all.events.push('release-failed'); throw release; };
    return prepared;
  };
  all.manager.close = /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: native cleanup 503 stays the original error and simultaneous preparation failures retain every cause
   * 失败 / Failure: `closing`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `all.events.push`.
   */
  async () => { all.events.push('close-failed'); throw closing; };
  await assert.rejects(all.run(), (error: any) => {
    assert.ok(error instanceof AppError); assert.equal(error.status, 503); assert.equal(error.code, cleanup.code);
    assert.equal(error.cause, cleanup);
    assert.deepEqual((error as AppError & { errors: unknown[] }).errors, [cleanup, release, closing]); return true;
  });
  assert.deepEqual(all.events, ['prepare', 'release-failed', 'close-failed']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: successful task results do not hide lease or manager cleanup failure
 * 状态影响 / State effects: `f.manager.prepare`, `f.manager.close`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.status === 503 && error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED' && error.errors.l…`; `assert.ok(f.events.includes('native-ticket-closed'))`.
 */
test('successful task results do not hide lease or manager cleanup failure', async () => {
  const f = fixture(), prepare = f.manager.prepare;
  f.manager.prepare = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`lease`），以 Promise 交付。
   * Result: Return the branch-computed value (`lease`) through a Promise.
   * 验证场景 / Scenario: successful task results do not hide lease or manager cleanup failure
   * 状态影响 / State effects: `lease.release`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `prepare`.
   */
  async (...args) => { const lease = await prepare(...args); lease.release = /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: successful task results do not hide lease or manager cleanup failure
   * 失败 / Failure: `new Error('lease')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  () => { throw new Error('lease'); }; return lease; };
  f.manager.close = /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: successful task results do not hide lease or manager cleanup failure
   * 失败 / Failure: `new Error('manager')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `f.events.push`.
   */
  async () => { f.events.push('close-failed'); throw new Error('manager'); };
  await assert.rejects(f.run(), (error: any) => error.status === 503 && error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED' && error.errors.length === 2);
  assert.ok(f.events.includes('native-ticket-closed')); assert.ok(f.events.includes('close-failed'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: close waits for full pending task cleanup and preserves unconfirmed cleanup errors
 * 状态影响 / State effects: `f.options.runTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.run`, `pending.catch`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.tools.close(), error => error === cleanup)`; `assert.ok(error instanceof Error)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('close waits for full pending task cleanup and preserves unconfirmed cleanup errors', async () => {
  for (const unconfirmed of [false, true]) {
    const f = fixture(); let started!: /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    const cleanup = new AppError('full domain unconfirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    f.options.runTask = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`output()`），以 Promise 交付。
     * Result: Return the branch-computed value (`output()`) through a Promise.
     * 验证场景 / Scenario: close waits for full pending task cleanup and preserves unconfirmed cleanup errors
     * 失败 / Failure: `cleanup`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `assert.ok`, `f.leaseOpen`, `started`, `f.events.push`.
     * 检查边界 / Checked boundaries: `assert.ok(f.leaseOpen())`; `assert.ok(f.leaseOpen())`.
     */
    async (...args) => {
      assert.ok(f.leaseOpen()); started();
      await new Promise<void>(resolve => args[4].addEventListener('abort', () => resolve(), { once: true }));
      assert.ok(f.leaseOpen()); f.events.push('full-domain-cleanup');
      if (unconfirmed) throw cleanup;
      args[4].throwIfAborted(); return output();
    };
    const pending = f.run(); const handled = pending.catch(error => error); await ready;
    if (unconfirmed) await assert.rejects(f.tools.close(), error => error === cleanup); else await f.tools.close();
    const error = await handled; assert.ok(error instanceof Error);
    assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
    assert.ok(f.events.indexOf('release') > f.events.indexOf('full-domain-cleanup'));
    await assert.rejects(f.run(), (error: any) => error.name === 'AbortError');
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: administrator installs keep catalog package selection and fixed env/cwd with proxy data on stdin
 * 状态影响 / State effects: `f.workspaces.config`, `f.workspaces.resolveProject`, `f.workspaces.networkEnvironment`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.setDistro`, `f.tools.install`, `f.tools.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'done')`; `assert.equal(job.key, id)`.
 */
test('administrator installs keep catalog package selection and fixed env/cwd with proxy data on stdin', async () => {
  for (const distro of ['alpine', 'debian', 'ubuntu']) {
    const f = fixture(); f.setDistro(distro);
    f.workspaces.config = /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: administrator installs keep catalog package selection and fixed env/cwd with proxy data on stdin
     * 失败 / Failure: `new Error('Administrator install must not load project config')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    async () => { throw new Error('Administrator install must not load project config'); };
    f.workspaces.resolveProject = /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: administrator installs keep catalog package selection and fixed env/cwd with proxy data on stdin
     * 失败 / Failure: `new Error('Administrator install must not resolve project env')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    async () => { throw new Error('Administrator install must not resolve project env'); };
    f.workspaces.networkEnvironment = /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ HTTPS_PROXY: 'http://admin-proxy:3128', https_proxy: 'http://admin-proxy:3128…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ HTTPS_PROXY: 'http://admin-proxy:3128', https_proxy: 'http://admin-proxy:3128…`) through a Promise.
     * 验证场景 / Scenario: administrator installs keep catalog package selection and fixed env/cwd with proxy data on stdin
     */
    async () => ({ HTTPS_PROXY: 'http://admin-proxy:3128',
      https_proxy: 'http://admin-proxy:3128', PATH: '/workspace/hostile', HOME: '/workspace/hostile',
      APT_CONFIG: '/workspace/hostile/apt.conf', ENV: '/workspace/hostile/.shrc',
      LD_PRELOAD: '/workspace/hostile/preload.so', PYTHONPATH: '/workspace/hostile', NPM_CONFIG_REGISTRY: 'http://unused' });
    const job = await f.tools.install(id, { tools: ['git', 'python', 'git'] }); await f.tools.jobs.wait(id);
    assert.equal(job.status, 'done'); assert.equal(job.key, id); assert.equal(f.installs.length, 1); assert.equal(f.created(), 0);
    const [, , command, , , , , , options] = f.installs[0], body = options!.input!.toString();
    assert.match(command, /^exec \/usr\/bin\/env -i PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin HOME=\/ USER=root LOGNAME=root LANG=C LC_ALL=C \/bin\/sh -eu -s$/);
    assert.ok(!command.includes('admin-proxy')); assert.match(body, /^set -eu\ncd \/\n/);
    assert.ok(body.includes("export HTTPS_PROXY='http://admin-proxy:3128'"));
    assert.doesNotMatch(body, /hostile|NPM_CONFIG_REGISTRY|LD_PRELOAD|PYTHONPATH|APT_CONFIG/);
    assert.ok(body.includes(distro === 'alpine' ? '/sbin/apk add --no-cache --timeout 30 git python3 py3-pip' :
      '/usr/bin/apt-get -y install git python3 python3-pip python3-venv'));
    // The shell owns its bounded stdin body; package helpers must not consume
    // later script lines while installation is running.
    assert.equal(body.match(/<\/dev\/null/g)?.length, distro === 'alpine' ? 1 : 2);
    assert.deepEqual(f.rootCommands, []);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: administrator environment quoting and log redaction work across chunks and reject oversized/NUL values
 * 状态影响 / State effects: `f.workspaces.networkEnvironment`, `f.options.runInstallTask`, `invalid.workspaces.networkEnvironment`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.tools.install`, `f.tools.jobs.wait`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'done')`; `assert.ok(job.log.includes('[私密配置已隐藏]'))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('administrator environment quoting and log redaction work across chunks and reject oversized/NUL values', async () => {
  const f = fixture(), proxy = "http://user:private-proxy-token@proxy/$(touch /root/marker)'";
  f.workspaces.networkEnvironment = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ HTTPS_PROXY: proxy })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ HTTPS_PROXY: proxy })`) through a Promise.
   * 验证场景 / Scenario: administrator environment quoting and log redaction work across chunks and reject oversized/NUL values
   */
  async () => ({ HTTPS_PROXY: proxy });
  f.options.runInstallTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: administrator environment quoting and log redaction work across chunks and reject oversized/NUL values
   * 协作入口 / Collaborators: `f.installs.push`, `args[4]!`, `proxy.slice`.
   */
  async (...args) => {
    f.installs.push(args); args[4]!('error ' + proxy.slice(0, 20)); args[4]!(proxy.slice(20) + '\n');
    return { code: 0, stdout: '', stderr: '' };
  };
  const job = await f.tools.install(id, { tools: ['node'] }); await f.tools.jobs.wait(id);
  assert.equal(job.status, 'done'); assert.ok(job.log.includes('[私密配置已隐藏]')); assert.ok(!job.log.includes('private-proxy-token'));
  assert.ok(!f.installs[0][2].includes(proxy));
  assert.ok(f.installs[0][8]!.input!.toString().includes("'\\''"));
  for (const value of ['x'.repeat(16385), 'nul\0value']) {
    const invalid = fixture(); invalid.workspaces.networkEnvironment = /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ HTTPS_PROXY: value })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ HTTPS_PROXY: value })`) through a Promise.
     * 验证场景 / Scenario: administrator environment quoting and log redaction work across chunks and reject oversized/NUL values
     */
    async () => ({ HTTPS_PROXY: value });
    await assert.rejects(invalid.tools.install(id, { tools: ['git'] }), (error: any) => error.status === 413 && error.code === 'GUEST_INPUT_INVALID');
    assert.equal(invalid.installs.length, 0); assert.equal(invalid.tools.jobs.list().length, 0);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: administrator install pins original Live/distro before async network resolution and accepted job execution
 * 状态影响 / State effects: `stale.workspaces.networkEnvironment`, `distro.workspaces.networkEnvironment`, `Jobs.instrument`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `stale.tools.install`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(stale.tools.install(id, { tools: ['git'] }), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(stale.installs.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('administrator install pins original Live/distro before async network resolution and accepted job execution', async () => {
  const stale = fixture(); stale.workspaces.networkEnvironment = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
   * 验证场景 / Scenario: administrator install pins original Live/distro before async network resolution and accepted job execution
   * 协作入口 / Collaborators: `stale.machines.live.set`.
   */
  async () => { stale.machines.live.set(id, {} as any); return {}; };
  await assert.rejects(stale.tools.install(id, { tools: ['git'] }), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(stale.installs.length, 0); assert.equal(stale.tools.jobs.list().length, 0);
  const distro = fixture(); distro.workspaces.networkEnvironment = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 ``；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as ``; the actual branch determines its shape.
   * 验证场景 / Scenario: administrator install pins original Live/distro before async network resolution and accepted job execution
   * 协作入口 / Collaborators: `distro.setDistro`.
   */
  async () => { distro.setDistro('alpine'); return {}; };
  const job = await distro.tools.install(id, { tools: ['git'] }); await distro.tools.jobs.wait(id);
  assert.equal(job.status, 'done'); assert.ok(distro.installs[0][8]!.input!.includes(Buffer.from('/usr/bin/apt-get')));
  const accepted = fixture();
  Jobs.instrument = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: _view; work。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: administrator install pins original Live/distro before async network resolution and accepted job execution
   * 协作入口 / Collaborators: `accepted.machines.live.set`, `work`.
   */
  async (_view, work) => { accepted.machines.live.set(id, {} as any); await work(); };
  try {
    const pending = await accepted.tools.install(id, { tools: ['git'] }); await accepted.tools.jobs.wait(id);
    assert.equal(pending.status, 'error'); assert.equal(pending.errorCode, 'PROJECT_IDENTITY_HOST_CHANGED'); assert.equal(accepted.installs.length, 0);
  } finally { Jobs.instrument = undefined; }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: administrator cleanup 503 remains a durable error even when the job was cancelled
 * 状态影响 / State effects: `f.options.runInstallTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.tools.install`, `f.tools.jobs.cancel`, `f.tools.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal(job.errorCode, 'GUEST_TASK_CLEANUP_FAILED')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('administrator cleanup 503 remains a durable error even when the job was cancelled', async () => {
  const f = fixture(); let started!: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  f.options.runInstallTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: administrator cleanup 503 remains a durable error even when the job was cancelled
   * 失败 / Failure: `new AppError('administrator cgroup cleanup unconfirmed', 503, 'GUEST_TASK_CLEANUP_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `started`.
   */
  async (...args) => {
    started(); await new Promise<void>(resolve => args[3].addEventListener('abort', () => resolve(), { once: true }));
    throw new AppError('administrator cgroup cleanup unconfirmed', 503, 'GUEST_TASK_CLEANUP_FAILED');
  };
  const job = await f.tools.install(id, { tools: ['git'] }); await ready; f.tools.jobs.cancel(job.id!); await f.tools.jobs.wait(id);
  assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'GUEST_TASK_CLEANUP_FAILED');
  assert.deepEqual(f.rootCommands, []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: invalid tool input and stopped or missing original administrator instances do not launch a job
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `invalid.tools.install`, `f.setStatus`.
 * 检查边界 / Checked boundaries: `assert.rejects(invalid.tools.install(id, value))`; `assert.rejects(f.tools.install(id, { tools: ['git'] }))`.
 */
test('invalid tool input and stopped or missing original administrator instances do not launch a job', async () => {
  const invalid = fixture();
  for (const value of [{ tools: [] }, { tools: ['unknown'] }, { tools: ['git'], command: 'hostile' }])
    await assert.rejects(invalid.tools.install(id, value));
  for (const field of ['stopped', 'live'] as const) {
    const f = fixture(); if (field === 'stopped') f.setStatus('stopped'); else f.machines.live.delete(id);
    await assert.rejects(f.tools.install(id, { tools: ['git'] })); assert.equal(f.tools.jobs.list().length, 0);
  }
  assert.equal(invalid.installs.length, 0); assert.equal(invalid.created(), 0);
});
