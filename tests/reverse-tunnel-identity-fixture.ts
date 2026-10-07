/**
 * 模块职责：共享测试夹具模块，围绕 `reverse-tunnel-identity-fixture` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Shared test fixture for `reverse-tunnel-identity-fixture`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PassThrough, type Duplex } from 'node:stream';
import { AppError, DATA } from '../server/model.ts';
import { projectVersion, type Project, type Workspaces } from '../server/workspaces.ts';
import { projectIdentityPayload, projectIdentitySchema, projectIdentityRunSchema,
  type ProjectIdentity, type ProjectIdentityRun } from '../server/project-identity.ts';
import { projectReverseTunnelRecordSchema, type ProjectReverseTunnelRecord } from '../server/project-service-scope.ts';
import type { Machines } from '../server/machines.ts';
import type { ReverseTunnelOptions } from '../server/reverse-tunnels.ts';

/**
 * 中文功能：构造反向隧道的受控身份、运行、桥接和证明适配器，并提供独立持久文件与事件记录。
 * English: Build controlled identity, run, bridge and proof adapters for reverse tunnels, together with a private persisted file and observable events.
 * 输入 / Inputs: t: { after: (action: () => Promise<unknown>) => void }; machines: Machines; workspaces: Workspaces。
 * 结果：返回受控对象，公开字段包括 `options, file, records, tickets, identities, hashes, members, held, events`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `options, file, records, tickets, identities, hashes, members, held, events`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdir`, `mkdtemp`, `join`, `t.after`.
 * 设计思路：票据、进程成员和桥接租约分开记录，测试可制造“监听可用但身份过期”等不一致；目录清理先解析实际路径并核对父目录与前缀，保护测试边界。
 * Design: Record tickets, process members and bridge leases independently so tests can create inconsistencies such as an available listener with stale identity. Cleanup resolves the actual path and checks its parent/prefix before removal.
 */
export async function reverseTunnelIdentityOptions(t: { after: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: action: () => Promise<unknown>。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
(action: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => Promise<unknown>) => void },
  machines: Machines, workspaces: Workspaces) {
  await mkdir(DATA, { recursive: true }); const directory = await mkdtemp(join(DATA, 'reverse-tunnel-unit-'));
  t.after(async () => { const owned = await realpath(directory);
    assert.equal(dirname(owned), await realpath(DATA)); assert.match(basename(owned), /^reverse-tunnel-unit-/);
    await rm(owned, { recursive: true, force: true }); });
  const file = join(directory, 'tunnels.json'), registryId = randomUUID();
  const records = new Map<string, ProjectReverseTunnelRecord>(), tickets = new Map<string, ProjectIdentityRun>(),
    identities = new Map<string, ProjectIdentity>(), hashes = new Map<string, string>(), members = new Map<string, Set<number>>();
  const held = new Map<string, number>(), events: string[] = [], executions: { project: Project; command: string; environment?: Record<string, string> }[] = [],
    frames: Buffer[] = [], rootLaunches: string[] = [], proofCalls: string[] = [], bridges: Parameters<NonNullable<ReverseTunnelOptions['bridge']>>[] = [];
  const state = { bootId: randomUUID(), cleanupFailures: 0, releaseFailures: 0, closeFailures: 0,
    starts: 0, preparations: 0, releases: 0, closes: 0, resolutions: 0, probeCode: 0, probeStderr: '',
    identityFailure: false, activeFailure: false, listenerChanged: false, missingListener: false, coldBootBlocked: false,
    taskHook: undefined as (/**
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
    bridgeHook: undefined as (/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<void>) | undefined };
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: project: Project。
   * 结果：返回分支计算值（`project._workspace || 'default'`）。
   * Result: Return the branch-computed value (`project._workspace || 'default'`).
   */
  const binding = (project: Project) => project._workspace || 'default';
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: project: Project。
   * 结果：返回分支计算值（`Object.defineProperty(structuredClone(project), '_workspace', { value: project._…`）。
   * Result: Return the branch-computed value (`Object.defineProperty(structuredClone(project), '_workspace', { value: project._…`).
   * 协作入口 / Collaborators: `Object.defineProperty`, `structuredClone`.
   */
  const clone = (project: Project) => Object.defineProperty(structuredClone(project), '_workspace',
    { value: project._workspace, enumerable: false });
  /**
   * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
   * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
   * 输入 / Inputs: project: Project。
   * 结果：返回分支计算值（`assert.ok(held.get(binding(project)), 'original preparation must remain held')`）。
   * Result: Return the branch-computed value (`assert.ok(held.get(binding(project)), 'original preparation must remain held')`).
   * 协作入口 / Collaborators: `assert.ok`, `held.get`, `binding`.
   * 检查边界 / Checked boundaries: `assert.ok(held.get(binding(project)), 'original preparation must remain held')`.
   */
  const assertHeld = (project: Project) => assert.ok(held.get(binding(project)), 'original preparation must remain held');
  /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: project: Project。
   * 结果：返回分支计算值（`account`）。
   * Result: Return the branch-computed value (`account`).
   * 状态影响 / State effects: `account`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `binding`, `identities.get`, `randomUUID`, `projectIdentitySchema.parse`.
   * 检查边界 / Checked boundaries: `assert.equal(account.directory, project.directory)`; `assert.equal(account.networkIsolation, project.networkIsolation || 'host')`.
   */
  const identity = (project: Project) => {
    const key = binding(project); let account = identities.get(key);
    if (!account) { const identityId = randomUUID(), uid = 21000 + identities.size;
      account = projectIdentitySchema.parse({ version: 1, phase: 'active', registryId, identityId, projectId: key,
        revision: 1, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid, gid: uid,
        home: '/var/lib/sakura-project-homes/' + identityId, directory: project.directory,
        homeDevice: '12', homeInode: String(uid + 1), directoryDevice: '12', directoryInode: String(uid + 2),
        networkIsolation: project.networkIsolation || 'host' }); identities.set(key, account); }
    assert.equal(account.directory, project.directory); assert.equal(account.networkIsolation, project.networkIsolation || 'host'); return account;
  };
  const options: ReverseTunnelOptions = {
    file,
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
         * 输入 / Inputs: id; scope; session; readOnly; signal; _terminalId; mode。
         * 结果：返回受控对象，公开字段包括 `command, projectId, terminalId, networkIsolation, signal, captured, release`；各分支以实际返回对象为准。
         * Result: Return a controlled object exposing fields such as `command, projectId, terminalId, networkIsolation, signal, captured, release`; the actual branch determines its shape.
         * 状态影响 / State effects: `selected`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
         * 失败 / Failure: `new Error('missing explicit project')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         * 协作入口 / Collaborators: `assert.equal`, `assert.ok`, `signal?.throwIfAborted`, `clone`.
         * 检查边界 / Checked boundaries: `assert.equal(session, null)`; `assert.equal(readOnly, false)`.
         */
        prepare: async (id, scope, session, readOnly, signal, _terminalId, mode) => {
          assert.equal(session, null); assert.equal(readOnly, false);
          assert.ok(mode?.mode === 'task' && (!mode.verifyOnly || mode.verifyOnly === true));
          assert.equal(typeof scope, 'string'); if (typeof scope !== 'string') throw new Error('missing explicit project');
          signal?.throwIfAborted(); selected = scope; const project = clone(await workspaces.config(id)), live = machines.live.get(id)!;
          assert.equal(binding(project), scope); held.set(scope, (held.get(scope) || 0) + 1); events.push(scope + ':prepare');
          return { command: 'unused root terminal command', projectId: scope, terminalId: undefined, networkIsolation: project.networkIsolation || 'host',
            signal: signal!, captured: { project, configVersion: projectVersion(project), live }, /**
             * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
             * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
             * 输入 / Inputs: 无 / none。
             * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
             * Result: No explicit result value; callers observe completion, state changes or an exception.
             * 状态影响 / State effects: `released`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
             * 失败 / Failure: `new Error('network lease release failed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
             * 协作入口 / Collaborators: `held.set`, `held.get`, `events.push`.
             */
            release: async () => {
              if (state.releaseFailures > 0) { --state.releaseFailures; throw new Error('network lease release failed'); }
              if (released) return; released = true; held.set(scope, held.get(scope)! - 1); ++state.releases; events.push(scope + ':release'); } };
        },
        /**
         * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
         * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 失败 / Failure: `new Error('preparation close failed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         * 协作入口 / Collaborators: `assert.equal`, `events.push`.
         * 检查边界 / Checked boundaries: `assert.equal(released || !selected, true)`.
         */
        close: async () => { if (state.closeFailures > 0) { --state.closeFailures; throw new Error('preparation close failed'); }
          assert.equal(released || !selected, true); ++state.closes; events.push(selected + ':close'); },
      };
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `assert.equal`, `machines.live.get`, `assertHeld`, `signal.throwIfAborted`.
     * 检查边界 / Checked boundaries: `assert.equal(transport, machines)`; `assert.equal(timeout, 10000)`.
     */
    runTask: async (...args) => {
      const [transport, id, project, execution, signal, _log, timeout, _agent, _cleanup, pins] = args;
      assert.equal(transport, machines); assert.equal(timeout, 10000); assert.equal(pins?.expectedLive, machines.live.get(id));
      assertHeld(project); signal.throwIfAborted(); projectIdentityPayload(execution);
      executions.push({ project: clone(project), ...execution }); events.push(binding(project) + ':uid-probe');
      const guest = machines as unknown as { commands?: string[]; hanging?: boolean };
      guest.commands?.push(execution.command); if (guest.hanging) await delay(60000, undefined, { signal });
      await state.taskHook?.(); signal.throwIfAborted(); events.push(binding(project) + ':task-full-domain-stopped');
      return { code: state.probeCode, stdout: '', stderr: state.probeStderr };
    },
    scopes: {
      /**
       * 中文功能：生成或核对本组验证所需的摘要与身份材料。
       * English: Generate or verify digest and identity material required by this suite.
       * 输入 / Inputs: _id; project; signal。
       * 结果：返回分支计算值（`identity(project)`），以 Promise 交付。
       * Result: Return the branch-computed value (`identity(project)`) through a Promise.
       * 失败 / Failure: `new AppError('explicit project directory migration required', 409, 'PROJECT_DIRECTORY_MIGRATION_REQU…`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       * 协作入口 / Collaborators: `signal?.throwIfAborted`, `assertHeld`, `events.push`, `binding`.
       */
      identity: async (_id, project, signal) => { signal?.throwIfAborted(); assertHeld(project);
        if (state.identityFailure) throw new AppError('explicit project directory migration required', 409, 'PROJECT_DIRECTORY_MIGRATION_REQUIRED');
        events.push(binding(project) + ':identity'); return identity(project); },
      /**
       * 中文功能：生成或核对本组验证所需的摘要与身份材料。
       * English: Generate or verify digest and identity material required by this suite.
       * 输入 / Inputs: _id; project; execution; owner; signal。
       * 结果：返回受控对象，公开字段包括 `command, runId, identity`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `command, runId, identity`; the actual branch determines its shape.
       * 协作入口 / Collaborators: `signal?.throwIfAborted`, `assertHeld`, `assert.equal`, `identity`.
       * 检查边界 / Checked boundaries: `assert.equal(owner.kind, 'service')`.
       */
      inherited: async (_id, project, execution, owner, signal) => {
        signal?.throwIfAborted(); assertHeld(project); assert.equal(owner.kind, 'service');
        const account = identity(project), payload = projectIdentityPayload(execution); frames.push(payload.input);
        executions.push({ project: clone(project), ...execution }); events.push(binding(project) + ':native-intent');
        const command = 'fixed-native-entry --run ' + owner.runId; rootLaunches.push(command);
        return { ...payload, command, runId: owner.runId, identity: account };
      },
      /**
       * 中文功能：生成或核对本组验证所需的摘要与身份材料。
       * English: Generate or verify digest and identity material required by this suite.
       * 输入 / Inputs: _id; _projectId; runId; signal。
       * 结果：返回分支计算值（`!state.activeFailure && tickets.get(runId)?.phase === 'active'`），以 Promise 交付。
       * Result: Return the branch-computed value (`!state.activeFailure && tickets.get(runId)?.phase === 'active'`) through a Promise.
       * 协作入口 / Collaborators: `signal?.throwIfAborted`, `tickets.get`.
       */
      active: async (_id, _projectId, runId, signal) => { signal?.throwIfAborted(); return !state.activeFailure && tickets.get(runId)?.phase === 'active'; },
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: _id; projectId; runId; signal。
       * 结果：返回分支计算值（`tickets.get(runId)?.phase === 'active' && tickets.get(runId)?.projectId === proj…`），以 Promise 交付。
       * Result: Return the branch-computed value (`tickets.get(runId)?.phase === 'active' && tickets.get(runId)?.projectId === proj…`) through a Promise.
       * 协作入口 / Collaborators: `signal?.throwIfAborted`, `proofCalls.push`, `tickets.get`.
       */
      readonlyActive: async (_id, projectId, runId, signal) => { signal?.throwIfAborted(); proofCalls.push(projectId + ':' + runId);
        return tickets.get(runId)?.phase === 'active' && tickets.get(runId)?.projectId === projectId; },
    },
    identities: { /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id; account; runId; signal。
     * 结果：返回分支计算值（`structuredClone(run)`），以 Promise 交付。
     * Result: Return the branch-computed value (`structuredClone(run)`) through a Promise.
     * 失败 / Failure: `new AppError('old native ticket changed', 409)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `signal?.throwIfAborted`, `tickets.get`, `structuredClone`.
     */
    runReadonly: async (_id, account, runId, signal) => { signal?.throwIfAborted(); const run = tickets.get(runId);
      if (!run || run.projectId !== account.projectId || run.bootId !== state.bootId) throw new AppError('old native ticket changed', 409);
      return structuredClone(run); } },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _id; project; duration。
     * 结果：返回受控对象，公开字段包括 `status, newIntent, persistIntent, start, stop, expiresAt`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `status, newIntent, persistIntent, start, stop, expiresAt`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `binding`.
     */
    processScope: (_id, project, duration) => {
      const key = binding(project); let expiration: string | undefined;
      return {
        /**
         * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
         * English: Read or resolve observable fixture state for business calls or subsequent assertions.
         * 输入 / Inputs: signal; expectedHash。
         * 结果：返回受控对象，公开字段包括 `status, bootId, record`；各分支以实际返回对象为准。
         * Result: Return a controlled object exposing fields such as `status, bootId, record`; the actual branch determines its shape.
         * 失败 / Failure: `new AppError('transport changed', 409)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         * 协作入口 / Collaborators: `signal?.throwIfAborted`, `state.proofHook`, `records.get`, `hashes.get`.
         */
        status: async (signal, expectedHash) => { signal?.throwIfAborted(); await state.proofHook?.(); const record = records.get(key) || null;
          if (expectedHash && (!record || hashes.get(record.runId) !== expectedHash)) throw new AppError('transport changed', 409);
          return { status: !record ? 'absent' : record.phase === 'running' ? 'running' : record.phase === 'stopped' ? 'stopped' : 'prepared',
            bootId: state.bootId, record: record && structuredClone(record) }; },
        /**
         * 中文功能：生成或核对本组验证所需的摘要与身份材料。
         * English: Generate or verify digest and identity material required by this suite.
         * 输入 / Inputs: binding; bootId。
         * 结果：返回分支计算值（`projectReverseTunnelRecordSchema.parse({ version: 1, name: 'reverse-tunnel', pro…`）。
         * Result: Return the branch-computed value (`projectReverseTunnelRecordSchema.parse({ version: 1, name: 'reverse-tunnel', pro…`).
         * 协作入口 / Collaborators: `randomUUID`, `projectReverseTunnelRecordSchema.parse`.
         */
        newIntent: (binding, bootId) => { const runId = randomUUID(); return projectReverseTunnelRecordSchema.parse({ version: 1,
          name: 'reverse-tunnel', projectId: key, session: 'sakura-reverse-tunnel-' + key, runId, bootId,
          scopeName: 'sakura-service-' + runId, binding, phase: 'intent', inode: null,
          sessionId: null, paneId: null, panePid: null, paneStartTicks: null }); },
        /**
         * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
         * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
         * 输入 / Inputs: record。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 协作入口 / Collaborators: `(JSON.parse(await readFile(file, 'utf8')).sessions as any[]).find`, `JSON.parse`, `readFile`, `assert.deepEqual`.
         * 检查边界 / Checked boundaries: `assert.deepEqual(row.execution.record, record)`; `assert.equal(row.execution.run, null)`.
         */
        persistIntent: async record => { const row = (JSON.parse(await readFile(file, 'utf8')).sessions as any[]).find(row => row.projectId === key);
          assert.deepEqual(row.execution.record, record); assert.equal(row.execution.run, null); assert.equal(row.phase, 'starting');
          records.set(key, record); events.push(key + ':outer-intent'); },
        /**
         * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
         * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
         * 输入 / Inputs: intent; payload; signal。
         * 结果：返回分支计算值（`record`），以 Promise 交付。
         * Result: Return the branch-computed value (`record`) through a Promise.
         * 状态影响 / State effects: `expiration`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
         * 协作入口 / Collaborators: `signal.throwIfAborted`, `assertHeld`, `identity`, `records.set`.
         * 检查边界 / Checked boundaries: `assert.ok(duration)`.
         */
        start: async (intent, payload, signal) => {
          signal.throwIfAborted(); assertHeld(project); ++state.starts;
          const account = identity(project), record: ProjectReverseTunnelRecord = { ...intent, phase: 'running', inode: '900',
            sessionId: '$10', paneId: '%22', panePid: 1234, paneStartTicks: '987' };
          records.set(key, record); hashes.set(record.runId, payload.sha256); members.set(record.runId, new Set([1234, 5555, 5556]));
          tickets.set(record.runId, projectIdentityRunSchema.parse({ version: 1, phase: 'active', mode: 'inherit-current',
            registryId, identityId: account.identityId, projectId: key, runId: record.runId, revision: 1,
            bootId: state.bootId, build: 'a'.repeat(64), networkDevice: '4', networkInode: '500',
            cgroupDevice: '29', cgroupInode: record.inode, cgroupName: record.scopeName,
            namespace: account.networkIsolation === 'private' ? 'sk-' + key : '' }));
          assert.ok(duration); expiration = new Date(Date.now() + duration! * 1000).toISOString();
          events.push(key + ':broker-start'); return record;
        },
        /**
         * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
         * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
         * 输入 / Inputs: original。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 失败 / Failure: `new AppError('original full domain still populated', 503, 'SERVICE_CLEANUP_FAILED')`; `new AppError('new boot owns reused service label', 503, 'SERVICE_CLEANUP_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         * 协作入口 / Collaborators: `events.push`, `records.get`, `assert.equal`, `members.delete`.
         * 检查边界 / Checked boundaries: `assert.equal(known.runId, original.runId)`; `assert.equal(known.binding, original.binding)`.
         * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
         * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
         */
        stop: async original => {
          events.push(key + ':stop-attempt');
          if (state.cleanupFailures > 0) { --state.cleanupFailures; throw new AppError('original full domain still populated', 503, 'SERVICE_CLEANUP_FAILED'); }
          if (original.bootId !== state.bootId && state.coldBootBlocked) throw new AppError('new boot owns reused service label', 503, 'SERVICE_CLEANUP_FAILED');
          const known = records.get(key);
          if (known) { assert.equal(known.runId, original.runId); assert.equal(known.binding, original.binding);
            for (const field of ['inode', 'sessionId', 'paneId', 'panePid', 'paneStartTicks'] as const)
              if (original[field] !== null && known[field] !== null) assert.equal(known[field], original[field]); }
          members.delete(original.runId); events.push(key + ':full-domain-absent');
          const run = tickets.get(original.runId); if (run) tickets.set(run.runId, { ...run, phase: 'closed' });
          events.push(key + ':native-ticket-retired'); records.set(key, { ...(known || original), phase: 'stopped' });
        },
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`expiration`）。
         * Result: Return the branch-computed value (`expiration`).
         */
        expiresAt: () => expiration,
      };
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: account; run; signal。
     * 结果：返回受控对象，公开字段包括 `port, pid, startTicks, socketInode`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `port, pid, startTicks, socketInode`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `signal?.throwIfAborted`.
     */
    listener: async (account, run, signal) => { signal?.throwIfAborted(); if (state.missingListener) return null;
      return { port: 23000 + account.uid - 21000, pid: state.listenerChanged ? 9999 : 1234, startTicks: '987', socketInode: '888' }; },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`guest.openGuestTcpStream ? guest.openGuestTcpStream(args[1], args[2].listener.po…`），以 Promise 交付。
     * Result: Return the branch-computed value (`guest.openGuestTcpStream ? guest.openGuestTcpStream(args[1], args[2].listener.po…`) through a Promise.
     * 协作入口 / Collaborators: `bridges.push`, `args[4].throwIfAborted`, `args[5]`, `state.bridgeHook`.
     */
    bridge: async (...args) => { bridges.push(args); args[4].throwIfAborted(); await args[5](); await state.bridgeHook?.();
      const guest = machines as unknown as { openGuestTcpStream?: /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: id: string; port: number; signal: AbortSignal; project: Project。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      (id: string, port: number, signal: AbortSignal, project: Project) => Promise<Duplex> };
      const account = args[2].identity, project = Object.defineProperty({ directory: account.directory,
        template: 'none', repository: '', setup: '', command: '', networkIsolation: account.networkIsolation }, '_workspace',
        { value: account.projectId === 'default' ? undefined : account.projectId, enumerable: false }) as Project;
      return guest.openGuestTcpStream ? guest.openGuestTcpStream(args[1], args[2].listener.port, args[4], project) : new PassThrough(); },
  };
  return { options, file, records, tickets, identities, hashes, members, held, events, frames, rootLaunches, executions,
    proofCalls, bridges, state, /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`JSON.parse(await readFile(file, 'utf8'))`），以 Promise 交付。
     * Result: Return the branch-computed value (`JSON.parse(await readFile(file, 'utf8'))`) through a Promise.
     * 协作入口 / Collaborators: `JSON.parse`, `readFile`.
     */
    read: async () => JSON.parse(await readFile(file, 'utf8')) };
}
