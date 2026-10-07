/**
 * 模块职责：回归验证模块，围绕 `project-protocol-stream` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-protocol-stream`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: owned SESSION2 admission persists own intent before lower intent and sends exact frame without protocol EOF; detached child prevents native closure and retains original ticket plus leases until explicit retry.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectProtocolDuplex, ProjectProtocolStreams, projectProtocolRelaySource, projectProtocolStreamSchema,
  type ProjectProtocolStreamRecord } from '../server/project-protocol-stream.ts';
import { projectIdentityPayload } from '../server/project-identity.ts';
import { guestTaskControlPlan } from '../server/guest-task.ts';
import { AppError } from '../server/model.ts';
import { Jobs } from '../server/jobs.ts';
import { projectVersion, type Project, type Workspaces } from '../server/workspaces.ts';
import type { Machines } from '../server/machines.ts';
import { hostRuntime } from '../server/host-runtime/index.ts';
import { identityFor, runFor } from './project-protocol-fixture.ts';

const directory = await mkdtemp(join(tmpdir(), 'sakura-owned-protocol-'));
after(() => rm(directory, { recursive: true, force: true }));
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: network: 'host' | 'private' = 'host'。
 * 结果：返回受控对象，公开字段包括 `streams, machines, workspaces, options, root, vmId, projectId, project, identity`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `streams, machines, workspaces, options, root, vmId, projectId, project, identity`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `randomUUID`, `Object.defineProperty`.
 */
async function fixture(network: 'host' | 'private' = 'host') {
  const root = await mkdtemp(join(directory, 'case-')), vmId = randomUUID(), projectId = '1234567890abcdef', live = {};
  const project: Project = { directory: '/workspace/stream', template: 'none', repository: '', setup: '', command: '', networkIsolation: network, environment: { SESSION_SECRET: 'protocol-only-secret', PATH: '/project/bin' } };
  Object.defineProperty(project, '_workspace', { value: projectId, enumerable: false });
  const identity = identityFor(project), bootId = randomUUID();
  let boot: string = bootId;
  let taskRun = runFor(identity, randomUUID(), bootId), nativeSha = '', nativeIdentity = { ...identity }, nativeClosed = false;
  let activeFailure: Error | undefined, queryFailure: Error | undefined, cleanupFailure = false, afterFailure = false, cleanupCode = 'PROJECT_IDENTITY_CLEANUP_FAILED';
  let prepareFailure = false, resolveWrongScope = false, capturedWrongScope = false, disconnectAfterFrame = false, rejectExec = false;
  let preparationLeases = 0, admissionLeases = 0, admits = 0, activeCalls = 0, localScope = projectId;
  const calls: string[] = [], commands: string[] = [], sent: Buffer[] = [];
  let recordFile = '', plan: ReturnType<typeof guestTaskControlPlan> | undefined, wire: Duplex | undefined;
  const machines = { live: new Map([[vmId, live]]), /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'running'`）。
   * Result: Return the branch-computed value (`'running'`).
   */
  state: () => 'running', /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; command: string。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 失败 / Failure: `new Error('Unexpected root command')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `commands.push`, `command.endsWith`, `calls.push`, `command.includes`.
   * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
   * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
   */
  exec: async (_id: string, command: string) => {
    commands.push(command);
    if (command.endsWith('/proc/sys/kernel/random/boot_id')) { calls.push('boot'); return { code: 0, stdout: boot, stderr: '' }; }
    if (plan?.cleanup === command) { calls.push('whole-cgroup-stop'); return { code: cleanupFailure ? 1 : 0, stdout: '', stderr: cleanupFailure ? 'original cgroup still contains detached child' : '' }; }
    if (plan?.confirmStopped === command) { calls.push('original-scope-absent'); return { code: 0, stdout: '', stderr: '' }; }
    if (plan?.retire === command) { calls.push('root-owner-retire'); return { code: 0, stdout: '', stderr: '' }; }
    if (command.includes('test ! -e')) { calls.push('old-root-owner-absent'); return { code: 0, stdout: '', stderr: '' }; }
    throw new Error('Unexpected root command');
  } } as unknown as Machines;
  const workspaces = { projects: { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`localScope`）。
   * Result: Return the branch-computed value (`localScope`).
   */
  current: () => localScope, /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: _id: string; scope: string; action: () => Promise<unknown>。
   * 结果：返回分支计算值（`await action()`），以 Promise 交付。
   * Result: Return the branch-computed value (`await action()`) through a Promise.
   * 状态影响 / State effects: `localScope`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `action`.
   */
  inScope: async (_id: string, scope: string, action: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => Promise<unknown>) => {
    const previous = localScope; localScope = scope; try { return await action(); } finally { localScope = previous; }
  } }, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`project`），以 Promise 交付。
   * Result: Return the branch-computed value (`project`) through a Promise.
   */
  config: async () => project, /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: _id: string; value: Project。
   * 结果：返回分支计算值（`resolved`），以 Promise 交付。
   * Result: Return the branch-computed value (`resolved`) through a Promise.
   * 协作入口 / Collaborators: `assert.equal`, `Object.keys(value).includes`, `Object.keys`, `Object.defineProperty`.
   * 检查边界 / Checked boundaries: `assert.equal(value._workspace, projectId)`; `assert.equal(Object.keys(value).includes('_workspace'), false)`.
   */
  resolveProject: async (_id: string, value: Project) => {
    assert.equal(value._workspace, projectId); assert.equal(Object.keys(value).includes('_workspace'), false);
    const resolved = { ...value }; Object.defineProperty(resolved, '_workspace', { value: resolveWrongScope ? 'fedcba0987654321' : value._workspace, enumerable: false });
    return resolved;
  } } as unknown as Workspaces;
  const preparation = { /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: _id: string; scope: string; _cwd: unknown; _install: boolean; signal: AbortSignal。
   * 结果：返回受控对象，公开字段包括 `projectId, signal, captured, release`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `projectId, signal, captured, release`; the actual branch determines its shape.
   * 失败 / Failure: `new AppError('prep refusal', 409)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `calls.push`, `assert.equal`, `Object.defineProperty`, `projectVersion`.
   * 检查边界 / Checked boundaries: `assert.equal(scope, projectId)`.
   */
  prepare: async (_id: string, scope: string, _cwd: unknown, _install: boolean, signal: AbortSignal) => {
    calls.push('prepare-lease'); assert.equal(scope, projectId);
    if (prepareFailure) throw new AppError('prep refusal', 409);
    ++preparationLeases;
    const captured = Object.defineProperty({ ...project }, '_workspace', { value: capturedWrongScope ? 'fedcba0987654321' : projectId, enumerable: false });
    return { projectId, signal, captured: { project: captured, configVersion: projectVersion(project), live },
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 状态影响 / State effects: `preparationLeases`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `calls.push`.
       */
      release: async () => { calls.push('prepare-release'); preparationLeases = 0; } };
  }, /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `calls.push`.
   */
  close: async () => { calls.push('preparation-close'); } };
  const scopes = { /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: _id: string; original: Project; execution: Parameters<typeof projectIdentityPayload>[0]; _signal: AbortSignal; options: any。
   * 结果：返回受控对象，公开字段包括 `live, owner, agentContext, forwarding, gpgContext, gpgForwarding, payload, release`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `live, owner, agentContext, forwarding, gpgContext, gpgForwarding, payload, release`; the actual branch determines its shape.
   * 状态影响 / State effects: `nativeSha`, `taskRun`, `recordFile`, `plan`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `assert.equal`, `projectIdentityPayload`, `runFor`, `randomUUID`.
   * 检查边界 / Checked boundaries: `assert.equal(original._workspace, projectId)`; `assert.equal(options.expectedLive, live)`.
   */
  admitTask: async (_id: string, original: Project, execution: Parameters<typeof projectIdentityPayload>[0], _signal: AbortSignal, options: any) => {
    ++admits; assert.equal(original._workspace, projectId); assert.equal(options.expectedLive, live); assert.equal(options.expectedBootId, bootId);
    const payload = projectIdentityPayload(execution); nativeSha = payload.sha256;
    taskRun = runFor(identity, randomUUID(), bootId);
    await options.beforeIntent({ identity, sha256: payload.sha256, owner: { kind: 'task', runId: taskRun.runId, bootId } });
    recordFile = join(root, 'project-protocol-streams', projectId, taskRun.runId + '.json');
    const intent = JSON.parse(await readFile(recordFile, 'utf8'));
    assert.equal(intent.phase, 'intent'); assert.equal(intent.issued, false); assert.equal(intent.sha256, nativeSha);
    calls.push('lower-host-intent'); ++admissionLeases;
    plan = guestTaskControlPlan(taskRun.runId, intent.controlToken, '', intent.timeoutMs);
    return { live: live as never, owner: { kind: 'task' as const, runId: taskRun.runId, bootId }, agentContext: undefined, forwarding: undefined, gpgContext: undefined, gpgForwarding: undefined, payload: { ...payload, identity, runId: taskRun.runId,
      command: '/usr/bin/env -i HOME=/ /usr/bin/python3 -I -S /fixed/controller.py ' + Buffer.from(JSON.stringify({ action: 'exec-current-session', run: taskRun.runId, sha256: payload.sha256 })).toString('base64') },
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 状态影响 / State effects: `admissionLeases`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `calls.push`.
       */
      release: () => { calls.push('admission-release'); admissionLeases = 0; } };
  }, /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：返回布尔判定，供用例选择路径或核对受控条件。
   * Result: Return a boolean decision for path selection or controlled-condition assertions.
   * 失败 / Failure: `activeFailure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `calls.push`.
   */
  active: async () => { ++activeCalls; calls.push('native-activate-query'); if (activeFailure) throw activeFailure; return true; },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `identity, owner, sha256, phase, run`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `identity, owner, sha256, phase, run`; the actual branch determines its shape.
     * 失败 / Failure: `queryFailure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `calls.push`.
     */
    readonlyTask: async () => { calls.push('native-readonly'); if (queryFailure) throw queryFailure;
      return { identity: nativeIdentity, owner: { kind: 'task' as const, runId: taskRun.runId, bootId }, sha256: nativeSha,
        phase: 'active' as const, run: taskRun }; },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回受控对象，公开字段包括 `identity, owner, sha256, phase, run`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `identity, owner, sha256, phase, run`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `calls.push`, `structuredClone`.
     */
    taskRun: async () => { calls.push('lower-intent-readonly'); return { identity: { ...nativeIdentity },
      owner: { kind: 'task' as const, runId: taskRun.runId, bootId }, sha256: nativeSha, phase: 'active' as const,
      run: structuredClone(taskRun) }; },
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `nativeClosed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new AppError('native cleanup query failed', 503, cleanupCode)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `calls.push`.
     */
    closeAfterScopeStopped: async () => { calls.push(boot !== bootId ? 'old-boot-native-retire' : 'native-close-after-scope');
      if (afterFailure) throw new AppError('native cleanup query failed', 503, cleanupCode); nativeClosed = true; },
  };
  const options = { rootDirectory: root, scopes, identities: { /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`structuredClone(taskRun)`），以 Promise 交付。
   * Result: Return the branch-computed value (`structuredClone(taskRun)`) through a Promise.
   * 失败 / Failure: `queryFailure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `structuredClone`.
   */
  runReadonly: async () => { if (queryFailure) throw queryFailure; return structuredClone(taskRun); } },
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`preparation as never`）。
     * Result: Return the branch-computed value (`preparation as never`).
     */
    createPreparation: () => preparation as never,
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `wire, close`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `wire, close`; the actual branch determines its shape.
     * 状态影响 / State effects: `wire`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new Error('lost SSH exec acknowledgement')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `calls.push`, `commands.push`, `assert.ok`, `command.includes`.
     * 检查边界 / Checked boundaries: `assert.ok(!command.includes('protocol-only-secret'))`; `assert.ok(!command.includes('/project/bin'))`.
     */
    channel: async (_id: string, command: string) => {
      calls.push('ssh-protocol-exec'); commands.push(command);
      assert.ok(!command.includes('protocol-only-secret')); assert.ok(!command.includes('/project/bin'));
      const issued = JSON.parse(await readFile(recordFile, 'utf8')); assert.equal(issued.issued, true);
      if (rejectExec) throw new Error('lost SSH exec acknowledgement');
      wire = new Duplex({ allowHalfOpen: true, /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       */
      read() {}, /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: chunk; _encoding; done。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 协作入口 / Collaborators: `sent.push`, `Buffer.from`, `queueMicrotask`, `done`.
       */
      write(chunk, _encoding, done) {
        sent.push(Buffer.from(chunk)); if (disconnectAfterFrame) queueMicrotask(() => wire!.destroy()); done();
      } }); wire.on('error', () => {}); return { wire, /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 协作入口 / Collaborators: `calls.push`, `wire!.destroy`.
       */
      close: () => { calls.push('ssh-client-close'); wire!.destroy(); } };
    } };
  const streams = new ProjectProtocolStreams(machines, workspaces, options);
  return { streams, machines, workspaces, options, root, vmId, projectId, project, identity, calls, commands, sent,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: signal: AbortSignal。
     * 结果：返回分支计算值（`streams.open(vmId, 'dap', project, () => ({ command: 'exec /fixed/adapter --stdi…`）。
     * Result: Return the branch-computed value (`streams.open(vmId, 'dap', project, () => ({ command: 'exec /fixed/adapter --stdi…`).
     * 协作入口 / Collaborators: `streams.open`.
     */
    open: (signal?: AbortSignal) => streams.open(vmId, 'dap', project, () => ({ command: 'exec /fixed/adapter --stdio' }), signal),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`new ProjectProtocolStreams(machines, workspaces, options)`）。
     * Result: Return the branch-computed value (`new ProjectProtocolStreams(machines, workspaces, options)`).
     */
    reload: () => new ProjectProtocolStreams(machines, workspaces, options),
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`JSON.parse(await readFile(recordFile, 'utf8')) as ProjectProtocolStreamRecord`），以 Promise 交付。
     * Result: Return the branch-computed value (`JSON.parse(await readFile(recordFile, 'utf8')) as ProjectProtocolStreamRecord`) through a Promise.
     * 协作入口 / Collaborators: `JSON.parse`, `readFile`.
     */
    record: async () => JSON.parse(await readFile(recordFile, 'utf8')) as ProjectProtocolStreamRecord,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`JSON.parse(await readFile(join(root, 'project-protocol-streams', projectId, 'clo…`），以 Promise 交付。
     * Result: Return the branch-computed value (`JSON.parse(await readFile(join(root, 'project-protocol-streams', projectId, 'clo…`) through a Promise.
     * 协作入口 / Collaborators: `JSON.parse`, `readFile`, `join`.
     */
    archived: async () => JSON.parse(await readFile(join(root, 'project-protocol-streams', projectId, 'closed', taskRun.runId + '.json'), 'utf8')) as ProjectProtocolStreamRecord,
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`nativeClosed`）。
     * Result: Return the branch-computed value (`nativeClosed`).
     */
    nativeClosed: () => nativeClosed, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回列表形式的受控数据，供调用者遍历或比较。
     * Result: Return controlled data as a list for iteration or comparison.
     */
    leases: () => [preparationLeases, admissionLeases], /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`admits`）。
     * Result: Return the branch-computed value (`admits`).
     */
    admits: () => admits,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`structuredClone(taskRun)`）。
     * Result: Return the branch-computed value (`structuredClone(taskRun)`).
     * 协作入口 / Collaborators: `structuredClone`.
     */
    taskRun: () => structuredClone(taskRun), /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`activeCalls`）。
     * Result: Return the branch-computed value (`activeCalls`).
     */
    activeCalls: () => activeCalls,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `boot`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setBoot: (value: string) => { boot = value; }, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `cleanupFailure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setCleanupFailure: (value: boolean) => { cleanupFailure = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean; code = 'PROJECT_IDENTITY_CLEANUP_FAILED'。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `afterFailure`, `cleanupCode`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setAfterFailure: (value: boolean, code = 'PROJECT_IDENTITY_CLEANUP_FAILED') => { afterFailure = value; cleanupCode = code; }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `prepareFailure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setPrepareFailure: () => { prepareFailure = true; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: where: 'resolve' | 'capture'。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `resolveWrongScope`, `capturedWrongScope`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setWrongScope: (where: 'resolve' | 'capture') => { if (where === 'resolve') resolveWrongScope = true; else capturedWrongScope = true; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: Error | undefined。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `queryFailure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setQueryFailure: (value: Error | undefined) => { queryFailure = value; }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: Error。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `activeFailure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setActiveFailure: (value: Error) => { activeFailure = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: patch: Partial<typeof taskRun>。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `Object.assign`.
     */
    setPin: (patch: Partial<typeof taskRun>) => { Object.assign(taskRun, patch); },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: patch: Partial<typeof identity>。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `Object.assign`.
     */
    setIdentity: (patch: Partial<typeof identity>) => { Object.assign(nativeIdentity, patch); },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `nativeSha`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setSha: (value: string) => { nativeSha = value; }, /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `disconnectAfterFrame`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setDisconnectAfterFrame: () => { disconnectAfterFrame = true; }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `rejectExec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setRejectExec: () => { rejectExec = true; },
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: owned SESSION2 admission persists own intent before lower intent and sends exact frame without protocol EOF
 * 协作入口 / Collaborators: `fixture`, `f.open`, `assert.equal`, `owner.record`.
 * 检查边界 / Checked boundaries: `assert.equal(owner.record().phase, 'active')`; `assert.deepEqual(owner.record().run, f.taskRun())`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('owned SESSION2 admission persists own intent before lower intent and sends exact frame without protocol EOF', async () => {
  const f = await fixture('private'), owner = await f.open();
  assert.equal(owner.record().phase, 'active'); assert.deepEqual(owner.record().run, f.taskRun());
  assert.equal(owner.record().identity.home, f.identity.home); assert.equal(owner.record().run?.namespace, 'sk-' + f.projectId);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].readUInt32LE(12), 2); assert.ok(f.sent[0].includes(Buffer.from('protocol-only-secret')));
  assert.equal(owner.stream.writableEnded, false); assert.deepEqual(f.leases(), [1, 1]);
  await owner.assertCurrent(); await owner.assertNative(); await owner.close();
  assert.equal(f.nativeClosed(), true); assert.deepEqual(f.leases(), [0, 0]);
  for (const [before, after] of [['whole-cgroup-stop', 'original-scope-absent'], ['original-scope-absent', 'native-close-after-scope'],
    ['native-close-after-scope', 'root-owner-retire'], ['root-owner-retire', 'prepare-release']])
    assert.ok(f.calls.indexOf(before) < f.calls.indexOf(after));
  assert.equal((await f.archived()).closure?.reason, 'scope-stopped'); assert.deepEqual(await f.streams.recordsAll(f.vmId), []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: detached child prevents native closure and retains original ticket plus leases until explicit retry
 * 协作入口 / Collaborators: `fixture`, `f.open`, `owner.record`, `f.setCleanupFailure`.
 * 检查边界 / Checked boundaries: `assert.equal(budget()?.kind, 'execution.session')`; `assert.rejects(owner.close(), { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('detached child prevents native closure and retains original ticket plus leases until explicit retry', async () => {
  const f = await fixture(), owner = await f.open(), original = owner.record(); f.setCleanupFailure(true);
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`hostRuntime.snapshot().resources.find(value => value.owner === `session:${origin…`）。
   * Result: Return the branch-computed value (`hostRuntime.snapshot().resources.find(value => value.owner === `session:${origin…`).
   * 验证场景 / Scenario: detached child prevents native closure and retains original ticket plus leases until explicit retry
   * 协作入口 / Collaborators: `hostRuntime.snapshot().resources.find`, `hostRuntime.snapshot`.
   */
  const budget = () => hostRuntime.snapshot().resources.find(value => value.owner === `session:${original.runId}`);
  assert.equal(budget()?.kind, 'execution.session');
  await assert.rejects(owner.close(), { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' });
  assert.deepEqual((await f.record()).run, original.run); assert.equal((await f.record()).phase, 'review');
  assert.equal(f.nativeClosed(), false); assert.deepEqual(f.leases(), [1, 1]);
  assert.equal(budget()?.state, 'cleanup-pending');
  assert.equal(f.calls.includes('native-close-after-scope'), false); assert.equal(f.calls.includes('root-owner-retire'), false);
  f.setCleanupFailure(false); await owner.close(); assert.deepEqual(f.leases(), [0, 0]); assert.equal((await f.archived()).phase, 'closed');
  assert.equal(budget(), undefined);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: native cleanup failure preserves full original scope receipt and status code
 * 协作入口 / Collaborators: `fixture`, `f.open`, `f.setAfterFailure`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(owner.close(), { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`; `assert.equal((await f.record()).phase, 'review')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('native cleanup failure preserves full original scope receipt and status code', async () => {
  const f = await fixture(), owner = await f.open(); f.setAfterFailure(true);
  await assert.rejects(owner.close(), { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal((await f.record()).phase, 'review'); assert.deepEqual(f.leases(), [1, 1]); assert.equal(f.calls.includes('root-owner-retire'), false);
  f.setAfterFailure(false); await owner.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: closed native phase cannot close the host stream while the original full cgroup survives
 * 协作入口 / Collaborators: `fixture`, `f.open`, `owner.record`, `f.setPin`.
 * 检查边界 / Checked boundaries: `assert.rejects(owner.close(), { status: 503 })`; `assert.deepEqual((await f.record()).run, original.run)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('closed native phase cannot close the host stream while the original full cgroup survives', async () => {
  const f = await fixture(), owner = await f.open(), original = owner.record();
  f.setPin({ phase: 'closed' }); f.setCleanupFailure(true);
  await assert.rejects(owner.close(), { status: 503 }); assert.deepEqual((await f.record()).run, original.run);
  assert.equal((await f.record()).phase, 'review'); assert.equal(f.calls.includes('native-close-after-scope'), false);
  f.setCleanupFailure(false); await owner.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: protocol cancellation cleanup 503 remains a durable Jobs failure rather than cancelled success
 * 协作入口 / Collaborators: `fixture`, `f.setCleanupFailure`, `jobs.track`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(tracked, { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' })`; `assert.equal(restored.view('lsp')?.status, 'error')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('protocol cancellation cleanup 503 remains a durable Jobs failure rather than cancelled success', async () => {
  const f = await fixture(), jobs = new Jobs('owned-stream-job', f.root), abort = new AbortController();
  f.setCleanupFailure(true); let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const tracked = jobs.track('lsp', async (_log, signal) => {
    const owner = await f.open(signal), cancelled = new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    entered(); await cancelled; await owner.close();
  }, {}, abort.signal);
  const refused = assert.rejects(tracked, { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' });
  await ready; abort.abort(); await refused; await jobs.close();
  const restored = new Jobs('owned-stream-job', f.root); assert.equal(restored.view('lsp')?.status, 'error');
  assert.equal(restored.view('lsp')?.errorCode, 'GUEST_TASK_CLEANUP_FAILED'); await restored.close();
  const original = await f.record(); assert.equal(original.phase, 'review'); assert.deepEqual(f.leases(), [1, 1]);
  f.setCleanupFailure(false); await f.streams.stop(f.vmId, f.projectId, original.runId); assert.deepEqual(f.leases(), [0, 0]);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: other project stop and orphan recovery cannot affect a connected original protocol owner
 * 协作入口 / Collaborators: `fixture`, `f.open`, `assert.rejects`, `f.streams.stop`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.streams.stop(f.vmId, 'fedcba0987654321', owner.record().runId), { status: 409 })`; `assert.equal(f.calls.includes('whole-cgroup-stop'), false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('other project stop and orphan recovery cannot affect a connected original protocol owner', async () => {
  const f = await fixture(), owner = await f.open();
  await assert.rejects(f.streams.stop(f.vmId, 'fedcba0987654321', owner.record().runId), { status: 409 });
  await f.streams.recover(f.vmId, f.projectId, 'dap');
  await f.streams.recover(f.vmId, 'fedcba0987654321', 'dap');
  assert.equal(f.calls.includes('whole-cgroup-stop'), false); assert.equal(owner.stream.destroyed, false); await owner.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lost activation acknowledgement retains cleanup intent and reload cleans original domain without new prepare
 * 协作入口 / Collaborators: `fixture`, `f.setActiveFailure`, `f.setCleanupFailure`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.open(), { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' })`; `assert.equal(original.phase, 'review')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('lost activation acknowledgement retains cleanup intent and reload cleans original domain without new prepare', async () => {
  const f = await fixture(); f.setActiveFailure(new AppError('native activation ack lost', 502, 'PROJECT_IDENTITY_CONTROL_FAILED')); f.setCleanupFailure(true);
  await assert.rejects(f.open(), { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' });
  const original = await f.record(); assert.equal(original.phase, 'review'); assert.equal(original.run, null); assert.equal(original.issued, true);
  f.setCleanupFailure(false); const reloaded = f.reload(); await reloaded.stop(f.vmId, f.projectId, original.runId);
  assert.equal(f.admits(), 1); assert.equal((await f.archived()).phase, 'closed'); await f.streams.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lost exec acknowledgement is conservatively issued and cannot discard original cleanup authority
 * 协作入口 / Collaborators: `fixture`, `f.setRejectExec`, `f.setCleanupFailure`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.open(), { status: 503 })`; `assert.equal(original.issued, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('lost exec acknowledgement is conservatively issued and cannot discard original cleanup authority', async () => {
  const f = await fixture(); f.setRejectExec(); f.setCleanupFailure(true);
  await assert.rejects(f.open(), { status: 503 }); const original = await f.record();
  assert.equal(original.issued, true); assert.equal(original.phase, 'review');
  f.setCleanupFailure(false); await f.reload().stop(f.vmId, f.projectId, original.runId); await f.streams.close();
  assert.deepEqual(f.leases(), [0, 0]);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: protocol close after frame performs full scope cleanup and preserves cleanup failures for retry
 * 协作入口 / Collaborators: `fixture`, `f.setDisconnectAfterFrame`, `f.setCleanupFailure`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.open(), { status: 503 })`; `assert.equal((await f.record()).phase, 'review')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('protocol close after frame performs full scope cleanup and preserves cleanup failures for retry', async () => {
  const f = await fixture(); f.setDisconnectAfterFrame(); f.setCleanupFailure(true);
  await assert.rejects(f.open(), { status: 503 });
  assert.equal((await f.record()).phase, 'review'); assert.deepEqual(f.leases(), [1, 1]);
  f.setCleanupFailure(false); await f.streams.close(); assert.deepEqual(f.leases(), [0, 0]);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: readonly reload uses full original pinned receipt without install, prepare or host phase change
 * 协作入口 / Collaborators: `fixture`, `f.open`, `f.record`, `f.reload`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(await f.record(), original)`; `assert.equal(f.admits(), before)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('readonly reload uses full original pinned receipt without install, prepare or host phase change', async () => {
  const f = await fixture(), owner = await f.open(), original = await f.record(), reloaded = f.reload();
  const before = f.admits(), queries = f.activeCalls(); await reloaded.readonly(original);
  assert.deepEqual(await f.record(), original); assert.equal(f.admits(), before); assert.equal(f.activeCalls(), queries);
  await assert.rejects(reloaded.readonly({ ...original, phase: 'intent', run: null }), { status: 409 });
  assert.deepEqual(await f.record(), original); await owner.close();
});

for (const [label, patch] of Object.entries({ cgroupInode: { cgroupInode: '99' }, networkInode: { networkInode: '99' },
  build: { build: 'b'.repeat(64) }, boot: { bootId: randomUUID() }, run: { runId: randomUUID() }, closed: { phase: 'closed' as const } })) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `fixture`, `f.open`, `f.record`, `f.setPin`.
   * 检查边界 / Checked boundaries: `assert.rejects(owner.assertNative(), { status: 409 })`; `assert.deepEqual(await f.record(), original)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  test('readonly protocol owner refuses changed native ' + label + ' without modifying original receipt', async () => {
    const f = await fixture(), owner = await f.open(), original = await f.record(); f.setPin(patch);
    await assert.rejects(owner.assertNative(), { status: 409 }); assert.deepEqual(await f.record(), original);
    f.setPin(original.run!); await owner.close();
  });
}
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: readonly protocol owner binds full identity and transport digest, and does not swallow native query error
 * 协作入口 / Collaborators: `fixture`, `f.open`, `f.record`, `f.setIdentity`.
 * 检查边界 / Checked boundaries: `assert.rejects(owner.assertNative(), { status: 409 })`; `assert.rejects(owner.assertNative(), { status: 409 })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('readonly protocol owner binds full identity and transport digest, and does not swallow native query error', async () => {
  const f = await fixture(), owner = await f.open(), original = await f.record();
  f.setIdentity({ homeInode: '999' }); await assert.rejects(owner.assertNative(), { status: 409 }); f.setIdentity(original.identity);
  f.setSha('c'.repeat(64)); await assert.rejects(owner.assertNative(), { status: 409 }); f.setSha(original.sha256);
  f.setQueryFailure(new AppError('native proof unavailable', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'));
  await assert.rejects(owner.assertNative(), { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.deepEqual(await f.record(), original); f.setQueryFailure(undefined); await owner.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cold boot rejects old readonly owner and retires old complete ticket without issuing a new-boot kill
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.open`, `f.record`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reload().readonly(original), { status: 409 })`; `assert.equal(f.calls.includes('whole-cgroup-stop'), false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cold boot rejects old readonly owner and retires old complete ticket without issuing a new-boot kill', async () => {
  const f = await fixture(), owner = await f.open(), original = await f.record(), boot = randomUUID();
  f.setBoot(boot); await assert.rejects(f.reload().readonly(original), { status: 409 });
  f.calls.length = 0; await owner.close();
  assert.equal(f.calls.includes('whole-cgroup-stop'), false); assert.equal(f.calls.includes('root-owner-retire'), false);
  assert.equal(f.calls.includes('old-boot-native-retire'), true);
  const closed = await f.archived(); assert.deepEqual(closed.run, original.run); assert.deepEqual(closed.closure, { reason: 'guest-reboot', bootId: boot });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: live replacement cannot target another VM process and preserves original cleanup authority
 * 协作入口 / Collaborators: `fixture`, `f.open`, `f.machines.live.get`, `f.machines.live.set`.
 * 检查边界 / Checked boundaries: `assert.rejects(owner.close(), { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`; `assert.equal(f.calls.includes('whole-cgroup-stop'), false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('live replacement cannot target another VM process and preserves original cleanup authority', async () => {
  const f = await fixture(), owner = await f.open(), old = f.machines.live.get(f.vmId)!;
  f.machines.live.set(f.vmId, {} as never); await assert.rejects(owner.close(), { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(f.calls.includes('whole-cgroup-stop'), false); assert.deepEqual(f.leases(), [1, 1]);
  f.machines.live.set(f.vmId, old); await owner.close();
});

for (const where of ['resolve', 'capture'] as const) /**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `fixture`, `f.setWrongScope`, `assert.equal`, `Object.keys(f.project).includes`.
 * 检查边界 / Checked boundaries: `assert.equal(Object.keys(f.project).includes('_workspace'), false)`; `assert.rejects(f.open(), { status: 409, code: 'PROJECT_IDENTITY_HOST_CHANGED' })`.
 */
test('non-enumerable named project capture cannot be replaced despite matching hash: ' + where, async () => {
  const f = await fixture(); f.setWrongScope(where); assert.equal(Object.keys(f.project).includes('_workspace'), false);
  await assert.rejects(f.open(), { status: 409, code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal(f.admits(), 0); assert.deepEqual(f.leases(), [0, 0]);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: prepare refusal closes only own manager and never issues native or SSH execution
 * 协作入口 / Collaborators: `fixture`, `f.setPrepareFailure`, `assert.rejects`, `f.open`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.open(), /prep refusal/)`; `assert.equal(f.admits(), 0)`.
 */
test('prepare refusal closes only own manager and never issues native or SSH execution', async () => {
  const f = await fixture(); f.setPrepareFailure(); await assert.rejects(f.open(), /prep refusal/);
  assert.equal(f.admits(), 0); assert.equal(f.calls.includes('ssh-protocol-exec'), false); assert.deepEqual(f.leases(), [0, 0]);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: explicit expected original live refuses replacement before any prepare or native issuance
 * 协作入口 / Collaborators: `fixture`, `f.machines.live.get`, `f.machines.live.set`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.streams.open(f.vmId, 'dap', f.project, () => ({ command: 'never-executed' }), undefined, undefined, original), { …`; `assert.equal(f.calls.length, 0)`.
 */
test('explicit expected original live refuses replacement before any prepare or native issuance', async () => {
  const f = await fixture(), original = f.machines.live.get(f.vmId)!; f.machines.live.set(f.vmId, {} as never);
  await assert.rejects(f.streams.open(f.vmId, 'dap', f.project, () => ({ command: 'never-executed' }), undefined, undefined, original),
    { status: 409, code: 'PROJECT_IDENTITY_HOST_CHANGED' }); assert.equal(f.calls.length, 0); assert.equal(f.admits(), 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cleanup rejects a changed full lower pin before guest signal and native network 503 preserves its code
 * 协作入口 / Collaborators: `fixture`, `f.open`, `owner.record`, `f.setPin`.
 * 检查边界 / Checked boundaries: `assert.rejects(owner.close(), { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`; `assert.equal(f.calls.includes('whole-cgroup-stop'), false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cleanup rejects a changed full lower pin before guest signal and native network 503 preserves its code', async () => {
  const f = await fixture(), owner = await f.open(), original = owner.record(); f.setPin({ cgroupInode: '999' });
  await assert.rejects(owner.close(), { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(f.calls.includes('whole-cgroup-stop'), false); assert.deepEqual((await f.record()).run, original.run);
  f.setPin(original.run!); f.setAfterFailure(true, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
  await assert.rejects(owner.close(), { status: 503, code: 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED' });
  assert.equal(f.calls.includes('root-owner-retire'), false); f.setAfterFailure(false); await owner.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: schema refuses full ticket from another project, wrong original domain, incomplete active and early closed receipt
 * 协作入口 / Collaborators: `fixture`, `f.open`, `owner.record`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(projectProtocolStreamSchema.safeParse(value).success, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('schema refuses full ticket from another project, wrong original domain, incomplete active and early closed receipt', async () => {
  const f = await fixture(), owner = await f.open(), original = owner.record();
  for (const value of [{ ...original, vmId: 'not-uuid' }, { ...original, projectId: 'fedcba0987654321' },
    { ...original, run: { ...original.run!, cgroupName: 'sakura-service-' + original.runId } }, { ...original, run: null },
    { ...original, phase: 'closed' }, { ...original, phase: 'closed', closure: { reason: 'guest-reboot', bootId: original.bootId } }])
    assert.equal(projectProtocolStreamSchema.safeParse(value).success, false);
  await owner.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: malformed persisted protocol receipt returns cleanup 503 without signaling or removing original evidence
 * 状态影响 / State effects: `f.calls.length`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.open`, `owner.record`, `join`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.reload().stop(f.vmId, f.projectId, original.runId), { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`; `assert.equal(await readFile(file, 'utf8'), broken)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('malformed persisted protocol receipt returns cleanup 503 without signaling or removing original evidence', async () => {
  const f = await fixture(), owner = await f.open(), original = owner.record();
  const file = join(f.root, 'project-protocol-streams', f.projectId, original.runId + '.json');
  const text = await readFile(file, 'utf8'), broken = '{invalid protected ownership json'; await writeFile(file, broken);
  f.calls.length = 0;
  await assert.rejects(f.reload().stop(f.vmId, f.projectId, original.runId),
    { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(await readFile(file, 'utf8'), broken); assert.equal(f.calls.length, 0); assert.deepEqual(f.leases(), [1, 1]);
  await writeFile(file, text); await owner.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: closed receipts are archived intact and do not exhaust live protocol ledger on repeated LSP requests
 * 协作入口 / Collaborators: `fixture`, `f.open`, `owner.record`, `owner.close`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(await f.reload().recordsAll(f.vmId), [])`; `assert.ok((await readdir(archive)).length > 1024)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('closed receipts are archived intact and do not exhaust live protocol ledger on repeated LSP requests', async () => {
  const f = await fixture(), owner = await f.open(), original = owner.record(); await owner.close();
  const archive = join(f.root, 'project-protocol-streams', f.projectId, 'closed');
  const closed = await f.archived();
  await Promise.all(Array.from({ length: 1025 }, () => {
    const runId = randomUUID();
    const receipt = projectProtocolStreamSchema.parse({ ...closed, runId, run: { ...closed.run!, runId, cgroupName: 'sakura-task-' + runId } });
    return writeFile(join(archive, runId + '.json'), JSON.stringify(receipt));
  }));
  assert.deepEqual(await f.reload().recordsAll(f.vmId), []); assert.ok((await readdir(archive)).length > 1024);
  assert.deepEqual((await f.archived()).run, original.run);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: binary protocol stream preserves NUL, half-close EOF, stdout bytes and write callback backpressure
 * 协作入口 / Collaborators: `Buffer.from`, `stream.write`, `delay`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(completed, false)`; `assert.equal(completed, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('binary protocol stream preserves NUL, half-close EOF, stdout bytes and write callback backpressure', async () => {
  let callback!: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, stopped = 0; const written: Buffer[] = [];
  const wire = new Duplex({ allowHalfOpen: true, /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: binary protocol stream preserves NUL, half-close EOF, stdout bytes and write callback backpressure
   */
  read() {}, /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: chunk; _encoding; done。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: binary protocol stream preserves NUL, half-close EOF, stdout bytes and write callback backpressure
   * 状态影响 / State effects: `callback`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `written.push`, `Buffer.from`.
   */
  write(chunk, _encoding, done) { written.push(Buffer.from(chunk)); callback = done; } });
  const stream = new ProjectProtocolDuplex(wire, () => { ++stopped; }); let completed = false;
  const binary = Buffer.from([0, 255, 128, 10, 0]); stream.write(binary, () => { completed = true; });
  await delay(0); assert.equal(completed, false); callback(); await delay(0); assert.equal(completed, true);
  assert.deepEqual(written[0], binary); stream.end(); await new Promise<void>(resolve => wire.once('finish', resolve));
  assert.equal(stream.destroyed, false); wire.push(binary); wire.push(null);
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), binary); await delay(0); assert.equal(stopped, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unconsumed protocol output pauses the SSH channel at bounded stream high-water mark
 * 协作入口 / Collaborators: `assert.equal`, `wire.isPaused`, `stream.read`, `wire.push`.
 * 检查边界 / Checked boundaries: `assert.equal(wire.isPaused(), true)`; `assert.equal(wire.isPaused(), true)`.
 */
test('unconsumed protocol output pauses the SSH channel at bounded stream high-water mark', async () => {
  let stop = 0; const wire = new Duplex({ /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: unconsumed protocol output pauses the SSH channel at bounded stream high-water mark
   */
  read() {}, /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: _chunk; _encoding; done。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: unconsumed protocol output pauses the SSH channel at bounded stream high-water mark
   * 协作入口 / Collaborators: `done`.
   */
  write(_chunk, _encoding, done) { done(); } });
  const stream = new ProjectProtocolDuplex(wire, () => { ++stop; });
  assert.equal(wire.isPaused(), true); stream.read(0); wire.push(Buffer.alloc(65536, 0x7f)); await delay(0);
  assert.equal(wire.isPaused(), true); assert.ok(stream.readableLength <= 65536);
  stream.destroy(); await delay(0); assert.equal(stop, 1);
});

const pythonModel = String.raw`import ast,base64,hashlib,json,stat,struct,sys,time,types
case=json.loads(sys.stdin.buffer.read());source=ast.parse(case['source'])
program=ast.Module(body=[node for node in source.body if isinstance(node,ast.FunctionDef) and node.name in ('frame','refuse')],type_ignores=[])
data=base64.b64decode(case['data']);reads=[];original=case.get('flags',0);state={'data':data,'flags':original}
def read(fd,size):
 assert fd==0;reads.append(size);n=min(size,case.get('fragment',7));part=state['data'][:n];state['data']=state['data'][n:];return part
class Poller:
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def register(self,*args):pass
 def select(self,*args):return [] if case.get('timeout') else [1]
def fcntl(fd,operation,value=None):
 assert fd==0
 if operation==1:return state['flags']
 state['flags']=value
namespace={'request':{'sha256':case['sha256']},'hashlib':hashlib,'struct':struct,'stat':stat,'time':time,
 'selectors':types.SimpleNamespace(DefaultSelector=Poller,EVENT_READ=1),
 'fcntl':types.SimpleNamespace(fcntl=fcntl,F_GETFL=1,F_SETFL=2),
 'os':types.SimpleNamespace(O_ACCMODE=3,O_WRONLY=1,O_NONBLOCK=2048,read=read,fstat=lambda fd:types.SimpleNamespace(st_mode=case.get('mode',stat.S_IFIFO)))}
exec(compile(program,'original-protected-relay','exec'),namespace)
try:payload=namespace['frame']();result={'ok':True,'payload':base64.b64encode(payload).decode()}
except Exception as error:result={'ok':False,'error':str(error)}
result.update(rest=base64.b64encode(state['data']).decode(),reads=reads,restored=state['flags']==original);print(json.dumps(result))
`;
/**
 * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
 * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
 * 输入 / Inputs: input: Buffer; sha256: string; options: Record<string, unknown> = {}。
 * 结果：返回分支计算值（`JSON.parse(result.stdout)`）。
 * Result: Return the branch-computed value (`JSON.parse(result.stdout)`).
 * 协作入口 / Collaborators: `projectProtocolRelaySource`, `spawnSync`, `JSON.stringify`, `input.toString`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 0, result.stderr)`.
 */
function frameModel(input: Buffer, sha256: string, options: Record<string, unknown> = {}) {
  const source = projectProtocolRelaySource(sha256, '/fixed/controller --metadata');
  const result = spawnSync(process.env.SAKURA_TEST_PYTHON || 'python', ['-I', '-S', '-c', pythonModel],
    { input: JSON.stringify({ source, data: input.toString('base64'), sha256, ...options }), encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
}
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: original Python frame reader accepts fragmented protected frame while leaving binary protocol tail and EOF untouched
 * 协作入口 / Collaborators: `projectIdentityPayload`, `Buffer.from`, `frameModel`, `Buffer.concat`.
 * 检查边界 / Checked boundaries: `assert.equal(result.ok, true)`; `assert.equal(result.payload, payload.input.toString('base64'))`.
 */
test('original Python frame reader accepts fragmented protected frame while leaving binary protocol tail and EOF untouched', () => {
  const payload = projectIdentityPayload({ command: 'exec /adapter', environment: { TOKEN: '你好' }, stdin: 'session' });
  const tail = Buffer.from([0, 255, 128, 0, 13, 10]), result = frameModel(Buffer.concat([payload.input, tail]), payload.sha256, { fragment: 1 });
  assert.equal(result.ok, true); assert.equal(result.payload, payload.input.toString('base64'));
  assert.equal(result.rest, tail.toString('base64')); assert.equal(result.restored, true); assert.ok(Math.max(...result.reads) <= 65536);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: original Python frame reader rejects unsupported transport combinations, bounds, wrong digest, truncate, fd type and timeout
 * 协作入口 / Collaborators: `projectIdentityPayload`, `[0, 1, 3, 4, 0xffffffff].map`, `payload.input.subarray`, `Buffer.from`.
 * 检查边界 / Checked boundaries: `assert.equal(result.ok, false)`; `assert.equal(result.restored, true)`.
 */
test('original Python frame reader rejects unsupported transport combinations, bounds, wrong digest, truncate, fd type and timeout', () => {
  const payload = projectIdentityPayload({ command: 'exec /adapter', stdin: 'session' });
  const variants: [Buffer, Record<string, unknown>][] = [
    ...[0, 1, 3, 4, 0xffffffff].map(flags => { const input = Buffer.from(payload.input); input.writeUInt32LE(flags, 12); return [input, {}] as [Buffer, Record<string, unknown>]; }),
    [payload.input.subarray(0, 31), {}], [payload.input.subarray(0, -1), {}], [payload.input, { flags: 1 }],
    [payload.input, { mode: 32768 }], [payload.input, { mode: 8192 }], [payload.input, { timeout: true }],
  ];
  const reserved = Buffer.from(payload.input); reserved.writeUInt32LE(1, 28); variants.push([reserved, {}]);
  const huge = Buffer.from(payload.input); huge.writeUInt32LE(131041, 16); variants.push([huge, {}]);
  const wrongScript = Buffer.from(payload.input); wrongScript.writeUInt32LE(65537, 24); variants.push([wrongScript, {}]);
  const wrongCount = Buffer.from(payload.input); wrongCount.writeUInt32LE(129, 20); variants.push([wrongCount, {}]);
  const wrongVersion = Buffer.from(payload.input); wrongVersion.writeUInt32LE(2, 8); variants.push([wrongVersion, {}]);
  for (const [input, options] of variants) { const result = frameModel(input, createHash('sha256').update(input).digest('hex'), options); assert.equal(result.ok, false); assert.equal(result.restored, true); }
  const bad = frameModel(payload.input, 'f'.repeat(64)); assert.equal(bad.ok, false);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Root relay child launch owns separate PIPE frame and fd3 protocol, with pure stdout and metadata-only argv
 * 协作入口 / Collaborators: `projectIdentityPayload`, `projectProtocolRelaySource`, `assert.match`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.match(source, /os.dup2\(0,3\)/)`; `assert.match(source, /stdin=subprocess.PIPE,stdout=None,stderr=None/)`.
 */
test('Root relay child launch owns separate PIPE frame and fd3 protocol, with pure stdout and metadata-only argv', () => {
  const payload = projectIdentityPayload({ command: 'echo secret-script', environment: { TOKEN: 'private-env' }, stdin: 'session' });
  const source = projectProtocolRelaySource(payload.sha256, '/fixed/controller --uuid --sha256');
  assert.match(source, /os.dup2\(0,3\)/); assert.match(source, /stdin=subprocess.PIPE,stdout=None,stderr=None/);
  assert.match(source, /close_fds=True,pass_fds=\(3,\)/); assert.match(source, /finally:os.close\(3\)/);
  assert.match(source, /child.stdin.close\(\);code=child.wait/); assert.ok(!source.includes('secret-script') && !source.includes('private-env'));
  assert.ok(Buffer.byteLength(source) < 8192);
});
