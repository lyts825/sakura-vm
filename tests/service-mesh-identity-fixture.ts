/**
 * 模块职责：共享测试夹具模块，围绕 `service-mesh-identity-fixture` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Shared test fixture for `service-mesh-identity-fixture`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Machines, type Machines as MachineType } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';
import { Workspaces, projectVersion, type Project } from '../server/workspaces.ts';
import { ServiceMesh, type ServiceMeshOptions } from '../server/service-mesh.ts';
import { AppError, DATA, vmDir } from '../server/model.ts';
import { projectIdentityPayload, projectIdentitySchema, projectIdentityRunSchema, type ProjectIdentity, type ProjectIdentityRun } from '../server/project-identity.ts';
import { projectMeshRecordSchema, type ProjectMeshRecord } from '../server/project-service-scope.ts';
import { meshConfigSchema, type MeshConfig } from '../server/service-mesh-identity.ts';

/**
 * 中文功能：组合真实 ServiceMesh/Workspaces 与受控客户机执行器，构造边车、身份票据、有限任务和清理失败的共享回归环境。
 * English: Compose the real ServiceMesh/Workspaces services with a controlled guest executor to model sidecars, identity tickets, finite tasks and failed cleanup.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `id, machines, workspaces, file, options, state, records, tickets, identities`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, machines, workspaces, file, options, state, records, tickets, identities`; the actual branch determines its shape.
 * 状态影响 / State effects: `workspaces.resolveProject`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `join`, `Object.assign`, `locks.locked.bind`.
 * 设计思路：分别记录身份、任务票据、进程成员与资源占用，允许测试独立改变各项证据；重启保留持久记录，关闭前复位失败开关，使失败回执重试与最终清理都可验证。
 * Design: Keep identities, task tickets, process membership and resource holds separate so each authority can be changed independently. Restart retains persisted records; final close resets injected faults to verify both receipt retries and complete cleanup.
 */
export async function meshIdentityFixture() {
  const id = randomUUID(), registryId = randomUUID(), locks = new Machines({} as Engine), file = join(DATA, id + '.mesh.json');
  const records = new Map<string, ProjectMeshRecord>(), tickets = new Map<string, ProjectIdentityRun>(),
    identities = new Map<string, ProjectIdentity>(), hashes = new Map<string, string>(), configs = new Map<string, MeshConfig>(),
    members = new Map<string, Set<number>>(), held = new Map<string, number>(),
    finiteMembers = new Map<string, Set<number>>(), finiteTickets = new Map<string, { identity: ProjectIdentity;
      owner: { kind: 'task'; runId: string; bootId: string }; sha256: string; phase: 'intent' | 'active' | 'closed'; run: ProjectIdentityRun | null }>(),
    running = new Map<string, { binding: string; runId: string; valid: boolean; orphan: boolean }>();
  const executions: { project: Project; command: string; environment?: Record<string, string>; timeout?: number }[] = [],
    frames: Buffer[] = [], rootLaunches: string[] = [], commands: string[] = [], events: string[] = [];
  const state = { guest: 'running', bootId: randomUUID(), envoy: true, python: true, tmux: true, enabled: true, usable: true,
    directoryPresent: true, namespacePresent: true, cleanupFailures: 0, releaseFailures: 0, closeFailures: 0,
    configFailures: 0, configCleanupFailures: 0, launchAckFailures: 0, starts: 0, preparations: 0, releases: 0, closes: 0,
    resolutions: 0, taskCalls: 0, taskCleanupFailures: 0, taskFailOnCall: 0, taskOutput: '', taskStderr: '',
    migrationRequired: false, missingListener: false, listenerChanged: false, configChanged: false, nativeChanged: false,
    coldBootBlocked: false, unknownScope: false, legacyRunning: new Set<string>(),
    prepareHook: undefined as (/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void | Promise<void>) | undefined,
    taskHook: undefined as (/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<void>) | undefined,
    resolutionHook: undefined as (/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<void>) | undefined,
    proofHook: undefined as (/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<void>) | undefined,
    launchHook: undefined as (/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void | Promise<void>) | undefined,
    stopHook: undefined as (/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void | Promise<void>) | undefined,
    publishHook: undefined as (/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void | Promise<void>) | undefined };
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: project: Project。
   * 结果：返回分支计算值（`project._workspace || 'default'`）。
   * Result: Return the branch-computed value (`project._workspace || 'default'`).
   */
  const scopeId = (project: Project) => project._workspace || 'default';
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: project: Project。
   * 结果：返回分支计算值（`Object.defineProperty(structuredClone(project), '_workspace', { value: project._…`）。
   * Result: Return the branch-computed value (`Object.defineProperty(structuredClone(project), '_workspace', { value: project._…`).
   * 协作入口 / Collaborators: `Object.defineProperty`, `structuredClone`.
   */
  const clone = (project: Project) => Object.defineProperty(structuredClone(project), '_workspace', { value: project._workspace, enumerable: false });
  /**
   * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
   * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
   * 输入 / Inputs: project: Project。
   * 结果：返回分支计算值（`assert.ok(held.get(scopeId(project)), 'preparation must remain owned through the…`）。
   * Result: Return the branch-computed value (`assert.ok(held.get(scopeId(project)), 'preparation must remain owned through the…`).
   * 协作入口 / Collaborators: `assert.ok`, `held.get`, `scopeId`.
   * 检查边界 / Checked boundaries: `assert.ok(held.get(scopeId(project)), 'preparation must remain owned through the original operation')`.
   */
  const assertHeld = (project: Project) => assert.ok(held.get(scopeId(project)), 'preparation must remain owned through the original operation');
  /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: project: Project。
   * 结果：返回分支计算值（`account`）。
   * Result: Return the branch-computed value (`account`).
   * 状态影响 / State effects: `account`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `scopeId`, `identities.get`, `randomUUID`, `projectIdentitySchema.parse`.
   */
  const identity = (project: Project) => {
    const key = scopeId(project); let account = identities.get(key);
    if (!account || account.directory !== project.directory || account.networkIsolation !== (project.networkIsolation || 'host')) {
      const identityId = randomUUID(), uid = 23000 + identities.size;
      account = projectIdentitySchema.parse({ version: 1, phase: 'active', registryId, identityId, projectId: key, revision: 1,
        account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid, gid: uid,
        home: '/var/lib/sakura-project-homes/' + identityId, directory: project.directory,
        homeDevice: '12', homeInode: String(uid + 1), directoryDevice: '12', directoryInode: String(uid + 2),
        networkIsolation: project.networkIsolation || 'host' }); identities.set(key, account);
    }
    return account;
  };
  const binary = { path: '/usr/bin/envoy', device: '12', inode: '701', size: 9999, mtimeNs: '123000' };
  const machines = Object.assign(new EventEmitter(), {
    records: new Map([[id, { template: 'none' }]]), live: new Map([[id, {}]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id, template: 'none', distro: 'alpine' })`）。
     * Result: Return the branch-computed value (`({ id, template: 'none', distro: 'alpine' })`).
     */
    get: () => ({ id, template: 'none', distro: 'alpine' }), /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`state.guest`）。
     * Result: Return the branch-computed value (`state.guest`).
     */
    state: () => state.guest,
    locked: locks.locked.bind(locks), requireUnlocked: locks.requireUnlocked.bind(locks),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `commands.push`, `command.includes`.
     */
    exec: async (_id: string, command: string) => { commands.push(command);
      if (command.includes('SAKURA_PROJECT_MAIN_LEGACY_STATUS')) return { code: 0, stdout: 'absent\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' }; },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('unexpected Root process execution outside the injected static metadata boundary')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `commands.push`.
     */
    execInput: async (_id: string, command: string) => { commands.push(command);
      throw new Error('unexpected Root process execution outside the injected static metadata boundary'); },
  }) as unknown as MachineType;
  await mkdir(vmDir(id), { recursive: true });
  const workspaces = new Workspaces(machines), actualResolve = workspaces.resolveProject.bind(workspaces);
  workspaces.resolveProject = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`actualResolve(...args)`），以 Promise 交付。
   * Result: Return the branch-computed value (`actualResolve(...args)`) through a Promise.
   * 协作入口 / Collaborators: `state.resolutionHook`, `actualResolve`.
   */
  async (...args) => { ++state.resolutions; await state.resolutionHook?.(); return actualResolve(...args); };
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`JSON.parse(await readFile(file, 'utf8'))`），以 Promise 交付。
   * Result: Return the branch-computed value (`JSON.parse(await readFile(file, 'utf8'))`) through a Promise.
   * 协作入口 / Collaborators: `JSON.parse`, `readFile`.
   */
  const read = async () => JSON.parse(await readFile(file, 'utf8'));
  const options: ServiceMeshOptions = {
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `prepare, close`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `prepare, close`; the actual branch determines its shape.
     */
    createPreparation: () => {
      let selected = '', released = false; ++state.preparations;
      return {
        /**
         * 中文功能：生成或核对本组验证所需的摘要与身份材料。
         * English: Generate or verify digest and identity material required by this suite.
         * 输入 / Inputs: vmId; projectId; session; readOnly; signal; _terminal; mode。
         * 结果：返回受控对象，公开字段包括 `command, projectId, terminalId, networkIsolation, signal, captured, release`；各分支以实际返回对象为准。
         * Result: Return a controlled object exposing fields such as `command, projectId, terminalId, networkIsolation, signal, captured, release`; the actual branch determines its shape.
         * 状态影响 / State effects: `selected`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
         * 协作入口 / Collaborators: `assert.equal`, `assert.deepEqual`, `signal?.throwIfAborted`, `clone`.
         * 检查边界 / Checked boundaries: `assert.equal(vmId, id)`; `assert.equal(typeof projectId, 'string')`.
         */
        prepare: async (vmId, projectId, session, readOnly, signal, _terminal, mode) => {
          assert.equal(vmId, id); assert.equal(typeof projectId, 'string'); assert.equal(session, null); assert.equal(readOnly, false);
          assert.deepEqual(mode, { mode: 'task' }); signal?.throwIfAborted();
          selected = projectId!; const project = clone(await workspaces.config(id));
          assert.equal(scopeId(project), selected); held.set(selected, (held.get(selected) || 0) + 1);
          events.push(selected + ':prepare');
          await state.prepareHook?.();
          return { command: 'unused Root shell', projectId: selected, terminalId: undefined, networkIsolation: project.networkIsolation || 'host',
            signal: signal!, captured: { project, configVersion: projectVersion(project), live: machines.live.get(id)! },
            /**
             * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
             * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
             * 输入 / Inputs: 无 / none。
             * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
             * Result: No explicit result value; callers observe completion, state changes or an exception.
             * 状态影响 / State effects: `released`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
             * 失败 / Failure: `new Error('original preparation release failed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
             * 协作入口 / Collaborators: `held.set`, `held.get`, `events.push`.
             */
            release: async () => {
              if (state.releaseFailures > 0) { --state.releaseFailures; throw new Error('original preparation release failed'); }
              if (released) return; released = true; held.set(selected, held.get(selected)! - 1);
              ++state.releases; events.push(selected + ':release');
            } };
        },
        /**
         * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
         * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 失败 / Failure: `new Error('original preparation close failed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         * 协作入口 / Collaborators: `assert.equal`, `events.push`.
         * 检查边界 / Checked boundaries: `assert.equal(released || !selected, true)`.
         */
        close: async () => {
          if (state.closeFailures > 0) { --state.closeFailures; throw new Error('original preparation close failed'); }
          assert.equal(released || !selected, true); ++state.closes; events.push(selected + ':close');
        },
      };
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 状态影响 / State effects: `failure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new AppError('finite task original domain still populated', 503, 'GUEST_TASK_CLEANUP_FAILED')`; `failure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `assert.equal`, `machines.live.get`, `assertHeld`, `signal.throwIfAborted`.
     * 检查边界 / Checked boundaries: `assert.equal(transport, machines)`; `assert.equal(vmId, id)`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    runTask: async (...args) => {
      const [transport, vmId, project, execution, signal, _log, timeout, _agent, _cleanup, pins] = args;
      assert.equal(transport, machines); assert.equal(vmId, id); assert.equal(pins?.expectedLive, machines.live.get(id));
      assert.equal(pins?.expectedBootId, state.bootId, 'each finite task must pin the original boot before execution');
      assertHeld(project); signal.throwIfAborted(); assert.ok(timeout === 10000 || timeout === 180000);
      const payload = projectIdentityPayload(execution), runId = randomUUID();
      const account = identity(project), owner = { kind: 'task' as const, runId, bootId: state.bootId };
      await pins?.beforeIntent?.({ identity: account, owner, sha256: payload.sha256 });
      finiteTickets.set(runId, { identity: account, owner, sha256: payload.sha256, phase: 'active', run: null });
      finiteMembers.set(runId, new Set([9876, 9877])); executions.push({ project: clone(project), ...execution, timeout });
      ++state.taskCalls; events.push(scopeId(project) + ':uid-task');
      let failure: unknown;
      try { await state.taskHook?.(); signal.throwIfAborted(); } catch (error) { failure = error; }
      if (state.taskCleanupFailures > 0 || state.taskCalls === state.taskFailOnCall) { if (state.taskCleanupFailures) --state.taskCleanupFailures;
        throw new AppError('finite task original domain still populated', 503, 'GUEST_TASK_CLEANUP_FAILED'); }
      finiteMembers.delete(runId);
      events.push(scopeId(project) + ':task-full-domain-absent');
      if (failure !== undefined) throw failure;
      return { code: state.usable ? 0 : 127,
        stdout: state.taskOutput || (execution.command.includes('--version') ? 'envoy version: fixture\n' : ''),
        stderr: state.usable ? '' : state.taskStderr || 'incompatible Envoy' };
    },
    scopes: {
      /**
       * 中文功能：生成或核对本组验证所需的摘要与身份材料。
       * English: Generate or verify digest and identity material required by this suite.
       * 输入 / Inputs: _vmId; project; signal。
       * 结果：返回分支计算值（`identity(project)`），以 Promise 交付。
       * Result: Return the branch-computed value (`identity(project)`) through a Promise.
       * 失败 / Failure: `new AppError('explicit project directory migration required', 409, 'PROJECT_DIRECTORY_MIGRATION_REQU…`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       * 协作入口 / Collaborators: `signal?.throwIfAborted`, `assertHeld`, `events.push`, `scopeId`.
       */
      identity: async (_vmId, project, signal) => {
        signal?.throwIfAborted(); assertHeld(project);
        if (state.migrationRequired) throw new AppError('explicit project directory migration required', 409, 'PROJECT_DIRECTORY_MIGRATION_REQUIRED');
        events.push(scopeId(project) + ':identity'); return identity(project);
      },
      /**
       * 中文功能：生成或核对本组验证所需的摘要与身份材料。
       * English: Generate or verify digest and identity material required by this suite.
       * 输入 / Inputs: _vmId; project; execution; owner; signal。
       * 结果：返回受控对象，公开字段包括 `command, runId, identity`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `command, runId, identity`; the actual branch determines its shape.
       * 协作入口 / Collaborators: `signal?.throwIfAborted`, `assertHeld`, `assert.equal`, `projectIdentityPayload`.
       * 检查边界 / Checked boundaries: `assert.equal(owner.kind, 'service')`; `assert.equal(row.execution.sha256, payload.sha256, 'full body digest must be durable before SDK/native launch')`.
       */
      inherited: async (_vmId, project, execution, owner, signal) => {
        signal?.throwIfAborted(); assertHeld(project); assert.equal(owner.kind, 'service');
        const payload = projectIdentityPayload(execution), account = identity(project);
        const row = (await read()).runs.find((value: any) => value.projectId === scopeId(project));
        assert.equal(row.execution.sha256, payload.sha256, 'full body digest must be durable before SDK/native launch');
        assert.equal(row.execution.run, null); frames.push(payload.input); executions.push({ project: clone(project), ...execution });
        const command = 'fixed-native-entry --run ' + owner.runId; rootLaunches.push(command);
        events.push(scopeId(project) + ':native-intent');
        return { ...payload, command, runId: owner.runId, identity: account };
      },
      /**
       * 中文功能：生成或核对本组验证所需的摘要与身份材料。
       * English: Generate or verify digest and identity material required by this suite.
       * 输入 / Inputs: _id; _projectId; runId; signal。
       * 结果：返回分支计算值（`tickets.get(runId)?.phase === 'active'`），以 Promise 交付。
       * Result: Return the branch-computed value (`tickets.get(runId)?.phase === 'active'`) through a Promise.
       * 协作入口 / Collaborators: `signal?.throwIfAborted`, `tickets.get`.
       */
      active: async (_id, _projectId, runId, signal) => { signal?.throwIfAborted(); return tickets.get(runId)?.phase === 'active'; },
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: _id; projectId; runId; signal。
       * 结果：返回分支计算值（`ticket?.phase === 'active' && ticket.projectId === projectId && ticket.bootId ==…`），以 Promise 交付。
       * Result: Return the branch-computed value (`ticket?.phase === 'active' && ticket.projectId === projectId && ticket.bootId ==…`) through a Promise.
       * 协作入口 / Collaborators: `signal?.throwIfAborted`, `tickets.get`.
       */
      readonlyActive: async (_id, projectId, runId, signal) => {
        signal?.throwIfAborted(); const ticket = tickets.get(runId);
        return ticket?.phase === 'active' && ticket.projectId === projectId && ticket.bootId === state.bootId;
      },
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: _id; projectId; runId。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 状态影响 / State effects: `ticket.phase`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 失败 / Failure: `new AppError('original finite task full domain has descendants', 503, 'PROJECT_IDENTITY_CLEANUP_FAIL…`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       * 协作入口 / Collaborators: `finiteMembers.has`, `finiteTickets.get`, `assert.ok`, `events.push`.
       * 检查边界 / Checked boundaries: `assert.ok(ticket)`.
       */
      closeAfterScopeStopped: async (_id, projectId, runId) => {
        if (finiteMembers.has(runId)) throw new AppError('original finite task full domain has descendants', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        const ticket = finiteTickets.get(runId); assert.ok(ticket); ticket.phase = 'closed';
        events.push(projectId + ':task-native-ticket-retired');
      },
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: _id; projectId; runId。
       * 结果：返回分支计算值（`null / structuredClone(ticket)`），以 Promise 交付。
       * Result: Return the branch-computed value (`null / structuredClone(ticket)`) through a Promise.
       * 协作入口 / Collaborators: `finiteTickets.get`, `assert.equal`, `structuredClone`.
       * 检查边界 / Checked boundaries: `assert.equal(ticket.identity.projectId, projectId)`.
       */
      taskRun: async (_id, projectId, runId) => {
        const ticket = finiteTickets.get(runId); if (!ticket) return null;
        assert.equal(ticket.identity.projectId, projectId); return structuredClone(ticket);
      },
    },
    identities: {
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: _id; account; runId; signal。
       * 结果：返回分支计算值（`state.nativeChanged ? { ...ticket, cgroupInode: '999999' } : structuredClone(tic…`），以 Promise 交付。
       * Result: Return the branch-computed value (`state.nativeChanged ? { ...ticket, cgroupInode: '999999' } : structuredClone(tic…`) through a Promise.
       * 失败 / Failure: `new AppError('native ticket changed', 409)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       * 协作入口 / Collaborators: `signal?.throwIfAborted`, `tickets.get`, `structuredClone`.
       */
      runReadonly: async (_id, account, runId, signal) => {
        signal?.throwIfAborted(); const ticket = tickets.get(runId);
        if (!ticket || ticket.identityId !== account.identityId || ticket.bootId !== state.bootId) throw new AppError('native ticket changed', 409);
        return state.nativeChanged ? { ...ticket, cgroupInode: '999999' } : structuredClone(ticket);
      },
    },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _id; project。
     * 结果：返回受控对象，公开字段包括 `status, newIntent, persistIntent, start, stop`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `status, newIntent, persistIntent, start, stop`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `scopeId`.
     */
    processScope: (_id, project) => {
      const key = scopeId(project);
      return {
        /**
         * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
         * English: Read or resolve observable fixture state for business calls or subsequent assertions.
         * 输入 / Inputs: signal; expectedHash。
         * 结果：返回受控对象，公开字段包括 `status, bootId, record`；各分支以实际返回对象为准。
         * Result: Return a controlled object exposing fields such as `status, bootId, record`; the actual branch determines its shape.
         * 失败 / Failure: `new AppError('immutable transport changed', 409)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         * 协作入口 / Collaborators: `signal?.throwIfAborted`, `state.proofHook`, `records.get`, `hashes.get`.
         */
        status: async (signal, expectedHash) => {
          signal?.throwIfAborted(); await state.proofHook?.();
          const record = records.get(key) || null;
          if (expectedHash && (!record || hashes.get(record.runId) !== expectedHash)) throw new AppError('immutable transport changed', 409);
          return { status: state.unknownScope ? 'unmanaged' : !record ? 'absent' : record.bootId !== state.bootId ? 'unconfirmed' :
            record.phase === 'running' ? 'running' : record.phase === 'stopped' ? 'stopped' : 'prepared',
          bootId: state.bootId, record: record && structuredClone(record) };
        },
        /**
         * 中文功能：生成或核对本组验证所需的摘要与身份材料。
         * English: Generate or verify digest and identity material required by this suite.
         * 输入 / Inputs: binding; bootId。
         * 结果：返回分支计算值（`projectMeshRecordSchema.parse({ version: 1, projectId: key, name: 'mesh', sessio…`）。
         * Result: Return the branch-computed value (`projectMeshRecordSchema.parse({ version: 1, projectId: key, name: 'mesh', sessio…`).
         * 协作入口 / Collaborators: `randomUUID`, `projectMeshRecordSchema.parse`.
         */
        newIntent: (binding, bootId) => {
          const runId = randomUUID();
          return projectMeshRecordSchema.parse({ version: 1, projectId: key, name: 'mesh', session: 'sakura-mesh-uid-' + key,
            runId, bootId, scopeName: 'sakura-service-' + runId, binding, phase: 'intent',
            inode: null, sessionId: null, paneId: null, panePid: null, paneStartTicks: null });
        },
        /**
         * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
         * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
         * 输入 / Inputs: intent。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 协作入口 / Collaborators: `(await read()).runs.find`, `read`, `assert.deepEqual`, `assert.equal`.
         * 检查边界 / Checked boundaries: `assert.deepEqual(row.execution.record, intent)`; `assert.equal(row.config, null)`.
         */
        persistIntent: async intent => {
          const row = (await read()).runs.find((value: any) => value.projectId === key);
          assert.deepEqual(row.execution.record, intent); assert.equal(row.config, null); assertHeld(project);
          records.set(key, intent); events.push(key + ':outer-intent');
        },
        /**
         * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
         * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
         * 输入 / Inputs: intent; payload; signal。
         * 结果：返回分支计算值（`record`），以 Promise 交付。
         * Result: Return the branch-computed value (`record`) through a Promise.
         * 失败 / Failure: `new Error('Root launch ACK lost after UID process entered full domain')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         * 协作入口 / Collaborators: `signal.throwIfAborted`, `assertHeld`, `identity`, `records.set`.
         */
        start: async (intent, payload, signal) => {
          signal.throwIfAborted(); assertHeld(project); ++state.starts;
          const account = identity(project), record: ProjectMeshRecord = { ...intent, phase: 'running', inode: '901',
            sessionId: '$11', paneId: '%25', panePid: 1234, paneStartTicks: '989' };
          records.set(key, record); hashes.set(record.runId, payload.sha256);
          members.set(record.runId, new Set([1234, 5555, 5556]));
          tickets.set(record.runId, projectIdentityRunSchema.parse({ version: 1, phase: 'active', mode: 'inherit-current',
            registryId, identityId: account.identityId, projectId: key, runId: record.runId, revision: account.revision,
            bootId: state.bootId, build: 'b'.repeat(64), networkDevice: '4', networkInode: '502', cgroupDevice: '29',
            cgroupInode: record.inode, cgroupName: record.scopeName, namespace: account.networkIsolation === 'private' ? 'sk-' + key : '' }));
          running.set(key, { binding: intent.binding, runId: intent.runId, valid: true, orphan: false });
          events.push(key + ':envoy-start'); await state.launchHook?.();
          if (state.launchAckFailures > 0) { --state.launchAckFailures; throw new Error('Root launch ACK lost after UID process entered full domain'); }
          return record;
        },
        /**
         * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
         * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
         * 输入 / Inputs: original。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 失败 / Failure: `new AppError('original full domain still populated', 503, 'SERVICE_CLEANUP_FAILED')`; `new AppError('new boot owns reused tmux label', 503, 'SERVICE_CLEANUP_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         * 协作入口 / Collaborators: `events.push`, `state.stopHook`, `records.get`, `assert.equal`.
         * 检查边界 / Checked boundaries: `assert.equal(known.runId, original.runId)`; `assert.equal(known.binding, original.binding)`.
         * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
         * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
         */
        stop: async original => {
          events.push(key + ':stop-attempt'); await state.stopHook?.();
          if (state.cleanupFailures > 0) { --state.cleanupFailures;
            throw new AppError('original full domain still populated', 503, 'SERVICE_CLEANUP_FAILED'); }
          if (original.bootId !== state.bootId && state.coldBootBlocked)
            throw new AppError('new boot owns reused tmux label', 503, 'SERVICE_CLEANUP_FAILED');
          const known = records.get(key);
          if (known) { assert.equal(known.runId, original.runId); assert.equal(known.binding, original.binding);
            for (const field of ['inode', 'sessionId', 'paneId', 'panePid', 'paneStartTicks'] as const)
              if (original[field] !== null && known[field] !== null) assert.equal(known[field], original[field]); }
          members.delete(original.runId); running.delete(key); events.push(key + ':full-domain-absent');
          const ticket = tickets.get(original.runId); if (ticket) tickets.set(ticket.runId, { ...ticket, phase: 'closed' });
          events.push(key + ':native-ticket-retired'); records.set(key, { ...(known || original), phase: 'stopped' });
        },
      };
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id; project; signal。
     * 结果：返回受控对象，公开字段包括 `bootId, pythonInstalled, tmuxInstalled, envoy, directoryPresent, namespacePresent, legacyRunning, legacyProcesses, legacyConfigPresent`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `bootId, pythonInstalled, tmuxInstalled, envoy, directoryPresent, namespacePresent, legacyRunning, legacyProcesses, legacyConfigPresent`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `signal?.throwIfAborted`, `state.legacyRunning.has`, `scopeId`.
     */
    hostStatus: async (_id, project, signal) => { signal?.throwIfAborted();
      return { bootId: state.bootId, pythonInstalled: state.python, tmuxInstalled: state.tmux, envoy: state.envoy ? binary : null,
        directoryPresent: state.directoryPresent, namespacePresent: state.namespacePresent,
        legacyRunning: state.legacyRunning.has(scopeId(project)),
        legacyProcesses: state.legacyRunning.has(scopeId(project)) ? [7777] : [], legacyConfigPresent: state.legacyRunning.has(scopeId(project)) }; },
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: _id; op; plan; proof; source; signal。
     * 结果：返回受控对象，公开字段包括 `present, config, cleaned`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `present, config, cleaned`; the actual branch determines its shape.
     * 失败 / Failure: `new Error('configuration publish ACK lost')`; `new Error('original config cleanup failed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `signal?.throwIfAborted`, `(await read()).runs.find`, `read`, `assert.deepEqual`.
     * 检查边界 / Checked boundaries: `assert.deepEqual(row.plan, plan)`; `assert.ok(source && Buffer.byteLength(source) === plan.bytes)`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    configControl: async (_id, op, plan, proof, source, signal) => {
      signal?.throwIfAborted();
      if (op === 'publish') {
        const row = (await read()).runs.find((value: any) => value.projectId === plan.projectId);
        assert.deepEqual(row.plan, plan); assertHeld(identityProject(row));
        assert.ok(source && Buffer.byteLength(source) === plan.bytes);
        assert.ok(!configs.has(plan.runId)); events.push(plan.projectId + ':config-intent');
        const config = meshConfigSchema.parse({ version: 1, path: plan.path, device: '12', inode: '705',
          sha256: plan.sha256, bytes: plan.bytes, gid: plan.gid });
        configs.set(plan.runId, config); await state.publishHook?.();
        if (state.configFailures > 0) { --state.configFailures; throw new Error('configuration publish ACK lost'); }
        return { present: true, config };
      }
      if (op === 'cleanup') {
        assert.ok(!members.has(plan.runId), 'configuration must outlive the complete original process domain');
        if (state.configCleanupFailures > 0) { --state.configCleanupFailures; throw new Error('original config cleanup failed'); }
        const config = configs.get(plan.runId); if (config && proof) assert.deepEqual(config, proof);
        configs.delete(plan.runId); events.push(plan.projectId + ':config-retired'); return { cleaned: true };
      }
      const config = configs.get(plan.runId);
      return { present: !!config, config: config && state.configChanged ? { ...config, inode: '99998' } : config || null };
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id; account; run; signal。
     * 结果：返回受控对象，公开字段包括 `port, pid, startTicks, socketInode`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `port, pid, startTicks, socketInode`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `signal?.throwIfAborted`, `(await read()).runs.find`, `read`, `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(row.projectId, account.projectId)`.
     */
    listener: async (_id, account, run, signal) => {
      signal?.throwIfAborted(); if (state.missingListener) return null;
      const row = (await read()).runs.find((value: any) => value.execution.record.runId === run.runId);
      assert.equal(row.projectId, account.projectId);
      return { port: row.policy.listenPort, pid: state.listenerChanged ? 9999 : 1234, startTicks: '989', socketInode: '889' };
    },
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: row; run; listener; signal。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new AppError('original Envoy executable/listener/cwd binding changed', 409)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `signal?.throwIfAborted`, `running.get`, `assert.deepEqual`, `configs.get`.
     * 检查边界 / Checked boundaries: `assert.deepEqual(configs.get(run.runId), row.config)`; `assert.equal(listener.pid, 1234)`.
     */
    processProbe: async (row, run, listener, signal) => {
      signal?.throwIfAborted(); const process = running.get(row.projectId);
      assert.deepEqual(configs.get(run.runId), row.config); assert.equal(listener.pid, 1234);
      if (!process?.valid || process.orphan || process.runId !== run.runId || listener.port !== row.policy.listenPort)
        throw new AppError('original Envoy executable/listener/cwd binding changed', 409);
      events.push(row.projectId + ':envoy-kernel-proof');
    },
  };
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: row: any。
   * 结果：返回分支计算值（`Object.defineProperty({ directory: row.directory, template: 'none', repository: …`）。
   * Result: Return the branch-computed value (`Object.defineProperty({ directory: row.directory, template: 'none', repository: …`).
   * 协作入口 / Collaborators: `Object.defineProperty`.
   */
  function identityProject(row: any) {
    return Object.defineProperty({ directory: row.directory, template: 'none', repository: '', setup: '', command: '',
      networkIsolation: row.networkIsolation }, '_workspace', { value: row.projectId === 'default' ? undefined : row.projectId, enumerable: false }) as Project;
  }
  /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`new ServiceMesh(machines, workspaces, file, async () => state.enabled, options)`）。
   * Result: Return the branch-computed value (`new ServiceMesh(machines, workspaces, file, async () => state.enabled, options)`).
   */
  const create = () => new ServiceMesh(machines, workspaces, file, async () => state.enabled, options);
  let mesh = create(); await mesh.init();
  return { id, machines, workspaces, file, options, state, records, tickets, identities, hashes, configs, members, finiteMembers, finiteTickets, held, running,
    frames, executions, commands, events, rootLaunches, read, binary,
    /**
     * 中文功能：读取夹具当前状态或暴露受控句柄，供断言观察。
     * English: Read current fixture state or expose a controlled handle for assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`mesh`）。
     * Result: Return the branch-computed value (`mesh`).
     */
    get mesh() { return mesh; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `mesh`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `mesh.close`, `create`, `mesh.init`.
     */
    restart: async () => { await mesh.close(); mesh = create(); await mesh.init(); },
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `state.cleanupFailures`, `state.configCleanupFailures`, `state.releaseFailures`, `state.closeFailures`, `state.coldBootBlocked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `finiteMembers.clear`, `mesh.close`, `workspaces.close`.
     */
    close: async () => { state.cleanupFailures = state.configCleanupFailures = state.releaseFailures = state.closeFailures = 0;
      state.coldBootBlocked = false; finiteMembers.clear(); await mesh.close(); await workspaces.close(); },
  };
}
