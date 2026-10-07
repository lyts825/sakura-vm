/**
 * 模块职责：回归验证模块，围绕 `engineering-runner-identity` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `engineering-runner-identity`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: project operations use the captured UID payload without root helper files or selected-config rereads; non-enumerable named-project metadata stays bound to the original task without changing the config hash.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import type { Machines } from '../server/machines.ts';
import { vmLiveView } from '../server/vm-reference.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { projectSchema, projectVersion } from '../server/workspaces.ts';
import { AppError } from '../server/model.ts';
import { ExtendedFeatures } from '../server/extended-features.ts';
import { Jobs } from '../server/jobs.ts';
import { CapabilityActions } from '../server/capability-actions.ts';
import { projectIdentityPayload } from '../server/project-identity.ts';
import { runEngineeringOperation, engineeringInvocation, engineeringLimits, engineeringSource,
  requireSuccessfulResult, type EngineeringRunOptions } from '../server/engineering-runner.ts';

const id = '11111111-1111-4111-8111-111111111111', projectId = '0123456789abcdef';
const moduleSource = 'import json,os,sys\nr=json.load(sys.stdin)\nprint(json.dumps({"code":0,"operation":r["operation"],"request":r,"token":os.environ.get("TOKEN")}))';
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: command: string。
 * 结果：返回分支计算值（`quoted.slice(1, -1).replaceAll("'\\''", "'")`）。
 * Result: Return the branch-computed value (`quoted.slice(1, -1).replaceAll("'\\''", "'")`).
 * 协作入口 / Collaborators: `assert.ok`, `command.startsWith`, `command.slice`, `quoted.startsWith`.
 * 检查边界 / Checked boundaries: `assert.ok(command.startsWith(prefix))`; `assert.ok(quoted.startsWith("'") && quoted.endsWith("'"))`.
 */
const pythonSource = (command: string) => {
  const prefix = 'exec /usr/bin/python3 -I -S -c ';
  assert.ok(command.startsWith(prefix));
  const quoted = command.slice(prefix.length);
  assert.ok(quoted.startsWith("'") && quoted.endsWith("'"));
  return quoted.slice(1, -1).replaceAll("'\\''", "'");
};
/**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: command: string。
 * 结果：返回分支计算值（`JSON.parse(inflateSync(Buffer.from(JSON.parse(match[1]), 'base64')).toString('ut…`）。
 * Result: Return the branch-computed value (`JSON.parse(inflateSync(Buffer.from(JSON.parse(match[1]), 'base64')).toString('ut…`).
 * 协作入口 / Collaborators: `pythonSource`, `python.match`, `assert.ok`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.ok(match)`.
 */
const unpackRequest = (command: string) => {
  const python = pythonSource(command);
  const match = python.match(/^request=unpack\(("[A-Za-z0-9+/=]+"),/m);
  assert.ok(match);
  return JSON.parse(inflateSync(Buffer.from(JSON.parse(match[1]), 'base64')).toString('utf8'));
};
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: code: string; input: Buffer。
 * 结果：返回分支计算值（`spawnSync(process.env.SAKURA_TEST_PYTHON || 'python', ['-I', '-S', '-c', code], …`）。
 * Result: Return the branch-computed value (`spawnSync(process.env.SAKURA_TEST_PYTHON || 'python', ['-I', '-S', '-c', code], …`).
 * 协作入口 / Collaborators: `spawnSync`.
 */
const localPython = (code: string, input?: Buffer) => spawnSync(process.env.SAKURA_TEST_PYTHON || 'python',
  ['-I', '-S', '-c', code], { input, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: operation = 'hash-manifest'。
 * 结果：返回受控对象，公开字段包括 `run, options, config, machines, workspaces, live, payloads, administrative, saves`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `run, options, config, machines, workspaces, live, payloads, administrative, saves`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `projectSchema.parse`, `Object.defineProperty`.
 */
function fixture(operation = 'hash-manifest') {
  const context = new AsyncLocalStorage<string>();
  let override: string | undefined, leaseOpen = false, releases = 0;
  const live = { status: 'running' };
  const config = projectSchema.parse({ directory: '/srv/projects/original', template: 'none',
    networkIsolation: 'private', environment: { MODE: 'original' }, secrets: { TOKEN: 'fixture-token' } });
  Object.defineProperty(config, '_workspace', { value: projectId, enumerable: false });
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`Object.defineProperty(structuredClone(config), '_workspace', { value: projectId,…`）。
   * Result: Return the branch-computed value (`Object.defineProperty(structuredClone(config), '_workspace', { value: projectId,…`).
   * 协作入口 / Collaborators: `Object.defineProperty`, `structuredClone`.
   */
  const cloneConfig = () => Object.defineProperty(structuredClone(config), '_workspace',
    { value: projectId, enumerable: false });
  const payloads: any[] = [], administrative: any[] = [], saves: any[] = [], events: string[] = [];
  const machines = {
    live: new Map([[id, live]]), /**
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
    requireUnlocked: () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('Direct root exec is forbidden in this model')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    exec: async () => { throw new Error('Direct root exec is forbidden in this model'); },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('Root helper publication is forbidden')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    writeGuestFile: async () => { throw new Error('Root helper publication is forbidden'); },
  } as unknown as Machines;
  const workspaces = {
    projects: {
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`override || context.getStore() || projectId`）。
       * Result: Return the branch-computed value (`override || context.getStore() || projectId`).
       * 协作入口 / Collaborators: `context.getStore`.
       */
      current: () => override || context.getStore() || projectId,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`id + ':' + (override || context.getStore() || projectId)`）。
       * Result: Return the branch-computed value (`id + ':' + (override || context.getStore() || projectId)`).
       * 协作入口 / Collaborators: `context.getStore`.
       */
      key: () => id + ':' + (override || context.getStore() || projectId),
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
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`cloneConfig()`），以 Promise 交付。
     * Result: Return the branch-computed value (`cloneConfig()`) through a Promise.
     * 协作入口 / Collaborators: `cloneConfig`.
     */
    config: async () => cloneConfig(),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('A second selected-project read is forbidden')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    resolvedConfig: async () => { throw new Error('A second selected-project read is forbidden'); },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; captured: typeof config。
     * 结果：返回受控对象，公开字段包括 `environment`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `environment`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `assert.equal`, `projectVersion`.
     * 检查边界 / Checked boundaries: `assert.equal(projectVersion(captured), projectVersion(config))`.
     */
    resolveProject: async (_id: string, captured: typeof config) => {
      assert.equal(projectVersion(captured), projectVersion(config));
      return { ...captured, environment: { ...captured.environment, TOKEN: 'fixture-private-token' } };
    },
  } as unknown as Workspaces;
  const options: EngineeringRunOptions = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`moduleSource`），以 Promise 交付。
     * Result: Return the branch-computed value (`moduleSource`) through a Promise.
     */
    source: async () => moduleSource,
    terminals: { /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _id; scope; session; readOnly; signal; _terminalId; mode。
     * 结果：返回受控对象，公开字段包括 `command, projectId, networkIsolation, signal, terminalId, captured, release`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `command, projectId, networkIsolation, signal, terminalId, captured, release`; the actual branch determines its shape.
     * 状态影响 / State effects: `leaseOpen`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `assert.equal`, `assert.deepEqual`, `cloneConfig`, `projectVersion`.
     * 检查边界 / Checked boundaries: `assert.equal(scope, projectId)`; `assert.equal(session, null)`.
     */
    prepare: async (_id, scope, session, readOnly, signal, _terminalId, mode) => {
      assert.equal(scope, projectId); assert.equal(session, null); assert.equal(readOnly, false);
      assert.deepEqual(mode, { mode: 'task' }); leaseOpen = true;
      return { command: 'unused', projectId, networkIsolation: 'private', signal: signal!, terminalId: undefined,
        captured: { project: cloneConfig(), configVersion: projectVersion(config), live: live as any },
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
    } },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _machines; _id; captured; execution; signal; _log; timeout; _agent; _cleanup; pins。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `assert.ok`, `assert.equal`, `projectIdentityPayload`, `payloads.push`.
     * 检查边界 / Checked boundaries: `assert.ok(leaseOpen)`; `assert.equal(captured.directory, config.directory)`.
     */
    runProjectTask: async (_machines, _id, captured, execution, signal, _log, timeout, _agent, _cleanup, pins) => {
      assert.ok(leaseOpen); assert.equal(captured.directory, config.directory);
      assert.equal(captured._workspace, projectId);
      assert.equal(pins?.expectedLive, live); assert.equal(signal.aborted, false); assert.ok(timeout! >= 120000);
      projectIdentityPayload(execution); payloads.push({ captured, execution }); events.push('uid-task');
      return { code: 0, stdout: JSON.stringify(operation === 'task-import'
        ? { code: 0, tasks: [{ name: 'test', command: 'npm test' }] }
        : { code: 0, operation, stdout: 'fixture-private-token' }), stderr: '' };
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _machines; _id; command; _signal; _log; _timeout; _agent; _cleanup; transport。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `assert.ok`, `administrative.push`, `JSON.stringify`.
     * 检查边界 / Checked boundaries: `assert.ok(leaseOpen)`.
     */
    runAdministrativeTask: async (_machines, _id, command, _signal, _log, _timeout, _agent, _cleanup, transport) => {
      assert.ok(leaseOpen); administrative.push({ command, input: transport?.input });
      return { code: 0, stdout: JSON.stringify({ code: 0, operation }), stderr: '' };
    },
    presets: { /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回列表形式的受控数据，供调用者遍历或比较。
     * Result: Return controlled data as a list for iteration or comparison.
     * 协作入口 / Collaborators: `assert.ok`.
     * 检查边界 / Checked boundaries: `assert.ok(leaseOpen)`.
     */
    list: async () => { assert.ok(leaseOpen); return []; }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _id; input。
     * 结果：返回列表形式的受控数据，供调用者遍历或比较。
     * Result: Return controlled data as a list for iteration or comparison.
     * 协作入口 / Collaborators: `assert.ok`, `assert.equal`, `workspaces.projects.current`, `saves.push`.
     * 检查边界 / Checked boundaries: `assert.ok(leaseOpen)`; `assert.equal(workspaces.projects.current(id), projectId)`.
     */
    save: async (_id, input) => {
      assert.ok(leaseOpen); assert.equal(workspaces.projects.current(id), projectId); saves.push(input); return [];
    }, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `events.push`.
     */
    close: async () => { events.push('presets-close'); } },
  };
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: parameters: Record<string, unknown> = {}。
   * 结果：返回分支计算值（`runEngineeringOperation(machines, workspaces, id, operation, parameters, new Abo…`）。
   * Result: Return the branch-computed value (`runEngineeringOperation(machines, workspaces, id, operation, parameters, new Abo…`).
   * 协作入口 / Collaborators: `runEngineeringOperation`.
   */
  const run = (parameters: Record<string, unknown> = {}) => runEngineeringOperation(machines, workspaces, id,
    operation, parameters, new AbortController().signal, options);
  return { run, options, config, machines, workspaces, live, payloads, administrative, saves, events,
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
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `override`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    switchScope: () => { override = 'fedcba9876543210'; } };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: project operations use the captured UID payload without root helper files or selected-config rereads
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.equal`, `f.releases`.
 * 检查边界 / Checked boundaries: `assert.equal(f.payloads.length, 1)`; `assert.equal(f.administrative.length, 0)`.
 */
test('project operations use the captured UID payload without root helper files or selected-config rereads', async () => {
  const f = fixture('runbooks');
  const result = await f.run({ steps: [{ name: 'command', command: 'printf fixture', timeout: 1 }] });
  assert.equal(f.payloads.length, 1); assert.equal(f.administrative.length, 0); assert.equal(f.releases(), 1);
  const { captured, execution } = f.payloads[0];
  assert.equal(captured._workspace, projectId);
  assert.equal(execution.environment.TOKEN, 'fixture-private-token');
  const request = unpackRequest(execution.command);
  assert.deepEqual(request.environment, {}); assert.equal(request.directory, f.config.directory);
  assert.equal(request.parameters.steps[0].command, 'printf fixture');
  assert.equal(result.stdout, '[私密配置已隐藏]');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: non-enumerable named-project metadata stays bound to the original task without changing the config hash
 * 协作入口 / Collaborators: `fixture`, `assert.equal`, `Object.getOwnPropertyDescriptor`, `Object.hasOwn`.
 * 检查边界 / Checked boundaries: `assert.equal(Object.getOwnPropertyDescriptor(f.config, '_workspace')?.enumerable, false)`; `assert.equal(Object.hasOwn(structuredClone(f.config), '_workspace'), false)`.
 */
test('non-enumerable named-project metadata stays bound to the original task without changing the config hash', async () => {
  const f = fixture();
  assert.equal(Object.getOwnPropertyDescriptor(f.config, '_workspace')?.enumerable, false);
  assert.equal(Object.hasOwn(structuredClone(f.config), '_workspace'), false);
  await f.run();
  const captured = f.payloads[0].captured;
  assert.equal(captured._workspace, projectId);
  assert.equal(Object.getOwnPropertyDescriptor(captured, '_workspace')?.enumerable, false);
  assert.equal(projectVersion(captured), projectVersion(f.config));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a matching config hash cannot authorize preparation captured for another project
 * 状态影响 / State effects: `f.options.terminals`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.payloads.length + f.administrative.length, 0)`.
 */
test('a matching config hash cannot authorize preparation captured for another project', async () => {
  const f = fixture(), prepare = f.options.terminals!.prepare;
  f.options.terminals = { /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回受控对象，公开字段包括 `captured`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `captured`; the actual branch determines its shape.
   * 验证场景 / Scenario: a matching config hash cannot authorize preparation captured for another project
   * 协作入口 / Collaborators: `prepare`, `Object.defineProperty`, `structuredClone`, `assert.equal`.
   * 检查边界 / Checked boundaries: `assert.equal(projectVersion(wrongProject), projectVersion(f.config))`.
   */
  prepare: async (...args) => {
    const result = await prepare(...args);
    const wrongProject = Object.defineProperty(structuredClone(result.captured!.project), '_workspace',
      { value: 'fedcba9876543210', enumerable: false });
    assert.equal(projectVersion(wrongProject), projectVersion(f.config));
    return { ...result, captured: { ...result.captured!, project: wrongProject } };
  } };
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.payloads.length + f.administrative.length, 0);
  assert.equal(f.releases(), 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a preparation live view authorizes only its original VM runtime
 * 状态影响 / State effects: `f.options.terminals`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.equal`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.equal(f.payloads.length, 1)`; `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`.
 */
test('a preparation live view authorizes only its original VM runtime', async () => {
  for (const sameRuntime of [true, false]) {
    const f = fixture(), prepare = f.options.terminals!.prepare;
    f.options.terminals = { /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: args。
     * 结果：返回受控对象，公开字段包括 `captured`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `captured`; the actual branch determines its shape.
     * 验证场景 / Scenario: a preparation live view authorizes only its original VM runtime
     * 协作入口 / Collaborators: `prepare`, `vmLiveView`.
     */
    prepare: async (...args) => {
      const result = await prepare(...args);
      const raw = sameRuntime ? f.live : { ...f.live };
      return { ...result, captured: { ...result.captured!, live: vmLiveView(raw as any) } };
    } };
    if (sameRuntime) {
      await f.run();
      assert.equal(f.payloads.length, 1);
    } else {
      await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
      assert.equal(f.payloads.length + f.administrative.length, 0);
    }
    assert.equal(f.releases(), 1);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the current complete helper fits the native payload and the packed bootstrap preserves UTF-8 request data
 * 协作入口 / Collaborators: `engineeringInvocation`, `engineeringSource`, `projectIdentityPayload`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(frame.input.length < 131072)`; `assert.equal(execution.error, undefined)`.
 */
test('the current complete helper fits the native payload and the packed bootstrap preserves UTF-8 request data', async () => {
  const request = { operation: 'hash-manifest', directory: '/srv/projects/original', environment: {}, parameters: { path: '中文' } };
  const current = engineeringInvocation(await engineeringSource(), request);
  const frame = projectIdentityPayload({ command: current.command, environment: { TOKEN: 'fixture-token' } });
  assert.ok(frame.input.length < 131072);
  const invocation = engineeringInvocation(moduleSource, request);
  const execution = localPython(pythonSource(invocation.command));
  assert.equal(execution.error, undefined); assert.equal(execution.status, 0, execution.stderr);
  assert.deepEqual(JSON.parse(execution.stdout).request, request);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: raw and compressed source/request limits reject oversized data before any guest execution
 * 协作入口 / Collaborators: `'x'.repeat`, `randomBytes(60000).toString`, `randomBytes`, `randomBytes(30000).toString`.
 * 检查边界 / Checked boundaries: `assert.throws(() => engineeringInvocation(source, request), (error: any) => error.status === 413 && error.code === 'ENGINEERING_IN…`.
 */
test('raw and compressed source/request limits reject oversized data before any guest execution', () => {
  for (const [source, request] of [
    ['x'.repeat(engineeringLimits.sourceBytes + 1), {}],
    [randomBytes(60000).toString('hex'), {}],
    [moduleSource, { data: 'x'.repeat(engineeringLimits.requestBytes + 1) }],
    [moduleSource, { data: randomBytes(30000).toString('hex') }],
  ] as const) assert.throws(() => engineeringInvocation(source, request),
    (error: any) => error.status === 413 && error.code === 'ENGINEERING_INPUT_TOO_LARGE');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: guest decoding rejects extra compressed data and bounded decompression bombs without executing the source
 * 协作入口 / Collaborators: `engineeringInvocation`, `pythonSource`, `python.match`, `Buffer.from`.
 * 检查边界 / Checked boundaries: `assert.equal(result.error, undefined)`; `assert.notEqual(result.status, 0)`.
 */
test('guest decoding rejects extra compressed data and bounded decompression bombs without executing the source', () => {
  const invocation = engineeringInvocation(moduleSource, { operation: 'hash-manifest' });
  const python = pythonSource(invocation.command);
  const source = python.match(/^module=unpack\(("[A-Za-z0-9+/=]+"),/m)!;
  const packed = Buffer.from(JSON.parse(source[1]), 'base64');
  const tail = Buffer.concat([packed, Buffer.from('unexpected trailing bytes')]).toString('base64');
  const bomb = deflateSync(Buffer.alloc(engineeringLimits.sourceBytes + 1, 65)).toString('base64');
  for (const value of [tail, bomb]) {
    const result = localPython(python.replace(source[1], JSON.stringify(value)));
    assert.equal(result.error, undefined); assert.notEqual(result.status, 0);
    assert.equal(result.stdout, ''); assert.match(result.stderr, /Engineering transport integrity/);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: only three validated administrative operations use fixed root environment, root cwd and bounded stdin
 * 状态影响 / State effects: `f.config.environment`, `f.workspaces.resolveProject`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(f.payloads.length, 0)`; `assert.equal(f.administrative.length, 1)`.
 */
test('only three validated administrative operations use fixed root environment, root cwd and bounded stdin', async () => {
  for (const [operation, parameters] of [
    ['guest-clock-policy', { mode: 'inspect' }], ['static-routes', { mode: 'list' }],
    ['packet-capture', { interface: 'eth0', protocol: 'tcp', maxPackets: 2, durationSeconds: 1 }],
  ] as const) {
    const f = fixture(operation); f.config.environment = { PATH: '/project/untrusted', PYTHONPATH: '/project/untrusted', TOKEN: 'project-only-token' };
    f.workspaces.resolveProject = /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: only three validated administrative operations use fixed root environment, root cwd and bounded stdin
     * 失败 / Failure: `new Error('Administrative operations must not resolve project secrets')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    async () => { throw new Error('Administrative operations must not resolve project secrets'); };
    await f.run(parameters);
    assert.equal(f.payloads.length, 0); assert.equal(f.administrative.length, 1);
    const { command, input } = f.administrative[0];
    assert.match(command, /\/usr\/bin\/env -i HOME=\/ USER=root LOGNAME=root/);
    assert.match(command, /PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin LANG=C LC_ALL=C/);
    assert.match(command, /ip netns exec sk-0123456789abcdef/);
    assert.equal(command.includes('sh -lc'), false); assert.equal(command.includes(f.config.directory), false);
    assert.equal(command.includes('/project/untrusted'), false); assert.equal(command.includes('project-only-token'), false);
    const request = JSON.parse(input.toString('utf8'));
    assert.equal(request.operation, operation); assert.equal(request.directory, '/'); assert.deepEqual(request.environment, {});
    const invocation = engineeringInvocation(moduleSource, request, true);
    const correct = localPython(pythonSource(invocation.command), invocation.input);
    assert.equal(correct.status, 0, correct.stderr);
    const altered = localPython(pythonSource(invocation.command), Buffer.concat([invocation.input!, Buffer.from('x')]));
    assert.notEqual(altered.status, 0); assert.match(altered.stderr, /Engineering request integrity/);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the actual privileged helper paths read no project files, hooks or output paths
 * 协作入口 / Collaborators: `Buffer.from`, `engineeringSource`, `[ 'import pathlib, json, sys', 'ns={"__name__":"draft_admin_review"}', 'exe…`, `localPython`.
 * 检查边界 / Checked boundaries: `assert.equal(output.error, undefined)`; `assert.equal(output.status, 0, output.stderr)`.
 */
test('the actual privileged helper paths read no project files, hooks or output paths', async () => {
  const source = Buffer.from(await engineeringSource());
  const code = [
    'import pathlib, json, sys',
    'ns={"__name__":"draft_admin_review"}',
    'exec(compile(sys.stdin.buffer.read(),"trusted-helper.py","exec"),ns)',
    'calls=[]',
    'def denied(*args,**kwargs): raise AssertionError("project file/config/output access")',
    'def run(args,cwd=None,**kwargs):',
    ' assert args[0] in ("tcpdump","date","ip")',
    ' assert cwd is None or cwd==pathlib.Path("/")',
    ' calls.append(args)',
    ' return {"code":0,"stdout":"","stderr":""}',
    'ns["run"]=run',
    'ns["shutil"].which=lambda name: "/usr/sbin/tcpdump" if name=="tcpdump" else None',
    'for name in ("safe_path","read_text","history","atomic_json","task_import"): ns[name]=denied',
    'for name in ("open","read_text","read_bytes","resolve","is_symlink","exists","mkdir","write_text"): setattr(pathlib.Path,name,denied)',
    'root=pathlib.Path("/")',
    'ns["execute"](root,"guest-clock-policy",{"mode":"sync","_hostEpochMs":1700000000000})',
    'ns["execute"](root,"static-routes",{"mode":"add","destination":"192.0.2.0/24","gateway":"192.0.2.1"})',
    'ns["capability_execute"](root,"packet-capture",{"interface":"eth0","protocol":"tcp","port":443,"durationSeconds":1,"maxPackets":2})',
    'assert [row[0] for row in calls]==["date","ip","tcpdump"]',
    'assert calls[-1]==["tcpdump","-i","eth0","-p","-nn","-tt","-l","-q","-s","96","-c","2","tcp","and","port","443"]',
    'print(json.dumps({"code":0,"executables":[row[0] for row in calls]}))',
  ].join('\n');
  const output = localPython(code, source);
  assert.equal(output.error, undefined); assert.equal(output.status, 0, output.stderr);
  assert.deepEqual(JSON.parse(output.stdout), { code: 0, executables: ['date', 'ip', 'tcpdump'] });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unknown operations and invalid administrative parameters never enter any runner
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `routes.run`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'ENGINEERING_OPERATION_UNSUPPORTED')`; `assert.rejects(routes.run({ mode: 'add', destination: '0.0.0.0/0' }))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('unknown operations and invalid administrative parameters never enter any runner', async () => {
  const f = fixture('unknown-root-operation');
  await assert.rejects(f.run(), (error: any) => error.code === 'ENGINEERING_OPERATION_UNSUPPORTED');
  const routes = fixture('static-routes');
  await assert.rejects(routes.run({ mode: 'add', destination: '0.0.0.0/0' }));
  await assert.rejects(routes.run({ mode: 'list', command: 'malicious-root-command' }));
  assert.equal(f.releases(), 0); assert.equal(routes.releases(), 0);
  assert.equal(f.administrative.length + routes.administrative.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: internal matrix commands and parity probes have explicit bounded schemas and use the UID runner
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.equal`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.equal(f.payloads.length, 1)`; `assert.equal(f.administrative.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('internal matrix commands and parity probes have explicit bounded schemas and use the UID runner', async () => {
  for (const [operation, parameters] of [
    ['capability-command', { argv: ['npm', 'test'], timeout: 60 }],
    ['environment-fingerprint', {}],
  ] as const) {
    const f = fixture(operation);
    await f.run(parameters);
    assert.equal(f.payloads.length, 1); assert.equal(f.administrative.length, 0);
    assert.deepEqual(unpackRequest(f.payloads[0].execution.command).parameters, parameters);
  }
  const command = fixture('capability-command'), fingerprint = fixture('environment-fingerprint');
  for (const parameters of [{ argv: [] }, { argv: [''] }, { argv: ['bad\0command'] },
    { argv: ['npm'], timeout: 1801 }, { argv: ['npm'], root: true }])
    await assert.rejects(command.run(parameters));
  await assert.rejects(fingerprint.run({ command: 'untrusted' }));
  assert.equal(command.releases() + fingerprint.releases(), 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a source-load live replacement fails before code launch and releases the original preparation lease
 * 状态影响 / State effects: `f.options.source`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.payloads.length + f.administrative.length, 0)`.
 */
test('a source-load live replacement fails before code launch and releases the original preparation lease', async () => {
  const f = fixture();
  f.options.source = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`moduleSource`），以 Promise 交付。
   * Result: Return the branch-computed value (`moduleSource`) through a Promise.
   * 验证场景 / Scenario: a source-load live replacement fails before code launch and releases the original preparation lease
   * 协作入口 / Collaborators: `f.machines.live.set`.
   */
  async () => { f.machines.live.set(id, {} as any); return moduleSource; };
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.payloads.length + f.administrative.length, 0); assert.equal(f.releases(), 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: original config edits fail before execution even when preparation captured a later candidate
 * 状态影响 / State effects: `f.options.terminals!.prepare`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.payloads.length, 0)`.
 */
test('original config edits fail before execution even when preparation captured a later candidate', async () => {
  const f = fixture(); const prepare = f.options.terminals!.prepare;
  f.options.terminals!.prepare = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`prepare(...args)`），以 Promise 交付。
   * Result: Return the branch-computed value (`prepare(...args)`) through a Promise.
   * 验证场景 / Scenario: original config edits fail before execution even when preparation captured a later candidate
   * 状态影响 / State effects: `f.config.environment`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `prepare`.
   */
  async (...args) => { f.config.environment = { MODE: 'changed' }; return prepare(...args); };
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.payloads.length, 0); assert.equal(f.releases(), 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: task import writes to the original project while its lease remains held
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.equal`, `f.releases`.
 * 检查边界 / Checked boundaries: `assert.equal(result.saved, 1)`; `assert.equal(f.saves.length, 1)`.
 */
test('task import writes to the original project while its lease remains held', async () => {
  const f = fixture('task-import');
  const result = await f.run({ save: true });
  assert.equal(result.saved, 1); assert.equal(f.saves.length, 1); assert.equal(f.releases(), 1);
  assert.deepEqual(f.events, ['uid-task', 'presets-close', 'release']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: task import rejects a scope switch during execution before reading or saving presets
 * 状态影响 / State effects: `f.options.runProjectTask`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run({ save: true }), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED')`; `assert.equal(f.saves.length, 0)`.
 */
test('task import rejects a scope switch during execution before reading or saving presets', async () => {
  const f = fixture('task-import'), runTask = f.options.runProjectTask!;
  f.options.runProjectTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`output`），以 Promise 交付。
   * Result: Return the branch-computed value (`output`) through a Promise.
   * 验证场景 / Scenario: task import rejects a scope switch during execution before reading or saving presets
   * 协作入口 / Collaborators: `runTask`, `f.switchScope`.
   */
  async (...args) => { const output = await runTask(...args); f.switchScope(); return output; };
  await assert.rejects(f.run({ save: true }), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.saves.length, 0); assert.equal(f.releases(), 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: result persistence holds the original lease, and persistence failure releases it without root fallback
 * 状态影响 / State effects: `f.options.onResult`, `failed.options.onResult`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.run`, `assert.equal`, `f.releases`.
 * 检查边界 / Checked boundaries: `assert.equal(f.releases(), 0)`; `assert.equal(f.releases(), 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('result persistence holds the original lease, and persistence failure releases it without root fallback', async () => {
  const f = fixture(); let reached!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
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
  const saving = new Promise<void>(resolve => { reached = resolve; });
  const saved = new Promise<void>(resolve => { finish = resolve; });
  f.options.onResult = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: result persistence holds the original lease, and persistence failure releases it without root fallback
   * 协作入口 / Collaborators: `assert.ok`, `f.leaseOpen`, `reached`.
   * 检查边界 / Checked boundaries: `assert.ok(f.leaseOpen())`; `assert.ok(f.leaseOpen())`.
   */
  async () => { assert.ok(f.leaseOpen()); reached(); await saved; assert.ok(f.leaseOpen()); };
  const operation = f.run(); await saving; assert.equal(f.releases(), 0); finish(); await operation;
  assert.equal(f.releases(), 1);
  const failed = fixture(), error = new AppError('result storage failure', 503, 'RESULT_STORAGE_FAILED');
  failed.options.onResult = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: result persistence holds the original lease, and persistence failure releases it without root fallback
   * 失败 / Failure: `error`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw error; };
  await assert.rejects(failed.run(), value => value === error);
  assert.equal(failed.releases(), 1); assert.equal(failed.administrative.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: native cleanup 503/status/code propagate unchanged and never become JSON errors or success-check failures
 * 状态影响 / State effects: `f.options.runProjectTask`, `f.options.onResult`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.run().then`, `f.run`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run().then(result => requireSuccessfulResult(result)), value => value === error)`; `assert.equal(saved, false)`.
 */
test('native cleanup 503/status/code propagate unchanged and never become JSON errors or success-check failures', async () => {
  for (const code of ['PROJECT_IDENTITY_CLEANUP_FAILED', 'GUEST_TASK_CLEANUP_FAILED']) {
    const f = fixture(), error = new AppError('original cleanup failure', 503, code);
    f.options.runProjectTask = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: native cleanup 503/status/code propagate unchanged and never become JSON errors or success-check failures
     * 失败 / Failure: `error`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    async () => { throw error; };
    let saved = false; f.options.onResult = /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: native cleanup 503/status/code propagate unchanged and never become JSON errors or success-check failures
     * 状态影响 / State effects: `saved`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    async () => { saved = true; };
    await assert.rejects(f.run().then(result => requireSuccessfulResult(result)), value => value === error);
    assert.equal(saved, false); assert.equal(f.releases(), 1); assert.equal(f.administrative.length, 0);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the real extended-operation job saves its result through the original preparation lease
 * 状态影响 / State effects: `(service as any).runOperation`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `Object.create`, `Object.assign`, `service.action`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'done')`; `assert.equal(job.projectId, projectId)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('the real extended-operation job saves its result through the original preparation lease', async () => {
  const f = fixture(), jobs = new Jobs();
  // Keep this model in memory; do not initialize production stores or VM services.
  const service = Object.create(ExtendedFeatures.prototype) as ExtendedFeatures;
  Object.assign(service, { machines: f.machines, workspaces: f.workspaces, jobs,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ settings: {} })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ settings: {} })`) through a Promise.
     * 验证场景 / Scenario: the real extended-operation job saves its result through the original preparation lease
     */
    state: async () => ({ settings: {} }) });
  let persisted = 0;
  (service as any).runOperation = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; operation: string; parameters: Record<string, unknown>; signal: AbortSignal; persist: (value: unknown) => Promise<void>。
   * 结果：返回分支计算值（`runEngineeringOperation(f.machines, f.workspaces, id, operation, parameters, sig…`），以 Promise 交付。
   * Result: Return the branch-computed value (`runEngineeringOperation(f.machines, f.workspaces, id, operation, parameters, sig…`) through a Promise.
   * 验证场景 / Scenario: the real extended-operation job saves its result through the original preparation lease
   * 协作入口 / Collaborators: `assert.equal`, `runEngineeringOperation`.
   * 检查边界 / Checked boundaries: `assert.equal(typeof persist, 'function')`.
   */
  async (_id: string, operation: string, parameters: Record<string, unknown>,
    signal: AbortSignal, persist: /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: unknown。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (value: unknown) => Promise<void>) => {
    assert.equal(typeof persist, 'function');
    return runEngineeringOperation(f.machines, f.workspaces, id, operation, parameters, signal,
      { ...f.options, /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: result。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: the real extended-operation job saves its result through the original preparation lease
       * 协作入口 / Collaborators: `assert.ok`, `f.leaseOpen`, `persist`.
       * 检查边界 / Checked boundaries: `assert.ok(f.leaseOpen())`; `assert.ok(f.leaseOpen())`.
       */
      onResult: async result => {
        assert.ok(f.leaseOpen()); await persist(result); assert.ok(f.leaseOpen()); ++persisted;
      } });
  };
  try {
    const job: any = await service.action(id, { action: 'operation', operation: 'hash-manifest' });
    await jobs.wait(job.key);
    assert.equal(job.status, 'done'); assert.equal(job.projectId, projectId);
    assert.equal((await jobs.result(job.id)).stdout, '[私密配置已隐藏]');
    assert.equal(persisted, 1); assert.equal(f.releases(), 1);
  } finally { await jobs.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the extended-operation job retains a native cleanup error code without storing a fabricated result
 * 状态影响 / State effects: `f.options.runProjectTask`, `(service as any).runOperation`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `Object.create`, `Object.assign`, `service.action`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.equal(job.errorCode, error.code)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('the extended-operation job retains a native cleanup error code without storing a fabricated result', async () => {
  const f = fixture(), jobs = new Jobs(), error = new AppError('original cleanup failure', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  f.options.runProjectTask = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: the extended-operation job retains a native cleanup error code without storing a fabricated result
   * 失败 / Failure: `error`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw error; };
  const service = Object.create(ExtendedFeatures.prototype) as ExtendedFeatures;
  Object.assign(service, { machines: f.machines, workspaces: f.workspaces, jobs,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ settings: {} })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ settings: {} })`) through a Promise.
     * 验证场景 / Scenario: the extended-operation job retains a native cleanup error code without storing a fabricated result
     */
    state: async () => ({ settings: {} }) });
  (service as any).runOperation = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; operation: string; parameters: Record<string, unknown>; signal: AbortSignal; onResult: EngineeringRunOptions['onResult']。
   * 结果：返回分支计算值（`runEngineeringOperation(f.machines, f.workspaces, id, operation, parameters, sig…`），以 Promise 交付。
   * Result: Return the branch-computed value (`runEngineeringOperation(f.machines, f.workspaces, id, operation, parameters, sig…`) through a Promise.
   * 验证场景 / Scenario: the extended-operation job retains a native cleanup error code without storing a fabricated result
   * 协作入口 / Collaborators: `runEngineeringOperation`.
   */
  async (_id: string, operation: string, parameters: Record<string, unknown>,
    signal: AbortSignal, onResult: EngineeringRunOptions['onResult']) =>
    runEngineeringOperation(f.machines, f.workspaces, id, operation, parameters, signal, { ...f.options, onResult });
  try {
    const job: any = await service.action(id, { action: 'operation', operation: 'hash-manifest' });
    await jobs.wait(job.key);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, error.code);
    assert.equal(job.error, error.message); assert.equal(job.result, undefined);
    assert.equal(f.releases(), 1); assert.equal(f.administrative.length, 0);
  } finally { await jobs.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cross-project workspace search preserves infrastructure 503 errors instead of producing a check failure
 * 协作入口 / Collaborators: `fixture`, `Object.assign`, `assert.rejects`, `capabilities.run(id, 'workspace-search', { query: 'TODO', targets: [{ vmId:…`.
 * 检查边界 / Checked boundaries: `assert.rejects(capabilities.run(id, 'workspace-search', { query: 'TODO', targets: [{ vmId: id, projectId }] }, new AbortController…`; `assert.equal(result.code, 1)`.
 */
test('cross-project workspace search preserves infrastructure 503 errors instead of producing a check failure', async () => {
  const f = fixture(), error = new AppError('original cleanup failure', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  Object.assign(f.workspaces.projects, { /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: cross-project workspace search preserves infrastructure 503 errors instead of producing a check failure
   * 失败 / Failure: `error`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  with: async () => { throw error; } });
  const capabilities = new CapabilityActions(f.machines, f.workspaces);
  await assert.rejects(capabilities.run(id, 'workspace-search', { query: 'TODO', targets: [{ vmId: id, projectId }] },
    new AbortController().signal).then(result => requireSuccessfulResult(result)), value => value === error);
  Object.assign(f.workspaces.projects, { /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: cross-project workspace search preserves infrastructure 503 errors instead of producing a check failure
   * 失败 / Failure: `new AppError('target unavailable', 409)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  with: async () => { throw new AppError('target unavailable', 409); } });
  const result = await capabilities.run(id, 'workspace-search', { query: 'TODO', targets: [{ vmId: id, projectId }] },
    new AbortController().signal);
  assert.equal(result.code, 1); assert.equal(result.ready, false);
});
