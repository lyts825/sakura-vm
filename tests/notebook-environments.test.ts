/**
 * 模块职责：回归验证模块，围绕 `notebook-environments` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `notebook-environments`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: boot reply cannot admit a replaced live instance even when its boot UUID is unchanged; administrator system dependency body executes with only the fixed root environment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { NotebookEnvironments, notebookListenerCommand, notebookSessionSchema, notebookToolsScript } from '../server/notebook-environments.ts';
import { notebookInstalledCommand, notebookInstallExecution, notebookWheelhouseCommand, notebookWheelLeaseSchema,
  notebookWheelRequest, type NotebookWheelLease } from '../server/notebook-wheelhouse.ts';
import { ProjectNotebookScope, projectNotebookRecordSchema, projectNotebookScopePaths, projectNotebookScopeCommand,
  projectServiceScopePaths, projectBrowserIdeScopePaths, type ProjectNotebookRecord } from '../server/project-service-scope.ts';
import { projectIdentityPayload, projectIdentitySchema, type ProjectIdentityRun } from '../server/project-identity.ts';
import { projectVersion, type Project, type Workspaces } from '../server/workspaces.ts';
import type { Machines } from '../server/machines.ts';
import { AppError, DATA, createSchema, vmDir } from '../server/model.ts';

const signal = new AbortController().signal;
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: command: string。
 * 结果：返回分支计算值（`command.split('/usr/bin/python3 -I -S -c ')[1].slice(1, -1).replaceAll("'\\''", …`）。
 * Result: Return the branch-computed value (`command.split('/usr/bin/python3 -I -S -c ')[1].slice(1, -1).replaceAll("'\\''", …`).
 * 协作入口 / Collaborators: `command.split('/usr/bin/python3 -I -S -c ')[1].slice(1, -1).replaceAll`, `command.split('/usr/bin/python3 -I -S -c ')[1].slice`, `command.split`.
 */
const decodeSource = (command: string) => command.split('/usr/bin/python3 -I -S -c ')[1].slice(1, -1).replaceAll("'\\''", "'");
/**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: command: string。
 * 结果：返回分支计算值（`JSON.parse(JSON.parse(data))`）。
 * Result: Return the branch-computed value (`JSON.parse(JSON.parse(data))`).
 * 协作入口 / Collaborators: `decodeSource`, `source.match`, `assert.ok`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.ok(data)`.
 */
const commandRequest = (command: string) => {
  const source = decodeSource(command), data = source.match(/request=json.loads\(([^\n]+)\)/)?.[1];
  assert.ok(data); return JSON.parse(JSON.parse(data));
};
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: request: { leaseId: string; bootId: string; provider: 'jupyter' | 'marimo'…。
 * 结果：返回分支计算值（`notebookWheelLeaseSchema.parse({ version: 1, ...request, path: '/var/cache/sakur…`）。
 * Result: Return the branch-computed value (`notebookWheelLeaseSchema.parse({ version: 1, ...request, path: '/var/cache/sakur…`).
 * 协作入口 / Collaborators: `notebookWheelLeaseSchema.parse`, `'a'.repeat`, `['pip-25.0-py3-none-any.whl', 'notebook_dep-1.0-py3-none-any.whl'].map`.
 */
const leaseFor = (request: { leaseId: string; bootId: string; provider: 'jupyter' | 'marimo' }): NotebookWheelLease =>
  notebookWheelLeaseSchema.parse({ version: 1, ...request, path: '/var/cache/sakura/notebook-wheels/' + request.leaseId,
    device: '12', inode: '99', manifestSha256: 'a'.repeat(64),
    files: ['pip-25.0-py3-none-any.whl', 'notebook_dep-1.0-py3-none-any.whl'].map((name, index) =>
      ({ name, device: '12', inode: String(100 + index), sha256: 'b'.repeat(64), bytes: 123 })) });
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: project: Project。
 * 结果：返回分支计算值（`Object.defineProperty(structuredClone(project), '_workspace', { value: project._…`）。
 * Result: Return the branch-computed value (`Object.defineProperty(structuredClone(project), '_workspace', { value: project._…`).
 * 协作入口 / Collaborators: `Object.defineProperty`, `structuredClone`.
 */
const copyProject = (project: Project) => Object.defineProperty(structuredClone(project), '_workspace', {
  value: project._workspace, enumerable: false,
});
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: { after: (work: () => Promise<unknown>) => void }; networkIsolation: 'host' | 'private' = 'host'; projectId = 'default'。
 * 结果：返回受控对象，公开字段包括 `service, create, vmId, vm, file, identity, project, projectId, machines`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `service, create, vmId, vm, file, identity, project, projectId, machines`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdir`, `mkdtemp`, `join`, `randomUUID`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture(t: { after: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: work: () => Promise<unknown>。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
(work: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => Promise<unknown>) => void }, networkIsolation: 'host' | 'private' = 'host', projectId = 'default') {
  await mkdir(DATA, { recursive: true });
  const directory = await mkdtemp(join(DATA, 'notebook-uid-unit-')), vmId = randomUUID();
  /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: path: string。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `assert.ok`, `resolve(path).startsWith`, `resolve`, `rm`.
   * 检查边界 / Checked boundaries: `assert.ok(resolve(path).startsWith(resolve(DATA) + sep))`.
   */
  const removeOwned = async (path: string) => { assert.ok(resolve(path).startsWith(resolve(DATA) + sep)); await rm(path, { recursive: true, force: true }); };
  t.after(() => removeOwned(directory)); t.after(() => removeOwned(vmDir(vmId)));
  let bootId = randomUUID(); const originalBoot = bootId, registryId = randomUUID(), identityId = randomUUID();
  const identity = projectIdentitySchema.parse({ version: 1, phase: 'active', projectId, registryId, identityId,
    revision: 1, uid: 20001, gid: 20001, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
    home: '/var/lib/sakura-project-homes/' + identityId, homeDevice: '12', homeInode: '20',
    directory: '/srv/notebooks/雪 quote\' project', directoryDevice: '12', directoryInode: '21', networkIsolation });
  const project: Project = { directory: identity.directory, networkIsolation, template: 'none',
    repository: '', setup: 'private-hook;$(id)', command: '',
    environment: { PATH: '/private/bin', PYTHONPATH: '/private/python', PIP_CONFIG_FILE: '/private/pip.conf',
      BASH_ENV: '/private/init', LD_PRELOAD: '/private/lib', TOKEN: 'notebook-private-雪' }, secrets: { RESOLVED: 'api-token' } };
  Object.defineProperty(project, '_workspace', { value: projectId === 'default' ? undefined : projectId, enumerable: false });
  const projectScope = new AsyncLocalStorage<string>();
  const vm = { ...createSchema.parse({ name: 'notebook-uid-unit', distro: 'ubuntu' }), id: vmId, createdAt: new Date().toISOString(), snapshots: [] };
  let machineState = 'running', currentProject = projectId, live: object = {}, installed = true, listener = true;
  let bridge = false, migration = false, startFailure = false, cleanupFailure = false, nativeFailure = false, inheritedFailure = false;
  let installFailure = false, wheelCleanupFailure = false, malformedWheelCleanup = false, wrongLease = false, activeLease = false;
  let prepareFailure: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void) | undefined, downloadHook: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void) | undefined, listenerGate: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => Promise<void>) | undefined;
  let configHook: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void | Promise<void>) | undefined, bootHook: (/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void | Promise<void>) | undefined;
  let resolvedScope: string | undefined, configScope: string | undefined, currentScope: string | undefined;
  let scopeRecord: ProjectNotebookRecord | null = null, ticket: ProjectIdentityRun | null = null, transportSha: string | null = null;
  const events: string[] = [], rootCommands: string[] = [], frames: Buffer[] = [], projectScripts: string[] = [], rootLaunchCommands: string[] = [];
  const file = join(directory, 'notebooks.json');
  const machines = Object.assign(new EventEmitter(), {
    live: new Map([[vmId, live]]), /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`vm`）。
     * Result: Return the branch-computed value (`vm`).
     */
    get: () => vm, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`machineState`）。
     * Result: Return the branch-computed value (`machineState`).
     */
    state: () => machineState,
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
    () => Promise<unknown>) => work(), /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    requireUnlocked() {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    reserveHostPorts() {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _vm: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `rootCommands.push`, `command.endsWith`, `bootHook`, `command.startsWith`.
     */
    exec: async (_vm: string, command: string) => {
      rootCommands.push(command);
      if (command.endsWith('/bin/cat /proc/sys/kernel/random/boot_id')) {
        const original = bootId; await bootHook?.(); return { code: 0, stdout: original, stderr: '' };
      }
      if (command.startsWith('# SAKURA_NOTEBOOK_INSTALLED')) return { code: 0, stdout: JSON.stringify({ installed }), stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`assert.fail('Notebook UID services must use validated loopback bridges')`），以 Promise 交付。
     * Result: Return the branch-computed value (`assert.fail('Notebook UID services must use validated loopback bridges')`) through a Promise.
     * 协作入口 / Collaborators: `assert.fail`.
     * 检查边界 / Checked boundaries: `assert.fail('Notebook UID services must use validated loopback bridges')`.
     */
    setForwards: async () => assert.fail('Notebook UID services must use validated loopback bridges'),
  }) as unknown as Machines;
  const workspaces = { projects: { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`currentScope || projectScope.getStore() || currentProject`）。
   * Result: Return the branch-computed value (`currentScope || projectScope.getStore() || currentProject`).
   * 协作入口 / Collaborators: `projectScope.getStore`.
   */
  current: () => currentScope || projectScope.getStore() || currentProject,
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _vm: string; selected: string; work: () => Promise<unknown>。
     * 结果：返回分支计算值（`projectScope.run(selected, work)`），以 Promise 交付。
     * Result: Return the branch-computed value (`projectScope.run(selected, work)`) through a Promise.
     * 协作入口 / Collaborators: `assert.equal`, `projectScope.run`.
     * 检查边界 / Checked boundaries: `assert.equal(selected, projectId)`.
     */
    inScope: async (_vm: string, selected: string, work: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => {
      assert.equal(selected, projectId); return projectScope.run(selected, work);
    } },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`configScope === undefined ? value : Object.defineProperty(structuredClone(value)…`），以 Promise 交付。
     * Result: Return the branch-computed value (`configScope === undefined ? value : Object.defineProperty(structuredClone(value)…`) through a Promise.
     * 协作入口 / Collaborators: `copyProject`, `configHook`, `Object.defineProperty`, `structuredClone`.
     */
    config: async () => {
      const value = copyProject(project); await configHook?.();
      return configScope === undefined ? value : Object.defineProperty(structuredClone(value), '_workspace', { value: configScope, enumerable: false });
    }, /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _vm: string; captured: Project。
     * 结果：返回分支计算值（`Object.defineProperty({ ...structuredClone(captured), environment: { ...captured…`），以 Promise 交付。
     * Result: Return the branch-computed value (`Object.defineProperty({ ...structuredClone(captured), environment: { ...captured…`) through a Promise.
     * 协作入口 / Collaborators: `assert.equal`, `projectScope.getStore`, `Object.defineProperty`, `structuredClone`.
     * 检查边界 / Checked boundaries: `assert.equal(captured._workspace || 'default', projectId, 'raw captured scope must survive a non-enumerable clone')`; `assert.equal(projectScope.getStore(), projectId)`.
     */
    resolveProject: async (_vm: string, captured: Project) => {
      assert.equal(captured._workspace || 'default', projectId, 'raw captured scope must survive a non-enumerable clone');
      assert.equal(projectScope.getStore(), projectId);
      return Object.defineProperty({ ...structuredClone(captured), environment: { ...captured.environment, RESOLVED: 'resolved-secret-value' } },
        '_workspace', { value: resolvedScope ?? captured._workspace, enumerable: false });
    } } as unknown as Workspaces;
  const terminals = { /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: _vm: string; selected: string | null | undefined; _session: string | null; _readonly: boolean; incoming: AbortSignal; _expected: string; options: { mode?: 'task' }。
   * 结果：返回受控对象，公开字段包括 `projectId, command, networkIsolation, signal, terminalId, captured, release`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `projectId, command, networkIsolation, signal, terminalId, captured, release`; the actual branch determines its shape.
   * 状态影响 / State effects: `activeLease`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `events.push`, `assert.equal`, `prepareFailure`, `copyProject`.
   * 检查边界 / Checked boundaries: `assert.equal(selected, projectId)`; `assert.equal(options?.mode, 'task')`.
   */
  async prepare(_vm: string, selected: string | null | undefined, _session?: string | null,
    _readonly?: boolean, incoming?: AbortSignal, _expected?: string, options?: { mode?: 'task' }) {
    events.push('lease-prepare'); assert.equal(selected, projectId); assert.equal(options?.mode, 'task');
    activeLease = true; prepareFailure?.();
    return { projectId: selected!, command: '', networkIsolation, signal: incoming!, terminalId: undefined,
      captured: { project: copyProject(project), configVersion: projectVersion(project), live: machines.live.get(vmId)! },
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 状态影响 / State effects: `activeLease`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `events.push`.
       */
      async release() { activeLease = false; events.push('lease-release'); } };
  } };
  const processScope = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _signal: AbortSignal; sha: string。
     * 结果：返回受控对象，公开字段包括 `status, record, bootId`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `status, record, bootId`; the actual branch determines its shape.
     * 失败 / Failure: `changedDigest()`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `events.push`, `changedDigest`, `structuredClone`.
     */
    async status(_signal?: AbortSignal, sha?: string) {
      events.push('scope-status'); if (sha !== undefined && sha !== transportSha) throw changedDigest();
      return { status: !scopeRecord ? 'absent' as const : scopeRecord.phase === 'stopped' ? 'stopped' as const : 'running' as const,
        record: scopeRecord && structuredClone(scopeRecord), bootId };
    },
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: binding: string; boot: string。
     * 结果：返回分支计算值（`projectNotebookRecordSchema.parse({ version: 1, projectId, name: 'notebook', ses…`）。
     * Result: Return the branch-computed value (`projectNotebookRecordSchema.parse({ version: 1, projectId, name: 'notebook', ses…`).
     * 协作入口 / Collaborators: `randomUUID`, `projectNotebookRecordSchema.parse`.
     */
    newIntent(binding: string, boot: string) { const runId = randomUUID(); return projectNotebookRecordSchema.parse({ version: 1,
      projectId, name: 'notebook', session: 'sakura-notebook-' + projectId, runId, bootId: boot,
      scopeName: 'sakura-service-' + runId, inode: null, binding, phase: 'intent', sessionId: null, paneId: null, panePid: null, paneStartTicks: null }); },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: record: ProjectNotebookRecord。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `assert.equal`, `events.push`.
     * 检查边界 / Checked boundaries: `assert.equal(activeLease, true)`; `assert.equal(record.phase, 'intent')`.
     */
    async persistIntent(record: ProjectNotebookRecord) { assert.equal(activeLease, true); events.push('outer-intent'); assert.equal(record.phase, 'intent'); },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: record: ProjectNotebookRecord; payload: { command: string; input: Buffer; sha256: string }。
     * 结果：返回分支计算值（`structuredClone(scopeRecord)`），以 Promise 交付。
     * Result: Return the branch-computed value (`structuredClone(scopeRecord)`) through a Promise.
     * 状态影响 / State effects: `transportSha`, `scopeRecord`, `ticket`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new Error('Notebook commit acknowledgement lost')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `events.push`, `assert.equal`, `JSON.parse`, `readFile`.
     * 检查边界 / Checked boundaries: `assert.equal(activeLease, true)`; `assert.equal(session.status, 'starting')`.
     */
    async start(record: ProjectNotebookRecord, payload: { command: string; input: Buffer; sha256: string }) {
      events.push('scope-start'); assert.equal(activeLease, true);
      const session = JSON.parse(await readFile(file, 'utf8')).sessions[0];
      assert.equal(session.status, 'starting'); assert.equal(session.execution.run, null); assert.deepEqual(session.execution.record, record);
      assert.equal(session.execution.sha256, createHash('sha256').update(payload.input).digest('hex'));
      assert.equal(session.execution.configSha256, projectVersion(project));
      transportSha = payload.sha256; frames.push(Buffer.from(payload.input)); rootLaunchCommands.push(payload.command);
      scopeRecord = { ...record, phase: 'running', inode: '900', sessionId: '$1', paneId: '%2', panePid: 555, paneStartTicks: '1111' };
      ticket = { version: 1, phase: 'active', mode: 'inherit-current', projectId, registryId, identityId, revision: 1,
        runId: record.runId, bootId: record.bootId, build: 'a'.repeat(64), cgroupName: record.scopeName,
        cgroupDevice: '29', cgroupInode: '900', networkDevice: '4', networkInode: '500', namespace: networkIsolation === 'private' ? 'sk-' + projectId : '' };
      if (startFailure) throw new Error('Notebook commit acknowledgement lost'); return structuredClone(scopeRecord);
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: record: ProjectNotebookRecord。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `scopeRecord.phase`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new Error('whole original cgroup still populated')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `events.push`, `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(record.runId, scopeRecord.runId)`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    async stop(record: ProjectNotebookRecord) {
      events.push('scope-stop'); if (cleanupFailure) throw new Error('whole original cgroup still populated');
      if (scopeRecord) assert.equal(record.runId, scopeRecord.runId);
      if (record.bootId !== bootId) events.push('reboot-retirement-without-native-stop');
      else { events.push('whole-domain-removed'); events.push('native-ticket-closed'); }
      if (scopeRecord) scopeRecord.phase = 'stopped';
    },
  };
  const scopes = {
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: _vm: string; captured: Project。
     * 结果：返回分支计算值（`structuredClone(identity)`），以 Promise 交付。
     * Result: Return the branch-computed value (`structuredClone(identity)`) through a Promise.
     * 失败 / Failure: `new AppError('明确迁移原项目目录', 409, 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `assert.equal`, `events.push`, `structuredClone`.
     * 检查边界 / Checked boundaries: `assert.equal(activeLease, true)`; `assert.equal(captured._workspace || 'default', projectId)`.
     */
    async identity(_vm: string, captured: Project) { assert.equal(activeLease, true); assert.equal(captured._workspace || 'default', projectId); events.push('identity');
      if (migration) throw new AppError('明确迁移原项目目录', 409, 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED'); return structuredClone(identity); },
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: _vm: string; captured: Project; execution: { command: string; environment?: Record<string, string> }; owner: { kind: string; runId: string; bootId: string }。
     * 结果：返回受控对象，公开字段包括 `identity, runId, command`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `identity, runId, command`; the actual branch determines its shape.
     * 失败 / Failure: `new Error('native intent acknowledgement lost')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `assert.equal`, `events.push`, `assert.ok`, `events.includes`.
     * 检查边界 / Checked boundaries: `assert.equal(activeLease, true)`; `assert.equal(owner.kind, 'service')`.
     */
    async inherited(_vm: string, captured: Project, execution: { command: string; environment?: Record<string, string> }, owner: { kind: string; runId: string; bootId: string }) {
      assert.equal(activeLease, true); events.push('identity-intent'); assert.equal(owner.kind, 'service'); assert.equal(owner.bootId, originalBoot);
      assert.equal(captured._workspace || 'default', projectId);
      assert.equal(captured.environment?.RESOLVED, 'resolved-secret-value'); assert.ok(events.includes('outer-intent'));
      const payload = projectIdentityPayload(execution), session = JSON.parse(await readFile(file, 'utf8')).sessions[0];
      assert.equal(session.execution.record.runId, owner.runId); assert.equal(session.execution.sha256, payload.sha256);
      if (inheritedFailure) throw new Error('native intent acknowledgement lost');
      return { identity: structuredClone(identity), runId: owner.runId, ...payload, command: '/fixed/controller --run ' + owner.runId + ' --payload ' + payload.sha256 };
    },
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`ticket?.phase === 'active'`），以 Promise 交付。
     * Result: Return the branch-computed value (`ticket?.phase === 'active'`) through a Promise.
     * 失败 / Failure: `new Error('native run acknowledgement lost')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `events.push`.
     */
    async active() { events.push('activate-native'); if (nativeFailure) throw new Error('native run acknowledgement lost'); return ticket?.phase === 'active'; },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`ticket?.phase === 'active'`），以 Promise 交付。
     * Result: Return the branch-computed value (`ticket?.phase === 'active'`) through a Promise.
     * 协作入口 / Collaborators: `events.push`.
     */
    async readonlyActive() { events.push('readonly-native'); return ticket?.phase === 'active'; },
  };
  const identities = { /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`structuredClone(ticket!)`），以 Promise 交付。
   * Result: Return the branch-computed value (`structuredClone(ticket!)`) through a Promise.
   * 协作入口 / Collaborators: `events.push`, `structuredClone`.
   */
  async runReadonly() { events.push('readonly-full-ticket'); return structuredClone(ticket!); } };
  const bridges = { /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: _vm: string; _project: Project; _guest: number; _host: number; _abort: AbortSignal; allowShared: boolean。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `bridge`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `assert.equal`, `events.push`.
   * 检查边界 / Checked boundaries: `assert.equal(allowShared, true)`.
   */
  async open(_vm: string, _project: Project, _guest: number, _host: number, _abort?: AbortSignal, allowShared?: boolean) {
    assert.equal(allowShared, true); events.push('bridge-open'); bridge = true;
  }, /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `bridge`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `events.push`.
   */
  async stop() { events.push('bridge-stop'); bridge = false; }, /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `bridge`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  async close() { bridge = false; } };
  /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: _machines: Parameters<typeof import('../server/guest-task.ts').guestTask>[0]; _vm: string; command: string。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 状态影响 / State effects: `lease.bootId`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `assert.equal`, `rootCommands.push`, `events.push`, `command.startsWith`.
   * 检查边界 / Checked boundaries: `assert.equal(activeLease, true)`.
   */
  const adminTask = (async (_machines: Parameters<typeof import('../server/guest-task.ts').guestTask>[0], _vm: string, command: string) => {
    assert.equal(activeLease, true); rootCommands.push(command); events.push(command.startsWith('# SAKURA_NOTEBOOK_WHEELS') ?
      command.startsWith('# SAKURA_NOTEBOOK_WHEELS_DOWNLOAD') ? 'root-wheel-download' : 'root-wheel-cleanup' : 'root-system-tools');
    if (command.startsWith('# SAKURA_NOTEBOOK_WHEELS_DOWNLOAD')) {
      downloadHook?.(); const request = commandRequest(command);
      const lease = leaseFor(request); if (wrongLease) lease.bootId = randomUUID();
      return { code: 0, stdout: JSON.stringify(lease), stderr: '' };
    }
    if (command.startsWith('# SAKURA_NOTEBOOK_WHEELS_CLEANUP')) {
      if (wheelCleanupFailure) return { code: 1, stdout: '', stderr: 'wheel cleanup refused' };
      if (malformedWheelCleanup) return { code: 0, stdout: 'not-json cleanup acknowledgement', stderr: '' };
      return { code: 0, stdout: JSON.stringify({ cleaned: true, leaseId: commandRequest(command).leaseId }), stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  }) as typeof import('../server/guest-task.ts').guestTask;
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _machines: Machines; _vm: string; captured: Project; execution: { command: string; environment?: Record<string, string> }; _signal: AbortSignal; _log: unknown; _timeout: unknown; _agent: unknown; _cleanup: unknown; expected: { expectedLive: object; expectedBootId: string }。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 状态影响 / State effects: `installed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 失败 / Failure: `new AppError('UID cleanup unconfirmed resolved-secret-value', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'…`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `assert.equal`, `assert.deepEqual`, `events.push`, `projectScripts.push`.
   * 检查边界 / Checked boundaries: `assert.equal(activeLease, true)`; `assert.equal(expected.expectedLive, live)`.
   */
  const runTask = (async (_machines: Machines, _vm: string, captured: Project, execution: { command: string; environment?: Record<string, string> },
    _signal: AbortSignal, _log: unknown, _timeout: unknown, _agent: unknown, _cleanup: unknown, expected: { expectedLive: object; expectedBootId: string }) => {
    assert.equal(activeLease, true); assert.equal(expected.expectedLive, live); assert.equal(expected.expectedBootId, originalBoot);
    assert.equal(captured._workspace || 'default', projectId);
    assert.equal(captured.environment?.RESOLVED, 'resolved-secret-value'); assert.deepEqual(execution.environment, captured.environment);
    events.push('uid-offline-install'); projectScripts.push(execution.command); frames.push(projectIdentityPayload(execution).input);
    if (installFailure) throw new AppError('UID cleanup unconfirmed resolved-secret-value', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    installed = true; events.push('uid-whole-task-domain-closed'); return { code: 0, stdout: '', stderr: '' };
  }) as typeof import('../server/project-run-scope.ts').projectIdentityTask;
  const options = { scopes, identities, terminals, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`processScope`）。
   * Result: Return the branch-computed value (`processScope`).
   */
  processScope: () => processScope, bridges, adminTask, runTask,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`listener`），以 Promise 交付。
     * Result: Return the branch-computed value (`listener`) through a Promise.
     * 协作入口 / Collaborators: `events.push`, `listenerGate`.
     */
    listener: async () => { events.push('uid-listener'); if (listenerGate) await listenerGate(); return listener; } };
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`bridge && listener`），以 Promise 交付。
   * Result: Return the branch-computed value (`bridge && listener`) through a Promise.
   * 协作入口 / Collaborators: `events.push`.
   */
  const probe = async () => { events.push('http-probe'); return bridge && listener; };
  /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`service`），以 Promise 交付。
   * Result: Return the branch-computed value (`service`) through a Promise.
   * 协作入口 / Collaborators: `service.init`, `t.after`.
   */
  const create = async () => { const service = new NotebookEnvironments(machines, workspaces, file, probe, options); await service.init(); t.after(() => service.close()); return service; };
  const service = await create();
  return { service, create, vmId, vm, file, identity, project, projectId, machines, rootCommands, rootLaunchCommands, projectScripts, frames, events,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `version, sessions, environments`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `version, sessions, environments`; the actual branch determines its shape.
     * 失败 / Failure: `error`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `JSON.parse`, `readFile`.
     */
    viewStore: async () => { try { return JSON.parse(await readFile(file, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, sessions: [], environments: [] }; throw error; } },
    /**
     * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
     * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`ticket!`）。
     * Result: Return the branch-computed value (`ticket!`).
     */
    ticket: () => ticket!, /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`scopeRecord!`）。
     * Result: Return the branch-computed value (`scopeRecord!`).
     */
    scopeRecord: () => scopeRecord!,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：返回分支计算值（`installed = value`）。
     * Result: Return the branch-computed value (`installed = value`).
     * 状态影响 / State effects: `installed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setInstalled: (value: boolean) => installed = value, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：返回分支计算值（`listener = value`）。
     * Result: Return the branch-computed value (`listener = value`).
     * 状态影响 / State effects: `listener`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setListener: (value: boolean) => listener = value,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：返回分支计算值（`machineState = value`）。
     * Result: Return the branch-computed value (`machineState = value`).
     * 状态影响 / State effects: `machineState`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setState: (value: string) => machineState = value, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`migration = true`）。
     * Result: Return the branch-computed value (`migration = true`).
     * 状态影响 / State effects: `migration`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setMigration: () => migration = true,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`startFailure = true`）。
     * Result: Return the branch-computed value (`startFailure = true`).
     * 状态影响 / State effects: `startFailure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    failStart: () => startFailure = true, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: value = true。
     * 结果：返回分支计算值（`cleanupFailure = value`）。
     * Result: Return the branch-computed value (`cleanupFailure = value`).
     * 状态影响 / State effects: `cleanupFailure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    failCleanup: (value = true) => cleanupFailure = value,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`nativeFailure = true`）。
     * Result: Return the branch-computed value (`nativeFailure = true`).
     * 状态影响 / State effects: `nativeFailure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    failNative: () => nativeFailure = true, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`inheritedFailure = true`）。
     * Result: Return the branch-computed value (`inheritedFailure = true`).
     * 状态影响 / State effects: `inheritedFailure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    failInherited: () => inheritedFailure = true,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`installFailure = true`）。
     * Result: Return the branch-computed value (`installFailure = true`).
     * 状态影响 / State effects: `installFailure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    failInstall: () => installFailure = true, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`wheelCleanupFailure = true`）。
     * Result: Return the branch-computed value (`wheelCleanupFailure = true`).
     * 状态影响 / State effects: `wheelCleanupFailure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    failWheelCleanup: () => wheelCleanupFailure = true,
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`malformedWheelCleanup = true`）。
     * Result: Return the branch-computed value (`malformedWheelCleanup = true`).
     * 状态影响 / State effects: `malformedWheelCleanup`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    malformedWheelCleanup: () => malformedWheelCleanup = true,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`wrongLease = true`）。
     * Result: Return the branch-computed value (`wrongLease = true`).
     * 状态影响 / State effects: `wrongLease`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    wrongLease: () => wrongLease = true, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: hook: () => void。
     * 结果：返回分支计算值（`downloadHook = hook`）。
     * Result: Return the branch-computed value (`downloadHook = hook`).
     * 状态影响 / State effects: `downloadHook`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    onDownload: (hook: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void) => downloadHook = hook,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: hook: () => void。
     * 结果：返回分支计算值（`prepareFailure = hook`）。
     * Result: Return the branch-computed value (`prepareFailure = hook`).
     * 状态影响 / State effects: `prepareFailure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    onPrepare: (hook: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void) => prepareFailure = hook, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: gate: () => Promise<void>。
     * 结果：返回分支计算值（`listenerGate = gate`）。
     * Result: Return the branch-computed value (`listenerGate = gate`).
     * 状态影响 / State effects: `listenerGate`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    gateListener: (gate?: /**
     * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
     * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<void>) => listenerGate = gate,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: hook: () => void | Promise<void>。
     * 结果：返回分支计算值（`configHook = hook`）。
     * Result: Return the branch-computed value (`configHook = hook`).
     * 状态影响 / State effects: `configHook`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    onConfig: (hook?: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void | Promise<void>) => configHook = hook,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: hook: () => void | Promise<void>。
     * 结果：返回分支计算值（`bootHook = hook`）。
     * Result: Return the branch-computed value (`bootHook = hook`).
     * 状态影响 / State effects: `bootHook`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    onBoot: (hook?: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void | Promise<void>) => bootHook = hook,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：返回分支计算值（`resolvedScope = value`）。
     * Result: Return the branch-computed value (`resolvedScope = value`).
     * 状态影响 / State effects: `resolvedScope`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    resolveScope: (value: string) => resolvedScope = value, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：返回分支计算值（`configScope = value`）。
     * Result: Return the branch-computed value (`configScope = value`).
     * 状态影响 / State effects: `configScope`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    configScope: (value: string) => configScope = value,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：返回分支计算值（`currentScope = value`）。
     * Result: Return the branch-computed value (`currentScope = value`).
     * 状态影响 / State effects: `currentScope`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    currentScope: (value: string) => currentScope = value,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `live`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `machines.live.set`.
     */
    newLive: () => { live = {}; machines.live.set(vmId, live as never); }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `bootId`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `randomUUID`.
     */
    reboot: () => { bootId = randomUUID(); },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：返回分支计算值（`currentProject = value`）。
     * Result: Return the branch-computed value (`currentProject = value`).
     * 状态影响 / State effects: `currentProject`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setCurrent: (value: string) => currentProject = value, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`bridge`）。
     * Result: Return the branch-computed value (`bridge`).
     */
    isBridged: () => bridge, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`activeLease`）。
     * Result: Return the branch-computed value (`activeLease`).
     */
    leaseActive: () => activeLease };
}
/**
 * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
 * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`new AppError('Notebook 原正文摘要不符', 409, 'NOTEBOOK_SCOPE_CHANGED')`）。
 * Result: Return the branch-computed value (`new AppError('Notebook 原正文摘要不符', 409, 'NOTEBOOK_SCOPE_CHANGED')`).
 */
const changedDigest = () => new AppError('Notebook 原正文摘要不符', 409, 'NOTEBOOK_SCOPE_CHANGED');

for (const provider of ['jupyter', 'marimo'] as const)
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `fixture`, `f.setInstalled`, `assert.equal`, `Object.getOwnPropertyDescriptor`.
 * 检查边界 / Checked boundaries: `assert.equal(Object.getOwnPropertyDescriptor(f.project, '_workspace')?.enumerable, false)`; `assert.equal(structuredClone(f.project)._workspace, undefined)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test(`named ${provider}: non-enumerable original scope survives preparation, UID installation and protected service execution`, async t => {
  const f = await fixture(t, 'private', '0123456789abcdef'); f.setInstalled(false);
  assert.equal(Object.getOwnPropertyDescriptor(f.project, '_workspace')?.enumerable, false);
  assert.equal(structuredClone(f.project)._workspace, undefined);
  const result = await f.service.run(f.vmId, { mode: 'start', provider, hostPort: 18888 }, signal, () => {});
  assert.equal(result.session?.status, 'running');
  const session = (await f.viewStore()).sessions[0];
  assert.equal(session.projectId, f.projectId); assert.equal(session.execution.identity.projectId, f.projectId);
  assert.equal(session.execution.record.projectId, f.projectId); assert.equal(session.execution.run.namespace, 'sk-' + f.projectId);
  assert.equal(session.execution.configSha256, projectVersion(f.project));
  assert.ok(f.events.includes('uid-offline-install')); assert.ok(f.events.includes('identity-intent'));
  await f.service.run(f.vmId, { mode: 'stop' }, signal, () => {});
});

for (const stage of ['resolve', 'config'] as const)
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `fixture`, `f.setInstalled`, `Object.defineProperty`, `structuredClone`.
 * 检查边界 / Checked boundaries: `assert.equal(projectVersion(other), projectVersion(f.project))`; `assert.notEqual(other._workspace, f.project._workspace)`.
 */
test(`matching serialized config with wrong ${stage} scope cannot issue identity, download or execute project code`, async t => {
  const f = await fixture(t, 'private', '0123456789abcdef'); f.setInstalled(false);
  const other = Object.defineProperty(structuredClone(f.project), '_workspace', { value: 'fedcba9876543210', enumerable: false });
  assert.equal(projectVersion(other), projectVersion(f.project)); assert.notEqual(other._workspace, f.project._workspace);
  if (stage === 'resolve') f.resolveScope(other._workspace!); else f.configScope(other._workspace!);
  await assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), (error: unknown) =>
    error instanceof AppError && error.code === 'NOTEBOOK_SCOPE_CHANGED');
  for (const event of ['identity', 'root-system-tools', 'root-wheel-download', 'uid-offline-install', 'identity-intent'])
    assert.equal(f.events.includes(event), false);
  assert.equal(f.leaseActive(), false);
});

for (const mutation of ['live', 'scope', 'paused'] as const)
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `fixture`, `f.setInstalled`, `f.onConfig`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), /原项目/)`; `assert.equal(f.events.includes(event), false)`.
 */
test(`an asynchronous config reply cannot admit a captured task after original ${mutation} changes`, async t => {
  const f = await fixture(t, 'host', '0123456789abcdef'); f.setInstalled(false);
  f.onConfig(async () => {
    await Promise.resolve();
    if (mutation === 'live') f.newLive(); else if (mutation === 'scope') f.currentScope('fedcba9876543210'); else f.setState('paused');
  });
  await assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), /原项目/);
  for (const event of ['identity', 'root-system-tools', 'root-wheel-download', 'uid-offline-install']) assert.equal(f.events.includes(event), false);
  assert.equal(f.leaseActive(), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: boot reply cannot admit a replaced live instance even when its boot UUID is unchanged
 * 协作入口 / Collaborators: `fixture`, `f.setInstalled`, `f.onBoot`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), /原项目/)`; `assert.equal(f.events.includes('identity'), false)`.
 */
test('boot reply cannot admit a replaced live instance even when its boot UUID is unchanged', async t => {
  const f = await fixture(t); f.setInstalled(false); let observations = 0;
  f.onBoot(async () => { await Promise.resolve(); if (++observations === 2) f.newLive(); });
  await assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), /原项目/);
  assert.equal(f.events.includes('identity'), false); assert.equal(f.events.includes('root-system-tools'), false); assert.equal(f.leaseActive(), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: administrator system dependency body executes with only the fixed root environment
 * 协作入口 / Collaborators: `notebookToolsScript`, `randomUUID`, `assert.ok`, `command.startsWith`.
 * 检查边界 / Checked boundaries: `assert.ok(command.startsWith('exec /usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=…`; `assert.ok(command.includes('cd /'))`.
 */
test('administrator system dependency body executes with only the fixed root environment', () => {
  for (const distro of ['alpine', 'ubuntu']) {
    const command = notebookToolsScript(distro, randomUUID());
    assert.ok(command.startsWith('exec /usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C PIP_CONFIG_FILE=/dev/null /bin/sh -ec '));
    assert.ok(command.includes('cd /')); assert.equal(command.includes('PYTHONPATH'), false);
    assert.equal(command.includes('private-hook'), false); assert.equal(command.includes('source '), false);
    assert.ok(command.includes('/usr/bin/python3 -I -m pip'));
  }
});

for (const provider of ['jupyter', 'marimo'] as const) for (const network of ['host', 'private'] as const)
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `fixture`, `f.service.run`, `assert.ok`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.ok('session' in result)`; `assert.equal(result.session?.status, 'running')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test(`${provider}/${network}: original UID service, home, protected token and full ticket use a validated loopback bridge`, async t => {
  const f = await fixture(t, network); const result = await f.service.run(f.vmId, { mode: 'start', provider, hostPort: 18888 }, signal, () => {});
  assert.ok('session' in result); assert.equal(result.session?.status, 'running'); const session = (await f.viewStore()).sessions[0], frame = f.frames[0];
  const script = frame.subarray(32, 32 + frame.readUInt32LE(24)).toString();
  assert.ok(script.includes('127.0.0.1')); assert.ok(script.includes('$HOME/.local/share/sakura-notebooks'));
  assert.equal(script.includes('--allow-root'), false); assert.equal(script.includes('0.0.0.0'), false); assert.equal(script.includes('/root'), false);
  assert.ok(frame.includes(Buffer.from(session.token))); assert.ok(frame.includes(Buffer.from('resolved-secret-value')));
  for (const command of [...f.rootCommands, ...f.rootLaunchCommands]) {
    assert.equal(command.includes(session.token), false); assert.equal(command.includes('resolved-secret-value'), false);
    assert.equal(command.includes('notebook-private-雪'), false);
  }
  assert.deepEqual(session.execution.identity, f.identity); assert.deepEqual(session.execution.run, f.ticket());
  assert.deepEqual(session.execution.record, f.scopeRecord()); assert.deepEqual(f.vm.forwards, []);
  assert.ok(f.events.indexOf('lease-prepare') < f.events.indexOf('identity-intent'));
  assert.ok(f.events.indexOf('readonly-full-ticket') < f.events.indexOf('bridge-open'));
  assert.ok(f.events.indexOf('uid-listener') < f.events.indexOf('http-probe')); assert.equal(f.leaseActive(), false);
  const link = await f.service.link(f.vmId); assert.ok(link.url.includes(session.token));
  assert.equal(JSON.stringify(result).includes(session.token), false); assert.equal(JSON.stringify(await f.service.view(f.vmId)).includes(session.token), false);
  await f.service.run(f.vmId, { mode: 'stop' }, signal, () => {});
  assert.ok(f.events.indexOf('whole-domain-removed') < f.events.indexOf('native-ticket-closed'));
  assert.deepEqual((await f.viewStore()).sessions, []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: venv and strict offline wheel install execute only within captured UID task, with an original protected wheel lease
 * 协作入口 / Collaborators: `fixture`, `f.setInstalled`, `f.service.run`, `f.rootCommands.filter`.
 * 检查边界 / Checked boundaries: `assert.equal(command.includes(value), false, value)`; `assert.ok(download.includes('https://pypi.org/simple'))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('venv and strict offline wheel install execute only within captured UID task, with an original protected wheel lease', async t => {
  const f = await fixture(t, 'private'); f.setInstalled(false);
  await f.service.run(f.vmId, { mode: 'install', provider: 'jupyter' }, signal, () => {});
  const root = f.rootCommands.filter(command => !command.startsWith('# SAKURA_NOTEBOOK_INSTALLED'));
  for (const command of root) for (const value of [f.project.directory, '/private/bin', '/private/pip.conf', 'private-hook', 'resolved-secret-value'])
    assert.equal(command.includes(value), false, value);
  const download = root.find(command => command.startsWith('# SAKURA_NOTEBOOK_WHEELS_DOWNLOAD'))!;
  assert.ok(download.includes('https://pypi.org/simple')); assert.ok(download.includes('PIP_CONFIG_FILE=/dev/null'));
  assert.ok(decodeSource(download).includes("'/usr/bin/python3','-I','-m','pip','--isolated','download'"));
  assert.ok(download.includes('--only-binary=:all:')); assert.ok(download.includes('subprocess.DEVNULL'));
  const task = f.projectScripts[0]; assert.ok(task.includes('venv --without-pip'));
  assert.ok(task.includes('--no-index')); assert.ok(task.includes('--only-binary=:all:')); assert.ok(task.includes('--no-cache-dir'));
  const decodedTask = task.replaceAll("'\\''", "'");
  assert.ok(decodedTask.includes("lease['manifestSha256']")); assert.ok(decodedTask.includes("expected['sha256']")); assert.ok(task.includes('O_NOFOLLOW'));
  assert.ok(f.events.indexOf('uid-whole-task-domain-closed') < f.events.indexOf('root-wheel-cleanup'));
  assert.equal((await f.viewStore()).environments[0].identity.uid, f.identity.uid); assert.equal(f.leaseActive(), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: explicit legacy directory migration refusal occurs before shared download or any UID execution
 * 协作入口 / Collaborators: `fixture`, `f.setMigration`, `f.setInstalled`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.run(f.vmId, { mode: 'start' }, signal, () => {}), /明确迁移/)`; `assert.equal(f.events.includes('root-system-tools'), false)`.
 */
test('explicit legacy directory migration refusal occurs before shared download or any UID execution', async t => {
  const f = await fixture(t); f.setMigration(); f.setInstalled(false);
  await assert.rejects(f.service.run(f.vmId, { mode: 'start' }, signal, () => {}), /明确迁移/);
  assert.equal(f.events.includes('root-system-tools'), false); assert.equal(f.events.includes('root-wheel-download'), false);
  assert.equal(f.events.includes('identity-intent'), false); assert.equal(f.events.includes('uid-offline-install'), false); assert.equal(f.leaseActive(), false);
});

for (const mutation of ['config', 'live', 'boot'] as const) /**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `fixture`, `f.setInstalled`, `f.onDownload`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), /原项目/)`; `assert.equal(f.events.includes('uid-offline-install'), false)`.
 */
test(`captured ${mutation} change during administrator download refuses UID installation and releases its lease`, async t => {
  const f = await fixture(t); f.setInstalled(false);
  f.onDownload(() => { if (mutation === 'config') f.project.environment!.TOKEN = 'changed'; else if (mutation === 'live') f.newLive(); else f.reboot(); });
  await assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), /原项目/);
  assert.equal(f.events.includes('uid-offline-install'), false); assert.equal(f.events.includes('root-wheel-cleanup'), false);
  assert.equal(f.leaseActive(), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: wrong downloaded boot lease cannot enter UID code
 * 协作入口 / Collaborators: `fixture`, `f.setInstalled`, `f.wrongLease`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), /原项目/)`; `assert.equal(f.events.includes('uid-offline-install'), false)`.
 */
test('wrong downloaded boot lease cannot enter UID code', async t => {
  const f = await fixture(t); f.setInstalled(false); f.wrongLease();
  await assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), /原项目/);
  assert.equal(f.events.includes('uid-offline-install'), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: uncertain original UID task cleanup preserves wheel cache and redacts the project secret
 * 协作入口 / Collaborators: `fixture`, `f.setInstalled`, `f.failInstall`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), (error: unknown) => error instanceof AppError && erro…`; `assert.equal(f.events.includes('root-wheel-cleanup'), false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('uncertain original UID task cleanup preserves wheel cache and redacts the project secret', async t => {
  const f = await fixture(t); f.setInstalled(false); f.failInstall();
  await assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), (error: unknown) =>
    error instanceof AppError && error.status === 503 && error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED' && !error.message.includes('resolved-secret-value'));
  assert.equal(f.events.includes('root-wheel-cleanup'), false); assert.equal((await f.viewStore()).environments.length, 0);
  assert.equal(f.leaseActive(), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: wheel cache cleanup failure never reports an installed environment
 * 协作入口 / Collaborators: `fixture`, `f.setInstalled`, `f.failWheelCleanup`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), (error: unknown) => error instanceof AppError && erro…`; `assert.equal((await f.viewStore()).environments.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('wheel cache cleanup failure never reports an installed environment', async t => {
  const f = await fixture(t); f.setInstalled(false); f.failWheelCleanup();
  await assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), (error: unknown) =>
    error instanceof AppError && error.code === 'NOTEBOOK_PREPARE_CLEANUP_FAILED');
  assert.equal((await f.viewStore()).environments.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: garbage cleanup acknowledgement is an explicit 503 and preserves the complete original cache lease for review
 * 协作入口 / Collaborators: `fixture`, `f.setInstalled`, `f.malformedWheelCleanup`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), (error: unknown) => error instanceof AppError && erro…`; `assert.equal(metadata.phase, 'review')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('garbage cleanup acknowledgement is an explicit 503 and preserves the complete original cache lease for review', async t => {
  const f = await fixture(t); f.setInstalled(false); f.malformedWheelCleanup();
  await assert.rejects(f.service.run(f.vmId, { mode: 'install' }, signal, () => {}), (error: unknown) =>
    error instanceof AppError && error.status === 503 && error.code === 'NOTEBOOK_PREPARE_CLEANUP_FAILED');
  const request = commandRequest(f.rootCommands.find(command => command.startsWith('# SAKURA_NOTEBOOK_WHEELS_DOWNLOAD'))!);
  const file = join(vmDir(f.vmId), 'project-notebooks', f.projectId, 'wheelhouses', request.leaseId + '.json');
  const metadata = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(metadata.phase, 'review'); assert.deepEqual(metadata.lease, leaseFor(request));
  assert.equal((await f.viewStore()).environments.length, 0); assert.equal(f.leaseActive(), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: readonly reload and link do not advance host receipts, issue preparation, or install anything
 * 状态影响 / State effects: `f.events.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.service.run`, `f.service.close`, `readFile`.
 * 检查边界 / Checked boundaries: `assert.equal((await reopened.view(f.vmId)).session?.status, 'running')`; `assert.deepEqual(await readFile(f.file), before)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('readonly reload and link do not advance host receipts, issue preparation, or install anything', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {});
  await f.service.close(); const before = await readFile(f.file), reopened = await f.create(); f.events.length = 0;
  assert.equal((await reopened.view(f.vmId)).session?.status, 'running'); await reopened.link(f.vmId);
  assert.deepEqual(await readFile(f.file), before);
  for (const event of ['lease-prepare', 'identity', 'outer-intent', 'identity-intent', 'activate-native', 'root-system-tools']) assert.equal(f.events.includes(event), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: healthy HTTP cannot replace original native inode, boot, run or build
 * 状态影响 / State effects: `f.events.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.service.run`, `f.ticket`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.link(f.vmId), /原项目/)`; `assert.equal(f.isBridged(), false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('healthy HTTP cannot replace original native inode, boot, run or build', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {});
  const original = { ...f.ticket() };
  for (const substitution of [{ cgroupInode: '901' }, { bootId: randomUUID() }, { runId: randomUUID() }, { build: 'b'.repeat(64) }]) {
    Object.assign(f.ticket(), original, substitution); f.events.length = 0; const before = await readFile(f.file);
    await assert.rejects(f.service.link(f.vmId), /原项目/); assert.equal(f.isBridged(), false);
    assert.equal(f.events.includes('http-probe'), false); assert.deepEqual(await readFile(f.file), before);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an HTTP listener with the wrong ownership cannot reopen a bridge
 * 状态影响 / State effects: `f.events.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.service.run`, `f.setListener`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.link(f.vmId), /原项目/)`; `assert.equal(f.events.includes('http-probe'), false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('an HTTP listener with the wrong ownership cannot reopen a bridge', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {}); f.setListener(false);
  f.events.length = 0; await assert.rejects(f.service.link(f.vmId), /原项目/); assert.equal(f.events.includes('http-probe'), false);
  const source = decodeSource(notebookListenerCommand((await f.viewStore()).sessions[0]));
  for (const needle of ["status.get('Uid'", "status.get('Gid'", 'before[19]==after[19]', 'socket:[', "request['cgroupInode']", '0100007F:']) assert.ok(source.includes(needle));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: changed captured environment or directory refuses readonly access while original-owner stop remains possible
 * 状态影响 / State effects: `f.project.environment!.TOKEN`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.service.run`, `assert.rejects`, `f.service.link`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.link(f.vmId), /原项目/)`; `assert.deepEqual((await f.viewStore()).sessions, [])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('changed captured environment or directory refuses readonly access while original-owner stop remains possible', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {});
  f.project.environment!.TOKEN = 'changed'; await assert.rejects(f.service.link(f.vmId), /原项目/);
  await f.service.run(f.vmId, { mode: 'stop' }, signal, () => {}); assert.deepEqual((await f.viewStore()).sessions, []);
});

for (const failure of ['start', 'inherited', 'native'] as const) /**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 状态影响 / State effects: `f.events.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.failCleanup`, `f.failStart`, `f.failInherited`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {}), (error: unknown) => error instanceof A…`; `assert.equal(record.status, 'review')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test(`lost ${failure} acknowledgement preserves original cleanup ownership until full-domain retry succeeds`, async t => {
  const f = await fixture(t); f.failCleanup(); if (failure === 'start') f.failStart(); else if (failure === 'inherited') f.failInherited(); else f.failNative();
  await assert.rejects(f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {}), (error: unknown) =>
    error instanceof AppError && error.code === 'NOTEBOOK_CLEANUP_FAILED' && error.status === 503 && error.message.includes('acknowledgement lost'));
  const record = (await f.viewStore()).sessions[0]; assert.equal(record.status, 'review'); assert.equal(record.execution.run, null);
  const reopened = await f.create(), before = await readFile(f.file); f.events.length = 0;
  await assert.rejects(reopened.link(f.vmId)); assert.deepEqual(await readFile(f.file), before); assert.equal(f.events.includes('bridge-open'), false);
  f.failCleanup(false); await reopened.run(f.vmId, { mode: 'stop' }, signal, () => {}); assert.deepEqual((await f.viewStore()).sessions, []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed whole-domain stop retains complete original record and permanently closes its entrance until explicit retry
 * 协作入口 / Collaborators: `fixture`, `f.service.run`, `f.viewStore`, `f.failCleanup`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.run(f.vmId, { mode: 'stop' }, signal, () => {}), /完整运行域清理未确认/)`; `assert.deepEqual(saved.execution, original)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('failed whole-domain stop retains complete original record and permanently closes its entrance until explicit retry', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {});
  const original = (await f.viewStore()).sessions[0].execution; f.failCleanup();
  await assert.rejects(f.service.run(f.vmId, { mode: 'stop' }, signal, () => {}), /完整运行域清理未确认/);
  const saved = (await f.viewStore()).sessions[0]; assert.deepEqual(saved.execution, original); assert.equal(saved.status, 'review');
  await assert.rejects(f.service.link(f.vmId)); assert.equal(f.isBridged(), false); f.failCleanup(false);
  await f.service.run(f.vmId, { mode: 'stop' }, signal, () => {});
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cold reboot readonly rejects the original full run and explicit stop never sends native stop into the new boot
 * 状态影响 / State effects: `f.events.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.service.run`, `f.reboot`, `readFile`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.link(f.vmId))`; `assert.deepEqual(await readFile(f.file), before)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cold reboot readonly rejects the original full run and explicit stop never sends native stop into the new boot', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {}); f.reboot();
  const before = await readFile(f.file); await assert.rejects(f.service.link(f.vmId)); assert.deepEqual(await readFile(f.file), before);
  f.events.length = 0; await f.service.run(f.vmId, { mode: 'stop' }, signal, () => {});
  assert.ok(f.events.includes('reboot-retirement-without-native-stop')); assert.equal(f.events.includes('native-ticket-closed'), false);
  assert.deepEqual((await f.viewStore()).sessions, []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: paused VM cannot discard an original Notebook execution
 * 协作入口 / Collaborators: `fixture`, `f.service.run`, `readFile`, `f.setState`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.run(f.vmId, { mode: 'stop' }, signal, () => {}), /启动或恢复/)`; `assert.deepEqual(await readFile(f.file), before)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('paused VM cannot discard an original Notebook execution', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {});
  const before = await readFile(f.file); f.setState('paused'); await assert.rejects(f.service.run(f.vmId, { mode: 'stop' }, signal, () => {}), /启动或恢复/);
  assert.deepEqual(await readFile(f.file), before);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy root record remains unchanged for review and never gets tmux-name cleanup authority
 * 协作入口 / Collaborators: `fixture`, `'a'.repeat`, `new Date().toISOString`, `f.service.close`.
 * 检查边界 / Checked boundaries: `assert.equal((await reopened.view(f.vmId)).session?.needsReview, true)`; `assert.equal((await reopened.view(f.vmId)).session?.status, 'review')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('legacy root record remains unchanged for review and never gets tmux-name cleanup authority', async t => {
  const f = await fixture(t), old = { vmId: f.vmId, projectId: 'default', provider: 'jupyter', directory: f.project.directory,
    guestPort: 8888, hostPort: 18888, token: 'a'.repeat(64), createdForward: true, networkIsolation: 'host', status: 'starting', startedAt: new Date().toISOString() };
  await f.service.close(); await writeFile(f.file, JSON.stringify({ version: 1, sessions: [old] }));
  const before = await readFile(f.file), reopened = await f.create();
  assert.equal((await reopened.view(f.vmId)).session?.needsReview, true); assert.equal((await reopened.view(f.vmId)).session?.status, 'review');
  await assert.rejects(reopened.link(f.vmId), /旧 Notebook/); await assert.rejects(reopened.run(f.vmId, { mode: 'stop' }, signal, () => {}), /旧 Notebook/);
  assert.deepEqual(await readFile(f.file), before); assert.equal(f.events.includes('scope-stop'), false);
  assert.equal(f.rootCommands.some(command => command.includes('tmux kill-session')), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a stopped stale status cannot reopen the old Notebook bridge
 * 协作入口 / Collaborators: `fixture`, `f.service.run`, `f.gateListener`, `f.service.view`.
 * 检查边界 / Checked boundaries: `assert.equal(reached, true)`; `assert.equal(f.isBridged(), false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a stopped stale status cannot reopen the old Notebook bridge', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {});
  let release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, reached = false; const gate = new Promise<void>(done => release = done);
  f.gateListener(async () => { reached = true; await gate; }); const view = f.service.view(f.vmId);
  for (let i = 0; i < 100 && !reached; i++) await new Promise(done => setTimeout(done, 5)); assert.equal(reached, true);
  const stopping = f.service.run(f.vmId, { mode: 'stop' }, signal, () => {}); release(); await stopping; await view;
  assert.equal(f.isBridged(), false); assert.equal((await f.service.view(f.vmId)).session, null);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: malformed immutable Notebook receipt cannot be made healthy by HTTP
 * 状态影响 / State effects: `store.sessions[0].execution.run`, `store.sessions[0].execution.sha256`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.service.run`, `f.service.close`, `f.viewStore`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.create())`; `assert.deepEqual(await readFile(f.file), before)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('malformed immutable Notebook receipt cannot be made healthy by HTTP', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {}); await f.service.close();
  const store = await f.viewStore(); store.sessions[0].execution.run = null; await writeFile(f.file, JSON.stringify(store));
  const before = await readFile(f.file); await assert.rejects(f.create()); assert.deepEqual(await readFile(f.file), before);
  store.sessions[0].execution.run = f.ticket(); store.sessions[0].execution.sha256 = 'b'.repeat(64); await writeFile(f.file, JSON.stringify(store));
  const reopened = await f.create(); await assert.rejects(reopened.link(f.vmId), /原正文摘要/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Notebook namespace, runtime receipt and service UUID never reserve user service names or Browser namespaces
 * 协作入口 / Collaborators: `fixture`, `projectNotebookScopePaths`, `assert.equal`, `assert.notEqual`.
 * 检查边界 / Checked boundaries: `assert.equal(paths.guest, '/run/sakura-notebook/default')`; `assert.equal(paths.session, 'sakura-notebook-default')`.
 */
test('Notebook namespace, runtime receipt and service UUID never reserve user service names or Browser namespaces', async t => {
  const f = await fixture(t), paths = projectNotebookScopePaths(f.project);
  assert.equal(paths.guest, '/run/sakura-notebook/default'); assert.equal(paths.session, 'sakura-notebook-default');
  assert.notEqual(paths.guest, projectServiceScopePaths(f.project, 'notebook').guest);
  assert.notEqual(paths.session, projectServiceScopePaths(f.project, 'notebook').session);
  assert.notEqual(paths.guest, projectBrowserIdeScopePaths(f.project).guest);
  const scope = new ProjectNotebookScope(f.machines, f.vmId, f.project), intent = scope.newIntent('a'.repeat(64), randomUUID());
  assert.equal(scope.receipt(), join(vmDir(f.vmId), 'project-notebooks/default/runtime.json'));
  assert.equal(intent.scopeName, 'sakura-service-' + intent.runId); assert.equal(intent.name, 'notebook');
  assert.throws(() => projectNotebookRecordSchema.parse({ ...intent, session: 'sakura-service-notebook' }));
  assert.throws(() => notebookSessionSchema.parse({ vmId: f.vmId, projectId: 'default', provider: 'jupyter', directory: f.project.directory,
    guestPort: 8888, hostPort: 18888, token: 'a'.repeat(64), createdForward: true, status: 'running', startedAt: new Date().toISOString(),
    execution: { identity: f.identity, record: intent, run: null, sha256: 'a'.repeat(64), configSha256: projectVersion(f.project) } }));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: root helpers parse as isolated Python and wheel file regex accepts wheels but refuses paths and code suffixes
 * 协作入口 / Collaborators: `fixture`, `leaseFor`, `notebookWheelRequest`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.equal(parsed.status, 0, parsed.stderr)`; `assert.equal(regex.status, 0, regex.stderr)`.
 */
test('root helpers parse as isolated Python and wheel file regex accepts wheels but refuses paths and code suffixes', async t => {
  const f = await fixture(t), lease = leaseFor(notebookWheelRequest(randomUUID(), 'jupyter'));
  const intent = new ProjectNotebookScope(f.machines, f.vmId, f.project).newIntent('a'.repeat(64), randomUUID());
  const input = projectIdentityPayload({ command: 'echo owned', environment: { TOKEN: 'private' } });
  const commands = [notebookWheelhouseCommand('download', { leaseId: lease.leaseId, bootId: lease.bootId, provider: lease.provider }),
    notebookWheelhouseCommand('cleanup', lease), notebookInstalledCommand(f.identity, 'jupyter'),
    projectNotebookScopeCommand(f.project, 'start', intent, { ...input, runId: intent.runId, command: '/fixed/native/controller' })];
  for (const command of commands) {
    const source = command.startsWith('# SAKURA_PROJECT_SERVICE') ? command.split('/usr/bin/python3 -I -S -c ')[1].slice(1, -1).replaceAll("'\\''", "'") : decodeSource(command);
    const parsed = spawnSync('python', ['-I', '-S', '-c', 'import ast,sys;ast.parse(sys.stdin.read())'], { input: source, encoding: 'utf8', windowsHide: true });
    assert.equal(parsed.status, 0, parsed.stderr);
  }
  const downloaded = decodeSource(commands[0]), check = `import ast,json,re,sys\nroot=ast.parse(sys.stdin.read())\n` +
    `patterns=list({node.args[0].value for node in ast.walk(root) if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='fullmatch' and isinstance(node.args[0],ast.Constant) and node.args[0].value.endswith('whl')})\n` +
    `assert len(patterns)==1\nassert re.fullmatch(patterns[0],'pip-25.0-py3-none-any.whl')\n` +
    `assert not re.fullmatch(patterns[0],'../pip.whl')\nassert not re.fullmatch(patterns[0],'evil.py')\n`;
  const regex = spawnSync('python', ['-I', '-S', '-c', check], { input: downloaded, encoding: 'utf8', windowsHide: true });
  assert.equal(regex.status, 0, regex.stderr);
  const code = notebookInstallExecution(f.identity, lease); assert.ok(code.includes('runpy')); assert.ok(code.includes('--without-pip'));
  const tools = notebookToolsScript('ubuntu', lease.bootId); assert.ok(tools.includes('cd /')); assert.equal(tools.includes(f.project.directory), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: untrusted wheel lease paths, duplicate entries and oversized cache metadata are refused before generating Root commands
 * 协作入口 / Collaborators: `leaseFor`, `notebookWheelRequest`, `randomUUID`, `'1'.repeat`.
 * 检查边界 / Checked boundaries: `assert.throws(() => notebookWheelhouseCommand('cleanup', { ...lease, ...changed }))`; `assert.throws(() => notebookInstallExecution({} as never, { ...lease, files: lease.files.filter(file => !file.name.startsWith('pip…`.
 */
test('untrusted wheel lease paths, duplicate entries and oversized cache metadata are refused before generating Root commands', () => {
  const lease = leaseFor(notebookWheelRequest(randomUUID(), 'marimo'));
  for (const changed of [{ path: '/root' }, { files: [...lease.files, lease.files[0]] }, { files: [{ ...lease.files[0], name: '../evil.whl' }] },
    { device: '1'.repeat(21) }, { inode: '1'.repeat(21) },
    { files: [{ ...lease.files[0], bytes: 1024 * 1024 * 1024 }] }]) assert.throws(() => notebookWheelhouseCommand('cleanup', { ...lease, ...changed }));
  assert.throws(() => notebookInstallExecution({} as never, { ...lease, files: lease.files.filter(file => !file.name.startsWith('pip-')) }));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: actual Python wheel verifier and cache retirement reject substituted ownership, content and late directory replacements
 * 协作入口 / Collaborators: `notebookWheelRequest`, `randomUUID`, `decodeSource`, `notebookWheelhouseCommand`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 0, result.stderr)`; `assert.ok(result.stdout.includes('7 ownership/content substitutions refused'))`.
 */
test('actual Python wheel verifier and cache retirement reject substituted ownership, content and late directory replacements', () => {
  const request = notebookWheelRequest(randomUUID(), 'jupyter'), source = decodeSource(notebookWheelhouseCommand('download', request));
  const cleanup = decodeSource(notebookWheelhouseCommand('cleanup', leaseFor(request)));
  const program = `import ast,copy,hashlib,json,stat,sys,types
bundle=json.loads(sys.stdin.read());tree=ast.parse(bundle['verify']);nodes=[]
for node in tree.body:
 if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='request' for target in node.targets):break
 nodes.append(node)
namespace={};exec(compile(ast.Module(body=nodes,type_ignores=[]),'wheel-verifier','exec'),namespace)
path='/var/cache/sakura/notebook-wheels/00000000-0000-0000-0000-000000000001'
files=[{'name':'pip-25.0-py3-none-any.whl','sha256':hashlib.sha256(b'wheelbytes').hexdigest(),'bytes':10,'device':'1','inode':'21'}]
lease={'version':1,'leaseId':path.rsplit('/',1)[1],'bootId':'00000000-0000-0000-0000-000000000002','provider':'jupyter','path':path,'device':'1','inode':'20','files':files}
manifest=json.dumps(lease,sort_keys=True,separators=(',',':')).encode();lease['manifestSha256']=hashlib.sha256(manifest).hexdigest()
class Files:
 O_RDONLY=0;O_DIRECTORY=1;O_NOFOLLOW=2;O_NONBLOCK=4;O_CLOEXEC=8
 def __init__(self):
  self.next=1;self.fds={};self.positions={};self.entries={};self.late=None
  for index,folder in enumerate(['/','/var','/var/cache','/var/cache/sakura','/var/cache/sakura/notebook-wheels',path]):self.entries[folder]={'mode':stat.S_IFDIR|0o555,'inode':20 if folder==path else index+1,'uid':0,'data':b''}
  self.entries[path+'/pip-25.0-py3-none-any.whl']={'mode':stat.S_IFREG|0o444,'inode':21,'uid':0,'data':b'wheelbytes'}
  self.entries[path+'/.manifest.json']={'mode':stat.S_IFREG|0o444,'inode':22,'uid':0,'data':manifest}
 def open(self,name,flags,dir_fd=None):
  file=(self.fds[dir_fd].rstrip('/')+'/'+name) if dir_fd is not None else name
  if file not in self.entries:raise FileNotFoundError(file)
  entry=self.entries[file]
  if flags&self.O_NOFOLLOW and stat.S_ISLNK(entry['mode']):raise OSError('symlink')
  fd=self.next;self.next+=1;self.fds[fd]=file;self.positions[fd]=0;return fd
 def close(self,fd):del self.fds[fd];del self.positions[fd]
 def fstat(self,fd):
  entry=self.entries[self.fds[fd]];return types.SimpleNamespace(st_uid=entry['uid'],st_gid=0,st_mode=entry['mode'],st_nlink=1,st_dev=1,st_ino=entry['inode'],st_size=len(entry['data']),st_mtime_ns=1,st_ctime_ns=1)
 def read(self,fd,count):
  entry=self.entries[self.fds[fd]];start=self.positions[fd];self.positions[fd]+=count;return entry['data'][start:start+count]
 def listdir(self,fd):
  prefix=self.fds[fd]+'/';return [key[len(prefix):] for key in self.entries if key.startswith(prefix) and '/' not in key[len(prefix):]]
 def fchmod(self,fd,mode):self.entries[self.fds[fd]]['mode']=(self.entries[self.fds[fd]]['mode']&0o170000)|mode
 def fsync(self,fd):assert fd in self.fds
 def stat(self,name,dir_fd=None,follow_symlinks=False):
  fd=self.open(name,self.O_NOFOLLOW,dir_fd=dir_fd)
  try:return self.fstat(fd)
  finally:self.close(fd)
 def unlink(self,name,dir_fd):
  file=self.fds[dir_fd]+'/'+name;del self.entries[file]
  if name=='.manifest.json' and self.late=='inode':self.entries[path]['inode']=99
  if name=='.manifest.json' and self.late=='extra':self.entries[path+'/late.whl']={'mode':stat.S_IFREG|0o444,'inode':99,'uid':0,'data':b'late'}
 def rmdir(self,name,dir_fd):
  folder=self.fds[dir_fd]+'/'+name
  if any(key.startswith(folder+'/') for key in self.entries):raise OSError('not empty')
  del self.entries[folder]
  if self.late=='reappeared':self.entries[folder]={'mode':stat.S_IFDIR|0o555,'inode':99,'uid':0,'data':b''}
def check(change=None):
 model=Files()
 if change:change(model)
 namespace['os']=model
 try:
  fd=namespace['verified'](copy.deepcopy(lease));model.close(fd);return True
 except (ValueError,OSError):return False
assert check()
compact={key:value for key,value in lease.items() if key!='files'};saved=lease;lease=compact;assert check();lease=saved
for change in [lambda model:model.entries[path+'/pip-25.0-py3-none-any.whl'].update(data=b'badcontent'),lambda model:model.entries[path+'/pip-25.0-py3-none-any.whl'].update(inode=99),lambda model:model.entries[path].update(uid=20001),lambda model:model.entries[path].update(inode=99),lambda model:model.entries[path+'/.manifest.json'].update(data=manifest+b' '),lambda model:model.entries.update({path+'/evil.py':{'mode':stat.S_IFREG|0o444,'inode':30,'uid':0,'data':b'bad'}}),lambda model:model.entries[path+'/pip-25.0-py3-none-any.whl'].update(mode=stat.S_IFLNK|0o777)]:assert not check(change)
retirement=next(node.orelse for node in ast.parse(bundle['cleanup']).body if isinstance(node,ast.If) and isinstance(node.test,ast.Compare) and isinstance(node.test.left,ast.Name) and node.test.left.id=='operation')
retirement=compile(ast.Module(body=retirement,type_ignores=[]),'wheel-retirement','exec')
for change in [None,'inode','extra','reappeared']:
 model=Files();model.late=change;receipts=[]
 namespace['os']=model;namespace['request']={key:value for key,value in lease.items() if key!='files'};namespace['print']=receipts.append
 try:exec(retirement,namespace)
 except (ValueError,OSError):assert change is not None and not receipts
 else:assert change is None and path not in model.entries and json.loads(receipts[0])=={'cleaned':True,'leaseId':lease['leaseId']}
 assert not model.fds
print('1 original wheelhouse accepted; 7 ownership/content substitutions refused; 1 exact retirement and 3 late replacements checked')
`;
  const result = spawnSync('python', ['-I', '-S', '-c', program], { input: JSON.stringify({ verify: source, cleanup }), encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr); assert.ok(result.stdout.includes('7 ownership/content substitutions refused'));
  assert.ok(result.stdout.includes('1 exact retirement and 3 late replacements checked'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: starting full receipt reload remains review without opening a listener or advancing host state
 * 状态影响 / State effects: `store.sessions[0].status`, `f.events.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.service.run`, `f.service.close`, `f.viewStore`.
 * 检查边界 / Checked boundaries: `assert.equal((await reopened.view(f.vmId)).session?.needsReview, true)`; `assert.rejects(reopened.link(f.vmId))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('starting full receipt reload remains review without opening a listener or advancing host state', async t => {
  const f = await fixture(t); await f.service.run(f.vmId, { mode: 'start', hostPort: 18888 }, signal, () => {}); await f.service.close();
  const store = await f.viewStore(); store.sessions[0].status = 'starting'; await writeFile(f.file, JSON.stringify(store));
  const before = await readFile(f.file), reopened = await f.create(); f.events.length = 0;
  assert.equal((await reopened.view(f.vmId)).session?.needsReview, true); await assert.rejects(reopened.link(f.vmId));
  assert.deepEqual(await readFile(f.file), before); assert.equal(f.events.includes('bridge-open'), false); assert.equal(f.events.includes('http-probe'), false);
  await reopened.run(f.vmId, { mode: 'stop' }, signal, () => {});
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: real Notebook scope status pins saved transport metadata and rejects an immutable digest substitution
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `randomUUID`, `scope.newIntent`, `'a'.repeat`.
 * 检查边界 / Checked boundaries: `assert.equal((await scope.status(signal, input.sha256)).status, 'running')`; `assert.rejects(scope.status(signal, 'f'.repeat(64)), /受保护正文/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('real Notebook scope status pins saved transport metadata and rejects an immutable digest substitution', async t => {
  const f = await fixture(t), scope = new ProjectNotebookScope(f.machines, f.vmId, f.project), bootId = randomUUID();
  const intent = scope.newIntent('a'.repeat(64), bootId), record = { ...intent, inode: '900', phase: 'running', sessionId: '$1', paneId: '%2', panePid: 555, paneStartTicks: '1111' };
  await mkdir(join(scope.receipt(), '..'), { recursive: true }); await writeFile(scope.receipt(), JSON.stringify(record));
  const input = projectIdentityPayload({ command: 'sleep 900' });
  await writeFile(join(scope.receipt(), '..', 'transport-' + intent.runId + '.json'), JSON.stringify({ version: 1, record,
    sha256: input.sha256, bytes: input.input.length, commandSha256: 'b'.repeat(64) }));
  const originalExec = f.machines.exec;
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _vm; command。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: real Notebook scope status pins saved transport metadata and rejects an immutable digest substitution
   * 协作入口 / Collaborators: `assert.ok`, `command.includes`, `JSON.stringify`.
   * 检查边界 / Checked boundaries: `assert.ok(command.includes('/run/sakura-notebook'))`.
   */
  async (_vm, command) => { assert.ok(command.includes('/run/sakura-notebook'));
    return { code: 0, stdout: JSON.stringify({ status: 'running', bootId, record }), stderr: '' }; };
  const before = await readFile(scope.receipt()); assert.equal((await scope.status(signal, input.sha256)).status, 'running');
  await assert.rejects(scope.status(signal, 'f'.repeat(64)), /受保护正文/); assert.deepEqual(await readFile(scope.receipt()), before);
  f.machines.exec = originalExec;
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: maximum wheel metadata remains a compact, protected ABI1 frame rather than a Root command
 * 状态影响 / State effects: `lease.files`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `leaseFor`, `notebookWheelRequest`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.ok(frame.input.length < 16384)`; `assert.equal(command.includes('notebook_dependency_500'), false)`.
 */
test('maximum wheel metadata remains a compact, protected ABI1 frame rather than a Root command', async t => {
  const f = await fixture(t), lease = leaseFor(notebookWheelRequest(randomUUID(), 'jupyter'));
  lease.files = [lease.files[0], ...Array.from({ length: 511 }, (_, index) => ({ ...lease.files[1],
    name: 'notebook_dependency_' + index + '-1.0-py3-none-any.whl', inode: String(300 + index) }))];
  const command = notebookInstallExecution(f.identity, lease), frame = projectIdentityPayload({ command, environment: { TOKEN: 'private' } });
  assert.ok(frame.input.length < 16384); assert.equal(command.includes('notebook_dependency_500'), false);
  assert.ok(command.includes(lease.manifestSha256));
  const download = decodeSource(notebookWheelhouseCommand('download', { leaseId: lease.leaseId, bootId: lease.bootId, provider: lease.provider }));
  assert.ok(download.includes('os.fchmod(manifest,0o444)'), 'UID read access must survive the administrator umask');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: 512 maximum length wheel names never expand the administrator cleanup argv or lose the pinned manifest file set
 * 状态影响 / State effects: `lease.device`, `lease.inode`, `lease.files`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `leaseFor`, `notebookWheelRequest`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.equal(Buffer.byteLength(command), Buffer.byteLength(small))`; `assert.ok(Buffer.byteLength(command) < 16384)`.
 */
test('512 maximum length wheel names never expand the administrator cleanup argv or lose the pinned manifest file set', async t => {
  const f = await fixture(t), lease = leaseFor(notebookWheelRequest(randomUUID(), 'marimo'));
  lease.device = '9'.repeat(20); lease.inode = '9'.repeat(20);
  lease.files = [lease.files[0], ...Array.from({ length: 511 }, (_, index) => ({ ...lease.files[1],
    name: 'wheel_' + String(index).padStart(3, '0') + '_'.repeat(232) + '.whl', inode: String(300 + index) }))];
  const small = notebookWheelhouseCommand('cleanup', { ...lease, files: leaseFor({ leaseId: lease.leaseId, bootId: lease.bootId, provider: lease.provider }).files });
  const command = notebookWheelhouseCommand('cleanup', lease), source = decodeSource(command), request = commandRequest(command);
  assert.equal(Buffer.byteLength(command), Buffer.byteLength(small)); assert.ok(Buffer.byteLength(command) < 16384);
  assert.ok(source.includes('fd,manifest=verified(request,True)')); assert.ok(source.includes("for item in manifest['files']:os.unlink"));
  assert.equal('files' in request, false); assert.equal(request.manifestSha256, lease.manifestSha256);
  assert.ok(source.includes("os.rmdir(request['leaseId'],dir_fd=parent)")); assert.ok(source.includes('else:refuse()'));
  const frame = projectIdentityPayload({ command: notebookInstallExecution(f.identity, lease) });
  assert.ok(frame.input.length < 16384); assert.equal(frame.input.includes(Buffer.from(lease.files[511].name)), false);
});
