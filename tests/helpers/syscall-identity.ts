/**
 * 模块职责：共享测试夹具模块，围绕 `helpers/syscall-identity` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Shared test fixture for `helpers/syscall-identity`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 */
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Machines } from '../../server/machines.ts';
import { projectSchema, projectVersion, type Project, type Workspaces } from '../../server/workspaces.ts';
import type { ProjectTerminals } from '../../server/project-terminals.ts';
import { projectIdentityPayload } from '../../server/project-identity.ts';
import type { SyscallProjectTaskOptions } from '../../server/syscall-project-task.ts';
import { runSyscallProfile } from '../../server/syscall-profile.ts';

export const syscallVmId = '11111111-1111-4111-8111-111111111111';
export const syscallProjectId = '0123456789abcdef';
/**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: project: Project; scope = project._workspace。
 * 结果：返回分支计算值（`Object.defineProperty(structuredClone(project), '_workspace', { value: scope, en…`）。
 * Result: Return the branch-computed value (`Object.defineProperty(structuredClone(project), '_workspace', { value: scope, en…`).
 * 协作入口 / Collaborators: `Object.defineProperty`, `structuredClone`.
 */
export const copySyscallProject = (project: Project, scope = project._workspace) =>
  Object.defineProperty(structuredClone(project), '_workspace', { value: scope, enumerable: false });

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: networkIsolation: 'host' | 'private' = 'private'。
 * 结果：返回受控对象，公开字段包括 `machines, workspaces, manager, options, run, project, live, abort, rootCommands`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, workspaces, manager, options, run, project, live, abort, rootCommands`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `copySyscallProject`, `projectSchema.parse`.
 */
export function syscallIdentityFixture(networkIsolation: 'host' | 'private' = 'private') {
  const context = new AsyncLocalStorage<string>(), live = {}, abort = new AbortController();
  let outside = syscallProjectId, forced: string | undefined, state = 'running';
  let leaseOpen = false, releases = 0, closes = 0, resolves = 0;
  const project = copySyscallProject(projectSchema.parse({ directory: '/workspace/limited', networkIsolation,
    environment: { MODE: 'original', PATH: '/workspace/tools' }, secrets: { TOKEN: 'seccomp-key' } }), syscallProjectId);
  const rootCommands: string[] = [], events: string[] = [];
  const launches: Parameters<NonNullable<SyscallProjectTaskOptions['runProjectTask']>>[] = [];
  const machines = {
    live: new Map([[syscallVmId, live]]), /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`state`）。
     * Result: Return the branch-computed value (`state`).
     */
    state: () => state, /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ distro: 'alpine' })`）。
     * Result: Return the branch-computed value (`({ distro: 'alpine' })`).
     */
    get: () => ({ distro: 'alpine' }),
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
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `rootCommands.push`, `events.push`.
     */
    exec: async (_id: string, command: string) => {
      rootCommands.push(command); events.push('admin-status'); return { code: 0, stdout: '', stderr: '' };
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('Unexpected direct root input command')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    execInput: async () => { throw new Error('Unexpected direct root input command'); },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('Unexpected administrator project file write')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    writeGuestFile: async () => { throw new Error('Unexpected administrator project file write'); },
  } as unknown as Machines;
  const workspaces = {
    projects: {
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`forced || context.getStore() || outside`）。
       * Result: Return the branch-computed value (`forced || context.getStore() || outside`).
       * 协作入口 / Collaborators: `context.getStore`.
       */
      current: () => forced || context.getStore() || outside,
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
     * 结果：返回分支计算值（`copySyscallProject(project)`），以 Promise 交付。
     * Result: Return the branch-computed value (`copySyscallProject(project)`) through a Promise.
     * 协作入口 / Collaborators: `copySyscallProject`.
     */
    config: async () => copySyscallProject(project),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('Selected config must not be reread')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    resolvedConfig: async () => { throw new Error('Selected config must not be reread'); },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; captured: Project。
     * 结果：返回分支计算值（`copySyscallProject({ ...captured, environment: { ...captured.environment, TOKEN:…`），以 Promise 交付。
     * Result: Return the branch-computed value (`copySyscallProject({ ...captured, environment: { ...captured.environment, TOKEN:…`) through a Promise.
     * 协作入口 / Collaborators: `assert.equal`, `projectVersion`, `copySyscallProject`.
     * 检查边界 / Checked boundaries: `assert.equal(captured._workspace, syscallProjectId)`; `assert.equal(projectVersion(captured), projectVersion(project))`.
     */
    resolveProject: async (_id: string, captured: Project) => {
      ++resolves; assert.equal(captured._workspace, syscallProjectId);
      assert.equal(projectVersion(captured), projectVersion(project));
      return copySyscallProject({ ...captured, environment: { ...captured.environment, TOKEN: 'seccomp-private-value' } }, captured._workspace);
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
     * 检查边界 / Checked boundaries: `assert.equal(scope, syscallProjectId)`; `assert.equal(session, null)`.
     */
    prepare: async (_id, scope, session, readOnly, signal, _terminalId, mode) => {
      assert.equal(scope, syscallProjectId); assert.equal(session, null); assert.equal(readOnly, false);
      assert.deepEqual(mode, { mode: 'task' }); signal?.throwIfAborted(); leaseOpen = true; events.push('prepare');
      return { command: 'unused', projectId: syscallProjectId, networkIsolation, terminalId: undefined,
        signal: signal!, captured: { project: copySyscallProject(project), configVersion: projectVersion(project), live: live as any },
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
  const options: SyscallProjectTaskOptions = {
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`manager`）。
     * Result: Return the branch-computed value (`manager`).
     */
    createPreparation: () => manager,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `assert.equal`, `assert.ok`, `projectVersion`, `projectIdentityPayload`.
     * 检查边界 / Checked boundaries: `assert.equal(transport, machines)`; `assert.equal(vmId, syscallVmId)`.
     */
    runProjectTask: async (...args) => {
      const [transport, vmId, captured, execution, signal, log, timeout, agentPath, afterCleanup, pins] = args;
      assert.equal(transport, machines); assert.equal(vmId, syscallVmId); assert.equal(captured._workspace, syscallProjectId);
      assert.ok(leaseOpen); assert.equal(projectVersion(captured), projectVersion(project));
      assert.equal(signal.aborted, false); assert.ok(timeout! >= 16000 && timeout! <= 315000);
      assert.equal(pins?.expectedLive, live); assert.equal(log, undefined); assert.equal(agentPath, undefined); assert.equal(afterCleanup, undefined);
      projectIdentityPayload(execution); launches.push(args); events.push('uid-start');
      events.push('domain-stopped'); events.push('native-closed');
      return { code: 7, stdout: 'seccomp-private-value output', stderr: 'seccomp-private-value' };
    },
  };
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: input: unknown = { mode: 'run', command: 'printf', args: ['UID…; signal = abort.signal。
   * 结果：返回分支计算值（`runSyscallProfile(machines, syscallVmId, input, signal, workspaces, options)`）。
   * Result: Return the branch-computed value (`runSyscallProfile(machines, syscallVmId, input, signal, workspaces, options)`).
   * 协作入口 / Collaborators: `runSyscallProfile`.
   */
  const run = (input: unknown = { mode: 'run', command: 'printf', args: ['UID_TEST_MARKER'], confirmed: true }, signal = abort.signal) =>
    runSyscallProfile(machines, syscallVmId, input, signal, workspaces, options);
  return { machines, workspaces, manager, options, run, project, live, abort, rootCommands, launches, events,
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
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`resolves`）。
     * Result: Return the branch-computed value (`resolves`).
     */
    resolves: () => resolves,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `outside`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    switchOutside: () => { outside = 'fedcba9876543210'; }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `forced`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    forceScope: () => { forced = 'fedcba9876543210'; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `state`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setState: (value: string) => { state = value; } };
}
